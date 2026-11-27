import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT) || 4317
const BASE = `http://${HOST}:${PORT}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const READY_MS = 10000

let child = null

const track = z
  .string()
  .optional()
  .describe('Timeline track: main, or overlay, overlay2 … overlay10. Default: main')

const regionField = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .nullable()
  .optional()
  .describe(
    'Optional region of the frame, fractions of the canvas from the top-left, or null for the whole frame. Top half: {x:0,y:0,w:1,h:0.5}. Bottom half: {x:0,y:0.5,w:1,h:0.5}. The clip covers this rectangle; scale, x and y then apply inside it (0 is centered in the region).',
  )

const INSTRUCTIONS = `minicut is a local video editor. You edit a timeline; the user watches the same project live in the browser at ${BASE}.

How to work:
1. get_project first. Times are seconds. Tracks: main (clips play one after another, deleting a clip shifts the rest) and overlay, overlay2 … overlay10 (free clips placed by "start"; a higher number is drawn on top).
2. import_media with an absolute path (inside the user's home or temp folder, video files only), then add_clip with in/out inside the source file.
3. Cut with split / trim / remove_clip, reorder with move_clip, tune a clip with set_clip (scale 1 covers the canvas or its region; x/y are fractions of that area, 0 is centered; region null is the full frame, top half {x:0,y:0,w:1,h:0.5}, bottom half {x:0,y:0.5,w:1,h:0.5}; volume 0..2, fadeIn/fadeOut seconds). Overlays are muted by default.
4. Captions: add_text or import_subtitles (.srt/.ass), style them with set_style. Speech: speech_status, then transcribe (local whisper.cpp, set language when known), get_transcript to read it, find_in_transcript / find_repeats to locate phrases and repeated takes, cut_source_range to remove them, subtitles_from_transcript for captions.
5. Prefer small steps and call get_project to check the result. Every change can be undone with undo.
6. preview renders a fast low-quality proxy. render writes the final file only when the user asks for it, to an absolute .mp4 path inside the allowed folders.
7. Never edit files under the project's data folder directly; use the tools.
8. Look at your work: get_frame shows the project at a time exactly as exported, get_media_frame and probe inspect source files. Speed: set_clip speed (0.25 to 4) per clip, scale_speed for the whole project. Effects: set_clip vfilters / afilters take an ffmpeg filter chain (check names with ffmpeg_help). ffmpeg_run makes a new file (stabilize, grade, music, generated backgrounds) from allowed folders and can import it with importAs; it never overwrites without overwrite: true and never touches project sources.`

const mcp = new McpServer({ name: 'minicut', version: '0.3.1' }, { instructions: INSTRUCTIONS })

mcp.registerTool(
  'get_project',
  {
    description:
      'Return the current project: canvas, media, main and every overlay track, texts, and styles.',
    inputSchema: {},
  },
  async () => reply(await api('GET', '/api/project')),
)

mcp.registerTool(
  'import_media',
  {
    description:
      'Import a local video file into the media library. Width and height include display rotation.',
    inputSchema: {
      path: z.string().describe('Filesystem path to a video file'),
    },
  },
  async ({ path: filePath }) => reply(await api('POST', '/api/import', { path: filePath })),
)

mcp.registerTool(
  'add_clip',
  {
    description:
      'Add a clip from imported media. in and out are source seconds; omit them to use the whole file. index is the insert position (default: end). Overlay clips start at 0 and are muted until changed.',
    inputSchema: {
      mediaId: z.string().describe('Media id, for example m1'),
      in: z.number().optional().describe('Source in-point in seconds'),
      out: z.number().optional().describe('Source out-point in seconds'),
      index: z.number().int().optional().describe('Insert index; default is the end of the track'),
      track,
    },
  },
  async ({ mediaId, in: inPoint, out, index, track: trackId }) =>
    reply(await op('addClip', pack({ mediaId, in: inPoint, out, index, track: trackId }))),
)

// t is timeline time. splitAt picks the clip under that playhead; split() would treat t as an offset inside one clip.
mcp.registerTool(
  'split',
  {
    description:
      'Split the timeline at t seconds. t is timeline time, not a timestamp inside the source file.',
    inputSchema: {
      t: z.number().describe('Timeline time in seconds'),
      track,
    },
  },
  async ({ t, track: trackId }) => reply(await op('splitAt', pack({ t, track: trackId }))),
)

mcp.registerTool(
  'trim',
  {
    description: 'Change a clip source in-point and/or out-point, in seconds.',
    inputSchema: {
      clipId: z.string().describe('Clip id, for example c1'),
      in: z.number().optional().describe('New source in-point in seconds'),
      out: z.number().optional().describe('New source out-point in seconds'),
      track,
    },
  },
  async ({ clipId, in: inPoint, out, track: trackId }) =>
    reply(await op('trim', pack({ clipId, in: inPoint, out, track: trackId }))),
)

mcp.registerTool(
  'remove_clip',
  {
    description: 'Remove a clip. On main, following clips ripple left. On overlay, other clips stay put.',
    inputSchema: {
      clipId: z.string().describe('Clip id to remove'),
      track,
    },
  },
  async ({ clipId, track: trackId }) => reply(await op('remove', pack({ clipId, track: trackId }))),
)

mcp.registerTool(
  'move_clip',
  {
    description: 'Move a clip to a new index on its track. newIndex is its position after the move.',
    inputSchema: {
      clipId: z.string().describe('Clip id to move'),
      newIndex: z.number().int().describe('Destination index after the move'),
      track,
    },
  },
  async ({ clipId, newIndex, track: trackId }) =>
    reply(await op('move', pack({ clipId, newIndex, track: trackId }))),
)

mcp.registerTool(
  'move_clip_to_track',
  {
    description:
      'Move a clip onto another track. Moving onto main appends the clip. Moving onto an overlay keeps its timeline position unless start is set. in, out, scale, position, volume, fades and name stay.',
    inputSchema: {
      clipId: z.string().describe('Clip id to move'),
      track: z.string().describe('Destination track: main, overlay, overlay2 … overlay10'),
      start: z
        .number()
        .optional()
        .describe('Overlay timeline start in seconds; default is the clip’s current timeline position'),
    },
  },
  async ({ clipId, track: trackId, start }) =>
    reply(await op('moveClipToTrack', pack({ clipId, track: trackId, start }))),
)

mcp.registerTool(
  'add_overlay_track',
  {
    description: 'Add the next overlay track (up to overlay10) and return its id.',
    inputSchema: {},
  },
  async () => reply(await op('addOverlayTrack')),
)

mcp.registerTool(
  'remove_overlay_track',
  {
    description:
      'Remove an empty overlay track. The first overlay track cannot be removed, and a track with clips cannot be removed.',
    inputSchema: {
      id: z.string().describe('Overlay track id, for example overlay2'),
    },
  },
  async ({ id }) => reply(await op('removeOverlayTrack', { id })),
)

mcp.registerTool(
  'set_clip',
  {
    description:
      'Set scale, position, region, speed, volume, mute, fades, name, or overlay start on one clip. speed is 0.25 to 4 (2 = twice as fast); the clip gets shorter or longer on the timeline and later main clips shift. scale 1 covers the canvas, or the region when one is set. x and y are offsets as fractions of that area, 0 is centered. volume is 0..2. region null is the full frame; top half is {x:0,y:0,w:1,h:0.5}, bottom half is {x:0,y:0.5,w:1,h:0.5}.',
    inputSchema: {
      clipId: z.string().describe('Clip id'),
      scale: z
        .number()
        .optional()
        .describe('Zoom multiplier on top of cover, 1 = cover the frame or the region'),
      x: z
        .number()
        .optional()
        .describe('Horizontal offset as a fraction of the canvas, or of the region when set'),
      y: z
        .number()
        .optional()
        .describe('Vertical offset as a fraction of the canvas, or of the region when set'),
      region: regionField,
      volume: z.number().optional().describe('Linear gain from 0 to 2'),
      muted: z.boolean().optional().describe('Replace the clip audio with silence'),
      fadeIn: z.number().optional().describe('Fade-in length in seconds'),
      fadeOut: z.number().optional().describe('Fade-out length in seconds'),
      speed: z
        .number()
        .optional()
        .describe('Playback speed 0.25 to 4: 2 is twice as fast, 0.5 is slow motion. Audio keeps its pitch.'),
      vfilters: z
        .string()
        .nullable()
        .optional()
        .describe(
          'ffmpeg video filter chain applied to this clip at export and preview, e.g. "eq=contrast=1.1:saturation=1.3,vignette". One chain, no labels. No filters that change duration (trim, fps, reverse…). null clears. Check names with ffmpeg_help',
        ),
      afilters: z
        .string()
        .nullable()
        .optional()
        .describe(
          'ffmpeg audio filter chain for this clip, e.g. "highpass=f=80,acompressor,loudnorm". null clears',
        ),
      name: z.string().optional().describe('Clip label'),
      start: z.number().optional().describe('Overlay timeline start in seconds'),
    },
  },
  async (args) => reply(await op('setClip', pack(args))),
)

mcp.registerTool(
  'set_clips',
  {
    description:
      'Apply one patch to several clips (multi-selection). region null is the full frame; top half is {x:0,y:0,w:1,h:0.5}, bottom half is {x:0,y:0.5,w:1,h:0.5}.',
    inputSchema: {
      clipIds: z.array(z.string()).describe('Clip ids to update'),
      scale: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      region: regionField,
      volume: z.number().optional(),
      muted: z.boolean().optional(),
      fadeIn: z.number().optional(),
      fadeOut: z.number().optional(),
      speed: z.number().optional().describe('Playback speed 0.25 to 4'),
      vfilters: z.string().nullable().optional().describe('Video filter chain, null clears'),
      afilters: z.string().nullable().optional().describe('Audio filter chain, null clears'),
      name: z.string().optional(),
      start: z.number().optional(),
    },
  },
  async ({ clipIds, ...patch }) => reply(await op('setClips', pack({ clipIds, ...patch }))),
)

mcp.registerTool(
  'scale_speed',
  {
    description:
      'Speed up or slow down the whole project by a factor (2 = twice as fast, 0.5 = half speed). Multiplies the speed of every clip and moves overlay starts and captions so everything stays in place relative to the video. Fails if any clip would leave 0.25 to 4.',
    inputSchema: {
      factor: z.number().describe('Multiplier, for example 1.25 or 0.5'),
    },
  },
  async ({ factor }) => reply(await op('scaleSpeed', { factor })),
)

mcp.registerTool(
  'get_frame',
  {
    description:
      'Look at the result: returns one frame of the current project at a timeline time, rendered exactly like the export (layout, crop, captions), as a small JPEG. Use it to check your edit instead of guessing.',
    inputSchema: {
      time: z.number().optional().describe('Timeline seconds, default 0'),
      width: z.number().optional().describe('Image width in pixels, 120 to 1080, default 540'),
    },
  },
  async (args) => imageReply(await op('frame', pack(args))),
)

mcp.registerTool(
  'get_media_frame',
  {
    description:
      'One frame of a source file (a media id from get_project, or an absolute path) at a time in that file, as a small JPEG. Use it to look at footage before cutting.',
    inputSchema: {
      mediaId: z.string().optional().describe('Media id from get_project'),
      path: z.string().optional().describe('Absolute path to a video or image (instead of mediaId)'),
      time: z.number().optional().describe('Seconds in the source file, default 0'),
      width: z.number().optional().describe('Image width in pixels, 120 to 1080, default 540'),
    },
  },
  async (args) => imageReply(await op('mediaFrame', pack(args))),
)

mcp.registerTool(
  'probe',
  {
    description:
      'ffprobe summary of a media file (a media id or an absolute path to a video, audio or image): format, duration, size and every stream with codec, size, fps, sample rate, channels.',
    inputSchema: {
      mediaId: z.string().optional(),
      path: z.string().optional().describe('Absolute path (instead of mediaId)'),
    },
  },
  async (args) => reply(await op('probe', pack(args))),
)

const runInput = z.object({
  mediaId: z.string().optional().describe('Media id from get_project'),
  path: z.string().optional().describe('Absolute path to a video, audio or image file'),
  lavfi: z
    .string()
    .optional()
    .describe(
      'Generated source instead of a file: color, nullsrc, testsrc, testsrc2, smptebars, gradients, sine or anullsrc, e.g. "color=c=black:s=1080x1920:d=3"',
    ),
  ss: z.number().optional().describe('Start offset in the input, seconds'),
  t: z.number().optional().describe('Read only this many seconds'),
  loop: z.boolean().optional().describe('Loop a still image'),
})

mcp.registerTool(
  'ffmpeg_run',
  {
    description:
      'Run ffmpeg on this machine to make a NEW file: stabilize, denoise, colour-grade, mix music, generate backgrounds, convert, extract audio, make a GIF. You give inputs, a filter graph and an output; the command is built for you. Inputs and the output must be inside the allowed folders; an existing file is never overwritten unless overwrite is true, and project sources never. Filters that read files (movie, subtitles, lut3d…) and any network or file: protocols are refused. Use ffmpeg_help to check a filter exists first. With importAs the video result is added to the media library, ready for add_clip. Only one ffmpeg job runs at a time; cancel_render stops it.',
    inputSchema: {
      inputs: z.array(runInput).describe('1 to 8 inputs, numbered 0, 1, … in filter graphs'),
      filterComplex: z
        .string()
        .optional()
        .describe(
          'Filter graph, e.g. "[0:v]eq=contrast=1.1:saturation=1.2[v]". Label outputs and pass them in maps',
        ),
      vf: z.string().optional().describe('Simple video filter chain (instead of filterComplex)'),
      af: z.string().optional().describe('Simple audio filter chain (instead of filterComplex)'),
      maps: z.array(z.string()).optional().describe('Streams to keep: 0:v, 1:a:0 or [label]'),
      output: z.object({
        path: z
          .string()
          .describe(
            'Absolute output path (.mp4 .mov .mkv .webm .gif .mp3 .wav .m4a .aac .flac .ogg .opus .png .jpg .webp)',
          ),
        videoCodec: z
          .string()
          .optional()
          .describe('libx264, libx265, libvpx-vp9, prores_ks, mjpeg, png, gif or copy'),
        audioCodec: z.string().optional().describe('aac, libmp3lame, pcm_s16le, flac, libopus or copy'),
        crf: z.number().optional().describe('Quality 0 to 51, lower is better'),
        preset: z.string().optional().describe('ultrafast … slower'),
        pixFmt: z.string().optional().describe('yuv420p, yuv422p, yuv444p, yuva420p, rgba or gray'),
        fps: z.number().optional(),
        videoBitrate: z.string().optional().describe('For example 4000k'),
        audioBitrate: z.string().optional().describe('For example 192k'),
        duration: z.number().optional().describe('Cut the output to this many seconds'),
        frames: z.number().optional().describe('Stop after this many video frames'),
        noVideo: z.boolean().optional(),
        noAudio: z.boolean().optional(),
      }),
      overwrite: z.boolean().optional().describe('Replace an existing output file (never a project source)'),
      importAs: z.boolean().optional().describe('Add the video result to the media library'),
      timeoutMinutes: z.number().optional().describe('1 to 120, default 20'),
    },
  },
  async (args) => reply(await op('ffmpegRun', pack(args))),
)

mcp.registerTool(
  'ffmpeg_help',
  {
    description:
      "Ask this machine's ffmpeg what it can do. kind: filters, encoders, decoders, formats, pix_fmts (optionally narrowed with query) or filter (with name: options of one filter). Check here before writing a filter so you do not use one that does not exist.",
    inputSchema: {
      kind: z.enum(['filters', 'encoders', 'decoders', 'formats', 'pix_fmts', 'filter']).optional(),
      query: z.string().optional().describe('Only lines containing this text'),
      name: z.string().optional().describe('Filter name when kind is filter'),
    },
  },
  async (args) => reply(await op('ffmpegHelp', pack(args))),
)

mcp.registerTool(
  'remove_clips',
  {
    description: 'Remove several clips. Main clips ripple; overlay clips do not shift.',
    inputSchema: {
      ids: z.array(z.string()).describe('Clip ids to remove'),
    },
  },
  async ({ ids }) => reply(await op('removeClips', { ids })),
)

mcp.registerTool(
  'detect_silence',
  {
    description: 'Find silent intervals in a media file. Defaults: noiseDb -30, minDur 0.4 seconds.',
    inputSchema: {
      mediaId: z.string().describe('Media id to scan'),
      noiseDb: z.number().optional().describe('Noise floor in dB (default -30)'),
      minDur: z.number().optional().describe('Minimum silence length in seconds (default 0.4)'),
    },
  },
  async ({ mediaId, noiseDb, minDur }) =>
    reply(await op('detectSilence', pack({ mediaId, noiseDb, minDur }))),
)

mcp.registerTool(
  'remove_silence',
  {
    description:
      'Cut silent regions out of main-track clips and ripple the timeline. Defaults: noiseDb -30, minDur 0.4, pad 0.08 seconds.',
    inputSchema: {
      clipId: z.string().optional().describe('Limit the cut to one main clip; default is every main clip'),
      noiseDb: z.number().optional().describe('Noise floor in dB (default -30)'),
      minDur: z.number().optional().describe('Minimum silence length in seconds (default 0.4)'),
      pad: z.number().optional().describe('Silence kept against speech, in seconds (default 0.08)'),
    },
  },
  async (args) => reply(await op('removeSilence', pack(args))),
)

mcp.registerTool(
  'set_canvas',
  {
    description: 'Set the project canvas width, height, and fps. Width and height are made even.',
    inputSchema: {
      width: z.number().optional().describe('Canvas width in pixels'),
      height: z.number().optional().describe('Canvas height in pixels'),
      fps: z.number().optional().describe('Canvas frame rate'),
    },
  },
  async (args) => reply(await op('setCanvas', pack(args))),
)

mcp.registerTool(
  'add_text',
  {
    description: 'Add a text cue. Times are timeline seconds. style defaults to sub.',
    inputSchema: {
      start: z.number().describe('Cue start in seconds'),
      end: z.number().describe('Cue end in seconds'),
      text: z.string().describe('Caption text'),
      style: z.string().optional().describe('Style name, default sub'),
    },
  },
  async (args) => reply(await op('addText', pack(args))),
)

mcp.registerTool(
  'set_text',
  {
    description: 'Change a text cue start, end, text, or style.',
    inputSchema: {
      id: z.string().describe('Text cue id'),
      start: z.number().optional(),
      end: z.number().optional(),
      text: z.string().optional(),
      style: z.string().optional(),
    },
  },
  async (args) => reply(await op('setText', pack(args))),
)

mcp.registerTool(
  'remove_text',
  {
    description: 'Remove a text cue.',
    inputSchema: {
      id: z.string().describe('Text cue id'),
    },
  },
  async ({ id }) => reply(await op('removeText', { id })),
)

mcp.registerTool(
  'set_style',
  {
    description: 'Create or update a text style. shadow is { dx, dy, blur, color }.',
    inputSchema: {
      name: z.string().describe('Style name'),
      font: z.string().optional(),
      weight: z.number().optional(),
      size: z.number().optional(),
      color: z.string().optional(),
      x: z.number().optional().describe('Anchor x as a fraction of the canvas'),
      y: z.number().optional().describe('Anchor y as a fraction of the canvas'),
      align: z.enum(['left', 'center', 'right']).optional(),
      shadow: z
        .object({
          dx: z.number().optional(),
          dy: z.number().optional(),
          blur: z.number().optional(),
          color: z.string().optional(),
        })
        .optional(),
    },
  },
  async ({ name, ...patch }) => reply(await op('setStyle', pack({ name, ...patch }))),
)

mcp.registerTool(
  'import_subtitles',
  {
    description: 'Import .srt or .ass cues into the text track. ASS support is Dialogue lines only.',
    inputSchema: {
      path: z.string().describe('Path to an .srt or .ass file'),
    },
  },
  async ({ path: filePath }) => reply(await op('importSubtitles', { path: filePath })),
)

mcp.registerTool(
  'import_transcript',
  {
    description: 'Store word timings on a media item. words are { start, end, text } in source seconds.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      words: z
        .array(
          z.object({
            start: z.number(),
            end: z.number(),
            text: z.string(),
          }),
        )
        .describe('Word timings'),
    },
  },
  async ({ mediaId, words }) => reply(await op('importTranscript', { mediaId, words })),
)

mcp.registerTool(
  'speech_status',
  {
    description:
      'Check whether speech recognition is installed (whisper.cpp and a model). If not, the answer says what to run: npm run setup:speech.',
    inputSchema: {},
  },
  async () => reply(await op('speechState')),
)

mcp.registerTool(
  'transcribe',
  {
    description:
      'Recognize speech in a media file locally (whisper.cpp) and store word timings on the media. Takes from seconds to minutes depending on length. Progress is shown in the editor. Run it once per media, then use get_transcript.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      language: z
        .string()
        .optional()
        .describe(
          'Language code such as ru or en, or auto (default auto). Set it if you know it: this is more accurate',
        ),
      prompt: z.string().optional().describe('Optional hint with names and terms that appear in the speech'),
    },
  },
  async ({ mediaId, language, prompt }) => reply(await op('transcribe', pack({ mediaId, language, prompt }))),
)

mcp.registerTool(
  'cancel_transcribe',
  { description: 'Stop a running transcription.', inputSchema: {} },
  async () => reply(await op('cancelTranscribe')),
)

mcp.registerTool(
  'get_transcript',
  {
    description:
      'Return the transcript of a media as short phrases with source times (compact). Use from/to (source seconds) to read a part. Set words=true only when you need exact word times.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      from: z.number().optional().describe('Start of the range, source seconds'),
      to: z.number().optional().describe('End of the range, source seconds'),
      words: z.boolean().optional().describe('Return every word with its time instead of phrases'),
    },
  },
  async ({ mediaId, from, to, words }) =>
    reply(await op('getTranscript', pack({ mediaId, from, to, words }))),
)

mcp.registerTool(
  'find_in_transcript',
  {
    description:
      'Find a phrase in the transcripts and return where it is said (source start/end seconds). Matches ignore case and punctuation; close wording also matches.',
    inputSchema: {
      query: z.string().describe('Phrase to look for'),
      mediaId: z.string().optional().describe('Limit the search to one media'),
      limit: z.number().optional().describe('Maximum matches (default 20)'),
    },
  },
  async ({ query, mediaId, limit }) => reply(await op('findInTranscript', pack({ query, mediaId, limit }))),
)

mcp.registerTool(
  'find_repeats',
  {
    description:
      'Find repeated takes: phrases said several times in a row and aborted starts. Each group lists the takes and suggests keeping the last one (keep = its index). Cut the others with cut_source_range.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      minWords: z.number().optional().describe('Ignore phrases shorter than this many words (default 3)'),
      minSimilarity: z.number().optional().describe('0..1, how alike two takes must be (default 0.75)'),
    },
  },
  async ({ mediaId, minWords, minSimilarity }) =>
    reply(await op('findRepeats', pack({ mediaId, minWords, minSimilarity }))),
)

mcp.registerTool(
  'cut_source_range',
  {
    description:
      'Remove a source interval of a media from the main track (the rest closes up). Use start and end from find_in_transcript or find_repeats. Undo with undo.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      start: z.number().describe('Start, source seconds'),
      end: z.number().describe('End, source seconds'),
    },
  },
  async ({ mediaId, start, end }) => reply(await op('cutSourceRange', { mediaId, start, end })),
)

mcp.registerTool(
  'subtitles_from_transcript',
  {
    description:
      'Create timed captions from the transcript for the clips that are on the main track now (timeline time). Run it after cutting. replace=true removes existing captions first.',
    inputSchema: {
      mediaId: z.string().describe('Media id'),
      maxChars: z.number().optional().describe('Characters per caption (default 36)'),
      style: z.string().optional().describe('Caption style name (default sub)'),
      replace: z.boolean().optional().describe('Remove existing captions first'),
    },
  },
  async ({ mediaId, maxChars, style, replace }) =>
    reply(await op('subtitlesFromTranscript', pack({ mediaId, maxChars, style, replace }))),
)

mcp.registerTool(
  'list_projects',
  {
    description: 'List saved project names.',
    inputSchema: {},
  },
  async () => reply(await op('listProjects')),
)

mcp.registerTool(
  'new_project',
  {
    description: 'Create an empty project and switch to it.',
    inputSchema: {
      name: z.string().describe('New project name'),
    },
  },
  async ({ name }) => reply(await op('newProject', { name })),
)

mcp.registerTool(
  'load_project',
  {
    description: 'Open a saved project by name.',
    inputSchema: {
      name: z.string().describe('Project name'),
    },
  },
  async ({ name }) => reply(await op('loadProject', { name })),
)

mcp.registerTool(
  'save_project_as',
  {
    description: 'Save the current project under a new name and switch to it.',
    inputSchema: {
      name: z.string().describe('Project name'),
    },
  },
  async ({ name }) => reply(await op('saveProjectAs', { name })),
)

mcp.registerTool(
  'undo',
  {
    description: 'Undo the last project change.',
    inputSchema: {},
  },
  async () => reply(await op('undo')),
)

mcp.registerTool(
  'redo',
  {
    description: 'Redo the last undone project change.',
    inputSchema: {},
  },
  async () => reply(await op('redo')),
)

mcp.registerTool(
  'render',
  {
    description:
      'Export the timeline to a video file. Default H.264 + AAC in .mp4; videoCodec can be libx265 (.mp4 .mov .mkv), libvpx-vp9 (.webm only, Opus audio) or prores_ks (.mov only). Defaults: project canvas, crf 18, preset medium, audio 192k. Clip filters (vfilters, afilters) and speed are applied.',
    inputSchema: {
      output: z.string().describe('Destination file path'),
      width: z.number().optional().describe('Output width in pixels'),
      height: z.number().optional().describe('Output height in pixels'),
      fps: z.number().optional().describe('Output frame rate'),
      crf: z.number().optional().describe('x264 CRF, default 18'),
      preset: z.string().optional().describe('x264 preset, default medium'),
      audioBitrate: z.string().optional().describe('AAC bitrate, default 192k'),
      videoCodec: z.string().optional().describe('libx264 (default), libx265, libvpx-vp9 or prores_ks'),
      videoBitrate: z.string().optional().describe('Target video bitrate such as 8000k; replaces crf'),
      loudnorm: z.boolean().optional().describe('Apply EBU R128 loudnorm at I=-16'),
    },
  },
  async (args) => reply(await api('POST', '/api/render', pack(args))),
)

mcp.registerTool(
  'cancel_render',
  {
    description: 'Cancel the running export and delete its incomplete output file.',
    inputSchema: {},
  },
  async () => reply(await api('POST', '/api/render/cancel')),
)

mcp.registerTool(
  'preview',
  {
    description:
      'Render a low-quality 540x960 proxy to data/preview.mp4 and return its path. Served at /preview.mp4.',
    inputSchema: {},
  },
  async () => reply(await api('POST', '/api/preview')),
)

function imageReply(frame, note) {
  const { data, mimeType, ...info } = frame
  return {
    content: [
      { type: 'image', data, mimeType },
      { type: 'text', text: JSON.stringify({ ...info, ...note }) },
    ],
  }
}

function reply(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

function pack(fields) {
  const args = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) args[key] = value
  }
  return args
}

async function op(name, args = {}) {
  const data = await api('POST', '/api/op', { op: name, args })
  return data.result
}

async function api(method, pathname, body) {
  let res
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`minicut server is not reachable (${err.message})`)
  }
  const raw = await res.text()
  let data = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(raw)
    }
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

async function serverUp() {
  try {
    const res = await fetch(`${BASE}/api/project`, { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch {
    return false
  }
}

// MCP is a thin client of the HTTP API. Start the API if nothing is listening yet.
async function ensureServer() {
  if (await serverUp()) return
  const logs = []
  child = spawn(process.execPath, [path.join(root, 'src/server.js')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  const take = (buf) => {
    logs.push(buf)
    process.stderr.write(buf)
  }
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  let exitCode = null
  child.on('exit', (code) => {
    exitCode = code ?? 1
  })
  const deadline = Date.now() + READY_MS
  while (Date.now() < deadline) {
    if (exitCode !== null) break
    if (await serverUp()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (await serverUp()) return
  const detail = Buffer.concat(logs).toString().trim()
  const message =
    detail ||
    (exitCode !== null
      ? `minicut server exited with code ${exitCode}`
      : 'minicut server did not become ready')
  if (child.exitCode == null) child.kill('SIGTERM')
  child = null
  throw new Error(message)
}

function stopChild() {
  if (child && child.exitCode == null) child.kill('SIGTERM')
}

process.on('exit', stopChild)

process.stdin.on('end', () => {
  stopChild()
  process.exit(0)
})

async function main() {
  await ensureServer()
  await mcp.connect(new StdioServerTransport())
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  stopChild()
  process.exit(1)
})
