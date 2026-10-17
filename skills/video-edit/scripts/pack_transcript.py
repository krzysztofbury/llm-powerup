"""Pack word-level transcripts into one compact, timestamped text for planning cuts.

usage: python3 pack_transcript.py <transcripts_dir> [--gap 0.4] [--low 0.9]

One phrase per line, broken at pauses. Pauses of at least --gap seconds are
shown as [gap 0.62s]: they are the clean places to cut. Words under --low
confidence are marked with (?) and need a human ear before they go into
subtitles. Read this instead of watching the footage; pull frames with
timeline_view.py only where a cut decision needs a look.
"""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--gap", type=float, default=0.4)
    ap.add_argument("--low", type=float, default=0.9)
    a = ap.parse_args()
    for f in sorted(Path(a.dir).glob("*.json")):
        words = [w for s in json.loads(f.read_text())["segments"] for w in s.get("words", [])]
        print(f"## {f.stem}")
        line, start, prev_end = [], None, None
        for w in words:
            gap = w["start"] - prev_end if prev_end is not None else 0
            if line and gap >= a.gap:
                print(f"{start:7.2f}-{prev_end:7.2f}  {' '.join(line)}")
                print(f"{'':15}  [gap {gap:.2f}s]")
                line = []
            if not line:
                start = w["start"]
            text = w["word"].strip()
            line.append(text + ("(?)" if w.get("probability", 1) < a.low else ""))
            prev_end = w["end"]
        if line:
            print(f"{start:7.2f}-{prev_end:7.2f}  {' '.join(line)}")
        print()


if __name__ == "__main__":
    main()
