import { clipById, texts, tracks } from './project-model.js'
import { state } from './state.js'

export function selectOnly(id) {
  state.selectedIds = new Set(id ? [id] : [])
  state.primaryId = id || null
}

export function toggleSelect(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id)
    if (state.primaryId === id) state.primaryId = [...state.selectedIds][0] || null
  } else {
    state.selectedIds.add(id)
    state.primaryId = id
  }
}

export function rangeSelect(id) {
  const found = clipById(id)
  const primary = clipById(state.primaryId)
  if (!found || !primary || found.track.id !== primary.track.id) {
    toggleSelect(id)
    return
  }
  const ids = found.track.clips.map((clip) => clip.id)
  let a = ids.indexOf(primary.clip.id)
  let b = ids.indexOf(id)
  if (a > b) [a, b] = [b, a]
  const next = new Set(state.selectedIds)
  for (let i = a; i <= b; i++) next.add(ids[i])
  state.selectedIds = next
  state.primaryId = id
}

export function pruneSelection() {
  const ids = new Set()
  for (const track of tracks()) for (const clip of track.clips) ids.add(clip.id)
  for (const id of [...state.selectedIds]) if (!ids.has(id)) state.selectedIds.delete(id)
  if (!state.primaryId || !state.selectedIds.has(state.primaryId)) {
    state.primaryId = [...state.selectedIds][0] || null
  }
  if (state.textId && !texts().some((text) => text.id === state.textId)) state.textId = null
}
