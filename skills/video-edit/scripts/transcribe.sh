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
((${#todo[@]})) || exit 0

whisper-ctranslate2 "${todo[@]}" --model large-v3-turbo --language "$lang" --compute_type int8 \
  --word_timestamps True --output_format json --output_dir "$out" --threads "$(nproc)" \
  2>&1 | grep -vE 'Warning|warn' || true
for v in "${todo[@]}"; do
  [[ -s $out/$(basename "${v%.*}").json ]] || { echo "transcription failed: $v" >&2; exit 1; }
done
