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
   Always pass the language; ask the user if unsure. It also measures the
   audio pauses (`<stem>.pauses`), because Whisper often runs words together.
3. **Read.** `python3 scripts/pack_transcript.py <project>/transcripts`. Each
   pause shows its `cut` time (the middle of the silence): use those as segment
   starts and ends. Add `--gap 0.25` for the tighter pace of a short. Words
   marked `(?)` need a human ear. `<REF>` marks a line that points elsewhere
   ("previous video"), `<REPEAT>` a stutter or a Whisper hallucination. Use
   `scripts/timeline_view.py` at decision points only.
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

Times are source seconds from the transcript; render snaps them to whole
frames. `fps` is the target rate (sources are converted). Cards are
`templates/title` (`title`, `subtitle`, `header`) and `templates/endcard`
(`url`), rendered with HyperFrames.

Optional keys (full reference in the `render.py` docstring):

- `corrections`: `[{"source", "start", "end", "text"}]` replaces the words in
  the window with `text` in the subtitles (a name Whisper misheard); `""`
  drops them (stutters). The audio is untouched.
- `jumpcut`: `{"min_pause": 0.3, "keep": 0.1, "punch": 1.12}` splits every
  media segment at pauses, keeping `keep` seconds of air on each side; `punch`
  zooms every other piece to hide the jump (panels marked `"punch": true`).

## Vertical shorts

`"format": "short"` renders 1080x1920 from 16:9 footage. Cards are not
allowed; open cold on the hook.

```json
{
  "format": "short", "fps": 25,
  "short": {"title": "DON'T START WITH DISTINCT", "subtitle": "Check the data model first",
            "highlight": ["distinct", "data model"], "caption_y": 1460},
  "views": {
    "face": [{"crop": [452, 0, 576, 720], "at": [16, 322], "width": 1040, "border": "accent", "punch": true}],
    "code": [{"crop": [40, 28, 640, 382], "at": [16, 322], "width": 1040, "border": "accent"},
             {"crop": [1060, 505, 220, 220], "at": [350, 1180], "width": 380, "shape": "circle"}]
  },
  "jumpcut": {"min_pause": 0.3, "keep": 0.1, "punch": 1.12},
  "segments": [{"source": "a", "start": 1725.86, "end": 1730.81, "view": "face"}]
}
```

- A view is a list of panels: a source `crop` (x, y, w, h in source pixels)
  placed `at` a canvas position, scaled to `width`; `rect` or `circle` (a
  webcam bubble), with an optional `border`. Measure crops on a full-size
  frame; screen recordings scroll, so check `review.png` for every segment.
- The canvas is drawn once: brand `canvas` colour and a header at
  `header_y` (default 140, below the player's mute button). With a brand
  `mark` the header is one row, the mark on the left and `title` over
  `subtitle` beside it (about 150 px tall, so panels can start at y 320);
  without one, the logo sits on a light pill above a centred title. Segments
  may override `title`, `subtitle` and `caption_y`.
- Captions are chunks of one to three words in the brand font (Black weight,
  fetched from Google Fonts into `~/.cache/video-edit/fonts`), `highlight`
  phrases in the accent colour. A chunk never spans a cut. `final.srt` keeps
  the standard cues for upload.
- The Shorts player draws over three areas of the 1080x1920 frame (measured
  on the mobile site at phone size): mute/play at the top left (about
  200x130), like/comment/share on the right (x > 960 from y 1480 down), and
  channel, Subscribe and title at the bottom (y > 1760). `verify.py` outlines
  them in red on `review.png`; keep text and code out of them. To check an
  upload as a phone sees it, open the unlisted link in headless Chromium
  (Puppeteer) with a phone viewport and user agent and screenshot it; the
  extension-driven browser cannot switch to device mode.

### Picking shorts from long videos

1. Transcribe every source first (CPU large-v3-turbo runs at about 0.4x
   real time; run the batch in the background, one video after another).
2. Map each source on a contact sheet (`fps=1/20,tile`): where the face is
   full frame (intro, outro), where slides or an IDE run, where the webcam sits.
3. List candidates with source window, estimated length, the one learning and
   the hook. A good one stands alone (no `<REF>` lines), has one idea, and
   opens on a claim, a question or a surprising number. 35-60 s after jump
   cuts; source windows of 60-80 s usually land there.
4. Rank by layout risk, not only by content. Face-only parts are safe; every
   new screen layout (slides, IDE, webcam position) needs one prototype
   rendered and checked before more shorts use it. Say plainly when a video
   has few standalone moments.
5. Before each EDL: pull a full-size frame in the window to place crops, and
   check word timings at every cut.

### Layout recipes (1280x720 sources)

| Source layout | View |
|---|---|
| Talking head | 4:5 crop around the face (576x720), width 1040, `punch` on |
| IDE + small round webcam | code crop on top (about 640 px wide, 1.6x), result grid below, the bubble as a `circle` panel |
| IDE + large webcam | code crop on top, the webcam as a large rect panel (about 700 px wide) below |
| Slide + large webcam | slide crop on top (stop above any slide text the webcam hides), webcam panel below |

- Crop a few pixels inside a webcam frame and outside it on the slide side,
  or a strip of the other panel shows.
- When the key value sits in a far-right column of a wide table, show narrow
  slices side by side (for example the name column and the flag column) at
  2-3x instead of the whole table at 1x.
- Screen recordings scroll and switch panels (an output log instead of the
  result grid); check `review.png` across every segment, not one frame.

### Publishing

- Burned-in `final_subs.mp4` is the upload file for Shorts. Browser uploads
  through the automation extension cap a file at 10 MB; re-encode a copy with
  `-crf 21` when needed.
- YouTube rejects `<` and `>` in descriptions.
- Let YouTube finish its checks before publishing; publishing earlier only
  warns, but a clean check avoids restrictions.

## Brand profile

`brand.json` (path in the EDL, else `$VIDEO_EDIT_BRAND`, else
`~/.config/video-edit/brand.json`, else a neutral default) sets `accent`,
`text`, `background` (hex), `font` (a Google Fonts family), `logo` (path
relative to the profile), `header_html` (markup before the header topic, `<b>`
uses the accent), `url` (end card), `languages` (allowed codes), `canvas`
(background of a vertical short) and `mark` (the logo without words, in
colours that read on `canvas`, for the header row of a short). See
`brand.example.json`.

## Cutting rules

- Cut only at word boundaries, inside pauses; ≥ 0.4 s is clean, under 0.15 s is not.
  When two words run together, measure the level in 20 ms steps (`astats`); a
  dip below -55 dB is a usable cut.
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
| Wrong word in subtitles | Whisper guessed a name; list `(?)` words for the user, fix with `corrections` |
| No pauses in the transcript, cues that never end | Whisper glued the words and dropped punctuation; `.pauses` from transcribe.sh trims the word timings, cues also break at pauses and length |
| Duration off by a few frames per cut | segments not on whole frames; render snaps them, verify flags drift |
| A word from the next sentence in the last caption | it starts inside the cut window; end the segment a frame earlier |
| Repeated "thank you" at the end of a transcript | Whisper hallucinates on silence or music; `<REPEAT>` flags it, never cut past the last real word |
| Misheard domain words ("joints" for joins, "region" for right join) | read flagged and technical words in context, fix with `corrections` |
| Later videos skipped in a batch loop | ffmpeg reads stdin; scripts use `-nostdin`, add it to your own loops too |

Whisper tends to drop fillers ("um", "uh"), so filler removal from the
transcript alone is unreliable; look for short gaps and check them with
`timeline_view.py`.

## Requirements

ffmpeg, ImageMagick, Noto Sans, Node 22+ (for `npx hyperframes@0.8.168`, which
uses headless Chrome), `jq`, and local Whisper:
`uv tool install --python 3.12 whisper-ctranslate2` (the model, about 1.6 GB,
downloads on first use). Optional: `opentimelineio` for the editor timeline.
