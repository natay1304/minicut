import { postOp, request, setStatus } from './api.js'
import { canvasInfo, mainDuration } from './project-model.js'
import { $, progressBar, progressEl, progressLabel, state } from './state.js'
import { clamp, formatTime } from './util.js'

export function updateRenderButtons() {
  const busy = state.rendering
  $('quick-preview').disabled = busy
  $('open-export').disabled = busy
  $('export-btn').disabled = busy
  $('export-preview').disabled = busy
  $('export-cancel').disabled = !busy
  $('cancel-render').hidden = !busy
}

export function beginRender() {
  clearTimeout(state.hideProgressTimer)
  state.renderGen += 1
  state.rendering = true
  updateRenderButtons()
  return state.renderGen
}

export function endRender(gen) {
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

export function hideProgress() {
  clearTimeout(state.hideProgressTimer)
  progressEl.hidden = true
  progressLabel.hidden = true
  $('export-progress').hidden = true
  $('export-progress-label').textContent = ''
}

export function openExport() {
  const canvas = canvasInfo()
  $('export-width').value = canvas.width
  $('export-height').value = canvas.height
  $('export-fps').value = canvas.fps
  if (!$('export-dialog').open) $('export-dialog').showModal()
}

export async function runExport(body) {
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

export async function runPreview() {
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

export function openProxy() {
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

export function bindExport() {
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
