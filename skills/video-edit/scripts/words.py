"""Word timings from a Whisper transcript, corrected with measured pauses.

Whisper often runs word timestamps together: a pause before a word is folded
into that word (or a pause after it into its end). When transcribe.sh wrote
<stem>.pauses next to the transcript, each word is trimmed so that it no longer
covers a silence at its start or end. Used by pack_transcript.py and render.py.
"""
import bisect
import json
from pathlib import Path

EDGE = 0.15  # a silence this close to a word edge belongs outside the word


def load_pauses(transcript):
    p = Path(transcript).with_suffix(".pauses")
    if not p.is_file():
        return None
    return [tuple(map(float, line.split())) for line in p.read_text().splitlines() if line.strip()]


def load_words(transcript):
    """[{"start", "end", "word", "probability"}, ...] in order, trimmed by pauses when known."""
    words = [dict(w) for s in json.loads(Path(transcript).read_text())["segments"] for w in s.get("words", [])]
    pauses = load_pauses(transcript)
    if not pauses:
        return words
    starts = [p[0] for p in pauses]
    for w in words:
        i = bisect.bisect_left(starts, w["start"] - EDGE)
        while i < len(pauses) and pauses[i][0] < w["end"]:
            s, e = pauses[i]
            if s - w["start"] <= EDGE and e < w["end"]:
                w["start"] = e  # silence at the start of the word
            elif w["end"] - e <= EDGE and s > w["start"]:
                w["end"] = s    # silence at the end of the word
            i += 1
    return words
