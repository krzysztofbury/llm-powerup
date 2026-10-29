"""Subtitle cues from Whisper word timestamps.

Cues follow sentences, split at a comma when long, and wrap into at most two
balanced lines. Whisper sometimes returns no punctuation at all, so a long
pause also ends a sentence and a cue never grows past two lines. Used by render.py; importable on its own.
"""

MAX_LINE = 42           # characters per subtitle line
MAX_CUE = 2 * MAX_LINE  # two lines per cue
COMMA_SPLIT = 30        # split at a comma once the cue is this long
TAIL = 0.3              # seconds a cue stays up after its last word
PAUSE = 0.5             # a pause this long ends a sentence
GAP = 0.08              # minimum gap between cues: 2 frames at 25 fps and up (Netflix)
CLOSE = 0.5             # a shorter gap is closed down to GAP, so cues do not flicker
MIN_DUR = 0.84          # 20 frames at 24 fps (Netflix minimum event duration)


def _joined(ws):
    return " ".join(w[2] for w in ws)


def _sentences(words):
    cur = []
    for i, w in enumerate(words):
        cur.append(w)
        if (w[2] and w[2][-1] in ".?!") or (i + 1 < len(words) and words[i + 1][0] - w[1] >= PAUSE):
            yield cur
            cur = []
    if cur:
        yield cur


def _chunks(sentence):
    pieces, cur = [], []
    for w in sentence:
        if cur and len(_joined(cur + [w])) > MAX_CUE:
            pieces.append(cur)
            cur = []
        cur.append(w)
        if w[2].endswith(",") and len(_joined(cur)) > COMMA_SPLIT:
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    merged = []
    for p in pieces:  # put back together what still fits one cue
        if merged and len(_joined(merged[-1] + p)) <= MAX_CUE:
            merged[-1] += p
        else:
            merged.append(p)
    return merged


def wrap(text):
    if len(text) <= MAX_LINE:
        return text
    words = text.split()
    splits = ((" ".join(words[:i]), " ".join(words[i:])) for i in range(1, len(words)))
    a, b = min(splits, key=lambda ab: max(len(ab[0]), len(ab[1])))
    return f"{a}\n{b}"


def timestamp(t):
    ms = round(t * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def build_srt(words):
    """words: (start, end, text) on the output timeline, in order."""
    cues = [c for s in _sentences(words) for c in _chunks(s)]
    blocks = []
    for i, c in enumerate(cues):
        start, end = c[0][0], max(c[-1][1] + TAIL, c[0][0] + MIN_DUR)
        if i + 1 < len(cues):
            nxt = cues[i + 1][0][0] - GAP
            end = max(nxt if nxt - end < CLOSE else min(end, nxt), start + GAP)
        blocks.append(f"{i + 1}\n{timestamp(start)} --> {timestamp(end)}\n{wrap(_joined(c))}\n")
    return "\n".join(blocks)


def cue_midpoints(words):
    cues = [c for s in _sentences(words) for c in _chunks(s)]
    return [(c[0][0] + c[-1][1]) / 2 for c in cues]
