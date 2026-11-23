import { request, setApplyProject, setStatus } from './api.js'
import { bindCrop, syncCropLayer, toggleCrop } from './canvas-edit.js'
import { bindEditing } from './editing.js'
import { bindExport, showProgress } from './export.js'
import { hooks } from './hooks.js'
import { bindInspector, fillClipForm, renderInspector, setPair } from './inspector.js'
import { bindLibrary, renderLibrary, renderProjectButton } from './library.js'
import { bindPanels } from './panels.js'
import { bindPlayback, pausePlayback, resyncPlayback } from './playback.js'
import { paintCanvas } from './preview-canvas.js'
import { clearPlayers, frontVideo, showFrame, syncOverlayPool } from './preview-players.js'
import { projectSignature, timelineSpan } from './project-model.js'
import { bindProjects } from './projects.js'
import { pruneSelection, selectOnly } from './selection.js'
import { bindShortcuts } from './shortcuts.js'
import { state } from './state.js'
import { activeStyle, bindTexts, pickText } from './texts.js'
import { bindTranscript, onTranscribeProgress, renderTranscript } from './transcript.js'
import { onClipPointerDown, startBackground } from './timeline-drag.js'
import { bindTimeline, renderTimeline } from './timeline.js'
import { startCueDrag } from './timeline-cues.js'
import { startTrim } from './timeline-trim.js'

setApplyProject(applyProject)

hooks.applyProject = applyProject
hooks.flushPending = flushPending
hooks.fillClipForm = fillClipForm
hooks.setPair = setPair
hooks.renderInspector = renderInspector
hooks.pausePlayback = pausePlayback
hooks.showFrame = showFrame
hooks.paintCanvas = paintCanvas
hooks.syncCrop = syncCropLayer
hooks.toggleCrop = toggleCrop
hooks.startBackground = startBackground
hooks.onClipPointerDown = onClipPointerDown
hooks.startTrim = startTrim
hooks.startCueDrag = startCueDrag
hooks.pickText = pickText
hooks.renderTimeline = renderTimeline
hooks.activeStyle = activeStyle
hooks.frontVideo = frontVideo

export function applyProject(project) {
  if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.media)) return
  if (state.drag || state.renaming || state.hold) {
    state.pendingProject = project
    return
  }
  const prevName = state.project?.name || ''
  const prevSig = state.signature
  const nextSig = projectSignature(project)
  const switched = Boolean(prevName) && project.name !== prevName && prevSig && prevSig !== nextSig
  state.signature = nextSig
  state.project = project
  if (switched) {
    pausePlayback()
    state.playhead = 0
    selectOnly(null)
    state.textId = null
    state.previewPatch = null
    state.previewStyle = null
    state.captionKey = ''
    clearPlayers()
  }
  pruneSelection()
  const span = timelineSpan()
  if (state.playhead > span) state.playhead = span
  renderAll()
  if (state.playing) resyncPlayback()
  else void showFrame(state.playhead)
}

export function flushPending() {
  if (state.hold || state.drag || state.renaming) return
  const pending = state.pendingProject
  state.pendingProject = null
  if (pending) applyProject(pending)
}

function renderAll() {
  syncOverlayPool()
  renderLibrary()
  renderTimeline()
  renderInspector()
  renderProjectButton()
  renderTranscript()
}

function connectEvents() {
  const source = new EventSource('/api/events')
  source.addEventListener('project', (event) => {
    try {
      applyProject(JSON.parse(event.data))
    } catch {
      /* битый пакет */
    }
  })
  source.addEventListener('render-progress', (event) => {
    if (!state.rendering) return
    try {
      showProgress(JSON.parse(event.data))
    } catch {
      /* битый пакет */
    }
  })
  source.addEventListener('transcribe-progress', (event) => {
    try {
      onTranscribeProgress(JSON.parse(event.data))
    } catch {
      /* битый пакет */
    }
  })
}

function bind() {
  bindPlayback()
  bindEditing()
  bindLibrary()
  bindTimeline()
  bindInspector()
  bindTexts()
  bindTranscript()
  bindProjects()
  bindExport()
  bindShortcuts()
  bindPanels()
  bindCrop()
}

export async function init() {
  bind()
  connectEvents()
  renderAll()
  try {
    applyProject(await request('GET', '/api/project'))
  } catch (err) {
    setStatus(err.message, true)
  }
  requestAnimationFrame(() => {
    if (!state.drag) renderTimeline()
  })
}

init()
