import { postOp, request } from './api.js'
import { speedOf } from './clip-time.js'
import { hooks } from './hooks.js'
import { clipById, mediaById } from './project-model.js'
import { selectOnly } from './selection.js'
import { state } from './state.js'
import { snapEdge } from './timeline-drag.js'
import { renderTimeline } from './timeline.js'
import { MIN_CLIP, clamp, round3 } from './util.js'

export function startTrim(event, clip, edge) {
  if (event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  hooks.pausePlayback()
  const found = clipById(clip.id)
  const media = mediaById(clip.mediaId)
  if (!found || !media) return
  selectOnly(clip.id)
  state.drag = {
    type: 'trim',
    id: clip.id,
    trackId: found.track.id,
    edge,
    startX: event.clientX,
    origIn: clip.in,
    origOut: clip.out,
    origStart: clip.start || 0,
    in: clip.in,
    out: clip.out,
    start: clip.start || 0,
    speed: speedOf(clip),
    mediaDuration: media.duration,
    snapTime: null,
  }
  const onMove = (ev) => updateTrim(ev)
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const drag = state.drag
    if (!drag || drag.type !== 'trim') return
    if (drag.trackId === 'main') void finishMainTrim(drag)
    else void finishOverlayTrim(drag)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  renderTimeline()
  hooks.fillClipForm()
}

function updateTrim(ev) {
  const drag = state.drag
  if (!drag || drag.type !== 'trim') return
  const delta = (ev.clientX - drag.startX) / state.zoom
  const speed = speedOf(drag)
  const rawSpan = drag.origOut - drag.origIn
  const sourceSpan = Math.max(0.001, round3(rawSpan))
  const minSource = Math.min(MIN_CLIP, sourceSpan)
  if (drag.trackId === 'main') {
    drag.snapTime = null
    if (drag.edge === 'in') {
      drag.in = clamp(round3(drag.origIn + delta * speed), 0, round3(drag.origOut - minSource))
      drag.out = drag.origOut
    } else {
      drag.out = clamp(
        round3(drag.origOut + delta * speed),
        round3(drag.origIn + minSource),
        drag.mediaDuration,
      )
      drag.in = drag.origIn
    }
    renderTimeline()
    return
  }
  const timelineLen = rawSpan / speed
  const minTimeline = minSource / speed
  if (drag.edge === 'out') {
    const minRight = drag.origStart + minTimeline
    const maxRight = drag.origStart + Math.max(minTimeline, (drag.mediaDuration - drag.origIn) / speed)
    let right = clamp(drag.origStart + timelineLen + delta, minRight, maxRight)
    const snapped = snapEdge(right, drag.id)
    if (snapped.hit) right = clamp(snapped.time, minRight, maxRight)
    drag.out = clamp(
      round3(drag.origIn + (right - drag.origStart) * speed),
      round3(drag.origIn + minSource),
      drag.mediaDuration,
    )
    drag.in = drag.origIn
    drag.start = drag.origStart
    const edge = round3(drag.origStart + (drag.out - drag.origIn) / speed)
    drag.snapTime = snapped.hit && Math.abs(edge - snapped.time) < 0.002 ? snapped.time : null
  } else {
    const right = drag.origStart + timelineLen
    const minLeft = Math.max(0, round3(drag.origStart - drag.origIn / speed))
    const maxLeft = round3(right - minTimeline)
    let left = clamp(drag.origStart + delta, minLeft, Math.max(minLeft, maxLeft))
    const snapped = snapEdge(left, drag.id)
    if (snapped.hit) left = clamp(snapped.time, minLeft, Math.max(minLeft, maxLeft))
    drag.in = clamp(
      round3(drag.origIn + (left - drag.origStart) * speed),
      0,
      round3(drag.origOut - minSource),
    )
    drag.out = drag.origOut
    drag.start = round3(Math.max(0, drag.origStart + (drag.in - drag.origIn) / speed))
    drag.snapTime = snapped.hit && Math.abs(drag.start - snapped.time) < 0.002 ? snapped.time : null
  }
  renderTimeline()
}

async function finishMainTrim(drag) {
  const changed = drag.in !== drag.origIn || drag.out !== drag.origOut
  state.drag = null
  const pending = state.pendingProject
  state.pendingProject = null
  if (!changed) {
    if (pending) hooks.applyProject(pending)
    else renderTimeline()
    return
  }
  const snapshot = state.project
  const next = structuredClone(snapshot)
  const clip = clipById(drag.id, next)?.clip
  if (!clip) return
  clip.in = drag.in
  clip.out = drag.out
  hooks.applyProject(next)
  try {
    await postOp('trim', { clipId: drag.id, in: drag.in, out: drag.out, track: 'main' })
  } catch {
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      hooks.applyProject(snapshot)
    }
  }
}

async function finishOverlayTrim(drag) {
  const changedIn = drag.in !== drag.origIn || drag.out !== drag.origOut
  const changedStart = round3(drag.start) !== round3(drag.origStart)
  state.drag = null
  const pending = state.pendingProject
  state.pendingProject = null
  if (!changedIn && !changedStart) {
    if (pending) hooks.applyProject(pending)
    else renderTimeline()
    return
  }
  const snapshot = state.project
  const next = structuredClone(snapshot)
  const clip = clipById(drag.id, next)?.clip
  if (!clip) return
  clip.in = drag.in
  clip.out = drag.out
  clip.start = round3(drag.start)
  hooks.applyProject(next)
  state.hold = true
  let failed = false
  try {
    if (changedIn) await postOp('trim', { clipId: drag.id, in: drag.in, out: drag.out, track: drag.trackId })
    if (changedStart) await postOp('setClip', { clipId: drag.id, start: round3(drag.start) })
  } catch {
    failed = true
  } finally {
    state.hold = false
  }
  if (failed) {
    state.pendingProject = null
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      hooks.applyProject(snapshot)
    }
    return
  }
  hooks.flushPending()
}
