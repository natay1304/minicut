// Дорожка подписей на таймлайне: подпись можно двигать и менять ей начало и конец мышью.
import { postOp } from './api.js'
import { nextRange } from './cue-math.js'
import { hooks } from './hooks.js'
import { state } from './state.js'
import { snapEdge } from './timeline-drag.js'
import { renderTimeline, timeFromClientX } from './timeline.js'

/** Начало и конец подписи с учётом перетаскивания (во время жеста показываем промежуточное положение). */
export function cueRange(cue) {
  const drag = state.cueDrag
  return drag && drag.id === cue.id
    ? { start: drag.start, end: drag.end }
    : { start: cue.start, end: cue.end }
}

export function startCueDrag(event, cue, mode) {
  if (event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  hooks.pausePlayback()
  hooks.pickText(cue.id)
  const origin = timeFromClientX(event.clientX)
  const orig = { start: cue.start, end: cue.end }
  state.cueDrag = { id: cue.id, ...orig, snapTime: null }
  const onMove = (ev) => {
    const next = nextRange(mode, orig, timeFromClientX(ev.clientX) - origin, (time) => snapEdge(time, cue.id))
    state.cueDrag = { id: cue.id, ...next }
    state.drag = next.snapTime == null ? null : { snapTime: next.snapTime }
    renderTimeline()
  }
  const onUp = async () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const done = state.cueDrag
    state.drag = null
    if (done && (done.start !== orig.start || done.end !== orig.end)) {
      try {
        await postOp('setText', { id: cue.id, start: done.start, end: done.end })
      } catch {
        /* статус уже показан */
      }
    }
    state.cueDrag = null
    renderTimeline()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  renderTimeline()
}
