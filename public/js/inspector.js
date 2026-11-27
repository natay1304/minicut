import { postOp, request } from './api.js'
import { SPEED_MAX, SPEED_MIN, formatSpeed, speedOf } from './clip-time.js'
import { FRAME_BOTTOM, FRAME_TOP } from './crop-math.js'
import { hooks } from './hooks.js'
import { paintCanvas } from './preview-canvas.js'
import { frontVideo } from './preview-players.js'
import {
  clipById,
  locate,
  mainClips,
  mainDuration,
  overlayClips,
  primaryClip,
  trackLabel,
  viewClip,
} from './project-model.js'
import { $, overlayVideos, state } from './state.js'
import { fillStyleForm, fillTextForm, renderTextList } from './texts.js'
import { CLIP_LIMITS, clamp, round3 } from './util.js'

function sameRegion(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return ['x', 'y', 'w', 'h'].every((key) => Math.abs(Number(a[key]) - Number(b[key])) < 0.001)
}

function regionChoice(region) {
  if (!region) return 'full'
  if (sameRegion(region, FRAME_TOP)) return 'top'
  if (sameRegion(region, FRAME_BOTTOM)) return 'bottom'
  return 'custom'
}

function regionFromChoice(choice) {
  if (choice === 'top') return { ...FRAME_TOP }
  if (choice === 'bottom') return { ...FRAME_BOTTOM }
  return null
}

function fillRegion(clip) {
  const select = $('prop-region')
  const custom = select.querySelector('option[value="custom"]')
  const choice = regionChoice(clip.region)
  custom.hidden = choice !== 'custom'
  select.value = choice
}

function clipHeading() {
  const clip = primaryClip()
  if (!clip) return ''
  const trackName = trackLabel(clipById(clip.id)?.track.id || 'main')
  const extra = state.selectedIds.size > 1 ? ` · выбрано ${state.selectedIds.size}` : ''
  return `${trackName} · ${clip.name || clip.id}${extra}`
}

function fillHeading() {
  const heading = $('clip-heading')
  heading.textContent = clipHeading()
  const clip = primaryClip()
  if (!clip || speedOf(clip) === 1) return
  const badge = document.createElement('span')
  badge.className = 'clip-speed-badge'
  badge.textContent = formatSpeed(clip)
  heading.append(' ', badge)
}

/** Текущая скорость проекта: общая, если у всех клипов одна, иначе диапазон. */
function renderProjectSpeed() {
  const el = $('speed-now')
  const speeds = [...mainClips(), ...overlayClips()].map((clip) => round3(speedOf(clip)))
  if (!speeds.length) {
    el.textContent = ''
    return
  }
  const min = Math.min(...speeds)
  const max = Math.max(...speeds)
  el.textContent =
    min === max ? `Сейчас у всех клипов ×${min}` : `Сейчас скорости разные: от ×${min} до ×${max}`
}

export function renderInspector() {
  renderProjectSpeed()
  fillClipForm()
  renderTextList()
  fillTextForm()
  fillStyleForm()
}

export function fillClipForm() {
  const clip = viewClip(primaryClip())
  const form = $('clip-form')
  const empty = $('clip-empty')
  if (!clip) {
    form.hidden = true
    empty.hidden = false
    hooks.syncCrop?.()
    return
  }
  empty.hidden = true
  form.hidden = false
  fillHeading()
  $('clip-delete').textContent = state.selectedIds.size > 1 ? 'Удалить выбранные' : 'Удалить'
  if (form.contains(document.activeElement)) {
    hooks.syncCrop?.()
    return
  }
  setPair('prop-scale', clip.scale ?? 1)
  setPair('prop-x', clip.x ?? 0)
  setPair('prop-y', clip.y ?? 0)
  setPair('prop-volume', clip.volume ?? 1)
  $('prop-speed').value = String(round3(speedOf(clip)))
  syncSpeedPresets(speedOf(clip))
  $('prop-fade-in').value = String(clip.fadeIn ?? 0)
  $('prop-fade-out').value = String(clip.fadeOut ?? 0)
  $('prop-mute').checked = Boolean(clip.muted)
  fillRegion(clip)
  hooks.syncCrop?.()
}

export function setPair(id, value) {
  const n = round3(Number(value) || 0)
  const range = $(id)
  const num = $(`${id}-n`)
  if (range) range.value = String(n)
  if (num) num.value = String(n)
}

function previewAudio(clip) {
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

function bindClipNumber(rangeId, key, live) {
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

function bindFade(id, key) {
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

function readSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed)) return null
  return round3(clamp(speed, SPEED_MIN, SPEED_MAX))
}

function syncSpeedPresets(speed) {
  const rounded = round3(speed)
  for (const button of $('speed-presets').querySelectorAll('button')) {
    const on = round3(Number(button.dataset.speed)) === rounded
    button.setAttribute('aria-pressed', on ? 'true' : 'false')
    button.classList.toggle('is-on', on)
  }
}

function commitSpeed(speed) {
  const ids = [...state.selectedIds].filter((id) => clipById(id))
  if (!ids.length) return
  const changed = ids.some((id) => round3(speedOf(clipById(id).clip)) !== speed)
  if (!changed) return
  const run =
    ids.length > 1
      ? postOp('setClips', { clipIds: ids, speed })
      : postOp('setClip', { clipId: ids[0], speed })
  void run.catch(async () => {
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      /* статус уже есть */
    }
  })
}

function bindSpeed() {
  const input = $('prop-speed')
  input.addEventListener('change', () => {
    const speed = readSpeed(input.value)
    if (speed == null) return
    input.value = String(speed)
    syncSpeedPresets(speed)
    commitSpeed(speed)
  })
  for (const button of $('speed-presets').querySelectorAll('button')) {
    button.addEventListener('click', () => {
      const speed = readSpeed(button.dataset.speed)
      if (speed == null) return
      input.value = String(speed)
      syncSpeedPresets(speed)
      commitSpeed(speed)
    })
  }
}

export function bindInspector() {
  bindClipNumber('prop-scale', 'scale', true)
  bindClipNumber('prop-x', 'x', true)
  bindClipNumber('prop-y', 'y', true)
  bindClipNumber('prop-volume', 'volume', true)
  bindFade('prop-fade-in', 'fadeIn')
  bindFade('prop-fade-out', 'fadeOut')
  bindSpeed()
  $('clip-form').addEventListener('submit', (event) => event.preventDefault())
  $('prop-region').addEventListener('change', () => {
    const clip = primaryClip()
    if (!clip) return
    const select = $('prop-region')
    const choice = select.value
    if (choice === 'custom') return
    select.querySelector('option[value="custom"]').hidden = true
    const region = regionFromChoice(choice)
    if (sameRegion(clip.region, region)) return
    state.previewPatch = { id: clip.id, region }
    paintCanvas()
    void postOp('setClip', { clipId: clip.id, region }).catch(async () => {
      try {
        hooks.applyProject(await request('GET', '/api/project'))
      } catch {
        /* статус уже есть */
      }
    })
  })
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
    if (state.cropGesture) return
    state.previewPatch = null
    paintCanvas()
  })
}
