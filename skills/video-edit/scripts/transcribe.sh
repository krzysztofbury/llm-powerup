#!/bin/bash
# Transcribe sources with local Whisper (large-v3-turbo), word timestamps, cached.
#
# usage: bash transcribe.sh <language> <out_dir> <video> [video ...]
#
# <language> is a Whisper code such as en or pl, always given explicitly:
# auto-detection is unreliable on short or noisy clips. A brand profile
# ($VIDEO_EDIT_BRAND or ~/.config/video-edit/brand.json) may restrict the
# allowed codes with "languages": ["en", "pl"].
# Writes <out_dir>/<video stem>.json and skips sources already transcribed.
# Also writes <out_dir>/<video stem>.pauses: silences measured from the audio,
# one "start end" line each, which pack_transcript.py shows as cut points.
set -euo pipefail

lang=${1:?usage: transcribe.sh <language> <out_dir> <video>...}
out=${2:?out_dir}
shift 2
[[ $lang =~ ^[a-z]{2,3}$ ]] || { echo "language must be a Whisper code such as en or pl, got: $lang" >&2; exit 2; }
brand=${VIDEO_EDIT_BRAND:-$HOME/.config/video-edit/brand.json}
if [[ -f $brand ]] && command -v jq >/dev/null; then
  allowed=$(jq -r '(.languages // []) | join(" ")' "$brand")
  if [[ -n $allowed && " $allowed " != *" $lang "* ]]; then
    echo "language $lang not allowed by $brand (allowed: $allowed)" >&2
    exit 2
  fi
fi
command -v whisper-ctranslate2 >/dev/null || {
  echo "missing whisper-ctranslate2: uv tool install --python 3.12 whisper-ctranslate2" >&2; exit 1; }
mkdir -p "$out"

todo=()
for v in "$@"; do
  stem=$(basename "${v%.*}")
  if [[ -s $out/$stem.json ]]; then echo "cached: $stem"; else todo+=("$v"); fi
done
if ((${#todo[@]})); then
  whisper-ctranslate2 "${todo[@]}" --model large-v3-turbo --language "$lang" --compute_type int8 \
    --word_timestamps True --output_format json --output_dir "$out" --threads "$(nproc)" \
    2>&1 | grep -vE 'Warning|warn' || true
  for v in "${todo[@]}"; do
    [[ -s $out/$(basename "${v%.*}").json ]] || { echo "transcription failed: $v" >&2; exit 1; }
  done
fi

# Whisper often runs word timestamps together and hides real pauses, so measure
# them from the audio as well.
for v in "$@"; do
  p=$out/$(basename "${v%.*}").pauses
  [[ -s $p ]] && continue
  ffmpeg -nostdin -hide_banner -nostats -i "$v" -vn -af silencedetect=noise=-38dB:d=0.18 -f null - 2>&1 |
    awk '/silence_start/ {s = $NF} /silence_end/ {print s, $5}' > "$p"
done
