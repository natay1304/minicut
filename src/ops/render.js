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

const VIDEO_CODECS = new Set(['libx264', 'libx265', 'libvpx-vp9', 'prores_ks'])

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
  const videoCodec = options.videoCodec == null ? 'libx264' : String(options.videoCodec)
  if (!VIDEO_CODECS.has(videoCodec)) throw new OpError(`videoCodec: ${[...VIDEO_CODECS].join(', ')}`)
  const ext = path.extname(output).toLowerCase()
  if (videoCodec === 'libvpx-vp9' && ext !== '.webm') throw new OpError('libvpx-vp9 пишется только в .webm')
  if (ext === '.webm' && videoCodec !== 'libvpx-vp9')
    throw new OpError('Для .webm нужен videoCodec libvpx-vp9')
  if (videoCodec === 'prores_ks' && ext !== '.mov') throw new OpError('prores_ks пишется только в .mov')
  let videoBitrate = null
  if (options.videoBitrate != null) {
    videoBitrate = String(options.videoBitrate)
    if (!/^\d{2,5}k$/.test(videoBitrate)) throw new OpError('videoBitrate вида 8000k')
  }
  return {
    output,
    width,
    height,
    fps,
    crf,
    preset,
    audioBitrate,
    loudnorm,
    videoCodec,
    videoBitrate,
  }
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
    vfilters: clip.vfilters || null,
    afilters: clip.afilters || null,
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

const FRAME_LEAD = 1

/**
 * Для одного кадра нет смысла прогонять через фильтры весь проект: оставляем только куски клипов
 * в окне [time - FRAME_LEAD, time + 0.04] и сдвигаем время так, чтобы окно началось с нуля.
 * Возвращает null, если окно не покрыто главной дорожкой (тогда считаем кадр по полному плану).
 */
export function framePlan(planned, time) {
  const from = Math.max(0, time - FRAME_LEAD)
  const to = time + 0.04
  const cut = (clip, start) => {
    const length = (clip.out - clip.in) / clip.speed
    const a = Math.max(start, from)
    const b = Math.min(start + length, to)
    if (!(b - a > 0.001)) return null
    const inn = clip.in + (a - start) * clip.speed
    const out = clip.in + (b - start) * clip.speed
    // Читаем файл не с начала: -ss на входе сдвигает его время, поэтому in/out считаем от seek.
    const seek = Math.max(0, inn - 1)
    return {
      ...clip,
      seek: round3(seek),
      in: round3(inn - seek),
      out: round3(out - seek),
      fadeIn: 0,
      fadeOut: 0,
      ...(clip.start == null ? {} : { start: round3(a - from) }),
    }
  }
  let offset = 0
  const main = []
  for (const clip of planned.main) {
    const piece = cut(clip, offset)
    if (piece) main.push(piece)
    offset += (clip.out - clip.in) / clip.speed
  }
  if (!main.length) return null
  const overlays = planned.overlays.map((clip) => cut(clip, clip.start ?? 0)).filter(Boolean)
  return { main, overlays, from, duration: round3(to - from) }
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
    const at = round3(Math.min(time, Math.max(0, planned.duration - 0.04)))
    const win = framePlan(planned, at)
    const base = win
      ? { ...planned, main: win.main, overlays: win.overlays, duration: win.duration }
      : planned
    const shift = win ? win.from : 0
    const texts = draft.texts
      .filter((text) => !win || (text.end > shift && text.start < shift + win.duration))
      .map((text) => ({ ...text, start: round3(text.start - shift), end: round3(text.end - shift) }))
    const textList = buildTextTrack({
      dir: tmp,
      width: draft.canvas.width,
      height: draft.canvas.height,
      duration: base.duration,
      texts,
      styles: draft.styles,
      pixelScale: 1,
    })
    await renderFrame(
      {
        ...base,
        width: draft.canvas.width,
        height: draft.canvas.height,
        fps: draft.canvas.fps || 30,
        textList,
        loudnorm: false,
        frame: { time: round3(at - shift), width },
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
