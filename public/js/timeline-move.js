import { postOp, request } from './api.js'
import { hooks } from './hooks.js'
import { clipById, trackByName } from './project-model.js'
import { state } from './state.js'
import { renderTimeline } from './timeline.js'
import { round3 } from './util.js'

export async function finishMainMove(id, from, newIndex) {
  state.drag = null
  const pending = state.pendingProject
  state.pendingProject = null
  if (newIndex === from || newIndex < 0) {
    if (pending) hooks.applyProject(pending)
    else renderTimeline()
    return
  }
  const snapshot = state.project
  const next = structuredClone(snapshot)
  const track = trackByName('main', next)
  const index = track.clips.findIndex((clip) => clip.id === id)
  if (index < 0) return
  const [moved] = track.clips.splice(index, 1)
  track.clips.splice(newIndex, 0, moved)
  hooks.applyProject(next)
  try {
    await postOp('move', { clipId: id, newIndex, track: 'main' })
  } catch {
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      hooks.applyProject(snapshot)
    }
  }
}

export async function finishOverlayMove(drag) {
  if (!drag) return
  const start = round3(Math.max(0, drag.start))
  const target = drag.targetTrack || drag.trackId
  const movedTrack = target !== drag.trackId
  state.drag = null
  const pending = state.pendingProject
  state.pendingProject = null
  if (!movedTrack && start === round3(drag.origStart)) {
    if (pending) hooks.applyProject(pending)
    else renderTimeline()
    return
  }
  const snapshot = state.project
  const next = structuredClone(snapshot)
  const found = clipById(drag.id, next)
  if (!found) return
  if (movedTrack) {
    found.track.clips.splice(found.index, 1)
    const dest = trackByName(target, next)
    if (!dest) return
    found.clip.start = start
    dest.clips.push(found.clip)
  } else {
    found.clip.start = start
  }
  hooks.applyProject(next)
  try {
    if (movedTrack) await postOp('moveClipToTrack', { clipId: drag.id, track: target, start })
    else await postOp('setClip', { clipId: drag.id, start })
  } catch {
    try {
      hooks.applyProject(await request('GET', '/api/project'))
    } catch {
      hooks.applyProject(snapshot)
    }
  }
}
