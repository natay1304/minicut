import { postOp, request } from './api.js'
import {
  FRAME_BOTTOM,
  FRAME_MIN,
  FRAME_TOP,
  SCALE_MAX,
  SCALE_MIN,
  SHIFT_MAX,
  clipFrame,
  keepPicture,
  keepPictureCover,
  clampOffset,
  panContent,
  regionFromFrame,
  resizeFrame,
  wheelFactor,
  zoomAtPoint,
} from './crop-math.js'
import { hooks } from './hooks.js'
import { clipById, locate, mainDuration, mediaById, primaryClip, viewClip } from './project-model.js'
import { $, state } from './state.js'
import { clamp, round3 } from './util.js'

const CURSORS = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

let token = 0
let saveChain = Promise.resolve()
let session = null
let wheelTimer = 0

function typingTarget(el) {
  if (!el || el === document.body) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function dialogOpen() {
  return [...document.querySelectorAll('dialog')].some((dialog) => dialog.open)
}

function underPlayhead(clip) {
  const found = clipById(clip.id)
  if (!found) return false
  if (found.track.id === 'main') {
    const total = mainDuration()
    if (!(total > 0)) return false
    const loc = locate(Math.min(state.playhead, Math.max(total - 0.001, 0)))
    return loc?.clip.id === clip.id
  }
  const start = clip.start || 0
  const dur = clip.out - clip.in
  return state.playhead >= start && state.playhead < start + dur - 0.0001
}

function editableClip() {
  if (!state.crop) return null
  const clip = primaryClip()
  if (!clip || !underPlayhead(clip)) return null
  return clip
}

function boxRect() {
  const box = $('canvas-box')
  if (!box) return null
  const rect = box.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  return rect
}

function pointInBox(event, rect) {
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  }
}

function copyRegion(region) {
  if (!region || typeof region !== 'object') return null
  return { x: Number(region.x), y: Number(region.y), w: Number(region.w), h: Number(region.h) }
}

function packRegion(region) {
  if (!region) return null
  let x = round3(clamp(region.x, 0, 1))
  let y = round3(clamp(region.y, 0, 1))
  let w = round3(clamp(region.w, FRAME_MIN, 1))
  let h = round3(clamp(region.h, FRAME_MIN, 1))
  if (x + w > 1) w = round3(1 - x)
  if (y + h > 1) h = round3(1 - y)
  if (w < FRAME_MIN) {
    w = FRAME_MIN
    x = round3(Math.min(x, 1 - w))
  }
  if (h < FRAME_MIN) {
    h = FRAME_MIN
    y = round3(Math.min(y, 1 - h))
  }
  if (x === 0 && y === 0 && w === 1 && h === 1) return null
  return { x, y, w, h }
}

function packFields(fields) {
  return {
    region: packRegion(fields.region),
    scale: round3(clamp(Number(fields.scale) || 1, SCALE_MIN, SCALE_MAX)),
    x: round3(clamp(Number(fields.x) || 0, -SHIFT_MAX, SHIFT_MAX)),
    y: round3(clamp(Number(fields.y) || 0, -SHIFT_MAX, SHIFT_MAX)),
  }
}

function sameRegion(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

// Размеры видео и холста нужны, чтобы считать картинку так же, как экспорт (см. placeImage в crop-math.js).
function geometryFor(clipId) {
  const clip = clipById(clipId)?.clip
  const media = clip ? mediaById(clip.mediaId) : null
  const canvas = state.project?.canvas
  if (!media?.width || !media?.height || !canvas?.width || !canvas?.height) return null
  return { mediaW: media.width, mediaH: media.height, canvasW: canvas.width, canvasH: canvas.height }
}

function differs(clip, packed) {
  if (round3(clip.scale ?? 1) !== packed.scale) return true
  if (round3(clip.x ?? 0) !== packed.x) return true
  if (round3(clip.y ?? 0) !== packed.y) return true
  return !sameRegion(packRegion(clip.region), packed.region)
}

function blurClipForm() {
  const form = $('clip-form')
  if (form?.contains(document.activeElement)) document.activeElement.blur()
}

function showLive(clipId, fields) {
  state.cropGesture = true
  blurClipForm()
  state.previewPatch = {
    id: clipId,
    region: fields.region,
    scale: fields.scale,
    x: fields.x,
    y: fields.y,
  }
  hooks.paintCanvas?.()
  hooks.fillClipForm?.()
}

function finish(my) {
  if (my !== token) return
  state.previewPatch = null
  state.hold = false
  state.cropGesture = false
  if (state.drag?.type === 'crop') state.drag = null
  hooks.flushPending?.()
  hooks.paintCanvas?.()
  hooks.fillClipForm?.()
}

function enqueueSave(clipId, fields) {
  const my = ++token
  const packed = packFields(fields)
  saveChain = saveChain.then(() => persist(my, clipId, packed)).catch(() => {})
}

async function persist(my, clipId, packed) {
  if (my !== token) return
  const clip = clipById(clipId)?.clip
  if (!clip || !differs(clip, packed)) {
    finish(my)
    return
  }
  state.hold = true
  try {
    await postOp('setClip', {
      clipId,
      region: packed.region,
      scale: packed.scale,
      x: packed.x,
      y: packed.y,
    })
  } catch {
    if (my !== token) return
    state.pendingProject = null
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      /* статус уже есть */
    }
  } finally {
    finish(my)
  }
}

function clearWheelTimer() {
  clearTimeout(wheelTimer)
  wheelTimer = 0
}

function scheduleWheel(clipId) {
  clearWheelTimer()
  wheelTimer = setTimeout(() => {
    wheelTimer = 0
    const clip = clipById(clipId)?.clip
    if (!clip) return
    const view = viewClip(clip)
    enqueueSave(clipId, {
      region: copyRegion(view.region),
      scale: view.scale ?? 1,
      x: view.x ?? 0,
      y: view.y ?? 0,
    })
  }, 200)
}

function fieldsFromView(clip, overrides = {}) {
  const view = viewClip(clip)
  return {
    region: overrides.region === undefined ? copyRegion(view.region) : overrides.region,
    scale: overrides.scale === undefined ? (view.scale ?? 1) : overrides.scale,
    x: overrides.x === undefined ? (view.x ?? 0) : overrides.x,
    y: overrides.y === undefined ? (view.y ?? 0) : overrides.y,
  }
}

function applyFields(overrides) {
  if (session) return
  clearWheelTimer()
  const clip = editableClip()
  if (!clip) return
  const fields = fieldsFromView(clip, overrides)
  showLive(clip.id, fields)
  enqueueSave(clip.id, fields)
}

function onMove(event) {
  if (!session) return
  const rect = boxRect()
  if (!rect) return
  const point = pointInBox(event, rect)
  const dx = point.x - session.px
  const dy = point.y - session.py
  if (Math.hypot(dx * rect.width, dy * rect.height) < 2) {
    if (session.fields) {
      session.fields = null
      showLive(session.clipId, {
        region: session.region,
        scale: session.scale,
        x: session.x,
        y: session.y,
      })
    }
    return
  }
  let fields
  if (session.handle) {
    const frame = resizeFrame(session.frame, session.handle, dx, dy, { snap: !event.altKey })
    const geo = geometryFor(session.clipId)
    const kept = geo
      ? keepPictureCover(session.frame, frame, session.x, session.y, session.scale, geo)
      : { ...keepPicture(session.frame, frame, session.x, session.y, session.scale), scale: session.scale }
    fields = { region: regionFromFrame(frame), scale: kept.scale, x: kept.x, y: kept.y }
    document.documentElement.style.cursor = CURSORS[session.handle] || ''
  } else {
    const pan = panContent(
      { x: session.x, y: session.y },
      dx * rect.width,
      dy * rect.height,
      session.frame.w * rect.width,
      session.frame.h * rect.height,
    )
    const geo = geometryFor(session.clipId)
    const seen = geo ? clampOffset(session.frame, pan, session.scale, geo) : pan
    fields = { region: session.region, scale: session.scale, x: seen.x, y: seen.y }
    document.documentElement.style.cursor = 'move'
  }
  session.fields = fields
  showLive(session.clipId, fields)
}

function endDrag() {
  if (!session) return
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  document.documentElement.style.cursor = ''
  const done = session
  session = null
  if (state.drag?.type === 'crop') state.drag = null
  if (!done.fields) {
    if (done.pendingWheel) scheduleWheel(done.clipId)
    else {
      const clip = clipById(done.clipId)?.clip
      const packed = packFields({ region: done.region, scale: done.scale, x: done.x, y: done.y })
      if (!clip || !differs(clip, packed)) {
        state.previewPatch = null
        state.cropGesture = false
        hooks.paintCanvas?.()
        hooks.fillClipForm?.()
      }
    }
    return
  }
  enqueueSave(done.clipId, done.fields)
}

function onUp() {
  endDrag()
}

function onDown(event) {
  if (event.button !== 0 || !state.crop) return
  const clip = editableClip()
  if (!clip) return
  event.preventDefault()
  event.stopPropagation()
  if (event.detail >= 2) {
    clearWheelTimer()
    applyFields({ x: 0, y: 0, scale: 1 })
    return
  }
  const rect = boxRect()
  if (!rect) return
  const pendingWheel = wheelTimer !== 0
  clearWheelTimer()
  const view = viewClip(clip)
  const point = pointInBox(event, rect)
  const handle = event.target.closest?.('[data-handle]')?.dataset.handle || null
  session = {
    clipId: clip.id,
    handle,
    frame: clipFrame(view),
    region: copyRegion(view.region),
    x: view.x ?? 0,
    y: view.y ?? 0,
    scale: view.scale ?? 1,
    px: point.x,
    py: point.y,
    fields: null,
    pendingWheel,
  }
  state.drag = { type: 'crop' }
  document.documentElement.style.cursor = handle ? CURSORS[handle] || 'move' : 'move'
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    /* указатель уже отпущен */
  }
  hooks.pausePlayback?.()
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onWheel(event) {
  if (!state.crop || session) return
  const clip = editableClip()
  if (!clip) return
  event.preventDefault()
  const rect = boxRect()
  if (!rect) return
  const view = viewClip(clip)
  const point = pointInBox(event, rect)
  const next = zoomAtPoint(
    { scale: view.scale ?? 1, x: view.x ?? 0, y: view.y ?? 0 },
    clipFrame(view),
    wheelFactor(event.deltaY, event.shiftKey, event.deltaMode),
    point.x,
    point.y,
  )
  const geo = geometryFor(clip.id)
  const seen = geo ? clampOffset(clipFrame(view), next, next.scale, geo) : next
  showLive(clip.id, {
    region: copyRegion(view.region),
    scale: next.scale,
    x: seen.x,
    y: seen.y,
  })
  scheduleWheel(clip.id)
}

function onKeyDown(event) {
  if (event.code !== 'Escape' || !state.crop) return
  if (typingTarget(event.target) || dialogOpen()) return
  event.preventDefault()
  setCrop(false)
}

function setPresetEnabled(on) {
  for (const id of ['crop-full', 'crop-top', 'crop-bottom', 'crop-reset']) {
    const button = $(id)
    if (button) button.disabled = !on
  }
}

export function syncCropLayer() {
  const layer = $('crop-layer')
  const button = $('crop-btn')
  if (!layer || !button) return
  button.setAttribute('aria-pressed', state.crop ? 'true' : 'false')
  const presets = $('crop-presets')
  if (presets) presets.hidden = !state.crop
  const hint = $('crop-hint')
  if (!state.crop) {
    layer.hidden = true
    setPresetEnabled(false)
    if (hint) {
      hint.hidden = true
      hint.textContent = ''
    }
    return
  }
  const clip = primaryClip()
  const visible = Boolean(clip && underPlayhead(clip))
  setPresetEnabled(visible)
  if (hint) {
    if (!visible) {
      hint.hidden = false
      hint.textContent = 'Поставьте плейхед на клип'
    } else if (state.selectedIds.size > 1) {
      hint.hidden = false
      hint.textContent = `Правится клип: ${clip.name || clip.id}`
    } else {
      hint.hidden = true
      hint.textContent = ''
    }
  }
  if (!visible) {
    layer.hidden = true
    return
  }
  const frame = clipFrame(viewClip(clip))
  const box = $('crop-frame')
  if (!box) return
  box.style.left = `${frame.x * 100}%`
  box.style.top = `${frame.y * 100}%`
  box.style.width = `${frame.w * 100}%`
  box.style.height = `${frame.h * 100}%`
  layer.hidden = false
}

export function setCrop(on) {
  const next = Boolean(on)
  if (next === Boolean(state.crop)) return false
  if (!next) {
    if (session) endDrag()
    else if (wheelTimer) {
      const clip = primaryClip()
      clearWheelTimer()
      if (clip && state.previewPatch?.id === clip.id) {
        const view = viewClip(clip)
        enqueueSave(clip.id, {
          region: copyRegion(view.region),
          scale: view.scale ?? 1,
          x: view.x ?? 0,
          y: view.y ?? 0,
        })
      }
    }
  }
  state.crop = next
  syncCropLayer()
  return true
}

export function toggleCrop() {
  setCrop(!state.crop)
}

export function bindCrop() {
  $('crop-btn').addEventListener('click', () => toggleCrop())
  $('crop-full').addEventListener('click', () => applyFields({ region: null }))
  $('crop-top').addEventListener('click', () => applyFields({ region: { ...FRAME_TOP } }))
  $('crop-bottom').addEventListener('click', () => applyFields({ region: { ...FRAME_BOTTOM } }))
  $('crop-reset').addEventListener('click', () => applyFields({ region: null, scale: 1, x: 0, y: 0 }))
  const frame = $('crop-frame')
  frame.addEventListener('pointerdown', onDown)
  frame.addEventListener('wheel', onWheel, { passive: false })
  frame.addEventListener('click', (event) => event.stopPropagation())
  window.addEventListener('keydown', onKeyDown)
  syncCropLayer()
}
