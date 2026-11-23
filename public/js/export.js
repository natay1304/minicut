import { postOp, request, setStatus } from './api.js'
import { canvasInfo, mainDuration } from './project-model.js'
import { $, progressBar, progressEl, progressLabel, state } from './state.js'
import { clamp, formatTime } from './util.js'

function updateRenderButtons() {
  const busy = state.rendering
  $('quick-preview').disabled = busy
  $('open-export').disabled = busy
  $('export-btn').disabled = busy
  $('export-preview').disabled = busy
  $('export-cancel').disabled = !busy
  $('cancel-render').hidden = !busy
}

function beginRender() {
  clearTimeout(state.hideProgressTimer)
  state.renderGen += 1
  state.rendering = true
  updateRenderButtons()
  return state.renderGen
}

function endRender(gen) {
  if (gen !== state.renderGen) return
  state.rendering = false
  updateRenderButtons()
}

export function showProgress(info = {}) {
  clearTimeout(state.hideProgressTimer)
  const ratio = Number.isFinite(Number(info.ratio))
    ? clamp(Number(info.ratio), 0, 1)
    : clamp((Number(info.pct) || 0) / 100, 0, 1)
  const pct = Number.isFinite(Number(info.pct)) ? Number(info.pct) : Math.round(ratio * 1000) / 10
  const bits = [`${pct}%`]
  if (Number.isFinite(Number(info.fps)) && Number(info.fps) > 0) bits.push(`${info.fps} fps`)
  if (Number.isFinite(Number(info.eta)) && Number(info.eta) > 0) bits.push(`ещё ${formatTime(info.eta)}`)
  let label = bits.join(' · ')
  if (ratio >= 1) label = `${label} · готово`
  progressEl.hidden = false
  progressLabel.hidden = false
  progressBar.style.width = `${(ratio * 100).toFixed(1)}%`
  progressLabel.textContent = label
  const box = $('export-progress')
  box.hidden = false
  $('export-progress-bar').style.width = `${(ratio * 100).toFixed(1)}%`
  $('export-progress-label').textContent = label
  if (ratio >= 1) {
    state.hideProgressTimer = setTimeout(() => {
      if (!state.rendering) hideProgress()
    }, 3500)
  }
}

function hideProgress() {
  clearTimeout(state.hideProgressTimer)
  progressEl.hidden = true
  progressLabel.hidden = true
  $('export-progress').hidden = true
  $('export-progress-label').textContent = ''
}

function openExport() {
  const canvas = canvasInfo()
  $('export-width').value = canvas.width
  $('export-height').value = canvas.height
  $('export-fps').value = canvas.fps
  if (!$('export-path').value.trim()) {
    let dir = ''
    try {
      dir = localStorage.getItem(DIR_KEY) || ''
    } catch {
      /* хранилище недоступно */
    }
    const name =
      String(state.project?.name || 'ролик')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .trim() || 'ролик'
    if (dir) $('export-path').value = `${dir}${dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'}${name}.mp4`
  }
  if (!$('export-dialog').open) $('export-dialog').showModal()
}

async function runExport(body) {
  if (state.rendering) return
  const gen = beginRender()
  setStatus('Экспорт…')
  showProgress({ ratio: 0, pct: 0, time: 0, total: mainDuration(), output: body.output })
  try {
    const result = await request('POST', '/api/render', body)
    if (gen !== state.renderGen) return
    showProgress({
      ratio: 1,
      pct: 100,
      eta: 0,
      time: result.duration,
      total: result.duration,
      output: result.output,
    })
    setStatus(result.output ? `Экспорт готов: ${result.output}` : 'Экспорт готов')
  } catch (err) {
    if (gen !== state.renderGen) return
    hideProgress()
    if (/отмен/.test(err.message)) setStatus('Рендер отменён')
    else setStatus(err.message, true)
  } finally {
    endRender(gen)
  }
}

async function runPreview() {
  if (state.rendering) return
  const gen = beginRender()
  setStatus('Собираю предпросмотр…')
  showProgress({ ratio: 0, pct: 0, time: 0, total: mainDuration() })
  try {
    await request('POST', '/api/preview')
    if (gen !== state.renderGen) return
    showProgress({ ratio: 1, pct: 100, eta: 0, time: mainDuration(), total: mainDuration() })
    setStatus('Предпросмотр готов')
    openProxy()
  } catch (err) {
    if (gen !== state.renderGen) return
    hideProgress()
    if (/отмен/.test(err.message)) setStatus('Рендер отменён')
    else setStatus(err.message, true)
  } finally {
    endRender(gen)
  }
}

function openProxy() {
  const video = $('proxy-video')
  video.src = `/preview.mp4?t=${Date.now()}`
  const dialog = $('preview-dialog')
  if (!dialog.open) dialog.showModal()
  video.play().catch(() => {})
}

export async function cancelRender() {
  if (!state.rendering) return
  try {
    await request('POST', '/api/render/cancel')
  } catch (err) {
    if (!/не выполняется/.test(err.message)) setStatus(err.message, true)
  }
}

export async function removeSilence() {
  const noiseDb = Number($('silence-db').value)
  const minDur = Number($('silence-dur').value)
  if (!Number.isFinite(noiseDb) || !Number.isFinite(minDur) || !(minDur > 0)) {
    setStatus('Проверьте порог и минимальную длительность', true)
    return
  }
  const button = $('silence-btn')
  button.disabled = true
  setStatus('Убираю паузы…')
  try {
    await postOp('removeSilence', { noiseDb, minDur })
    setStatus('Паузы убраны')
  } catch {
    /* статус уже показан */
  } finally {
    button.disabled = false
  }
}

const DIR_KEY = 'minicut-export-dir'
let suggestions = []
let activeIndex = -1
let suggestTimer = 0
let suggestSeq = 0

function closeSuggest() {
  $('export-suggest').hidden = true
  $('export-path').setAttribute('aria-expanded', 'false')
  suggestions = []
  activeIndex = -1
}

function highlight(index) {
  activeIndex = index
  const items = $('export-suggest').children
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle('is-active', i === index)
    items[i].setAttribute('aria-selected', String(i === index))
  }
  if (items[index]) items[index].scrollIntoView({ block: 'nearest' })
}

function pick(item) {
  const input = $('export-path')
  input.value = item.path
  input.focus()
  if (item.kind === 'dir') void showSuggest()
  else closeSuggest()
}

async function showSuggest() {
  const seq = ++suggestSeq
  let items = []
  try {
    const data = await request('GET', `/api/complete?path=${encodeURIComponent($('export-path').value)}`)
    items = data.items || []
  } catch {
    items = []
  }
  if (seq !== suggestSeq) return
  suggestions = items
  const list = $('export-suggest')
  list.replaceChildren()
  if (!items.length) return closeSuggest()
  items.forEach((item, i) => {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    li.className = `combo-item is-${item.kind}`
    li.textContent = item.kind === 'dir' ? `${item.name}/` : item.name
    li.addEventListener('mousedown', (event) => {
      event.preventDefault()
      pick(item)
    })
    li.addEventListener('mousemove', () => highlight(i))
    list.append(li)
  })
  list.hidden = false
  $('export-path').setAttribute('aria-expanded', 'true')
  highlight(-1)
}

function bindExportPath() {
  const input = $('export-path')
  input.addEventListener('input', () => {
    clearTimeout(suggestTimer)
    suggestTimer = setTimeout(() => void showSuggest(), 120)
  })
  input.addEventListener('focus', () => void showSuggest())
  input.addEventListener('blur', closeSuggest)
  input.addEventListener('keydown', (event) => {
    const open = !$('export-suggest').hidden && suggestions.length
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault()
      highlight((activeIndex + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault()
      highlight((activeIndex - 1 + suggestions.length) % suggestions.length)
    } else if (
      (event.key === 'Tab' || event.key === 'Enter') &&
      open &&
      (activeIndex >= 0 || event.key === 'Tab')
    ) {
      event.preventDefault()
      pick(suggestions[Math.max(activeIndex, 0)])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      closeSuggest()
    }
  })
}

export function bindExport() {
  bindExportPath()
  $('silence-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void removeSilence()
  })
  $('open-export').addEventListener('click', openExport)
  $('quick-preview').addEventListener('click', () => {
    void runPreview()
  })
  $('cancel-render').addEventListener('click', () => {
    void cancelRender()
  })
  $('export-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const output = $('export-path').value.trim()
    if (!output) {
      setStatus('Укажите путь для экспорта', true)
      return
    }
    try {
      localStorage.setItem(DIR_KEY, output.replace(/[\\/][^\\/]*$/, ''))
    } catch {
      /* папка просто не запомнится */
    }
    const width = Number($('export-width').value)
    const height = Number($('export-height').value)
    const fps = Number($('export-fps').value)
    const crf = Number($('export-crf').value)
    if (![width, height, fps, crf].every(Number.isFinite)) {
      setStatus('Проверьте параметры экспорта', true)
      return
    }
    void runExport({
      output,
      width,
      height,
      fps,
      crf,
      loudnorm: $('export-loudnorm').checked,
    })
  })
  $('export-close').addEventListener('click', () => $('export-dialog').close())
  $('export-cancel').addEventListener('click', () => {
    void cancelRender()
  })
  $('export-preview').addEventListener('click', () => {
    void runPreview()
  })
  $('preview-close').addEventListener('click', () => $('preview-dialog').close())
  $('preview-dialog').addEventListener('close', () => {
    const video = $('proxy-video')
    video.pause()
    video.removeAttribute('src')
    try {
      video.load()
    } catch {
      /* уже пустой */
    }
  })
}
