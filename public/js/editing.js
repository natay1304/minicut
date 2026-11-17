import { postOp, setStatus } from './api.js'
import { hooks } from './hooks.js'
import { clipById, freeTracks, mainDuration, overlayClips } from './project-model.js'
import { selectOnly } from './selection.js'
import { $, redoBtn, state, undoBtn } from './state.js'
import { paintSelection } from './timeline.js'
import { round3 } from './util.js'

export function splitTarget() {
  const t = state.playhead
  const inside = (clip, start) => t > start + 0.0005 && t < start + (clip.out - clip.in) - 0.0005
  const hits = []
  for (const track of freeTracks()) {
    for (const clip of track.clips) {
      if (inside(clip, clip.start || 0)) hits.push({ track, clip })
    }
  }
  const selected = hits.filter((hit) => state.selectedIds.has(hit.clip.id))
  if (selected.length) {
    const primary = selected.find((hit) => hit.clip.id === state.primaryId)
    return (primary || selected[selected.length - 1]).track.id
  }
  const total = mainDuration()
  const mainInside = t > 0.0005 && t < total - 0.0005
  const primary = clipById(state.primaryId)
  if (primary?.track.id === 'main' && mainInside && state.selectedIds.has(primary.clip.id)) return 'main'
  if (mainInside) return 'main'
  if (hits.length) return hits[hits.length - 1].track.id
  return 'main'
}

export async function splitAtPlayhead() {
  if (mainDuration() <= 0 && !overlayClips().length) {
    setStatus('Нет клипов', true)
    return
  }
  try {
    const parts = await postOp('splitAt', { t: round3(state.playhead), track: splitTarget() })
    const right = Array.isArray(parts) ? parts[1] : null
    if (right?.id) {
      selectOnly(right.id)
      paintSelection()
      hooks.fillClipForm()
    }
  } catch {
    /* статус уже показан */
  }
}

export async function removeSelected() {
  if (!state.selectedIds.size) {
    setStatus('Сначала выберите клип', true)
    return
  }
  try {
    await postOp('removeClips', { ids: [...state.selectedIds] })
  } catch {
    /* статус уже показан */
  }
}

export function bindEditing() {
  undoBtn.addEventListener('click', () => {
    void postOp('undo', {}).catch(() => {})
  })
  redoBtn.addEventListener('click', () => {
    void postOp('redo', {}).catch(() => {})
  })
  $('clip-delete').addEventListener('click', () => {
    void removeSelected()
  })
}
