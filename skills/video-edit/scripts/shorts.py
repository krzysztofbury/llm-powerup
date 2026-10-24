"""Vertical short layout for render.py: panels cropped from 16:9 footage on a branded canvas.

Used when the EDL has "format": "short". A view is a list of panels, each a crop
of the source placed on a 1080x1920 canvas:

  {"crop": [x, y, w, h], "at": [x, y], "width": 1040,
   "shape": "rect" | "circle", "border": "accent" | "#hex" | null, "punch": true}

The canvas (brand "canvas" colour, a header row with the brand "mark" and the
title and subtitle, or the logo on a light pill above them) is drawn once per
header as a PNG. Captions are big chunks of one to
three words in the brand font, keywords in the accent colour, burned from an
ASS file. Brand fonts are fetched from Google Fonts into ~/.cache/video-edit.
"""
import hashlib
import json
import re
import subprocess
import urllib.request
from pathlib import Path

FONT_CACHE = Path.home() / ".cache/video-edit/fonts"
DEFAULT_CANVAS = "#111416"
CHUNK_WORDS = 3     # words per caption chunk
CHUNK_CHARS = 16    # characters per caption chunk
CHUNK_GAP = 0.25    # a pause this long starts a new chunk
CHUNK_TAIL = 0.25   # seconds a chunk stays up after its last word when nothing follows


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(map(str, cmd))}\n{r.stderr[-2000:]}")
    return r


def font_file(family, weight):
    """Path to a TTF of the family at weight (Black, Bold, Regular), downloaded once."""
    name = re.sub(r"[^A-Za-z0-9]", "", family)
    f = FONT_CACHE / f"{name}-{weight}.ttf"
    if f.is_file():
        return f
    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    for licence in ("ofl", "apache", "ufl"):
        url = f"https://github.com/google/fonts/raw/main/{licence}/{name.lower()}/{name}-{weight}.ttf"
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                f.write_bytes(r.read())
            return f
        except OSError:
            continue
    # Not a static Google Fonts file (variable fonts have other names): ask fontconfig.
    style = {"Black": "black", "Bold": "bold"}.get(weight, "regular")
    path = run(["fc-match", "-f", "%{file}", f"{family}:{style}"]).stdout.strip()
    return Path(path)


def font_family(path):
    """The most specific family name inside a font file, as libass matches it."""
    names = run(["fc-scan", "--format", "%{family}", str(path)]).stdout.split(",")
    return names[-1].strip()


def ass_colour(hex_colour):
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


def chrome(brand, title, subtitle, w, h, work, top=140):
    """Canvas PNG: background and header, cached by content. With a brand "mark" (the logo
    without words) the header is one row: mark on the left, title and subtitle beside it.
    Without one, the logo sits on a light pill above a centred title and subtitle."""
    key = hashlib.sha1(json.dumps([brand.get("canvas"), brand["accent"], brand["font"], brand.get("logo"),
                                   brand.get("mark"), title, subtitle, w, h, top]).encode()).hexdigest()[:10]
    out = work / f"chrome_{key}.png"
    if out.exists():
        return out
    if any(t.startswith("@") for t in (title, subtitle) if t):
        raise SystemExit("short title and subtitle must not start with @ (ImageMagick reads it as a file)")
    black, bold = font_file(brand["font"], "Black"), font_file(brand["font"], "Bold")
    cmd = ["magick", "-size", f"{w}x{h}", f"xc:{brand.get('canvas') or DEFAULT_CANVAS}"]

    def text(t, font, colour, box_w, box_h, gravity, x, y, place="northwest"):
        return ["(", "-size", f"{box_w}x{box_h}", "-background", "none", "-fill", colour, "-font", str(font),
                "-gravity", gravity, f"caption:{t}", ")", "-gravity", place, "-geometry", f"+{x}+{y}",
                "-composite"]

    mark, logo = brand.get("mark"), brand.get("logo")
    if mark and Path(mark).is_file():
        mark_h, margin, gap = 150, 40, 28
        mark_w = int(run(["magick", mark, "-resize", f"x{mark_h}", "-format", "%w", "info:"]).stdout)
        cmd += ["(", mark, "-resize", f"x{mark_h}", ")", "-gravity", "northwest", "-geometry",
                f"+{margin}+{top}", "-composite"]
        x = margin + mark_w + gap
        text_w = w - x - margin
        title_h, sub_h = (96, 50) if subtitle else (mark_h, 0)
        if title:
            cmd += text(title, black, "white", text_w, title_h, "west", x, top + (2 if subtitle else 0))
        if subtitle:
            cmd += text(subtitle, bold, brand["accent"], text_w, sub_h, "west", x, top + title_h + 2)
    else:
        y = top
        if logo and Path(logo).is_file():
            pill_h, logo_h = 120, 104
            logo_w = int(run(["magick", logo, "-trim", "-resize", f"x{logo_h}", "-format", "%w", "info:"]).stdout)
            pill_w = logo_w + pill_h
            cmd += ["(", "-size", f"{pill_w}x{pill_h}", "xc:none", "-fill", "white", "-draw",
                    f"roundrectangle 0,0 {pill_w - 1},{pill_h - 1} {pill_h // 2},{pill_h // 2}",
                    "(", logo, "-trim", "-resize", f"x{logo_h}", ")", "-gravity", "center", "-composite", ")",
                    "-gravity", "north", "-geometry", f"+0+{y}", "-composite"]
            y += pill_h + 24
        if title:
            cmd += text(title, black, "white", w - 100, 120, "center", 0, y, "north")
            y += 124
        if subtitle:
            cmd += text(subtitle, bold, brand["accent"], w - 160, 64, "center", 0, y, "north")
    run(cmd + [str(out)])
    return out


def circle_mask(d, work):
    out = work / f"mask_circle_{d}.png"
    if not out.exists():
        r = d / 2
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=black:s={d}x{d}", "-vf",
             f"format=gray,geq=lum='if(lt(hypot(X-{r - 0.5},Y-{r - 0.5}),{r - 1}),255,0)'",
             "-frames:v", "1", str(out)])
    return out


def _even(x):
    return int(round(x / 2) * 2)


def view_graph(view, brand, chrome_png, fps, dur, work, zoom=1.0):
    """(extra ffmpeg inputs, filter graph from [0:v] to [v]) for one view."""
    loop = ["-loop", "1", "-framerate", str(fps), "-t", f"{dur:.3f}", "-i"]
    inputs = loop + [str(chrome_png)]
    split = "".join(f"[s{i}]" for i in range(len(view)))
    graph = [f"[0:v]fps={fps},split={len(view)}{split}", "[1:v]format=yuv420p,setsar=1[o0]"]
    nxt = 2
    for i, p in enumerate(view):
        x, y, cw, ch = p["crop"]
        if p.get("punch") and zoom != 1.0:  # punch in around the centre of the crop
            nw, nh = cw / zoom, ch / zoom
            x, y, cw, ch = x + (cw - nw) / 2, y + (ch - nh) / 2, nw, nh
        width = _even(p["width"])
        height = _even(width * ch / cw)
        chain = f"[s{i}]crop={_even(cw)}:{_even(ch)}:{int(x)}:{int(y)},scale={width}:{height},setsar=1"
        if p.get("shape") == "circle":
            inputs += loop + [str(circle_mask(width, work))]
            graph += [f"{chain},format=yuva420p[c{i}]", f"[{nxt}:v]format=gray[m{i}]",
                      f"[c{i}][m{i}]alphamerge[p{i}]"]
            nxt += 1
        else:
            if p.get("border"):
                colour = brand["accent"] if p["border"] == "accent" else p["border"]
                chain += f",pad={width + 8}:{height + 8}:4:4:color={colour}"
            graph.append(f"{chain}[p{i}]")
        graph.append(f"[o{i}][p{i}]overlay={p['at'][0]}:{p['at'][1]}:shortest=1[o{i + 1}]")
    graph.append(f"[o{len(view)}]format=yuv420p[v]")
    return inputs, ";".join(graph)


def _norm(t):
    return re.sub(r"[^\w']", "", t.lower())


def _highlighted(words, phrases):
    marks = set()
    toks = [_norm(w[2]) for w in words]
    for phrase in phrases:
        p = [_norm(t) for t in phrase.split()]
        for i in range(len(toks) - len(p) + 1):
            if toks[i:i + len(p)] == p:
                marks.update(range(i, i + len(p)))
    return marks


def _chunks(words, cuts):
    cur = []
    for i, w in enumerate(words):
        if cur:
            text = " ".join(words[j][2] for j in cur + [i])
            prev = words[cur[-1]]
            if (len(cur) >= CHUNK_WORDS or len(text) > CHUNK_CHARS or w[0] - prev[1] >= CHUNK_GAP
                    or prev[2][-1:] in ".,?!" or any(prev[0] < c <= w[0] for c in cuts)):
                yield cur
                cur = []
        cur.append(i)
    if cur:
        yield cur


def _ts(t):
    cs = round(t * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}"


def build_ass(words, brand, cfg, w, h, caption_y, cuts=()):
    """Big chunked captions. words: (start, end, text) on the output timeline.
    caption_y(t) gives the caption centre line at output time t; a chunk never spans a cut."""
    family = font_family(font_file(brand["font"], "Black"))
    accent = ass_colour(brand["accent"])
    size = cfg.get("caption_size", 92)
    marks = _highlighted(words, cfg.get("highlight", []))
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Short,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,0,0,0,0,100,100,0,0,"
            "1,7,3,5,70,70,0,1\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    chunks = list(_chunks(words, cuts))
    lines = []
    for k, c in enumerate(chunks):
        start = words[c[0]][0]
        end = words[c[-1]][1] + CHUNK_TAIL
        if k + 1 < len(chunks):
            nxt = words[chunks[k + 1][0]][0]
            # hold the chunk until the next one when the gap is short, so captions do not flicker
            end = nxt - 0.01 if nxt - words[c[-1]][1] < 0.6 else min(end, nxt - 0.01)
        text = " ".join((f"{{\\c{accent}}}{words[i][2].upper()}{{\\c&H00FFFFFF&}}" if i in marks
                         else words[i][2].upper()) for i in c)
        pop = r"\fscx82\fscy82\t(0,90,\fscx100\fscy100)"
        lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Short,,0,0,0,,"
                     f"{{\\an5\\pos({w // 2},{caption_y(start)}){pop}}}{text}")
    return head + "\n".join(lines) + "\n"
