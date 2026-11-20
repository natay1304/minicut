import { postOp, request, setStatus } from './api.js'
import { hooks } from './hooks.js'
import { revealPlayhead } from './playback.js'
import { trackLabel } from './project-model.js'
import { selectOnly } from './selection.js'
import {
  $,
  browseBlock,
  browseForm,
  browseList,
  browsePath,
  importForm,
  importPath,
  mediaList,
  state,
  timelineScroll,
} from './state.js'
import { renderTimeline } from './timeline.js'
import { formatTime, round3 } from './util.js'

export function renderProjectButton() {
  const name = state.project.name || 'untitled'
  const summary = $('project-btn')
  if (summary.textContent !== name) summary.textContent = name
}

export function renderLibrary() {
  mediaList.replaceChildren()
  if (!state.project.media.length) {
    const note = document.createElement('li')
    note.className = 'empty-note'
    note.textContent = 'Пока пусто. Клик по ролику ставит его на выбранную дорожку.'
    mediaList.append(note)
  } else {
    for (const media of state.project.media) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.id = media.id
      button.title = media.path
      const name = document.createElement('span')
      name.className = 'item-name'
      name.textContent = media.name
      const meta = document.createElement('span')
      meta.className = 'item-meta'
      const audio = media.hasAudio ? '' : ' · без звука'
      meta.textContent = `${formatTime(media.duration)} · ${media.width}×${media.height}${audio}`
      button.append(name, meta)
      button.addEventListener('click', () => addMedia(media.id))
      li.append(button)
      mediaList.append(li)
    }
  }
  renderBrowse()
}

function renderBrowse() {
  browseList.replaceChildren()
  if (!state.browseFiles.length) {
    const note = document.createElement('li')
    note.className = 'empty-note'
    note.textContent = 'В этой папке нет видео'
    browseList.append(note)
    return
  }
  const imported = new Set(state.project.media.map((media) => media.path))
  for (const file of state.browseFiles) {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.title = file.path
    const name = document.createElement('span')
    name.className = 'item-name'
    name.textContent = file.name
    const meta = document.createElement('span')
    meta.className = 'item-meta'
    meta.textContent = imported.has(file.path) ? 'Уже в библиотеке' : 'Импортировать'
    button.append(name, meta)
    button.addEventListener('click', () => {
      if (imported.has(file.path)) {
        setStatus('Уже в библиотеке — кликните его в списке медиа')
        return
      }
      void importFile(file.path)
    })
    li.append(button)
    browseList.append(li)
  }
}

async function importFile(filePath) {
  const path = filePath.trim()
  if (!path) {
    setStatus('Укажите путь к файлу', true)
    return
  }
  try {
    const media = await request('POST', '/api/import', { path })
    const project = await request('GET', '/api/project')
    hooks.applyProject(project)
    setStatus(`Импортировано: ${media.name || path}`)
    mediaList.querySelector(`[data-id="${media.id}"]`)?.scrollIntoView({ block: 'nearest' })
  } catch (err) {
    setStatus(err.message, true)
  }
}

async function addMedia(mediaId) {
  const trackId = $('add-track').value || 'main'
  const start = round3(Math.max(0, state.playhead))
  try {
    const clip = await postOp('addClip', { mediaId, track: trackId })
    if (clip?.id && trackId !== 'main' && start > 0) {
      await postOp('setClip', { clipId: clip.id, start })
    }
    if (clip?.id) {
      selectOnly(clip.id)
      renderTimeline()
      hooks.fillClipForm()
      if (trackId === 'main') timelineScroll.scrollLeft = timelineScroll.scrollWidth
      else revealPlayhead()
    }
    setStatus(`Клип добавлен на ${trackLabel(trackId)}`)
  } catch {
    /* статус уже показан */
  }
}

async function browseDir(dir) {
  const folder = dir.trim()
  if (!folder) {
    setStatus('Укажите папку', true)
    return
  }
  try {
    const data = await request('GET', `/api/browse?dir=${encodeURIComponent(folder)}`)
    state.browseFiles = data.files || []
    if (data.dir) browsePath.value = data.dir
    browseBlock.hidden = false
    renderBrowse()
    setStatus(state.browseFiles.length ? `Файлов: ${state.browseFiles.length}` : 'В этой папке нет видео')
  } catch (err) {
    setStatus(err.message, true)
  }
}

export function bindLibrary() {
  importForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void importFile(importPath.value)
  })
  browseForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void browseDir(browsePath.value)
  })
}
