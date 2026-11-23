import { postOp } from './api.js'
import { clipLength, speedOf } from './clip-time.js'
import { hooks } from './hooks.js'
import { clipById, displayTracks, mainClips, overlayClips, timelineSpan } from './project-model.js'
import { rangeSelect, selectOnly, toggleSelect } from './selection.js'
import { $, state, trackRows } from './state.js'
import { finishMainMove, finishOverlayMove } from './timeline-move.js'
import {
  buildFreeItems,
  buildMainItems,
  dropIndexFromPointer,
  paintSelection,
  pointInTimeline,
  renderTimeline,
  timeFromClientX,
} from './timeline.js'
import { SNAP_PX, TRACK_H, clamp, round3 } from './util.js'

export function snapEdge(time, ignoreId) {
  const threshold = SNAP_PX / state.zoom
  let best = null
  let bestDist = threshold
  const consider = (point) => {
    const dist = Math.abs(point - time)
    if (dist <= threshold && (best == null || dist < bestDist)) {
      bestDist = dist
      best = point
    }
  }
  consider(0)
  consider(state.playhead)
  let acc = 0
  for (const clip of mainClips()) {
    consider(acc)
    acc += clipLength(clip)
  }
  consider(acc)
  for (const clip of overlayClips()) {
    if (clip.id === ignoreId) continue
    const start = clip.start || 0
    consider(start)
    consider(start + clipLength(clip))
  }
  return best == null ? { time, hit: false } : { time: best, hit: true }
}

function snapStart(start, dur, ignoreId) {
  const left = snapEdge(start, ignoreId)
  const right = snapEdge(start + dur, ignoreId)
  const leftDist = left.hit ? Math.abs(left.time - start) : Infinity
  const rightDist = right.hit ? Math.abs(right.time - (start + dur)) : Infinity
  let chosen = start
  let hit = false
  let snapTime = null
  if (left.hit && leftDist <= rightDist) {
    chosen = left.time
    hit = true
    snapTime = left.time
  } else if (right.hit) {
    chosen = right.time - dur
    hit = true
    snapTime = right.time
  }
  if (chosen < 0) {
    chosen = 0
    hit = snapTime === 0
    if (!hit) snapTime = null
  }
  return { start: chosen, hit, snapTime }
}

export function onClipPointerDown(event, clip, el) {
  if (event.button !== 0) return
  if (event.target.classList.contains('trim') || event.target.closest('.clip-rename')) return
  if (event.detail >= 2) {
    event.preventDefault()
    event.stopPropagation()
    beginRename(clip, el)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const modifier = event.shiftKey || event.metaKey || event.ctrlKey
  const shiftOnly = event.shiftKey && !event.metaKey && !event.ctrlKey
  const startX = event.clientX
  const startY = event.clientY
  const origin = pointInTimeline(startX, startY)
  const base = new Set(state.selectedIds)
  const rect = el.getBoundingClientRect()
  let mode = null
  const onMove = (ev) => {
    if (!mode) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      hooks.pausePlayback()
      if (modifier) {
        mode = 'marquee'
        state.drag = { type: 'marquee' }
      } else {
        mode = clipById(clip.id)?.track.kind === 'free' ? 'overlay-move' : 'move'
        armDrag(mode, clip, startX, rect)
      }
    }
    if (mode === 'marquee') paintMarquee(origin, pointInTimeline(ev.clientX, ev.clientY), base, true)
    else updateArmedDrag(ev)
  }
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    $('marquee').hidden = true
    if (!mode) {
      if (shiftOnly) rangeSelect(clip.id)
      else if (modifier) toggleSelect(clip.id)
      else selectOnly(clip.id)
      paintSelection()
      hooks.fillClipForm()
      return
    }
    if (mode === 'marquee') {
      state.drag = null
      hooks.flushPending()
      paintSelection()
      hooks.fillClipForm()
      return
    }
    if (mode === 'move') {
      const from = mainClips().findIndex((item) => item.id === clip.id)
      const newIndex = dropIndexFromPointer(ev.clientX, buildMainItems())
      void finishMainMove(clip.id, from, newIndex)
      return
    }
    void finishOverlayMove(state.drag)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function armDrag(mode, clip, startX, rect) {
  if (!state.selectedIds.has(clip.id)) selectOnly(clip.id)
  else state.primaryId = clip.id
  if (mode === 'move') {
    state.drag = {
      type: 'move',
      id: clip.id,
      offsetX: startX - rect.left,
      width: rect.width,
      pointerX: startX,
      dropIndex: 0,
    }
    return
  }
  const home = clipById(clip.id)?.track.id || 'overlay'
  state.drag = {
    type: 'overlay-move',
    id: clip.id,
    trackId: home,
    targetTrack: home,
    startX,
    origStart: clip.start || 0,
    origIn: clip.in,
    origOut: clip.out,
    start: clip.start || 0,
    in: clip.in,
    out: clip.out,
    speed: speedOf(clip),
    snapTime: null,
  }
}

function updateArmedDrag(ev) {
  const drag = state.drag
  if (!drag) return
  if (drag.type === 'move') {
    drag.pointerX = ev.clientX
    drag.dropIndex = dropIndexFromPointer(ev.clientX, buildMainItems())
    renderTimeline()
    return
  }
  if (drag.type === 'overlay-move') {
    const delta = (ev.clientX - drag.startX) / state.zoom
    const dur = clipLength({ in: drag.origIn, out: drag.origOut, speed: drag.speed })
    const snapped = snapStart(drag.origStart + delta, dur, drag.id)
    drag.start = round3(Math.max(0, snapped.start))
    drag.snapTime = snapped.hit ? snapped.snapTime : null
    const under = trackAtClientY(ev.clientY)
    if (under && under !== 'main') drag.targetTrack = under
    renderTimeline()
  }
}

function trackAtClientY(clientY) {
  for (const row of trackRows.querySelectorAll('.track')) {
    const rect = row.getBoundingClientRect()
    if (clientY >= rect.top && clientY < rect.bottom) return row.dataset.track
  }
  return null
}

export function startBackground(event) {
  if (event.button !== 0) return
  if (event.target.closest('.clip')) return
  const origin = pointInTimeline(event.clientX, event.clientY)
  const base = new Set(state.selectedIds)
  const startX = event.clientX
  const startY = event.clientY
  let moved = false
  const onMove = (ev) => {
    if (!moved) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      moved = true
      hooks.pausePlayback()
      state.drag = { type: 'marquee' }
    }
    const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey
    paintMarquee(origin, pointInTimeline(ev.clientX, ev.clientY), additive ? base : new Set(), additive)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    $('marquee').hidden = true
    state.drag = null
    if (!moved) {
      selectOnly(null)
      hooks.fillClipForm()
      void hooks.showFrame(clamp(timeFromClientX(event.clientX), 0, timelineSpan()))
    }
    hooks.flushPending()
    paintSelection()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function paintMarquee(origin, cur, base, additive) {
  const rect = {
    left: Math.min(origin.x, cur.x),
    top: Math.min(origin.y, cur.y),
    width: Math.abs(cur.x - origin.x),
    height: Math.abs(cur.y - origin.y),
  }
  const box = $('marquee')
  box.hidden = false
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
  const hits = clipsInRect(rect)
  state.selectedIds = additive ? new Set([...base, ...hits]) : new Set(hits)
  if (!state.primaryId || !state.selectedIds.has(state.primaryId)) state.primaryId = hits[0] || null
  paintSelection()
  hooks.fillClipForm()
}

function clipsInRect(rect) {
  const hits = []
  displayTracks().forEach((track, index) => {
    const items = track.id === 'main' ? buildMainItems() : buildFreeItems(track)
    const top = index * TRACK_H
    const bottom = top + TRACK_H
    for (const item of items) {
      const left = item.left
      const right = item.left + Math.max(item.width, 2)
      const overlaps =
        left < rect.left + rect.width &&
        right > rect.left &&
        top < rect.top + rect.height &&
        bottom > rect.top
      if (overlaps) hits.push(item.clip.id)
    }
  })
  return hits
}

function beginRename(clip, el) {
  if (state.renaming) return
  selectOnly(clip.id)
  paintSelection()
  hooks.fillClipForm()
  state.renaming = clip.id
  const nameEl = el.querySelector('.clip-name')
  if (!nameEl) {
    state.renaming = null
    return
  }
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'clip-rename'
  input.value = clip.name || ''
  input.maxLength = 200
  input.autocomplete = 'off'
  input.spellcheck = false
  nameEl.replaceWith(input)
  input.focus()
  input.select()
  const done = (commit) => {
    if (state.renaming !== clip.id) return
    const value = input.value
    state.renaming = null
    const pending = state.pendingProject
    state.pendingProject = null
    if (commit && value !== (clip.name || '')) {
      void postOp('setClip', { clipId: clip.id, name: value }).catch(() => renderTimeline())
      return
    }
    if (pending) hooks.applyProject(pending)
    else renderTimeline()
  }
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      input.dataset.skip = '1'
      input.blur()
    }
  })
  input.addEventListener('blur', () => done(input.dataset.skip !== '1'))
  input.addEventListener('pointerdown', (event) => event.stopPropagation())
}
