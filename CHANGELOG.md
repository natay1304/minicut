# Changelog

## 0.3.1

- Subtitle color: «Цвет — всем стилям» button; captions snap to each other and no longer overlap while dragging
- Delete key removes the selected caption (click it on the caption lane first)
- Clip panel: speed is at the top and in the heading (×N); project speed shows the current value; changing the speed of a main-track clip now moves the captions and overlay starts with the video (before, they stayed on the old timeline and drifted)

## 0.3.0

- Clip speed (0.25 to 4): field and presets (0.5× to 4×) in the clip panel, ×N badge on the timeline; project-wide speed change (`scale_speed`, form next to «Убрать паузы»); captions and overlays follow
- Per-clip ffmpeg filter chains (`vfilters`, `afilters`) applied in export and preview
- Export codecs: H.265, VP9 (.webm), ProRes (.mov) and a target bitrate
- MCP: `get_frame` and `get_media_frame` (look at the result), `probe`, `ffmpeg_help`, `ffmpeg_run` (build new files with ffmpeg inside the safe folders, with filter and path restrictions)

## 0.2.0

- Crop and shift a clip with the mouse on the preview: drag the frame, pan inside it, scroll to zoom
- Clip `region`: cover part of the frame instead of the whole canvas (full frame, top half, bottom half, or custom `{x,y,w,h}`), so two videos can split the screen
- Local speech recognition with whisper.cpp: `transcribe`, `get_transcript`, `find_in_transcript`, `find_repeats`, `cut_source_range`, `subtitles_from_transcript`, a transcript panel in the editor, and `npm run setup:speech` for macOS, Windows and Linux
- The API and events send `wordCount` instead of every word
- Subtitles get their own lane on the timeline: drag a caption to move it, drag its edges to change start and end (snaps to clip edges and the playhead)
- Export path field suggests folders and finished videos in a dropdown while you type, and remembers the last folder
- The preview now places the picture exactly like the export (no black bands that the export does not have)
- Panels can be resized with the mouse (library width, properties width, timeline height); sizes are remembered, double-click resets

## 0.1.0

First public release.

- Local web editor for vertical videos (1080×1920): main track plus up to 10 overlay tracks, trim, split, snap, multi-select, undo/redo
- Per-clip scale, position, volume, mute and fades; text and subtitles (`.srt`, `.ass`) with styles; silence removal; multiple projects
- ffmpeg export with progress and cancel, fast preview; captions rendered with bundled fonts (Cormorant, Manrope, JetBrains Mono)
- HTTP API and MCP server for Claude (`npm run mcp:install`)
- Local-only security model: Host/Origin checks, JSON-only POST, path allow-list
- Tests (node:test), ESLint, Prettier, CI
