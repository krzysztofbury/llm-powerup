"""Check a render against its plan, and build a contact sheet to look at.

usage: python3 verify.py <project>/edl.json

Reads work/render.json written by render.py. Prints PASS/FAIL per check and
exits non-zero on any FAIL. Writes work/review.png: frames just before and after
every cut, and at every subtitle cue, from final_subs.mp4 (or final.mp4).
Numbers cover sound; the contact sheet covers what only eyes can judge, such
as subtitles over slides or a jump at a cut, so always look at it.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

BLEEP_BAND = "bandpass=f=1000:w=50"
NOTCH = "bandreject=f=1000:w=100"
SHORTS_UI = [(0, 0, 0.19, 0.07), (0.889, 0.77, 0.111, 0.23), (0, 0.915, 0.889, 0.085)]  # x, y, w, h of frame


def ff(args):
    return subprocess.run(["ffmpeg", "-hide_banner", *args], capture_output=True, text=True).stderr


def rms_steps(path, start, dur, af):
    """RMS level (dB) per 100 ms step over a window."""
    out = ff(["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(path), "-af",
              f"{af},asetnsamples=4800,astats=metadata=1:reset=1,"
              "ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"])
    vals = re.findall(r"RMS_level=(-?inf|-?[0-9.]+)", out)
    return [float("-inf") if "inf" in v else float(v) for v in vals]


def main():
    d = Path(sys.argv[1]).resolve().parent
    r = json.loads((d / "work" / "render.json").read_text())
    final = d / "final.mp4"
    shown = d / "final_subs.mp4" if (d / "final_subs.mp4").exists() else final
    fails = 0

    def check(ok, label, detail):
        nonlocal fails
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {label}: {detail}")

    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                "csv=p=0", str(final)], capture_output=True, text=True).stdout)
    check(abs(dur - r["duration"]) < 0.15, "duration", f"{dur:.2f}s, plan {r['duration']:.2f}s")

    loud = ff(["-i", str(final), "-af", "ebur128=peak=true", "-f", "null", "-"])
    i_val = float(re.findall(r"I:\s+(-?[0-9.]+) LUFS", loud)[-1])
    peak = float(re.findall(r"Peak:\s+(-?[0-9.]+) dBFS", loud)[-1])
    check(abs(i_val + 14) <= 0.5, "loudness", f"{i_val} LUFS (target -14, was {r['loudness_in']})")
    check(peak <= -1.0, "true peak", f"{peak} dBFS (max -1.0)")

    for a, b in r["bleeps_out"]:
        inner_start, inner = a + 0.05, max(b - a - 0.1, 0.1)
        tone = rms_steps(final, inner_start, inner, BLEEP_BAND)
        # Notch the tone out and see what is left. A notch rings for ~100 ms while it
        # settles, so the first step is skipped; after that, muted speech is silence.
        voice = rms_steps(final, inner_start, inner, ",".join([NOTCH] * 3))[1:]
        check(tone and min(tone) > -30, f"bleep tone {a:.2f}-{b:.2f}s",
              f"1 kHz band min {min(tone, default=float('-inf')):.1f} dB")
        check(voice and max(voice) < -45, f"speech muted {a:.2f}-{b:.2f}s",
              f"rest of spectrum max {max(voice, default=float('-inf')):.1f} dB")
    # A tone anywhere else means a bleep landed in the wrong place. A pure tone
    # puts nearly all its energy in the 1 kHz band; speech spreads across the
    # spectrum. Flag steps where the band carries almost everything, at any level.
    # Only when bleeps are planned: without them no tone is ever mixed in, and a
    # voice harmonic or filter ringing after a hard cut would be a false alarm.
    if r["bleeps_out"]:
        band = rms_steps(final, 0, dur, BLEEP_BAND)
        full = rms_steps(final, 0, dur, "anull")
        inside = lambda t: any(a - 0.15 <= t <= b + 0.15 for a, b in r["bleeps_out"])  # noqa: E731
        hits = [round(i * 0.1, 1) for i, (v, f) in enumerate(zip(band, full))
                if v > -60 and v - f > -6 and not inside(i * 0.1)]
        check(not hits, "no stray bleep", f"tone outside planned windows at {hits[:5]}" if hits else "none")
    else:
        print("SKIP  no stray bleep: no bleeps planned")

    size = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height", "-of", "csv=p=0", str(shown)], capture_output=True, text=True)
    vw, vh = map(int, size.stdout.strip().split(","))
    frame_w, cols = (240, 8) if vh > vw else (480, 4)  # vertical shorts: smaller frames, more per row
    # Vertical shorts: outline where the YouTube Shorts player draws over the video (mute and
    # play at the top left, like/comment/share on the right, channel and title at the bottom),
    # measured on the mobile site at phone size. Nothing important should sit inside the red.
    zones = "".join(f"drawbox=x=iw*{x}:y=ih*{y}:w=iw*{w}:h=ih*{h}:color=red@0.7:t=6,"
                    for x, y, w, h in SHORTS_UI) if vh > vw else ""
    times = [t + o for t in r["cuts"] for o in (-0.3, 0.3)] + r["cue_midpoints"]
    times = sorted(t for t in times if 0 <= t < dur)
    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for n, t in enumerate(times):
            f = Path(tmp) / f"{n:03}.png"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(shown), "-frames:v",
                            "1", "-vf", f"{zones}scale={frame_w}:-2,drawtext=text='{t:.1f}s':x=8:y=8:fontsize=22:"
                            "fontcolor=white:box=1:boxcolor=black@0.6", str(f)], check=True)
            if f.exists():  # a time in the last frame can yield no image
                frames.append(str(f))
        sheet = d / "work" / "review.png"
        if frames:
            subprocess.run(["magick", "montage", *frames, "-tile", f"{cols}x", "-geometry", "+4+4",
                            "-background", "#222", str(sheet)], check=True)
            print(f"LOOK  contact sheet: {sheet} ({len(frames)} frames at cuts and subtitle cues)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
