import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { probe, round3 } from '../ffmpeg.js'
import { VIDEO_EXT, checkPath } from '../paths.js'

export const OVERLAY_LIMIT = 10

export class OpError extends Error {
  constructor(message, status = 400, code = 'op_error') {
    super(message)
    this.name = 'OpError'
    this.status = status
    this.code = code
  }
}

let commitBound = null

export function bindCommit(fn) {
  commitBound = fn
}

function commit(mutator) {
  return commitBound(mutator)
}

export function defaultStyle() {
  return {
    font: 'JetBrains Mono',
    weight: 700,
    size: 62,
    color: '#F3E9DC',
    shadow: { dx: 3, dy: 3, blur: 6, color: '#000000AA' },
    x: 0.5,
    y: 0.64,
    align: 'center',
  }
}

export function emptyProject(name = 'untitled') {
  return {
    version: 2,
    name,
    canvas: { width: 1080, height: 1920, fps: 30 },
    media: [],
    tracks: [
      { id: 'main', kind: 'ripple', clips: [] },
      { id: 'overlay', kind: 'free', clips: [] },
    ],
    texts: [],
    styles: { sub: defaultStyle() },
  }
}

function numOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const REGION_EPS = 0.001

function regionProblem(x, y, w, h) {
  if (w < 0.05 || h < 0.05) return 'Ширина и высота области не меньше 0.05'
  if (x < 0 || y < 0 || w > 1 + REGION_EPS || h > 1 + REGION_EPS) {
    return 'Область задаётся в долях кадра от 0 до 1'
  }
  if (x + w > 1 + REGION_EPS || y + h > 1 + REGION_EPS) return 'Область выходит за кадр'
  return ''
}

function regionBox(value) {
  return {
    x: round3(value.x),
    y: round3(value.y),
    w: round3(value.w),
    h: round3(value.h),
  }
}

// null — весь холст. Битые значения при чтении проекта отбрасываются, чтобы файл открывался.
export function normalizeRegion(value) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const x = Number(value.x)
  const y = Number(value.y)
  const w = Number(value.w)
  const h = Number(value.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  if (regionProblem(x, y, w, h)) return null
  return regionBox({ x, y, w, h })
}

export function requireRegion(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpError('region должен быть объектом или null')
  }
  const x = mustNum(value.x, 'region.x')
  const y = mustNum(value.y, 'region.y')
  const w = mustNum(value.w, 'region.w')
  const h = mustNum(value.h, 'region.h')
  const problem = regionProblem(x, y, w, h)
  if (problem) throw new OpError(problem)
  return regionBox({ x, y, w, h })
}

export function normalizeStyle(style) {
  const base = defaultStyle()
  const src = style && typeof style === 'object' ? style : {}
  const shadow = src.shadow && typeof src.shadow === 'object' ? src.shadow : {}
  const align =
    src.align === 'left' || src.align === 'right' || src.align === 'center' ? src.align : base.align
  return {
    font: typeof src.font === 'string' && src.font.trim() ? src.font : base.font,
    weight: Number.isFinite(Number(src.weight)) ? Number(src.weight) : base.weight,
    size: Number(src.size) > 0 ? Number(src.size) : base.size,
    color: typeof src.color === 'string' && src.color.trim() ? src.color : base.color,
    x: Number.isFinite(Number(src.x)) ? Number(src.x) : base.x,
    y: Number.isFinite(Number(src.y)) ? Number(src.y) : base.y,
    align,
    shadow: {
      dx: Number.isFinite(Number(shadow.dx)) ? Number(shadow.dx) : base.shadow.dx,
      dy: Number.isFinite(Number(shadow.dy)) ? Number(shadow.dy) : base.shadow.dy,
      blur: Number.isFinite(Number(shadow.blur)) ? Number(shadow.blur) : base.shadow.blur,
      color: typeof shadow.color === 'string' && shadow.color.trim() ? shadow.color : base.shadow.color,
    },
  }
}

function normalizeMedia(item) {
  if (!item || typeof item.id !== 'string' || typeof item.path !== 'string') {
    throw new Error('Повреждена библиотека медиа')
  }
  const media = {
    id: item.id,
    path: item.path,
    name: typeof item.name === 'string' ? item.name : path.basename(item.path),
    duration: numOr(item.duration, 0),
    width: numOr(item.width, 0),
    height: numOr(item.height, 0),
    fps: numOr(item.fps, 30),
    hasAudio: Boolean(item.hasAudio),
  }
  if (Array.isArray(item.words)) media.words = item.words
  if (typeof item.language === 'string') media.language = item.language
  return media
}

export const SPEED_MIN = 0.25
export const SPEED_MAX = 4

/** Скорость клипа: 1 — как в исходнике, 2 — вдвое быстрее. */
export function speedOf(clip) {
  const speed = Number(clip?.speed)
  return Number.isFinite(speed) && speed > 0 ? speed : 1
}

/** Длина клипа на таймлайне в секундах: исходный отрезок делится на скорость. */
export function clipLength(clip) {
  return (clip.out - clip.in) / speedOf(clip)
}

function normalizeSpeed(value) {
  const speed = numOr(value, 1)
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, round3(speed)))
}

function normalizeClip(clip, kind, mediaById) {
  if (!clip || typeof clip.id !== 'string' || typeof clip.mediaId !== 'string') {
    throw new Error('Повреждён клип')
  }
  const media = mediaById.get(clip.mediaId)
  const next = {
    id: clip.id,
    mediaId: clip.mediaId,
    in: round3(numOr(clip.in, 0)),
    out: round3(numOr(clip.out, 0)),
    name: typeof clip.name === 'string' ? clip.name : media?.name || '',
    scale: clip.scale == null ? 1 : numOr(clip.scale, 1),
    x: clip.x == null ? 0 : numOr(clip.x, 0),
    y: clip.y == null ? 0 : numOr(clip.y, 0),
    region: normalizeRegion(clip.region),
    volume: clip.volume == null ? 1 : numOr(clip.volume, 1),
    muted: clip.muted == null ? kind === 'free' : Boolean(clip.muted),
    fadeIn: clip.fadeIn == null ? 0 : numOr(clip.fadeIn, 0),
    fadeOut: clip.fadeOut == null ? 0 : numOr(clip.fadeOut, 0),
  }
  const speed = clip.speed == null ? 1 : normalizeSpeed(clip.speed)
  if (speed !== 1) next.speed = speed
  if (kind === 'free') next.start = round3(clip.start == null ? 0 : numOr(clip.start, 0))
  return next
}

function mediaMap(media) {
  return new Map(media.map((item) => [item.id, item]))
}

function normalizeTexts(texts, styles) {
  if (!Array.isArray(texts)) return []
  return texts
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      start: round3(numOr(item.start, 0)),
      end: round3(numOr(item.end, 0)),
      text: typeof item.text === 'string' ? item.text : '',
      style: typeof item.style === 'string' && styles[item.style] ? item.style : 'sub',
    }))
}

function canvasOf(raw) {
  const canvas = raw?.canvas && typeof raw.canvas === 'object' ? raw.canvas : {}
  return {
    width: evenSize(canvas.width, 1080, 'width'),
    height: evenSize(canvas.height, 1920, 'height'),
    fps: round3(numOr(canvas.fps, 30)) || 30,
  }
}

// overlay = 1, overlay2 … overlay10. overlay1 — тот же первый оверлей.
export function overlayIndex(id) {
  if (id === 'overlay') return 1
  if (typeof id !== 'string') return null
  const match = /^overlay(\d+)$/.exec(id)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isInteger(n) || n < 1 || n > OVERLAY_LIMIT) return null
  return n
}

export function overlayTrackId(n) {
  return n === 1 ? 'overlay' : `overlay${n}`
}

export function sortProjectTracks(list) {
  const main = list.find((track) => track && track.id === 'main') || { id: 'main', kind: 'ripple', clips: [] }
  const byId = new Map()
  for (const track of list) {
    const n = overlayIndex(track?.id)
    if (!n) continue
    const id = overlayTrackId(n)
    const clips = Array.isArray(track.clips) ? track.clips : []
    if (!byId.has(id) || track.id === id) byId.set(id, { id, kind: 'free', clips })
  }
  const overlays = [...byId.values()].sort((a, b) => overlayIndex(a.id) - overlayIndex(b.id))
  if (!overlays.length) overlays.push({ id: 'overlay', kind: 'free', clips: [] })
  return [{ id: 'main', kind: 'ripple', clips: Array.isArray(main.clips) ? main.clips : [] }, ...overlays]
}

// v1 хранил одну дорожку в clips. Она становится ripple-дорожкой main.
// Старый проект с одним overlay открывается как раньше; лишние id отбрасываются.
export function normalizeProject(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') throw new Error('Повреждён файл проекта')
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName || 'default'
  const media = Array.isArray(raw.media) ? raw.media.map(normalizeMedia) : []
  const byId = mediaMap(media)
  const styles = { sub: defaultStyle() }
  if (raw.styles && typeof raw.styles === 'object') {
    for (const [key, value] of Object.entries(raw.styles)) {
      if (key === 'sub' || (value && typeof value === 'object')) styles[key] = normalizeStyle(value)
    }
    styles.sub = normalizeStyle(raw.styles.sub || styles.sub)
  }
  let mainClips = []
  const overlayBuckets = new Map()
  const v2 = raw.version === 2 || Array.isArray(raw.tracks)
  if (v2 && Array.isArray(raw.tracks)) {
    for (const track of raw.tracks) {
      if (!track || typeof track !== 'object') continue
      if (track.id === 'main') {
        mainClips = Array.isArray(track.clips)
          ? track.clips.map((clip) => normalizeClip(clip, 'ripple', byId))
          : []
        continue
      }
      const n = overlayIndex(track.id)
      if (!n) continue
      const clips = Array.isArray(track.clips)
        ? track.clips.map((clip) => normalizeClip(clip, 'free', byId))
        : []
      const id = overlayTrackId(n)
      if (!overlayBuckets.has(id) || track.id === id) overlayBuckets.set(id, clips)
    }
  } else if (Array.isArray(raw.clips)) {
    mainClips = raw.clips.map((clip) => normalizeClip(clip, 'ripple', byId))
  } else if (!Array.isArray(raw.media)) {
    throw new Error('Повреждён файл проекта')
  }
  const overlays = [...overlayBuckets.keys()]
    .sort((a, b) => overlayIndex(a) - overlayIndex(b))
    .map((id) => ({ id, kind: 'free', clips: overlayBuckets.get(id) }))
  if (!overlays.length) overlays.push({ id: 'overlay', kind: 'free', clips: [] })
  return {
    version: 2,
    name,
    canvas: canvasOf(raw),
    media,
    tracks: [{ id: 'main', kind: 'ripple', clips: mainClips }, ...overlays],
    texts: normalizeTexts(raw.texts, styles),
    styles,
  }
}

export function evenSize(value, fallback, label) {
  const n = Math.round(value == null ? fallback : mustNum(value, label))
  if (n < 2) throw new OpError(`Некорректный ${label}`)
  return n - (n % 2)
}

export function mustNum(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new OpError(`Некорректное значение ${label}`)
  return n
}

export function mustInt(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new OpError(`Некорректное значение ${label}`)
  return n
}

export function hasPathChars(value) {
  return value.includes('/') || value.includes('\\') || value.includes('\0')
}

export function nextId(items, prefix) {
  let max = 0
  for (const item of items) {
    const n = Number(String(item?.id ?? '').slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

export function nextClipId(draft) {
  return nextId(
    draft.tracks.flatMap((track) => track.clips),
    'c',
  )
}

export function findMedia(media, id) {
  const found = media.find((item) => item.id === id)
  if (!found) throw new OpError(`Медиа не найдено: ${id}`)
  return found
}

export function setCanvas(patch = {}) {
  if (!patch || typeof patch !== 'object') throw new OpError('Параметры холста должны быть объектом')
  return commit((draft) => {
    if (patch.width !== undefined) draft.canvas.width = evenSize(patch.width, draft.canvas.width, 'width')
    if (patch.height !== undefined)
      draft.canvas.height = evenSize(patch.height, draft.canvas.height, 'height')
    if (patch.fps !== undefined) {
      const fps = round3(mustNum(patch.fps, 'fps'))
      if (!(fps > 0 && fps <= 120)) throw new OpError('Некорректный fps')
      draft.canvas.fps = fps
    }
    return draft.canvas
  })
}

export async function importMedia(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new OpError('Не указан путь к файлу')
  const abs = checkPath(filePath, { extensions: VIDEO_EXT, label: 'Видеофайл' })
  if (!existsSync(abs)) throw new OpError(`Файл не найден: ${abs}`)
  if (!statSync(abs).isFile()) throw new OpError('Это не файл')
  let info
  try {
    info = await probe(abs)
  } catch (err) {
    throw new OpError(`Не удалось прочитать файл: ${err.message}`)
  }
  return commit((draft) => {
    const media = {
      id: nextId(draft.media, 'm'),
      path: abs,
      name: path.basename(abs),
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
      hasAudio: info.hasAudio,
    }
    draft.media.push(media)
    return media
  })
}
