import { postOp, request } from './api.js'
import { timelineOffset } from './clip-time.js'
import { hooks } from './hooks.js'
import { pausePlayback, revealPlayhead } from './playback.js'
import { showFrame } from './preview-players.js'
import { clipStart, mainClips } from './project-model.js'
import { $, state } from './state.js'
import { formatTime, pad } from './util.js'

const STAGES = {
  audio: 'Извлечение звука',
  recognize: 'Распознавание',
}

let speechReady = null
let speechChecked = false
let speechHint = ''
let transcribing = false
let progress = 0
let panelMessage = ''
let panelError = false
let utterances = []
let loading = false
let loadGen = 0
let loaded = { id: '', count: -1, library: '' }
let repeats = null

function wordCount(media) {
  const count = Number(media?.wordCount)
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0
}

function audioMedia() {
  return state.project.media.filter((item) => item.hasAudio)
}

function selectedMedia() {
  const id = $('transcript-media').value
  if (!id) return null
  return state.project.media.find((item) => item.id === id && item.hasAudio) || null
}

function selectedLanguage() {
  const value = $('transcript-lang').value
  if (value === 'ru' || value === 'en' || value === 'auto') return value
  return 'auto'
}

function formatMmSs(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`
}

function setPanelStatus(text, isError = false) {
  panelMessage = text || ''
  panelError = Boolean(isError && panelMessage)
  paintStatus()
}

function paintStatus() {
  const node = $('transcript-status')
  node.textContent = panelMessage
  node.classList.toggle('is-error', panelError)
}

function timelineAt(mediaId, start) {
  const clips = mainClips()
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]
    if (clip.mediaId !== mediaId) continue
    if (start < clip.in - 0.0005 || start >= clip.out) continue
    return clipStart(i, clips) + timelineOffset(clip, start)
  }
  return null
}

function libraryToken() {
  const name = state.project?.name || ''
  const media = (state.project?.media || []).map((item) => `${item.id}\t${item.path}`)
  return JSON.stringify([name, media])
}

function takeMark(utterance) {
  const media = selectedMedia()
  if (!media || !repeats || repeats.mediaId !== media.id) return null
  let best = null
  let bestHit = 0
  for (const group of repeats.groups) {
    const takes = Array.isArray(group.takes) ? group.takes : []
    for (let index = 0; index < takes.length; index += 1) {
      const take = takes[index]
      const hit = Math.min(utterance.end, Number(take.end)) - Math.max(utterance.start, Number(take.start))
      if (!(hit > bestHit)) continue
      bestHit = hit
      best = {
        label: `дубль ${index + 1}/${takes.length}`,
        keep: index === group.keep,
        start: Number(take.start),
        end: Number(take.end),
      }
    }
  }
  return bestHit >= 0.05 ? best : null
}

function paintMediaSelect() {
  const select = $('transcript-media')
  const audio = audioMedia()
  const labels = audio.map((item) => item.name || item.id)
  if (!audio.length) {
    const placeholder =
      select.options.length === 1 &&
      select.options[0].value === '' &&
      select.options[0].textContent === 'Нет звука'
    if (!placeholder) {
      select.replaceChildren()
      const option = document.createElement('option')
      option.value = ''
      option.textContent = 'Нет звука'
      select.append(option)
    }
    select.disabled = true
    return
  }
  const same =
    select.options.length === audio.length &&
    audio.every(
      (item, index) =>
        select.options[index].value === item.id && select.options[index].textContent === labels[index],
    )
  if (!same) {
    const prev = select.value
    select.replaceChildren()
    audio.forEach((item, index) => {
      const option = document.createElement('option')
      option.value = item.id
      option.textContent = labels[index]
      if (item.path) option.title = item.path
      select.append(option)
    })
    if (audio.some((item) => item.id === prev)) select.value = prev
  }
  select.disabled = false
}

function paintChrome() {
  const media = selectedMedia()
  const count = wordCount(media)
  const missing = speechReady === false
  $('transcript-setup').hidden = !missing
  $('transcript-hint').textContent = speechHint
  $('transcript-copy').disabled = !speechHint
  $('transcript-run-row').hidden = missing
  const run = $('transcript-run')
  run.hidden = missing
  run.disabled = missing || !speechChecked || !media || transcribing
  const cancel = $('transcript-cancel')
  cancel.hidden = !transcribing
  const busy = !media || count <= 0 || transcribing
  $('transcript-repeats').disabled = busy
  $('transcript-subs').disabled = busy
  const box = $('transcript-progress')
  const pct = Math.round(progress)
  box.hidden = !transcribing
  box.setAttribute('aria-valuenow', String(pct))
  $('transcript-progress-bar').style.width = `${pct}%`
  $('transcript-pct').textContent = transcribing ? `${pct}%` : ''
  paintStatus()
}

function emptyNote(media) {
  if (!audioMedia().length || !media) return 'Нет медиа со звуком'
  if (loading && !utterances.length) return 'Загрузка…'
  if (wordCount(media) <= 0) return 'Расшифровки пока нет'
  return 'Фраз нет'
}

function paintList() {
  const list = $('transcript-list')
  const empty = $('transcript-empty')
  const media = selectedMedia()
  const note = emptyNote(media)
  empty.hidden = utterances.length > 0
  empty.textContent = utterances.length ? '' : note
  const scroll = list.scrollTop
  list.replaceChildren()
  if (!media || !utterances.length) return
  const frag = document.createDocumentFragment()
  for (const utterance of utterances) frag.append(renderRow(media.id, utterance))
  list.append(frag)
  list.scrollTop = scroll
}

function renderRow(mediaId, utterance) {
  const at = timelineAt(mediaId, utterance.start)
  const mark = takeMark(utterance)
  const li = document.createElement('li')
  const row = document.createElement('div')
  row.className = at == null ? 'transcript-row is-off' : 'transcript-row'

  const pick = document.createElement('button')
  pick.type = 'button'
  pick.className = 'transcript-pick'
  if (at == null) pick.setAttribute('aria-disabled', 'true')
  const time = document.createElement('span')
  time.className = 'transcript-time'
  time.textContent = formatMmSs(utterance.start)
  time.title = formatTime(utterance.start)
  const text = document.createElement('span')
  text.className = 'transcript-text'
  text.textContent = utterance.text
  pick.append(time)
  if (mark) {
    const marks = document.createElement('span')
    marks.className = 'transcript-marks'
    const badge = document.createElement('span')
    badge.className = 'transcript-badge'
    badge.textContent = mark.label
    marks.append(badge)
    if (mark.keep) {
      const keep = document.createElement('span')
      keep.className = 'transcript-keep'
      keep.textContent = 'оставить'
      marks.append(keep)
    }
    pick.append(marks)
  }
  pick.append(text)
  pick.addEventListener('click', () => {
    if (at == null) return
    pausePlayback()
    void showFrame(at)
    revealPlayhead()
  })

  const cut = document.createElement('button')
  cut.type = 'button'
  cut.className = 'transcript-cut'
  cut.textContent = '✂'
  cut.setAttribute('aria-label', 'Вырезать')
  cut.title = 'Вырезать'
  cut.addEventListener('click', () => {
    void cutRange(mediaId, utterance.start, utterance.end)
  })
  row.append(pick, cut)

  if (mark && !mark.keep) {
    const dup = document.createElement('button')
    dup.type = 'button'
    dup.className = 'transcript-cut-dup'
    dup.textContent = 'Вырезать дубль'
    dup.addEventListener('click', () => {
      void cutRange(mediaId, mark.start, mark.end)
    })
    row.append(dup)
  }

  li.append(row)
  return li
}

function syncTranscript() {
  const media = selectedMedia()
  const key = {
    id: media?.id || '',
    count: media ? wordCount(media) : 0,
    library: libraryToken(),
  }
  if (loaded.id === key.id && loaded.count === key.count && loaded.library === key.library) return
  const sameMedia = Boolean(key.id) && loaded.id === key.id && loaded.library === key.library
  loaded = key
  repeats = null
  if (!sameMedia) utterances = []
  const gen = ++loadGen
  void loadUtterances(key.id, key.count, gen)
}

async function loadUtterances(mediaId, count, gen) {
  if (!mediaId || count <= 0) {
    if (gen !== loadGen) return
    utterances = []
    loading = false
    paintList()
    return
  }
  loading = true
  if (!utterances.length) paintList()
  try {
    const data = await request('POST', '/api/op', { op: 'getTranscript', args: { mediaId } })
    if (gen !== loadGen) return
    const rows = Array.isArray(data?.result?.utterances) ? data.result.utterances : []
    utterances = rows
      .filter((item) => item && Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)))
      .map((item) => ({
        start: Number(item.start),
        end: Number(item.end),
        text: String(item.text ?? ''),
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end)
  } catch (err) {
    if (gen !== loadGen) return
    utterances = []
    setPanelStatus(err.message, true)
  } finally {
    if (gen === loadGen) {
      loading = false
      paintList()
    }
  }
}

async function refreshSpeech() {
  try {
    const data = await request('POST', '/api/op', { op: 'speechState', args: {} })
    const info = data?.result || {}
    speechReady = Boolean(info.ready)
    speechHint = typeof info.hint === 'string' ? info.hint : ''
  } catch (err) {
    speechReady = null
    speechHint = ''
    setPanelStatus(err.message, true)
  } finally {
    speechChecked = true
    renderTranscript()
  }
}

async function startTranscribe() {
  if (transcribing || speechReady !== true) return
  const media = selectedMedia()
  if (!media) return
  transcribing = true
  progress = 0
  setPanelStatus(STAGES.audio)
  paintChrome()
  try {
    // Долгий запрос не встаёт в очередь postOp, чтобы «Отмена» дошла сразу.
    const data = await request('POST', '/api/op', {
      op: 'transcribe',
      args: { mediaId: media.id, language: selectedLanguage() },
    })
    transcribing = false
    if (data?.project && hooks.applyProject) hooks.applyProject(data.project)
    if (!panelError) setPanelStatus('Готово')
    paintChrome()
  } catch (err) {
    if (!transcribing) return
    transcribing = false
    setPanelStatus(err.message, true)
    paintChrome()
  }
}

async function cancelJob() {
  if (!transcribing) return
  try {
    await request('POST', '/api/op', { op: 'cancelTranscribe', args: {} })
  } catch (err) {
    setPanelStatus(err.message, true)
  }
}

async function cutRange(mediaId, start, end) {
  try {
    await postOp('cutSourceRange', { mediaId, start, end })
    if (panelError) setPanelStatus('')
  } catch (err) {
    setPanelStatus(err.message, true)
  }
}

async function runRepeats() {
  const media = selectedMedia()
  if (!media || wordCount(media) <= 0) return
  const library = libraryToken()
  try {
    const data = await request('POST', '/api/op', { op: 'findRepeats', args: { mediaId: media.id } })
    if (selectedMedia()?.id !== media.id || libraryToken() !== library) return
    const groups = Array.isArray(data?.result?.groups) ? data.result.groups : []
    repeats = { mediaId: media.id, groups }
    setPanelStatus(groups.length ? '' : 'Повторов не найдено')
    paintList()
  } catch (err) {
    setPanelStatus(err.message, true)
  }
}

async function makeSubtitles() {
  const media = selectedMedia()
  if (!media || wordCount(media) <= 0) return
  const replace = confirm('Заменить существующие подписи?')
  try {
    const result = await postOp('subtitlesFromTranscript', { mediaId: media.id, replace })
    const created = Number(result?.created)
    setPanelStatus(`Создано подписей: ${Number.isFinite(created) ? created : 0}`)
  } catch (err) {
    setPanelStatus(err.message, true)
  }
}

async function copyHint() {
  const text = $('transcript-hint').textContent || ''
  if (!text) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      setPanelStatus('Команда скопирована')
      return
    }
  } catch {
    /* запасной путь ниже */
  }
  const range = document.createRange()
  range.selectNodeContents($('transcript-hint'))
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  const copied = document.execCommand('copy')
  setPanelStatus(copied ? 'Команда скопирована' : 'Не удалось скопировать', !copied)
}

function reloadSelected() {
  const media = selectedMedia()
  loaded = { id: media?.id || '', count: -1, library: libraryToken() }
  renderTranscript()
}

export function onTranscribeProgress(info) {
  if (!info || typeof info !== 'object') return
  const stage = typeof info.stage === 'string' ? info.stage : ''
  if (Number.isFinite(Number(info.pct))) progress = Math.max(0, Math.min(100, Number(info.pct)))
  if (stage === 'failed') {
    transcribing = false
    setPanelStatus(typeof info.error === 'string' && info.error ? info.error : 'Ошибка расшифровки', true)
    paintChrome()
    return
  }
  if (stage === 'done') {
    transcribing = false
    progress = 100
    setPanelStatus('Готово')
    const media = selectedMedia()
    if (info.mediaId && media && media.id !== info.mediaId) {
      paintChrome()
      return
    }
    reloadSelected()
    return
  }
  transcribing = true
  const label = STAGES[stage] || 'Расшифровка'
  if (panelMessage !== label || panelError) setPanelStatus(label)
  paintChrome()
}

export function renderTranscript() {
  paintMediaSelect()
  syncTranscript()
  paintChrome()
  paintList()
}

export function bindTranscript() {
  $('transcript-media').addEventListener('change', () => {
    repeats = null
    if (!transcribing) setPanelStatus('')
    loaded = { id: '\0', count: -1, library: libraryToken() }
    renderTranscript()
  })
  $('transcript-run').addEventListener('click', () => {
    void startTranscribe()
  })
  $('transcript-cancel').addEventListener('click', () => {
    void cancelJob()
  })
  $('transcript-repeats').addEventListener('click', () => {
    void runRepeats()
  })
  $('transcript-subs').addEventListener('click', () => {
    void makeSubtitles()
  })
  $('transcript-copy').addEventListener('click', () => {
    void copyHint()
  })
  void refreshSpeech()
}
