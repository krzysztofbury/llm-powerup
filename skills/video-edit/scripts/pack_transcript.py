"""Pack word-level transcripts into one compact, timestamped text for planning cuts.

usage: python3 pack_transcript.py <transcripts_dir> [--gap 0.4] [--low 0.9]

One phrase per line, broken at pauses of at least --gap seconds, shown as
[gap 0.62s, cut 1662.94]: cut there, in the middle of the pause. Word timings
are trimmed with the measured pauses (<stem>.pauses from transcribe.sh, see
words.py), since Whisper alone often runs words together and hides pauses.
Words under --low confidence are marked with (?) and need a human ear before
they go into subtitles. Lines are flagged <REF> when they point elsewhere
("previous video", "later in the video"), which breaks a standalone short, and
<REPEAT> when a word or two repeat four or more times, which is how Whisper
hallucinates on silence or music, often at the end of a recording. Read this
instead of watching the footage; pull frames with timeline_view.py only where a
cut decision needs a look.
"""
import argparse
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # keep the installed skill directory clean
sys.path.insert(0, str(Path(__file__).resolve().parent))
from words import load_pauses, load_words  # noqa: E402

REF = re.compile(r"\b(previous|last|next|upcoming|another|earlier) (video|episode)|later in the video"
                 r"|(link|linked) (it|to it|in the description)|as (i|we) (said|mentioned)"
                 r"|as (presented|shown|you've seen|you have seen) (before|previously)", re.I)
REPEAT = re.compile(r"\b((?:[\w'-]+\s+){1,2}?)(?:\1){3,}", re.I)


def emit(start, end, words):
    text = " ".join(words)
    plain = re.sub(r"\(\?\)", "", text) + " "
    flags = (" <REF>" if REF.search(plain) else "") + (" <REPEAT>" if REPEAT.search(plain) else "")
    print(f"{start:7.2f}-{end:7.2f}  {text}{flags}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--gap", type=float, default=0.4)
    ap.add_argument("--low", type=float, default=0.9)
    a = ap.parse_args()
    for f in sorted(Path(a.dir).glob("*.json")):
        words = load_words(f)
        note = "" if load_pauses(f) else "  (no .pauses file: word gaps only, rerun transcribe.sh)"
        print(f"## {f.stem}{note}")
        line, start, prev_end = [], None, None
        for w in words:
            gap = w["start"] - prev_end if prev_end is not None else 0
            if line and gap >= a.gap:
                emit(start, prev_end, line)
                print(f"{'':15}  [gap {gap:.2f}s, cut {prev_end + gap / 2:.2f}]")
                line = []
            if not line:
                start = w["start"]
            text = w["word"].strip()
            line.append(text + ("(?)" if w.get("probability", 1) < a.low else ""))
            prev_end = w["end"]
        if line:
            emit(start, prev_end, line)
        print()


if __name__ == "__main__":
    main()
