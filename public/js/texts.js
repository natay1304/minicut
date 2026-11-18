import { postOp, setStatus } from './api.js'
import { hooks } from './hooks.js'
import { pausePlayback } from './playback.js'
import { paintCanvas, paintCaptions } from './preview-canvas.js'
import { showFrame } from './preview-players.js'
import { styleMap, texts } from './project-model.js'
import { $, state } from './state.js'
import { clamp, formatTime, round3 } from './util.js'

function currentStyleName() {
  const text = texts().find((item) => item.id === state.textId)
  const name = text?.style || 'sub'
  return styleMap()[name] ? name : 'sub'
}

export function activeStyle(name) {
  const base = styleMap()[name] || styleMap().sub || {}
  if (!state.previewStyle || state.previewStyle.name !== name) return base
  return {
    ...base,
    ...state.previewStyle,
    shadow: { ...(base.shadow || {}), ...(state.previewStyle.shadow || {}) },
  }
}

export function renderTextList() {
  const list = $('text-list')
  const items = texts()
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)
  $('text-empty').hidden = items.length > 0
  list.replaceChildren()
  for (const text of items) {
    const li = document.createElement('li')
    const row = document.createElement('div')
    row.className = 'text-row'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'text-pick'
    if (text.id === state.textId) button.classList.add('is-selected')
    const time = document.createElement('span')
    time.className = 'text-time'
    time.textContent = `${formatTime(text.start)} – ${formatTime(text.end)}`
    const name = document.createElement('span')
    name.className = 'item-name'
    name.textContent = text.text.replace(/\s+/g, ' ')
    const style = document.createElement('span')
    style.className = 'text-style'
    style.textContent = text.style
    button.append(time, name, style)
    button.addEventListener('click', () => pickText(text.id))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'text-x'
    remove.textContent = '×'
    remove.title = 'Удалить подпись'
    remove.addEventListener('click', () => {
      void postOp('removeText', { id: text.id }).catch(() => {})
    })
    row.append(button, remove)
    li.append(row)
    list.append(li)
  }
}

function pickText(id) {
  state.textId = id
  const text = texts().find((item) => item.id === id)
  renderTextList()
  fillTextForm()
  fillStyleForm()
  if (!text) return
  if (state.playhead < text.start || state.playhead >= text.end) {
    pausePlayback()
    void showFrame(text.start)
  } else {
    paintCanvas()
  }
}

export function fillTextForm() {
  const text = texts().find((item) => item.id === state.textId)
  const form = $('text-form')
  if (!text) {
    form.hidden = true
    return
  }
  form.hidden = false
  if (form.contains(document.activeElement)) return
  $('text-body').value = text.text
  $('text-start').value = String(text.start)
  $('text-end').value = String(text.end)
}

async function saveText() {
  const text = texts().find((item) => item.id === state.textId)
  if (!text) return
  const body = $('text-body').value
  const start = round3(Number($('text-start').value))
  const end = round3(Number($('text-end').value))
  if (!body.trim()) {
    setStatus('Пустой текст', true)
    return
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || start < 0) {
    setStatus('Некорректный интервал подписи', true)
    return
  }
  try {
    await postOp('setText', { id: text.id, text: body, start, end })
    setStatus('Подпись сохранена')
  } catch {
    /* статус уже показан */
  }
}

async function addTextCue() {
  const start = round3(Math.max(0, state.playhead))
  const end = round3(start + 2)
  try {
    const cue = await postOp('addText', { start, end, text: 'Текст' })
    if (cue?.id) {
      state.textId = cue.id
      hooks.renderInspector()
      paintCanvas()
    }
  } catch {
    /* статус уже показан */
  }
}

export async function importSubtitles(filePath) {
  const path = filePath.trim()
  if (!path) {
    setStatus('Укажите путь к .srt или .ass', true)
    return
  }
  try {
    const added = await postOp('importSubtitles', { path })
    if (Array.isArray(added) && added.length) {
      state.textId = added[added.length - 1].id
      hooks.renderInspector()
      setStatus(`Импортировано реплик: ${added.length}`)
    }
  } catch {
    /* статус уже показан */
  }
}

export function fillStyleForm() {
  const name = currentStyleName()
  $('style-heading').textContent = `Стиль «${name}»`
  const form = $('style-form')
  if (form.contains(document.activeElement)) return
  const style = styleMap()[name] || {}
  const shadow = style.shadow || {}
  $('style-font').value = style.font || ''
  $('style-size').value = String(style.size ?? 62)
  $('style-align').value = style.align || 'center'
  $('style-color').value = style.color || '#F3E9DC'
  const hex = /^#([0-9a-fA-F]{6})$/.exec(String(style.color || '').trim())
  if (hex) $('style-color-pick').value = `#${hex[1]}`
  hooks.setPair('style-x', style.x ?? 0.5)
  hooks.setPair('style-y', style.y ?? 0.64)
  $('style-dx').value = String(shadow.dx ?? 0)
  $('style-dy').value = String(shadow.dy ?? 0)
  $('style-blur').value = String(shadow.blur ?? 0)
  $('style-shadow').value = shadow.color || '#000000AA'
}

function readStyleForm() {
  const size = Number($('style-size').value)
  const x = Number($('style-x-n').value)
  const y = Number($('style-y-n').value)
  const align = $('style-align').value
  return {
    font: $('style-font').value.trim(),
    size,
    color: $('style-color').value.trim(),
    align: align === 'left' || align === 'right' || align === 'center' ? align : 'center',
    x,
    y,
    shadow: {
      dx: Number($('style-dx').value),
      dy: Number($('style-dy').value),
      blur: Number($('style-blur').value),
      color: $('style-shadow').value.trim(),
    },
  }
}

function styleEqual(patch, prev) {
  if (!prev) return false
  const shadow = prev.shadow || {}
  return (
    patch.font === prev.font &&
    Number(patch.size) === Number(prev.size) &&
    patch.color === prev.color &&
    patch.align === prev.align &&
    Number(patch.x) === Number(prev.x) &&
    Number(patch.y) === Number(prev.y) &&
    Number(patch.shadow.dx) === Number(shadow.dx) &&
    Number(patch.shadow.dy) === Number(shadow.dy) &&
    Number(patch.shadow.blur) === Number(shadow.blur) &&
    patch.shadow.color === shadow.color
  )
}

function previewStyleForm() {
  const patch = readStyleForm()
  state.previewStyle = { name: currentStyleName(), ...patch }
  state.captionKey = ''
  paintCaptions()
}

async function commitStyle() {
  const name = currentStyleName()
  const patch = readStyleForm()
  if (
    !patch.font ||
    !(patch.size > 0) ||
    !patch.color ||
    !Number.isFinite(patch.x) ||
    !Number.isFinite(patch.y)
  ) {
    setStatus('Проверьте поля стиля', true)
    return
  }
  if (
    [patch.shadow.dx, patch.shadow.dy, patch.shadow.blur].some((n) => !Number.isFinite(n)) ||
    !patch.shadow.color
  ) {
    setStatus('Проверьте тень', true)
    return
  }
  const prev = styleMap()[name]
  if (styleEqual(patch, prev)) {
    state.previewStyle = null
    return
  }
  state.previewStyle = { name, ...patch }
  try {
    await postOp('setStyle', { name, ...patch })
  } catch {
    /* статус уже показан */
  } finally {
    state.previewStyle = null
    state.captionKey = ''
    paintCaptions()
  }
}

function bindStylePairs() {
  for (const key of ['style-x', 'style-y']) {
    const range = $(key)
    const num = $(`${key}-n`)
    const sync = (source) => {
      const value = Number(source.value)
      if (!Number.isFinite(value)) return
      if (source === range) num.value = String(value)
      else range.value = String(clamp(value, 0, 1))
    }
    range.addEventListener('input', () => sync(range))
    num.addEventListener('input', () => sync(num))
  }
}

export function bindTexts() {
  $('subs-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void importSubtitles($('subs-path').value)
  })
  $('text-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void saveText()
  })
  $('text-delete').addEventListener('click', () => {
    if (!state.textId) return
    void postOp('removeText', { id: state.textId }).catch(() => {})
  })
  $('text-add').addEventListener('click', () => {
    void addTextCue()
  })
  $('style-color-pick').addEventListener('input', () => {
    $('style-color').value = $('style-color-pick').value
  })
  bindStylePairs()
  $('style-form').addEventListener('input', () => previewStyleForm())
  $('style-form').addEventListener('change', () => {
    void commitStyle()
  })
  $('style-form').addEventListener('focusout', (event) => {
    if ($('style-form').contains(event.relatedTarget)) return
    state.previewStyle = null
    state.captionKey = ''
    paintCaptions()
  })
}
