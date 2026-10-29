# Craft standards

The reference point for each editing decision: what the published standard
says, where it says it, and what this skill does. Where no standard exists the
row says **convention**: a common practice from trainers and creators, not a
rule, so taste wins there. Numbers marked "read" were checked on the primary
page; the rest come from secondary sources and say so.

Columns: **Standard** is the gold standard, **Source** where it is written,
**Skill** the default here and the script that applies or checks it.

## Sound

| Topic | Standard | Source | Skill |
|---|---|---|---|
| Measuring loudness | K-weighted, gated programme loudness in LUFS; true peak with 4x oversampling | ITU-R BS.1770-5 (2023), Annexes 1-2 (read) | ffmpeg `loudnorm` / `ebur128` implement it |
| Broadcast target | -23.0 LUFS; true peak never above -1 dBTP; lower peaks for lossy codecs | EBU R128 v5 (2023), items h and m (read) | not used; a reference |
| Streaming target | EBU allows -20 to -16 LUFS for streams without metadata; Apple Podcasts about -16 LKFS, peak -1 dB; ATSC A/85 (2026) -24 LKFS, peak -2 dBTP | EBU R128 s2 (read); Apple Podcasts audio requirements (read); ATSC A/85:2026 (read) | - |
| YouTube | **No published loudness target.** YouTube turns loud uploads down ("Stable volume"), so louder buys nothing. The common -14 LUFS comes from Spotify's music normalisation and measurements by third parties | YouTube Help 1722171, 14106294 (read: no LUFS figure); Spotify loudness normalisation (read) | `render.py` -14 LUFS (convention), `verify.py` checks ±0.5 LU |
| True peak for AAC | -1 dBTP (EBU, Apple); -2 dBTP for loud masters (ATSC, Netflix, Spotify above -14 LUFS) | as above | render aims at -1.5, `verify.py` fails above -1.0 |
| Speech loudness range | Dialogue LRA 6 LU or less (SVT); EBU sets no limit and does not apply LRA under one minute | SVT delivery checklist v5.1 (read); EBU R128 footnote 2 (read) | not checked |
| Music under speech | Dialogue at least 8 LU above the background (SVT); 4 LU (UK DPP, secondary). "Music 15-25 dB under voice" is convention | SVT checklist (read) | no music bed yet |
| Clicks at edits | Short fade or crossfade at every audio edit, a few ms to about 20 ms; room tone instead of digital silence. Convention (vendor manuals, no standard) | Avid "Avoiding clicks and pops" (secondary) | 30 ms fades on every segment (`render.py` FADE) |

## Picture and delivery

| Topic | Standard | Source | Skill |
|---|---|---|---|
| Upload file | MP4, moov atom first (fast start), no edit lists; H.264 High, progressive, closed GOP of half the frame rate, 4:2:0; AAC-LC 48 kHz, 384 kbps stereo | YouTube Help 1722171 (read) | `render.py`: libx264 CRF 18, yuv420p, `+faststart`, AAC 320 kbps |
| Bitrate | SDR 1080p: 8 Mbps at 24-30 fps, 12 Mbps at 48-60 fps; 2160p 35-45 / 53-68 Mbps | YouTube Help 1722171 (read) | CRF instead of a bitrate; size is checked only for browser upload limits |
| Colour | BT.709 primaries, transfer and matrix; untagged is read as BT.709; full range is converted to limited (8-bit 16-235) | YouTube Help 1722171 (read); ITU-R BT.709-6 item 4.6 | sources pass through unchanged |
| Frame rate | Upload at the recorded rate; do not convert 25 to 30 | YouTube Help 1722171 (read) | EDL `fps`; set it to the source rate |
| Flicker | Under 50 Hz mains shoot 1/50 or 1/100 s, under 60 Hz 1/60 or 1/120 s; the 180 degree shutter rule (1/(2 x fps)) is convention | camera makers' manuals (Nikon, secondary) | a recording note, not an edit |
| Safe areas, 16:9 | Action safe 93%, title safe 90% (3.5% and 5% margins); many screens show the whole frame, so keep the edges clean too | SMPTE ST 2046-1:2009 5.1; EBU R95 v1.1 (read) | card title text is centred; the card's corner logo and header sit about 3.5% from the edge, outside title safe, which only matters on overscanned TVs |
| Shorts | Square or vertical, up to 3 minutes, up to 1080p | YouTube Help 15424877, 12779649 (read) | `"format": "short"`, 1080x1920 |
| Player overlays on Shorts | No official spec for organic Shorts; the ads safe zone and Reels guidance (about 14% top, 35% bottom, 6% sides free) are the nearest | Google Ads 9128498; Meta Reels ads guide (secondary) | zones measured on the mobile player, drawn by `verify.py` |

## Subtitles and captions

| Topic | Standard | Source | Skill |
|---|---|---|---|
| Line length | 42 characters (Netflix); 37 on broadcast or 68% of the width online (BBC) | Netflix English (USA) Timed Text Style Guide I.2 (read); BBC Subtitle Guidelines 3.1 | `subtitles.py` MAX_LINE 42 |
| Lines | At most two; keep one line unless it is too long; BBC allows three on 9:16 | Netflix I.10 (read); BBC 3.3 | two balanced lines |
| Reading speed | Adults up to 20 characters per second, children 17 (Netflix); 160-180 words per minute (BBC) | Netflix I.14 (read); BBC 4.1 | `verify.py` reports fast cues; verbatim speech is kept |
| Duration | At least 20 frames (Netflix), about 0.3 s per word (BBC); at most 7 s (Netflix) | Netflix General Requirements 1 | `subtitles.py` MIN_DUR 0.84 s; `verify.py` reports cues outside 20 frames to 7 s |
| Gap | 2 frames between cues, or 0.5 s or more; close the gaps in between (Netflix); BBC prefers at least 1 s | Netflix Timing Guidelines 5; BBC 4.5 | `subtitles.py` GAP 0.08 s, gaps under 0.5 s closed |
| Sync | In-time within 1-2 frames of speech; out-time up to 0.5 s after it (Netflix); BBC accepts 1.5 s | Netflix Timing Guidelines 1; BBC 5 | cues start on the first word, TAIL 0.3 s |
| Shot changes | Start on the cut if speech starts within 0.5 s of it; end 2 frames before a cut (Netflix) | Netflix Timing Guidelines 2, 4 | short captions never span a cut |
| Line breaks | Break after punctuation, before conjunctions and prepositions; never split article and noun, name, pronoun and verb | Netflix I.10; BBC 3.4 | balanced split at word boundaries; break rules not applied |
| Open or closed | Closed captions can be switched off and feed search and auto-translate; burned-in text cannot | W3C WAI captions; YouTube caption formats Help 2734698 | upload `final.srt` with every video; burned-in only for social copies |
| Kinetic 1-3 word captions | Convention; no study or platform spec. Eye-tracking research found phrase chunks easier to read than word-by-word | Rajendran et al. 2013, Perspectives 21(1) | `shorts.py` chunks of up to 3 words |
| Vertical placement | Lower third but raised on 9:16 (BBC) | BBC 10.1 | `caption_y` default 1500 of 1920 |

## Cutting

| Topic | Standard | Source | Skill |
|---|---|---|---|
| What a cut must serve | Murch's Rule of Six, in priority order: emotion, story, rhythm, eye trace, the 2D screen plane, 3D space. Give up the lower ones first; a jump cut breaks space but can keep emotion, story and rhythm | Walter Murch, *In the Blink of an Eye* (2nd ed. 2001) | jump cuts are allowed; story decides the cut list |
| Where to cut speech | Inside pauses, never mid-word; keep the breath before a sentence. About a third of a second between sentences and half that at a comma (one trainer's figure) | Larry Jordan, "Better dialog editing" (secondary) | cuts in the middle of measured pauses; `jumpcut.keep` 0.1 s each side |
| Air at a cut | No standard figure; editors set it by ear | convention | `verify.py` LISTEN below 30 ms of quiet |
| Punch-in on jump cuts | 110-120% on alternate pieces. Convention | creator blogs | `jumpcut.punch` 1.1-1.12 |
| J-cut and L-cut | A split edit: the next shot's sound starts before its picture (J) or the last shot's sound runs on after the cut (L). No official lead length; 6-12 frames is convention | Apple Final Cut Pro guide, "Create split edits" (read) | not supported yet; picture and sound cut together |
| B-roll | Cover jump cuts with cutaways while the speech runs on; cut on breaths or word boundaries. Shot lengths of 3-10 s are convention | convention | slides and IDE views play this role in layouts |
| Flash frames | One or a few unintended frames between shots; NLEs flag clips of 2 frames or fewer | Avid and Premiere flash frame finders (secondary) | `verify.py` fails pieces under 3 frames and single-frame spikes |
| Openings | YouTube measures how many viewers are still watching after 30 s and advises moving strong moments earlier; "hook in 1-3 s" for Shorts is creator advice | YouTube Help 9314415 (read) | shorts open cold on the claim, no cards |
| Shorts loop | Shorts replay by default; an ending that flows back into the opening is convention | convention | - |

## Review before rendering

| Topic | Standard | Source | Skill |
|---|---|---|---|
| Storyboard and contact sheet | Approve the plan as stills before the expensive render: a storyboard (planned shots) or a contact sheet (frames from the footage). An animatic times the stills to audio. Production practice, no standard | convention | `render.py --preview` before the render, `verify.py` review sheet after it |

## Motion graphics overlays

| Topic | Standard | Source | Skill |
|---|---|---|---|
| Alpha formats | ProRes 4444 (lossless alpha), PNG sequence (RGBA), WebM VP9 with alpha (yuva420p) | Apple ProRes white paper; HyperFrames rendering guide | not used yet |
| HyperFrames transparency | `--format webm`, `--format mov` (ProRes 4444) or `--format png-sequence` with no painted page background; no supersampled 4K with alpha. Parallel workers can leave a transparent first frame per chunk (issue 4435): render overlays with `--workers 1` and scan for blank frames | hyperframes.heygen.com/guides/rendering; GitHub heygen-com/hyperframes | cards render with HyperFrames today |
| Naming | "Plate" in VFX is the live footage under a composite; an animated overlay is a motion graphic or lower third | VFX glossaries (secondary) | - |
