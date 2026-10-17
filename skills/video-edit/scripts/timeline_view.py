"""Filmstrip plus waveform of one time range, as a PNG to look at.

usage: python3 timeline_view.py <video> <start> <end> <out.png> [--frames 8]

Use it at cut decisions and when reviewing a render, not to scan whole videos.
"""
import argparse
import subprocess
import tempfile
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("out")
    ap.add_argument("--frames", type=int, default=8)
    a = ap.parse_args()
    dur = max(a.end - a.start, 0.1)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        rate = a.frames / dur
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(a.start), "-t", str(dur), "-i", a.video,
                        "-vf", f"fps={rate},scale=240:-2,tile={a.frames}x1", "-frames:v", "1",
                        str(t / "strip.png")], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(a.start), "-t", str(dur), "-i", a.video,
                        "-filter_complex", f"showwavespic=s={240 * a.frames}x160:colors=#2563eb",
                        "-frames:v", "1", str(t / "wave.png")], check=True)
        label = f"{Path(a.video).name}  {a.start:.2f}s - {a.end:.2f}s"
        subprocess.run(["magick", str(t / "strip.png"), str(t / "wave.png"), "-background", "#111", "-append",
                        "-gravity", "north", "-splice", "0x34", "-fill", "white", "-pointsize", "22",
                        "-annotate", "+0+6", label, a.out], check=True)
    print(a.out)


if __name__ == "__main__":
    main()
