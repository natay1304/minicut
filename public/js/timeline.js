import { postOp, setStatus } from './api.js'
import { hooks } from './hooks.js'
import {
  clipById,
  clipColor,
  displayTracks,
  freeTracks,
  mainClips,
  mediaById,
  overlayIndex,
  timelineSpan,
  trackLabel,
} from './project-model.js'
import {
  $,
  durationEl,
  gutter,
  gutterScroll,
  playhead,
  ruler,
  state,
  timelineInner,
  timelineScroll,
  timecodeEl,
  trackRows,
  zoomInput,
} from './state.js'
import { ZOOM_MAX, ZOOM_MIN, clamp, formatRuler, formatTime, round3 } from './util.js'

export function contentX(clientX) {
  return clientX - timelineInner.getBoundingClientRect().left
}

export function timeFromClientX(clientX) {
  return Math.max(0, contentX(clientX) / state.zoom)
}

export function pointInTimeline(clientX, clientY) {
  const rect = timelineInner.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

export function buildMainItems() {
  const zoom = state.zoom
  const drag = state.drag
  const items = []
  let x = 0
  for (const clip of mainClips()) {
    if (drag?.type === 'move' && drag.id === clip.id) continue
    let inn = clip.in
    let out = clip.out
    let left = x
    const trimming = drag?.type === 'trim' && drag.trackId === 'main' && drag.id === clip.id
    if (trimming) {
      inn = drag.in
      out = drag.out
      if (drag.edge === 'in') left = x + (drag.in - drag.origIn) * zoom
    }
    const width = Math.max(0, (out - inn) * zoom)
    items.push({ clip, in: inn, out, left, width })
    if (trimming && drag.edge === 'in') x += (drag.origOut - drag.origIn) * zoom
    else x += width
  }
  return items
}

export function buildFreeItems(track) {
  const zoom = state.zoom
  const drag = state.drag
  const draggingHere = drag?.type === 'overlay-move' && drag.targetTrack === track.id
  const clips = track.clips.filter((clip) => {
    if (drag?.type === 'overlay-move' && drag.id === clip.id && drag.targetTrack !== track.id) return false
    return true
  })
  const items = clips.map((clip) => {
    let inn = clip.in
    let out = clip.out
    let start = clip.start || 0
    if (drag && drag.id === clip.id && (drag.type === 'trim' || drag.type === 'overlay-move')) {
      inn = drag.in
      out = drag.out
      start = drag.start
    }
    return { clip, in: inn, out, start, left: start * zoom, width: Math.max(0, (out - inn) * zoom) }
  })
  if (draggingHere && !track.clips.some((clip) => clip.id === drag.id)) {
    const clip = clipById(drag.id)?.clip
    if (clip) {
      items.push({
        clip,
        in: drag.in,
        out: drag.out,
        start: drag.start,
        left: drag.start * zoom,
        width: Math.max(0, (drag.out - drag.in) * zoom),
      })
    }
  }
  return items
}

export function renderAddTrack() {
  const select = $('add-track')
  const ids = ['main', ...freeTracks().map((track) => track.id)]
  const signature = ids.join('|')
  const current = ids.includes(select.value) ? select.value : 'main'
  if (select.dataset.signature !== signature) {
    select.replaceChildren()
    for (const id of ids) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = id === 'main' ? 'V1 · Main' : `${trackLabel(id)} · Overlay`
      select.append(option)
    }
    select.dataset.signature = signature
  }
  select.value = current
  $('add-overlay-track').disabled = freeTracks().length >= 10
}

export function syncRuler() {
  ruler.style.transform = `translateX(${-timelineScroll.scrollLeft}px)`
  if (gutterScroll) gutterScroll.scrollTop = timelineScroll.scrollTop
}

export function renderTimeline() {
  const scrollLeft = timelineScroll.scrollLeft
  const scrollTop = timelineScroll.scrollTop
  const rows = displayTracks().map((track) => ({
    track,
    items: track.id === 'main' ? buildMainItems() : buildFreeItems(track),
  }))
  let content = Math.max(timelineSpan() * state.zoom, state.zoom)
  for (const row of rows) {
    for (const item of row.items) content = Math.max(content, item.left + item.width)
  }
  const width = Math.max(timelineScroll.clientWidth || 0, content + 48)
  timelineInner.style.width = `${width}px`
  ruler.style.width = `${width}px`
  renderRuler(width)
  trackRows.replaceChildren()
  gutter.replaceChildren()
  const dropId = state.drag?.type === 'overlay-move' ? state.drag.targetTrack : null
  for (const row of rows) {
    const el = document.createElement('div')
    el.className = row.track.id === 'main' ? 'track' : 'track track-overlay'
    el.dataset.track = row.track.id
    if (dropId === row.track.id) el.classList.add('is-drop')
    const empty = !row.items.length && !(state.drag?.type === 'move' && row.track.id === 'main')
    renderTrack(el, row.items, empty)
    el.addEventListener('pointerdown', (event) => hooks.startBackground(event))
    trackRows.append(el)

    const label = document.createElement('div')
    label.className = 'gutter-track'
    if (dropId === row.track.id) label.classList.add('is-drop')
    const name = document.createElement('span')
    name.textContent = trackLabel(row.track.id)
    label.append(name)
    const index = overlayIndex(row.track.id)
    if (index && index > 1 && !row.track.clips.length) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'track-remove'
      button.textContent = '×'
      button.title = 'Удалить дорожку'
      button.setAttribute('aria-label', `Удалить ${trackLabel(row.track.id)}`)
      button.addEventListener('pointerdown', (event) => event.stopPropagation())
      button.addEventListener('click', () => {
        void postOp('removeOverlayTrack', { id: row.track.id }).catch(() => {})
      })
      label.append(button)
    }
    gutter.append(label)
  }
  if (state.drag?.type === 'move') {
    const main = rows.find((row) => row.track.id === 'main')
    paintMoveGhost(main?.items || [])
  }
  paintSnap()
  timelineScroll.scrollLeft = scrollLeft
  timelineScroll.scrollTop = scrollTop
  syncRuler()
  paintPlayhead()
  paintTimecode()
  hooks.paintCanvas()
  renderAddTrack()
  zoomInput.value = String(state.zoom)
}

export function renderRuler(width) {
  ruler.replaceChildren()
  const step = rulerStep(state.zoom)
  const minorStep = step / 2
  const count = Math.ceil(width / state.zoom / minorStep)
  for (let i = 0; i <= count; i++) {
    const t = i * minorStep
    const tick = document.createElement('div')
    tick.className = i % 2 === 1 ? 'tick minor' : 'tick'
    tick.style.left = `${t * state.zoom}px`
    if (i % 2 === 0) {
      const label = document.createElement('span')
      label.textContent = formatRuler(t)
      tick.append(label)
    }
    ruler.append(tick)
  }
}

export function rulerStep(zoom) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const step of steps) if (step * zoom >= 90) return step
  return 600
}

export function renderTrack(track, items, empty) {
  track.replaceChildren()
  if (empty) {
    const note = document.createElement('div')
    note.className = 'empty-track'
    note.textContent = track.dataset.track === 'main' ? 'Клипов пока нет' : 'Оверлей пуст'
    track.append(note)
  }
  for (const item of items) track.append(clipElement(item))
}

export function clipElement(item) {
  const { clip } = item
  const media = mediaById(clip.mediaId)
  const found = clipById(clip.id)
  const el = document.createElement('div')
  el.className = 'clip'
  el.dataset.id = clip.id
  el.dataset.track = found?.track.id || ''
  el.style.left = `${item.left}px`
  el.style.width = `${Math.max(item.width, 2)}px`
  el.style.background = clipColor(clip.mediaId)
  const label = clip.name || media?.name || clip.id
  el.title = `${label} · ${round3(item.in).toFixed(3)}–${round3(item.out).toFixed(3)}`
  const selected = state.selectedIds.has(clip.id)
  if (selected) el.classList.add('is-selected')
  if (clip.id === state.primaryId) el.classList.add('is-primary')
  el.setAttribute('role', 'button')
  el.setAttribute('aria-pressed', selected ? 'true' : 'false')

  const body = document.createElement('div')
  body.className = 'clip-body'
  const name = document.createElement('div')
  name.className = 'clip-name'
  name.textContent = label
  const meta = document.createElement('div')
  meta.className = 'clip-meta'
  meta.textContent = formatTime(item.out - item.in)
  body.append(name, meta)

  const trimIn = document.createElement('div')
  trimIn.className = 'trim trim-in'
  trimIn.title = 'Подрезка начала'
  const trimOut = document.createElement('div')
  trimOut.className = 'trim trim-out'
  trimOut.title = 'Подрезка конца'
  trimIn.addEventListener('pointerdown', (event) => hooks.startTrim(event, clip, 'in'))
  trimOut.addEventListener('pointerdown', (event) => hooks.startTrim(event, clip, 'out'))
  el.addEventListener('pointerdown', (event) => hooks.onClipPointerDown(event, clip, el))
  el.append(trimIn, body, trimOut)
  return el
}

export function paintMoveGhost(items) {
  const track = trackRows.querySelector('[data-track="main"]')
  if (!track) return
  const marker = document.createElement('div')
  marker.className = 'drop-marker'
  marker.style.left = `${markerX(state.drag.dropIndex ?? items.length, items)}px`
  track.append(marker)
  const clip = mainClips().find((item) => item.id === state.drag.id)
  const media = clip ? mediaById(clip.mediaId) : null
  const ghost = document.createElement('div')
  ghost.className = 'clip-ghost'
  ghost.style.background = clipColor(media?.id || state.drag.id)
  ghost.style.width = `${state.drag.width}px`
  ghost.style.left = `${contentX(state.drag.pointerX) - state.drag.offsetX}px`
  ghost.textContent = clip?.name || media?.name || ''
  track.append(ghost)
}

export function paintSnap() {
  const line = $('snap-line')
  const t = state.drag?.snapTime
  if (t == null || !state.drag) {
    line.hidden = true
    return
  }
  line.hidden = false
  line.style.left = `${t * state.zoom}px`
}

export function markerX(index, items) {
  if (!items.length) return 0
  if (index < items.length) return items[index].left
  const last = items[items.length - 1]
  return last.left + last.width
}

export function dropIndexFromPointer(clientX, items) {
  const x = contentX(clientX)
  for (let i = 0; i < items.length; i++) {
    const mid = items[i].left + items[i].width / 2
    if (x < mid) return i
  }
  return items.length
}

export function paintSelection() {
  for (const el of timelineInner.querySelectorAll('.clip')) {
    const on = state.selectedIds.has(el.dataset.id)
    el.classList.toggle('is-selected', on)
    el.classList.toggle('is-primary', el.dataset.id === state.primaryId)
    el.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

export function setZoom(next, anchorClientX) {
  const zoom = clamp(next, ZOOM_MIN, ZOOM_MAX)
  state.zoomExact = zoom
  const rounded = Math.round(zoom)
  if (rounded === state.zoom) return
  const rect = timelineScroll.getBoundingClientRect()
  const anchor = anchorClientX == null ? rect.left + 80 : anchorClientX
  const time = anchorClientX == null ? state.playhead : timeFromClientX(anchorClientX)
  state.zoom = rounded
  renderTimeline()
  timelineScroll.scrollLeft = time * state.zoom - (anchor - rect.left)
}

export function paintPlayhead() {
  playhead.style.left = `${state.playhead * state.zoom - timelineScroll.scrollLeft}px`
}

export function paintTimecode() {
  timecodeEl.textContent = formatTime(state.playhead)
  durationEl.textContent = formatTime(timelineSpan())
}

export function bindTimeline() {
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value), null))
  $('add-overlay-track').addEventListener('click', () => {
    void postOp('addOverlayTrack')
      .then((id) => {
        if (id) setStatus(`Дорожка ${trackLabel(id)}`)
      })
      .catch(() => {})
  })
  timelineScroll.addEventListener('scroll', () => {
    syncRuler()
    paintPlayhead()
  })
  timelineScroll.addEventListener(
    'wheel',
    (event) => {
      if (event.shiftKey) {
        timelineScroll.scrollLeft += event.deltaY
        event.preventDefault()
        return
      }
      const overflows = timelineScroll.scrollHeight > timelineScroll.clientHeight + 1
      if (!event.ctrlKey && !event.metaKey && overflows && Math.abs(event.deltaY) >= Math.abs(event.deltaX))
        return
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      setZoom(state.zoomExact * Math.exp(-event.deltaY * 0.0012), event.clientX)
    },
    { passive: false },
  )
  $('ruler-viewport').addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      if (event.shiftKey) {
        timelineScroll.scrollLeft += event.deltaY
        return
      }
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        timelineScroll.scrollLeft += event.deltaX
        return
      }
      setZoom(state.zoomExact * Math.exp(-event.deltaY * 0.0012), event.clientX)
    },
    { passive: false },
  )
  timelineInner.addEventListener('pointerdown', (event) => {
    if (event.target !== timelineInner) return
    hooks.startBackground(event)
  })
  window.addEventListener('resize', () => {
    state.captionKey = ''
    if (!state.drag && !state.renaming) renderTimeline()
  })
}
