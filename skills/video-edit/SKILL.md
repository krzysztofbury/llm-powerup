---
name: video-edit
description: Use when editing recorded video footage - cutting or trimming talking-head or screen recordings, joining takes, removing retakes or pauses, adding subtitles or captions, bleeping words, adding title or end cards, fixing loudness for YouTube, cutting a Short from a longer recording, or handing a rough cut to Kdenlive or DaVinci Resolve.
---

# Video edit

Edit by reading, not watching. Footage becomes a word-level transcript; cuts
are decided from words and pauses; frames are pulled only where a decision
needs eyes; every render is checked by numbers and by a contact sheet. A human
makes the final pass by eye in an editor. Method adapted from
[video-use](https://github.com/browser-use/video-use) ([MIT](LICENSE.upstream)),
with local transcription instead of a paid API.

Scripts live in `scripts/`; run them with `bash` and `python3`. `final.otio`
needs a Python with `opentimelineio`; without it the render skips that file.

## Workflow

1. **Project.** One directory per edit, for example `~/Videos/Edits/<name>/`.
   Never modify sources.
2. **Transcribe.** `bash scripts/transcribe.sh <lang> <project>/transcripts <videos...>`.
   Always pass the language; ask the user if unsure.
3. **Read.** `python3 scripts/pack_transcript.py <project>/transcripts`. Pauses
   ≥ 0.4 s are the clean cut points; words marked `(?)` need a human ear.
   Use `scripts/timeline_view.py` at decision points only.
4. **Plan, then ask.** Propose the cut in plain words: what stays, what goes
   and why, cards, bleeps, subtitles, length. Wait for approval before
   rendering.
5. **EDL.** Write `<project>/edl.json` (format below).
6. **Render.** `python3 scripts/render.py <project>/edl.json`.
7. **Verify.** `python3 scripts/verify.py <project>/edl.json`, then look at
   `work/review.png`. Fix and re-render, at most 3 passes; then report what
   is left.
8. **Hand over.** `final.mp4` + `final.srt` (upload the SRT separately),
   `final_subs.mp4` (subtitles burned in, for social), `final.otio` (Kdenlive or
   Resolve for the pass by eye). Record decisions in `<project>/project.md`.

## EDL

```json
{
  "name": "launch-demo", "language": "en", "fps": 30, "width": 1920, "height": 1080,
  "brand": "brand.json",
  "sources": {"a": "/abs/take1.mp4", "b": "/abs/take2.mp4"},
  "segments": [
    {"card": "title", "duration": 2.5, "vars": {"title": "Launch Demo", "subtitle": "Behind the scenes", "header": "Episode 4"}},
    {"source": "a", "start": 0.0, "end": 12.4, "quote": "Today we ship...", "reason": "clean intro take"},
    {"source": "b", "start": 3.1, "end": 41.0, "quote": "Here is how...", "reason": "take 1 stumbled here"},
    {"card": "endcard", "duration": 2.5}
  ],
  "bleeps": [{"source": "b", "start": 20.06, "end": 20.41, "mask": "****"}]
}
```

Times are source seconds from the transcript. `fps` is the target rate
(sources are converted). Cards are `templates/title` (`title`, `subtitle`,
`header`) and `templates/endcard` (`url`), rendered with HyperFrames.

## Brand profile

`brand.json` (path in the EDL, else `$VIDEO_EDIT_BRAND`, else
`~/.config/video-edit/brand.json`, else a neutral default) sets `accent`,
`text`, `background` (hex), `font` (a Google Fonts family), `logo` (path
relative to the profile), `header_html` (markup before the header topic, `<b>`
uses the accent), `url` (end card) and `languages` (allowed codes). See
`brand.example.json`.

## Cutting rules

- Cut only at word boundaries, inside pauses; ≥ 0.4 s is clean, under 0.15 s is not.
- Keep the laugh or reaction after a punchline; never cut on the punchline.
- Every segment gets 30 ms audio fades (render does it).
- Bleep from word timestamps; the subtitle mask must match.

## Defaults

Subtitles: sentence cues, at most two lines of 42 characters, white bold on a
semi-transparent box, burned last. Loudness -14 LUFS, true peak ≤ -1.5 dBFS.

## Verification lessons

| Symptom | Cause and check |
|---|---|
| Bleep plays at the clip start | ffmpeg `adelay` needs milliseconds; verify flags any tone outside planned windows |
| Subtitles unreadable on slides | white text on a light slide; the box style fixes it, look at `review.png` |
| One-word subtitle lines | cues must follow sentences, not character counts |
| Choppy motion | mixed 30/60 fps sources; render converts to the EDL `fps` |
| Wrong word in subtitles | Whisper guessed a name; list `(?)` words for the user |

Whisper tends to drop fillers ("um", "uh"), so filler removal from the
transcript alone is unreliable; look for short gaps and check them with
`timeline_view.py`.

## Requirements

ffmpeg, ImageMagick, Noto Sans, Node 22+ (for `npx hyperframes@0.8.168`, which
uses headless Chrome), `jq`, and local Whisper:
`uv tool install --python 3.12 whisper-ctranslate2` (the model, about 1.6 GB,
downloads on first use). Optional: `opentimelineio` for the editor timeline.
