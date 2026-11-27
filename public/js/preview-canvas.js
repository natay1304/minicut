import { speedOf } from './clip-time.js'
import { placeImage } from './crop-math.js'
import { hooks } from './hooks.js'
import {
  canvasInfo,
  clipById,
  clipOnTrackAt,
  freeTracks,
  locate,
  mainClips,
  mainDuration,
  mediaById,
  overlayClips,
  styleMap,
  texts,
  trackLabel,
  viewClip,
} from './project-model.js'
import {
  $,
  iconPause,
  iconPlay,
  overlayVideos,
  playBtn,
  speedEl,
  stageEmpty,
  stageMeta,
  state,
} from './state.js'

function frameRegion(clip) {
  const region = clip?.region
  if (!region || typeof region !== 'object') return null
  const x = Number(region.x)
  const y = Number(region.y)
  const w = Number(region.w)
  const h = Number(region.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || !(w > 0) || !(h > 0)) return null
  return { x, y, w, h }
}

function clearFrameBox(video) {
  video.style.left = ''
  video.style.top = ''
  video.style.right = ''
  video.style.bottom = ''
  video.style.width = ''
  video.style.height = ''
  video.style.clipPath = ''
  video.style.objectFit = ''
}

export function applyFrame(video, clip) {
  const scale = Number(clip?.scale ?? 1)
  const x = Number(clip?.x ?? 0)
  const y = Number(clip?.y ?? 0)
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const safeX = Number.isFinite(x) ? x : 0
  const safeY = Number.isFinite(y) ? y : 0
  const media = clip ? mediaById(clip.mediaId) : null
  const canvas = state.project?.canvas
  if (!media?.width || !media?.height || !canvas?.width || !canvas?.height) {
    // Размеры неизвестны: старый способ без точного совпадения с экспортом.
    clearFrameBox(video)
    video.style.transform = `translate(${safeX * 100}%, ${safeY * 100}%) scale(${safeScale})`
    return
  }
  // Картинка кладётся так же, как в экспорте (см. placeImage): всё видео, cover по области, затем окно области.
  const frame = frameRegion(clip) || { x: 0, y: 0, w: 1, h: 1 }
  const image = placeImage(frame, { x: safeX, y: safeY }, safeScale, {
    mediaW: media.width,
    mediaH: media.height,
    canvasW: canvas.width,
    canvasH: canvas.height,
  })
  const pct = (n) => `${n * 100}%`
  video.style.left = pct(image.left)
  video.style.top = pct(image.top)
  video.style.right = 'auto'
  video.style.bottom = 'auto'
  video.style.width = pct(image.width)
  video.style.height = pct(image.height)
  video.style.objectFit = 'fill'
  video.style.transform = 'none'
  // clip-path в координатах картинки возвращает видимое к области (отрицательный отступ: там поля).
  const inset = (n, size) => `${(n / size) * 100}%`
  const top = frame.y - image.top
  const left = frame.x - image.left
  const right = image.left + image.width - (frame.x + frame.w)
  const bottom = image.top + image.height - (frame.y + frame.h)
  video.style.clipPath = `inset(${inset(top, image.height)} ${inset(right, image.width)} ${inset(bottom, image.height)} ${inset(left, image.width)})`
}

function speedTag(clip) {
  const speed = Math.round(speedOf(clip) * 1000) / 1000
  return speed === 1 ? '' : ` ×${speed}`
}

export function paintCanvas() {
  const total = mainDuration()
  if (total > 0) {
    const loc = locate(Math.min(state.playhead, Math.max(total - 0.001, 0)))
    if (loc) applyFrame(hooks.frontVideo(), viewClip(loc.clip))
  }
  const overs = []
  for (const track of freeTracks()) {
    const clip = clipOnTrackAt(track, state.playhead)
    const video = overlayVideos.get(track.id)
    if (clip && video && video.dataset.clipId === clip.id) applyFrame(video, viewClip(clip))
    if (clip) overs.push(clip)
  }
  paintCaptions()
  const loc = total > 0 ? locate(Math.min(state.playhead, Math.max(total - 0.001, 0))) : null
  const parts = []
  if (loc) {
    const media = mediaById(loc.clip.mediaId)
    parts.push(`${loc.clip.name || media?.name || loc.clip.id}${speedTag(loc.clip)}`)
  }
  for (const over of overs)
    parts.push(
      `${trackLabel(clipById(over.id)?.track.id || 'overlay')}: ${over.name || mediaById(over.mediaId)?.name || over.id}${speedTag(over)}`,
    )
  stageMeta.textContent = parts.join(' · ')
  const hasVisual = mainClips().length > 0 || overlayClips().length > 0 || texts().length > 0
  stageEmpty.hidden = hasVisual
  hooks.syncCrop?.()
}

export function paintCaptions() {
  const box = $('canvas-box')
  const height = box.clientHeight
  const active = texts().filter((text) => state.playhead >= text.start && state.playhead < text.end)
  const key = JSON.stringify({
    height,
    preview: state.previewStyle,
    styles: styleMap(),
    active: active.map((text) => [text.id, text.text, text.style, text.start, text.end]),
  })
  if (key === state.captionKey) return
  state.captionKey = key
  const layer = $('captions')
  layer.replaceChildren()
  const canvas = canvasInfo()
  const scale = height > 0 && canvas.height > 0 ? height / canvas.height : 1
  for (const text of active) {
    const style = hooks.activeStyle(text.style || 'sub')
    const el = document.createElement('div')
    el.className = 'caption'
    el.textContent = text.text
    const align = style.align || 'center'
    const ax = align === 'left' ? '0%' : align === 'right' ? '-100%' : '-50%'
    el.style.left = `${(Number(style.x) || 0) * 100}%`
    el.style.top = `${(Number(style.y) || 0) * 100}%`
    el.style.transform = `translate(${ax}, -50%)`
    el.style.textAlign = align
    el.style.fontFamily = style.font || 'sans-serif'
    el.style.fontWeight = String(style.weight || 700)
    el.style.fontSize = `${(Number(style.size) || 62) * scale}px`
    el.style.color = style.color || '#F3E9DC'
    const shadow = style.shadow || {}
    el.style.textShadow = `${(Number(shadow.dx) || 0) * scale}px ${(Number(shadow.dy) || 0) * scale}px ${(Number(shadow.blur) || 0) * scale}px ${shadow.color || '#000'}`
    layer.append(el)
  }
}

export function paintTransport() {
  const playing = state.playing
  iconPlay.hidden = playing
  iconPause.hidden = !playing
  playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизведение')
  if (!playing || state.shuttle === 0) {
    speedEl.hidden = true
    return
  }
  speedEl.hidden = false
  const rate = Math.abs(state.shuttle)
  speedEl.textContent = `${state.shuttle < 0 ? '−' : ''}${rate}×`
}

export function mediaUrl(id) {
  return `/media/${encodeURIComponent(id)}`
}
