"""Render an edit decision list (edl.json) into finished files.

usage: python3 render.py <project>/edl.json [--no-cards-cache]

Writes next to the EDL:
  final.mp4        clean cut, loudness -14 LUFS, for YouTube with final.srt
  final_subs.mp4   the same with subtitles burned in (box style)
  final.srt        subtitles on the output timeline, bleeped words masked
  final.otio       editable timeline for Kdenlive or Resolve (only when
                   opentimelineio is importable by this Python)
  work/render.json offsets, cut points and bleep windows, read by verify.py

EDL fields (times in seconds, source time unless noted):
  name, language (Whisper code such as en or pl), fps, width, height
  brand:     optional path to a brand profile (see brand.example.json)
  sources:   {"key": "/absolute/path.mp4", ...}
  segments:  [{"source": key, "start": s, "end": e, "quote": "...", "reason": "..."}
              | {"card": "title" | "endcard", "duration": d, "vars": {...}}]
  bleeps:    [{"source": key, "start": s, "end": e, "mask": "K***a"}]
  corrections: [{"source": key, "start": s, "end": e, "text": "ctid"}]  words in the
             window become one word with this text (names Whisper got wrong);
             "text": "" drops them from the subtitles only (stutters, fillers)
  jumpcut:   {"min_pause": 0.3, "keep": 0.1, "punch": 1.12}  split media segments at
             pauses of min_pause or more, keeping keep seconds each side; punch zooms
             every other piece (panels marked "punch") to hide the jump
  subtitles: true | false   (default true)

Vertical shorts ("format": "short", 1080x1920 by default, no cards):
  short:     {"title": "...", "subtitle": "...", "highlight": ["distinct", ...],
              "caption_y": 1500, "caption_size": 92, "header_y": 140}
  views:     {"name": [panel, ...]}, panels as documented in shorts.py
  segments:  media segments name their "view" (default: the first view) and may
             override "title" / "subtitle" / "caption_y"

The brand profile is read from the EDL "brand" path, else $VIDEO_EDIT_BRAND,
else ~/.config/video-edit/brand.json, else neutral defaults.

Each media segment is extracted on its own with 30 ms audio fades, normalised
to fps, size and 48 kHz stereo, then joined losslessly. Loudness is set in two
passes on the joined program. Subtitles are burned last.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # keep the installed skill directory clean
sys.path.insert(0, str(Path(__file__).resolve().parent))
import shorts  # noqa: E402
import subtitles  # noqa: E402
from words import load_words  # noqa: E402

SKILL = Path(__file__).resolve().parent.parent
HYPERFRAMES = "hyperframes@0.8.168"
FADE = 0.03            # audio fade at every segment boundary, seconds
BLEEP_PAD = 0.04       # widen each bleep window a little, seconds
BLEEP_HZ = 1000
LOUDNESS = "I=-14:TP=-1.5:LRA=11"
DEFAULT_BRAND = {
    "accent": "#2563eb", "text": "#334155", "background": "#ffffff", "font": "Inter",
    "logo": None, "mark": None, "header_html": "", "url": "", "languages": None,
}
SUB_STYLE = ("FontName=Noto Sans,Bold=1,FontSize=15,PrimaryColour=&H00FFFFFF,"
             "BackColour=&H66000000,OutlineColour=&H66000000,BorderStyle=3,"
             "Outline=0.8,Shadow=0,MarginV=20")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(map(str, cmd))}\n{r.stderr[-2000:]}")
    return r


def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration",
               "-of", "json", str(path)]).stdout
    data = json.loads(out)
    return float(data["format"]["duration"]), any(s["codec_type"] == "audio" for s in data["streams"])


def load_brand(edl, edl_dir):
    candidates = [edl_dir / edl["brand"]] if edl.get("brand") else []
    if os.environ.get("VIDEO_EDIT_BRAND"):
        candidates.append(Path(os.environ["VIDEO_EDIT_BRAND"]).expanduser())
    candidates.append(Path.home() / ".config/video-edit/brand.json")
    for c in candidates:
        if c.is_file():
            brand = dict(DEFAULT_BRAND, **json.loads(c.read_text()))
            for k in ("logo", "mark"):
                if brand.get(k):
                    brand[k] = str((c.parent / Path(brand[k]).expanduser()).resolve())
            brand["_path"] = str(c)
            return brand
    return dict(DEFAULT_BRAND, _path="defaults")


COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def fill_template(html, brand, duration):
    for key in ("accent", "text", "background"):
        if not COLOR.match(str(brand[key])):
            sys.exit(f"brand {key} must be a hex colour, got {brand[key]!r}")
    font = re.sub(r"[^A-Za-z0-9 ]", "", brand["font"]) or "Inter"
    has_logo = bool(brand.get("logo")) and Path(brand["logo"]).is_file()
    if not has_logo:  # drop the element so the renderer does not wait for a missing asset
        html = re.sub(r"\s*<img id=\"logo\"[^>]*/>", "", html)
    values = {
        "__FONT_URL__": "https://fonts.googleapis.com/css2?family="
                        f"{font.replace(' ', '+')}:wght@400;700;900&display=block",
        "__FONT__": font, "__ACCENT__": brand["accent"], "__TEXT__": brand["text"],
        "__BACKGROUND__": brand["background"], "__LOGO_DISPLAY__": "block",
        "__URL_TOP__": "650" if has_logo else "480", "__DURATION__": str(duration),
        # JSON keeps the brand's markup a valid JS string; it is the brand owner's own HTML.
        '"__HEADER_HTML__"': json.dumps(brand.get("header_html") or ""),
    }
    for k, v in values.items():
        html = html.replace(k, v)
    return html, has_logo


def render_card(seg, fps, work, brand):
    template = SKILL / "templates" / seg["card"]
    if not template.is_dir():
        sys.exit(f"unknown card template: {seg['card']}")
    variables = dict(seg.get("vars", {}))
    if seg["card"] == "endcard":
        variables.setdefault("url", brand.get("url") or "")
    brand_key = {k: v for k, v in brand.items() if k != "_path"}
    key = hashlib.sha1(json.dumps([seg["card"], variables, fps, seg["duration"], brand_key],
                                  sort_keys=True).encode()).hexdigest()[:10]
    out = work / f"card_{seg['card']}_{key}.mp4"
    if out.exists():
        return out
    proj = work / f"card_{seg['card']}_{key}"
    shutil.rmtree(proj, ignore_errors=True)
    shutil.copytree(template, proj)
    html, has_logo = fill_template((proj / "index.html").read_text(), brand, seg["duration"])
    (proj / "index.html").write_text(html)
    if has_logo:
        (proj / "assets").mkdir(exist_ok=True)
        shutil.copy(brand["logo"], proj / "assets" / "logo.png")
    run(["npx", "-y", HYPERFRAMES, "render", str(proj), "--fps", str(fps), "--quality", "delivery",
         "--variables", json.dumps(variables), "-o", str(out), "--quiet"],
        env={**os.environ, "HYPERFRAMES_SKIP_SKILLS": "1"})
    return out


def video_chain(fps, w, h):
    return (f"fps={fps},scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p")


def extract(src, start, dur, has_audio, bleeps, fps, w, h, out, fade=True, layout=None):
    """One normalised segment; bleeps are (start, end) relative to the segment.
    layout: (extra inputs, graph from [0:v] to [v]) from shorts.view_graph, else scale and pad."""
    inputs = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src)]
    if layout:
        inputs += layout[0]
    if has_audio:
        mute = "".join(f",volume=0:enable='between(t,{a:.3f},{b:.3f})'" for a, b in bleeps)
        fades = f",afade=t=in:d={FADE},afade=t=out:st={max(dur - FADE, 0):.3f}:d={FADE}" if fade else ""
        audio = f"[0:a]aresample=48000,aformat=channel_layouts=stereo{mute}{fades}[dia]"
    else:
        audio = f"anullsrc=r=48000:cl=stereo,atrim=0:{dur:.3f}[dia]"
    tones, labels = [], ["[dia]"]
    for i, (a, b) in enumerate(bleeps):
        # adelay takes milliseconds; a bare "5.02s" is not read as seconds on this ffmpeg
        tones.append(f"sine=f={BLEEP_HZ}:r=48000:d={b - a:.3f},volume=0.2,"
                     f"aformat=channel_layouts=stereo,adelay={round(a * 1000)}:all=1[t{i}]")
        labels.append(f"[t{i}]")
    mix = (f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first[a]"
           if bleeps else ";[dia]anull[a]")
    video = layout[1] if layout else f"[0:v]{video_chain(fps, w, h)}[v]"
    graph = f"{video};{audio}" + "".join(f";{t}" for t in tones) + mix
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-crf", "12", "-preset", "medium", "-c:a", "pcm_s16le", "-t", f"{dur:.3f}",
         str(out)])


def words_for(transcripts_dir, src_path, corrections=()):
    """(start, end, text) per word, timings trimmed by measured pauses, corrections applied."""
    f = transcripts_dir / f"{Path(src_path).stem}.json"
    if not f.exists():
        return []
    out = [(w["start"], w["end"], w["word"].strip()) for w in load_words(f)]
    for c in corrections:
        hit = [w for w in out if c["start"] <= (w[0] + w[1]) / 2 <= c["end"]]
        if hit:
            out = [w for w in out if w not in hit]
            if c["text"]:  # empty text drops the words from the subtitles (stutters, fillers)
                out.append((hit[0][0], hit[-1][1], c["text"]))
    return sorted(out)


def jumpcut(segments, sources, transcripts, cfg):
    """Split media segments at pauses of cfg min_pause or more, keeping cfg keep each side."""
    min_pause, keep = cfg.get("min_pause", 0.3), cfg.get("keep", 0.1)
    if keep * 2 >= min_pause:
        sys.exit("jumpcut keep must be under half of min_pause, or the pieces overlap and repeat audio")
    out = []
    for seg in segments:
        if "card" in seg:
            out.append(seg)
            continue
        # Uncorrected words: a subtitle-only drop must not turn into a cut in the audio.
        ws = [w for w in words_for(transcripts, sources[seg["source"]]) if seg["start"] <= w[0] < seg["end"]]
        a = seg["start"]
        for w1, w2 in zip(ws, ws[1:]):
            if w2[0] - w1[1] >= min_pause:
                out.append(dict(seg, start=a, end=w1[1] + keep))
                a = w2[0] - keep
        out.append(dict(seg, start=a))
    return out


def filter_path(p):
    return str(p).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def mask_word(text, mask):
    core = text.strip(",.?!;:")
    return text.replace(core, mask) if core else text


def main():
    edl_path = Path(sys.argv[1]).resolve()
    edl = json.loads(edl_path.read_text())
    d = edl_path.parent
    brand = load_brand(edl, d)
    lang = edl.get("language")
    if not lang or (brand.get("languages") and lang not in brand["languages"]):
        sys.exit(f"language {lang!r} not allowed; brand allows {brand.get('languages') or 'any, but set one'}")
    print(f"brand: {brand['_path']}")
    work = d / "work"
    work.mkdir(exist_ok=True)
    short = edl.get("format") == "short"
    fps = edl.get("fps", 25)
    w, h = edl.get("width", 1080 if short else 1920), edl.get("height", 1920 if short else 1080)
    sources = {k: Path(v) for k, v in edl["sources"].items()}
    transcripts = d / edl.get("transcripts", "transcripts")
    corrections = {}
    for c in edl.get("corrections", []):
        corrections.setdefault(c["source"], []).append(c)
    segments = edl["segments"]
    if short and any("card" in s for s in segments):
        sys.exit("cards are 16:9 templates; leave them out of a short (open cold on the hook)")
    if edl.get("jumpcut"):
        segments = jumpcut(segments, sources, transcripts, edl["jumpcut"])
    cfg = edl.get("short", {})
    caption_y = []  # (output start, y) per segment, for the short captions

    parts, timeline, words_out, cursor = [], [], [], 0.0
    for i, seg in enumerate(segments):
        part = work / f"seg_{i:03}.mkv"
        if "card" in seg:
            card = render_card(seg, fps, work, brand)
            extract(card, 0, seg["duration"], False, [], fps, w, h, part, fade=False)
            timeline.append({"kind": "card", "card": seg["card"], "file": str(card),
                             "out_start": cursor, "duration": seg["duration"]})
            cursor += seg["duration"]
            parts.append(part)
            continue
        src = sources[seg["source"]]
        dur_src, has_audio = probe(src)
        # Whole frames only, or every joined part adds up to a frame of drift.
        start = round(seg["start"] * fps) / fps
        end = min(round(seg["end"] * fps) / fps, int(dur_src * fps) / fps)
        dur = end - start
        local = []
        for b in edl.get("bleeps", []):
            if b["source"] == seg["source"] and b["end"] > start and b["start"] < end:
                a = max(b["start"] - BLEEP_PAD, start) - start
                z = min(b["end"] + BLEEP_PAD, end) - start
                local.append((a, z))
        layout = None
        if short:
            views = edl.get("views") or {"full": [{"crop": [0, 0, 1280, 720], "at": [0, 656], "width": w}]}
            view = views[seg.get("view") or next(iter(views))]
            png = shorts.chrome(brand, seg.get("title", cfg.get("title", "")),
                                seg.get("subtitle", cfg.get("subtitle", "")), w, h, work, cfg.get("header_y", 140))
            zoom = edl.get("jumpcut", {}).get("punch", 1.0) if i % 2 else 1.0
            layout = shorts.view_graph(view, brand, png, fps, dur, work, zoom)
            caption_y.append((cursor, seg.get("caption_y", cfg.get("caption_y", 1500))))
        extract(src, start, dur, has_audio, local, fps, w, h, part, layout=layout)
        timeline.append({"kind": "media", "source": seg["source"], "file": str(src), "in": start,
                         "out": end, "out_start": cursor, "duration": dur, "quote": seg.get("quote", ""),
                         "bleeps_out": [(cursor + a, cursor + z) for a, z in local]})
        for ws, we, text in words_for(transcripts, src, corrections.get(seg["source"], [])):
            if start - 0.05 <= ws < end - 0.02:  # a word belongs where it starts
                we = min(we, end)
                for b in edl.get("bleeps", []):
                    if b["source"] == seg["source"] and ws < b["end"] and we > b["start"] and b.get("mask"):
                        text = mask_word(text, b["mask"])
                words_out.append((cursor + max(ws - start, 0), cursor + we - start, text))
        cursor += dur
        parts.append(part)

    # Join losslessly: every part shares codec, fps, size and audio format.
    concat = work / "concat.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in parts))
    program = work / "program_raw.mkv"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy",
         str(program)])

    # Two-pass loudness on the joined program.
    meas = run(["ffmpeg", "-hide_banner", "-i", str(program), "-af",
                f"loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-"]).stderr
    m = json.loads(meas[meas.rindex("{"):meas.rindex("}") + 1])
    norm = (f"loudnorm={LOUDNESS}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
            f"offset={m['target_offset']}:linear=true,aresample=48000")
    enc = ["-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"]
    run(["ffmpeg", "-v", "error", "-y", "-i", str(program), "-af", norm, *enc, str(d / "final.mp4")])

    srt = d / "final.srt"
    srt.write_text(subtitles.build_srt(words_out))
    if edl.get("subtitles", True) and words_out:
        if short:
            ass = d / "final.ass"
            y_at = lambda t: next(y for s, y in reversed(caption_y) if s <= t + 1e-6)  # noqa: E731
            cuts = [t["out_start"] for t in timeline[1:]]
            ass.write_text(shorts.build_ass(words_out, brand, cfg, w, h, y_at, cuts))
            vf = f"subtitles={filter_path(ass)}:fontsdir={filter_path(shorts.FONT_CACHE)}"
        else:
            vf = f"subtitles={filter_path(srt)}:force_style='{SUB_STYLE}'"
        run(["ffmpeg", "-v", "error", "-y", "-i", str(program), "-vf", vf, "-af", norm, *enc,
             str(d / "final_subs.mp4")])

    bleep_wav = work / "bleep.wav"
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f={BLEEP_HZ}:r=48000:d=2",
         "-af", "volume=0.2", "-ac", "2", str(bleep_wav)])
    summary = {"duration": cursor, "fps": fps, "timeline": timeline,
               "cuts": [t["out_start"] for t in timeline[1:]],
               "bleeps_out": [b for t in timeline for b in t.get("bleeps_out", [])],
               "cue_midpoints": subtitles.cue_midpoints(words_out), "bleep_wav": str(bleep_wav),
               "loudness_in": m["input_i"]}
    (work / "render.json").write_text(json.dumps(summary, indent=2))
    write_otio(d, edl, summary)
    print(f"rendered {cursor:.2f}s: {d / 'final.mp4'}")


def write_otio(d, edl, summary):
    try:
        import opentimelineio as otio
    except ImportError:
        print("opentimelineio not importable; skipped final.otio (install opentimelineio for this Python)")
        return
    fps = summary["fps"]
    rt = lambda s: otio.opentime.RationalTime(round(s * fps), fps)  # noqa: E731
    rng = lambda a, n: otio.opentime.TimeRange(rt(a), rt(n))  # noqa: E731

    def clip(name, path, start, dur):
        full, _ = probe(path)
        ref = otio.schema.ExternalReference(target_url=Path(path).resolve().as_uri(),
                                            available_range=rng(0, full))
        return otio.schema.Clip(name=name, media_reference=ref, source_range=rng(start, dur))

    tl = otio.schema.Timeline(name=edl.get("name", "edit"), global_start_time=rt(0))
    v = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    a = otio.schema.Track(name="A1 dialogue", kind=otio.schema.TrackKind.Audio)
    b = otio.schema.Track(name="A2 bleep", kind=otio.schema.TrackKind.Audio)
    bleep_cursor = 0.0
    for t in summary["timeline"]:
        if t["kind"] == "card":
            v.append(clip(t["card"], t["file"], 0, t["duration"]))
            a.append(otio.schema.Gap(source_range=rng(0, t["duration"])))
            continue
        v.append(clip(t["source"], t["file"], t["in"], t["duration"]))
        pos = t["out_start"]
        for x, y in t["bleeps_out"]:  # dialogue split around each bleep, tone on its own track
            a.append(clip(t["source"], t["file"], t["in"] + pos - t["out_start"], x - pos))
            a.append(otio.schema.Gap(source_range=rng(0, y - x)))
            b.append(otio.schema.Gap(source_range=rng(0, x - bleep_cursor)))
            b.append(clip("bleep", summary["bleep_wav"], 0, y - x))
            bleep_cursor, pos = y, y
        end = t["out_start"] + t["duration"]
        a.append(clip(t["source"], t["file"], t["in"] + pos - t["out_start"], end - pos))
    for track in (v, a, b):
        tl.tracks.append(track)
    otio.adapters.write_to_file(tl, str(d / "final.otio"))


if __name__ == "__main__":
    main()
