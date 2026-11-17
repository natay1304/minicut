import { postOp, request } from './api.js'
import { hooks } from './hooks.js'
import { paintCanvas } from './preview-canvas.js'
import { frontVideo } from './preview-players.js'
import { clipById, locate, mainDuration, primaryClip, trackLabel, viewClip } from './project-model.js'
import { $, overlayVideos, state } from './state.js'
import { fillStyleForm, fillTextForm, renderTextList } from './texts.js'
import { CLIP_LIMITS, clamp, round3 } from './util.js'

export function clipHeading() {
  const clip = primaryClip()
  if (!clip) return ''
  const trackName = trackLabel(clipById(clip.id)?.track.id || 'main')
  const extra = state.selectedIds.size > 1 ? ` · выбрано ${state.selectedIds.size}` : ''
  return `${trackName} · ${clip.name || clip.id}${extra}`
}

export function renderInspector() {
  fillClipForm()
  renderTextList()
  fillTextForm()
  fillStyleForm()
}

export function fillClipForm() {
  const clip = primaryClip()
  const form = $('clip-form')
  const empty = $('clip-empty')
  if (!clip) {
    form.hidden = true
    empty.hidden = false
    return
  }
  empty.hidden = true
  form.hidden = false
  $('clip-heading').textContent = clipHeading()
  $('clip-delete').textContent = state.selectedIds.size > 1 ? 'Удалить выбранные' : 'Удалить'
  if (form.contains(document.activeElement)) return
  setPair('prop-scale', clip.scale ?? 1)
  setPair('prop-x', clip.x ?? 0)
  setPair('prop-y', clip.y ?? 0)
  setPair('prop-volume', clip.volume ?? 1)
  $('prop-fade-in').value = String(clip.fadeIn ?? 0)
  $('prop-fade-out').value = String(clip.fadeOut ?? 0)
  $('prop-mute').checked = Boolean(clip.muted)
}

export function setPair(id, value) {
  const n = round3(Number(value) || 0)
  const range = $(id)
  const num = $(`${id}-n`)
  if (range) range.value = String(n)
  if (num) num.value = String(n)
}

export function previewAudio(clip) {
  const view = viewClip(clip)
  const volume = clamp(Number(view.volume ?? 1), 0, 1)
  const muted = Boolean(view.muted)
  const loc =
    mainDuration() > 0 ? locate(Math.min(state.playhead, Math.max(mainDuration() - 0.001, 0))) : null
  if (loc && loc.clip.id === clip.id) {
    const player = frontVideo()
    player.muted = muted
    player.volume = volume
  }
  const found = clipById(clip.id)
  const video = found ? overlayVideos.get(found.track.id) : null
  if (video) {
    video.muted = muted
    video.volume = volume
  }
}

export function bindClipNumber(rangeId, key, live) {
  const range = $(rangeId)
  const num = $(`${rangeId}-n`)
  const read = (source) => {
    const limits = CLIP_LIMITS[key]
    let value = Number(source.value)
    if (!Number.isFinite(value)) return null
    if (limits) value = clamp(value, limits[0], limits[1])
    return round3(value)
  }
  const pull = (source) => {
    const clip = primaryClip()
    if (!clip) return
    const value = read(source)
    if (value == null) return
    if (source === range && num) num.value = String(value)
    if (source === num && range) range.value = String(value)
    if (!live) return
    state.previewPatch = { id: clip.id, [key]: value }
    if (key === 'volume') previewAudio(clip)
    paintCanvas()
  }
  const commit = (source) => {
    pull(source)
    const clip = primaryClip()
    if (!clip) return
    const value = read(source)
    if (value == null || round3(clip[key] ?? 0) === value) return
    void postOp('setClip', { clipId: clip.id, [key]: value }).catch(async () => {
      try {
        hooks.applyProject(await request('GET', '/api/project'))
      } catch {
        /* статус уже есть */
      }
    })
  }
  for (const node of [range, num]) {
    if (!node) continue
    node.addEventListener('input', () => pull(node))
    node.addEventListener('change', () => commit(node))
  }
}

export function bindFade(id, key) {
  const node = $(id)
  node.addEventListener('change', () => {
    const clip = primaryClip()
    if (!clip) return
    let value = Number(node.value)
    if (!Number.isFinite(value)) return
    value = round3(Math.max(0, value))
    node.value = String(value)
    if (round3(clip[key] ?? 0) === value) return
    void postOp('setClip', { clipId: clip.id, [key]: value }).catch(async () => {
      try {
        hooks.applyProject(await request('GET', '/api/project'))
      } catch {
        /* статус уже есть */
      }
    })
  })
}

export function bindInspector() {
  bindClipNumber('prop-scale', 'scale', true)
  bindClipNumber('prop-x', 'x', true)
  bindClipNumber('prop-y', 'y', true)
  bindClipNumber('prop-volume', 'volume', true)
  bindFade('prop-fade-in', 'fadeIn')
  bindFade('prop-fade-out', 'fadeOut')
  $('prop-mute').addEventListener('change', () => {
    const clip = primaryClip()
    if (!clip) return
    const muted = $('prop-mute').checked
    state.previewPatch = { id: clip.id, muted }
    previewAudio(clip)
    if (Boolean(clip.muted) === muted) return
    void postOp('setClip', { clipId: clip.id, muted }).catch(async () => {
      try {
        hooks.applyProject(await request('GET', '/api/project'))
      } catch {
        /* статус уже есть */
      }
    })
  })
  $('clip-form').addEventListener('focusout', (event) => {
    if ($('clip-form').contains(event.relatedTarget)) return
    state.previewPatch = null
    paintCanvas()
  })
}
