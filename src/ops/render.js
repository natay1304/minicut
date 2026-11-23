import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { render as ffmpegRender, renderFrame, requestCancel, round3 } from '../ffmpeg.js'
import { OUTPUT_EXT, checkPath } from '../paths.js'
import { buildTextTrack } from '../textrender.js'
import { dataRoot, emit, getProject, previewFile } from './history.js'
import { OpError, clipLength, evenSize, findMedia, mustNum, overlayIndex, speedOf } from './project.js'
import { frameWidth } from './tools.js'
import { trackById } from './tracks.js'

const PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
  'placebo',
])

let rendering = false

function renderOptions(options = {}) {
  if (!options || typeof options.output !== 'string' || !options.output.trim()) {
    throw new OpError('Не указан путь вывода')
  }
  const output = checkPath(options.output, { extensions: OUTPUT_EXT, label: 'Путь вывода' })
  const canvas = getProject().canvas
  const width = evenSize(options.width, canvas.width, 'width')
  const height = evenSize(options.height, canvas.height, 'height')
  const fps = round3(options.fps == null ? canvas.fps : mustNum(options.fps, 'fps'))
  if (!(fps > 0 && fps <= 120)) throw new OpError('Некорректный fps')
  const crf = Math.round(options.crf == null ? 18 : mustNum(options.crf, 'crf'))
  if (crf < 0 || crf > 51) throw new OpError('crf должен быть от 0 до 51')
  const preset = options.preset == null ? 'medium' : String(options.preset)
  if (!PRESETS.has(preset)) throw new OpError(`Неизвестный preset: ${preset}`)
  const audioBitrate = options.audioBitrate == null ? '192k' : String(options.audioBitrate)
  if (!/^\d{2,4}k$/.test(audioBitrate)) throw new OpError('Некорректный audioBitrate')
  const loudnorm = options.loudnorm == null ? false : options.loudnorm
  if (typeof loudnorm !== 'boolean') throw new OpError('loudnorm должен быть true или false')
  return { output, width, height, fps, crf, preset, audioBitrate, loudnorm }
}

function planClip(draft, clip, output, free) {
  const media = findMedia(draft.media, clip.mediaId)
  if (!(clip.out > clip.in)) throw new OpError(`У клипа ${clip.id} пустая длительность`)
  if (!existsSync(media.path)) throw new OpError(`Файл не найден: ${media.path}`)
  if (path.resolve(media.path) === output) throw new OpError('Путь вывода совпадает с исходником')
  const planned = {
    path: media.path,
    in: clip.in,
    out: clip.out,
    hasAudio: Boolean(media.hasAudio),
    volume: clip.volume,
    muted: free ? (clip.muted == null ? true : Boolean(clip.muted)) : Boolean(clip.muted),
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    speed: speedOf(clip),
    scale: clip.scale,
    x: clip.x,
    y: clip.y,
  }
  if (clip.region) planned.region = clip.region
  if (free) planned.start = clip.start ?? 0
  return planned
}

function planClips(draft, output) {
  const main = trackById(draft, 'main')
  if (!main.clips.length) throw new OpError('Нет клипов для экспорта')
  let duration = 0
  const mainPlan = main.clips.map((clip) => {
    const planned = planClip(draft, clip, output, false)
    duration += clipLength(clip)
    return planned
  })
  for (const track of draft.tracks) {
    if (!overlayIndex(track.id)) continue
    for (const clip of track.clips) {
      if (!(clip.out > clip.in)) continue
      duration = Math.max(duration, (clip.start ?? 0) + clipLength(clip))
    }
  }
  duration = round3(duration)
  if (!(duration > 0)) throw new OpError('Нет клипов для экспорта')
  const overlays = []
  for (const track of draft.tracks) {
    if (!overlayIndex(track.id)) continue
    for (const clip of track.clips) {
      if (!((clip.start ?? 0) < duration && clip.out > clip.in)) continue
      overlays.push(planClip(draft, clip, output, true))
    }
  }
  return { main: mainPlan, overlays, duration }
}

async function runRender(options, fixed = {}) {
  const settings = renderOptions({ ...options, ...fixed })
  if (rendering) throw new OpError('Экспорт уже выполняется')
  const draft = getProject()
  const planned = planClips(draft, settings.output)
  const pixelScale = draft.canvas.height > 0 ? settings.height / draft.canvas.height : 1
  rendering = true
  const tmp = path.join(dataRoot(), 'tmp', randomBytes(6).toString('hex'))
  emit('render-progress', {
    output: settings.output,
    time: 0,
    total: planned.duration,
    ratio: 0,
    pct: 0,
    fps: null,
    eta: null,
  })
  try {
    const textList = buildTextTrack({
      dir: tmp,
      width: settings.width,
      height: settings.height,
      duration: planned.duration,
      texts: draft.texts,
      styles: draft.styles,
      pixelScale,
    })
    await ffmpegRender({
      ...settings,
      ...planned,
      textList,
      onProgress(info) {
        emit('render-progress', { output: settings.output, ...info })
      },
    })
  } catch (err) {
    if (err.cancelled) throw new OpError('Рендер отменён')
    if (err instanceof OpError) throw err
    throw new OpError(`Экспорт не удался: ${err.message}`, 500)
  } finally {
    rendering = false
    rmSync(tmp, { recursive: true, force: true })
  }
  if (!existsSync(settings.output)) throw new OpError('Экспорт не создал файл', 500)
  emit('render-progress', {
    output: settings.output,
    time: planned.duration,
    total: planned.duration,
    ratio: 1,
    pct: 100,
    fps: null,
    eta: 0,
  })
  return { output: settings.output, duration: planned.duration }
}

/** Один кадр проекта на секунде time таймлайна (как в экспорте, с подписями), JPEG в base64. */
export async function frame(options = {}) {
  const draft = getProject()
  const planned = planClips(draft, path.join(dataRoot(), 'frame.jpg'))
  const time = options.time == null ? 0 : mustNum(options.time, 'time')
  if (time < 0 || time > planned.duration) {
    throw new OpError(`time должен быть от 0 до ${planned.duration} с`)
  }
  const width = frameWidth(options.width)
  const height = Math.round(width * (draft.canvas.height / draft.canvas.width))
  const tmp = path.join(dataRoot(), 'tmp', randomBytes(6).toString('hex'))
  const output = path.join(tmp, 'frame.jpg')
  try {
    const textList = buildTextTrack({
      dir: tmp,
      width: draft.canvas.width,
      height: draft.canvas.height,
      duration: planned.duration,
      texts: draft.texts,
      styles: draft.styles,
      pixelScale: 1,
    })
    await renderFrame(
      {
        ...planned,
        width: draft.canvas.width,
        height: draft.canvas.height,
        fps: draft.canvas.fps || 30,
        textList,
        loudnorm: false,
        frame: { time: round3(Math.min(time, Math.max(0, planned.duration - 0.04))), width },
      },
      output,
    )
    if (!existsSync(output)) throw new OpError('Не удалось получить кадр', 500)
    return {
      mimeType: 'image/jpeg',
      time: round3(time),
      width,
      height,
      data: readFileSync(output).toString('base64'),
    }
  } catch (err) {
    if (err instanceof OpError) throw err
    throw new OpError(`Не удалось получить кадр: ${err.message}`, 500)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function render(options = {}) {
  return runRender(options)
}

export function preview() {
  return runRender({
    output: previewFile(),
    width: 540,
    height: 960,
    crf: 30,
    preset: 'ultrafast',
  })
}

export async function cancelRender() {
  const pending = requestCancel()
  if (!pending) throw new OpError('Рендер не выполняется')
  const result = await pending
  return { cancelled: Boolean(result?.cancelled) }
}

export function stopRender() {
  requestCancel()
}
