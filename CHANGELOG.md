# Changelog

## 0.1.0

First public release.

- Local web editor for vertical videos (1080×1920): main track plus up to 10 overlay tracks, trim, split, snap, multi-select, undo/redo
- Per-clip scale, position, volume, mute and fades; text and subtitles (`.srt`, `.ass`) with styles; silence removal; multiple projects
- ffmpeg export with progress and cancel, fast preview; captions rendered with bundled fonts (Cormorant, Manrope, JetBrains Mono)
- HTTP API and MCP server for Claude (`npm run mcp:install`)
- Local-only security model: Host/Origin checks, JSON-only POST, path allow-list
- Tests (node:test), ESLint, Prettier, CI
