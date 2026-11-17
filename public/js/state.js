export const $ = (id) => document.getElementById(id)

export const playBtn = $('play-btn')
export const iconPlay = $('icon-play')
export const iconPause = $('icon-pause')
export const speedEl = $('speed')
export const timecodeEl = $('timecode')
export const durationEl = $('duration')
export const undoBtn = $('undo-btn')
export const redoBtn = $('redo-btn')
export const progressEl = $('progress')
export const progressBar = $('progress-bar')
export const progressLabel = $('progress-label')
export const importForm = $('import-form')
export const importPath = $('import-path')
export const browseForm = $('browse-form')
export const browsePath = $('browse-path')
export const browseBlock = $('browse-block')
export const browseList = $('browse-list')
export const mediaList = $('media-list')
export const statusEl = $('status')
export const videos = [$('preview-a'), $('preview-b')]
export const overlayVideos = new Map()
export const stage = $('stage')
export const stageEmpty = $('stage-empty')
export const stageMeta = $('stage-meta')
export const zoomInput = $('zoom')
export const timelineScroll = $('timeline-scroll')
export const timelineInner = $('timeline-inner')
export const ruler = $('ruler')
export const gutter = $('gutter')
export const gutterScroll = $('gutter-scroll')
export const trackRows = $('track-rows')
export const playhead = $('playhead')

export function emptyProject() {
  return {
    version: 2,
    name: '',
    canvas: { width: 1080, height: 1920, fps: 30 },
    media: [],
    tracks: [
      { id: 'main', kind: 'ripple', clips: [] },
      { id: 'overlay', kind: 'free', clips: [] },
    ],
    texts: [],
    styles: {},
  }
}

export const state = {
  project: emptyProject(),
  selectedIds: new Set(),
  primaryId: null,
  textId: null,
  playhead: 0,
  zoom: 72,
  zoomExact: 72,
  playing: false,
  shuttle: 0,
  drag: null,
  renaming: null,
  hold: false,
  pendingProject: null,
  previewPatch: null,
  previewStyle: null,
  browseFiles: [],
  signature: '',
  rendering: false,
  renderGen: 0,
  queue: Promise.resolve(),
  front: 0,
  sourceToken: 0,
  playIndex: 0,
  transitioning: false,
  playbackArmed: false,
  raf: 0,
  lastTs: 0,
  hideProgressTimer: 0,
  statusTimer: 0,
  captionKey: '',
  scrubRaf: 0,
  frameToken: 0,
}
