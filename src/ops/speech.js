// Расшифровка речи и операции по тексту: поиск, дубли, вырезание, субтитры.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  SpeechError,
  cancelWhisper,
  extractAudio,
  runWhisper,
  speechStatus,
  DEFAULT_MODEL,
} from '../speech/engine.js'
import {
  cuesFromTimelineWords,
  findPhrase,
  findRepeats as findRepeatTakes,
  groupUtterances,
  parseWhisperJson,
  round3,
  wordsOnTimeline,
} from '../speech/words.js'
import { commit, emit, getProject } from './history.js'
import { OpError, findMedia, mustNum, nextId } from './project.js'
import { keepRanges } from './silence.js'
import { trackById } from './tracks.js'

// Остатки клипа короче этого после вырезания не оставляем: это обрывки вдоха или паузы.
const MIN_PIECE = 0.25

function asOpError(err) {
  if (err instanceof OpError) return err
  if (err instanceof SpeechError) {
    const wrapped = new OpError(err.message, err.status)
    wrapped.code = err.code
    return wrapped
  }
  return err
}

function wordsOf(mediaId) {
  const media = findMedia(getProject().media, mediaId)
  if (!Array.isArray(media.words) || !media.words.length) {
    throw new OpError(`У медиа ${mediaId} нет расшифровки: сначала выполните transcribe`)
  }
  return { media, words: media.words }
}

/** Состояние распознавания: установлено ли всё нужное и чего не хватает. */
export function speechState() {
  return speechStatus()
}

export async function transcribe(mediaId, options = {}) {
  const media = findMedia(getProject().media, mediaId)
  if (!media.hasAudio) throw new OpError('В медиа нет звуковой дорожки')
  const language = options.language == null ? 'auto' : String(options.language)
  if (!/^(auto|[a-z]{2,3})$/.test(language))
    throw new OpError('language: auto или код языка, например ru или en')
  const model = options.model == null ? DEFAULT_MODEL : String(options.model)
  if (!/^[\w.-]+$/.test(model)) throw new OpError('Некорректное имя модели')
  const status = speechStatus(model)
  if (!status.ready) throw new OpError(`Не установлено: ${status.missing.join(', ')}. ${status.hint}`, 424)

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'minicut-speech-'))
  const progress = (pct, stage) => emit('transcribe-progress', { mediaId, pct, stage })
  try {
    progress(0, 'audio')
    const wavPath = path.join(workDir, 'audio.wav')
    await extractAudio(media.path, wavPath)
    progress(2, 'recognize')
    const json = await runWhisper({
      wavPath,
      workDir,
      language,
      model,
      prompt: options.prompt,
      onProgress: (pct) => progress(Math.max(2, pct), 'recognize'),
    })
    const parsed = parseWhisperJson(json)
    if (!parsed.words.length) throw new OpError('В записи не найдено речи')
    commit((draft) => {
      const target = findMedia(draft.media, mediaId)
      target.words = parsed.words
      if (parsed.language) target.language = parsed.language
      return null
    })
    progress(100, 'done')
    return { mediaId, language: parsed.language, wordCount: parsed.words.length, duration: media.duration }
  } catch (err) {
    emit('transcribe-progress', { mediaId, pct: null, stage: 'failed', error: String(err.message || err) })
    throw asOpError(err)
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // временная папка могла быть уже удалена
    }
  }
}

export function cancelTranscribe() {
  return { cancelled: cancelWhisper() }
}

/** Расшифровка по фразам (компактно) или по словам. Диапазон from..to в секундах исходного файла. */
export function getTranscript(mediaId, options = {}) {
  const { media, words } = wordsOf(mediaId)
  const from = options.from == null ? 0 : mustNum(options.from, 'from')
  const to = options.to == null ? Infinity : mustNum(options.to, 'to')
  const slice = words.filter((word) => word.end > from && word.start < to)
  if (options.words) return { mediaId, language: media.language || null, words: slice }
  const utterances = groupUtterances(slice).map(({ start, end, text }) => ({ start, end, text }))
  return { mediaId, language: media.language || null, wordCount: slice.length, utterances }
}

export function findInTranscript(query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new OpError('Не указан текст для поиска')
  const limit = options.limit == null ? 20 : Math.max(1, Math.round(mustNum(options.limit, 'limit')))
  const media = getProject().media.filter(
    (item) => item.words?.length && (options.mediaId == null || item.id === options.mediaId),
  )
  if (!media.length) throw new OpError('Нет расшифрованных медиа: сначала выполните transcribe')
  const results = []
  for (const item of media) {
    for (const match of findPhrase(item.words, query, { limit })) results.push({ mediaId: item.id, ...match })
  }
  return results.slice(0, limit)
}

export function findRepeats(mediaId, options = {}) {
  const { words } = wordsOf(mediaId)
  const groups = findRepeatTakes(words, {
    minWords: options.minWords == null ? 3 : Math.round(mustNum(options.minWords, 'minWords')),
    minSimilarity: options.minSimilarity == null ? 0.75 : mustNum(options.minSimilarity, 'minSimilarity'),
  })
  return { mediaId, groups }
}

/**
 * Вырезает интервал исходного файла из клипов основной дорожки (остальное сдвигается).
 * Берите start и end из findInTranscript или findRepeats.
 */
export function cutSourceRange(mediaId, start, end) {
  const s = round3(mustNum(start, 'start'))
  const e = round3(mustNum(end, 'end'))
  if (!(e > s) || s < 0) throw new OpError('Некорректный интервал')
  const current = getProject()
  findMedia(current.media, mediaId)
  const hit = (clip) => clip.mediaId === mediaId && clip.out > s && clip.in < e
  if (!trackById(current, 'main').clips.some(hit)) {
    throw new OpError('На основной дорожке нет клипов, которые содержат этот фрагмент исходника')
  }
  return commit((draft) => {
    const track = trackById(draft, 'main')
    let max = 0
    for (const clip of draft.tracks.flatMap((item) => item.clips)) {
      const n = Number(String(clip.id).slice(1))
      if (Number.isInteger(n) && n > max) max = n
    }
    const next = []
    let removed = 0
    for (const clip of track.clips) {
      if (!hit(clip)) {
        next.push(clip)
        continue
      }
      const keeps = keepRanges(clip, [{ start: s, end: e }], 0).filter(
        (range) => range.out - range.in >= MIN_PIECE,
      )
      removed += round3(clip.out - clip.in - keeps.reduce((sum, range) => sum + (range.out - range.in), 0))
      keeps.forEach((range, index) => {
        next.push({ ...clip, id: index === 0 ? clip.id : `c${++max}`, in: range.in, out: range.out })
      })
    }
    track.clips = next
    return { removedSeconds: round3(removed), clips: next.length }
  })
}

/** Создаёт подписи из расшифровки по клипам основной дорожки (время на таймлайне). */
export function subtitlesFromTranscript(mediaId, options = {}) {
  const { words } = wordsOf(mediaId)
  const maxChars =
    options.maxChars == null ? 36 : Math.max(10, Math.round(mustNum(options.maxChars, 'maxChars')))
  const current = getProject()
  const timeline = wordsOnTimeline(words, trackById(current, 'main').clips, mediaId)
  if (!timeline.length) throw new OpError('Слова этой расшифровки не попадают в клипы основной дорожки')
  const cues = cuesFromTimelineWords(timeline, { maxChars })
  return commit((draft) => {
    const style = typeof options.style === 'string' && draft.styles[options.style] ? options.style : 'sub'
    if (options.replace) draft.texts = []
    for (const cue of cues) {
      draft.texts.push({
        id: nextId(draft.texts, 't'),
        start: cue.start,
        end: cue.end,
        text: cue.text,
        style,
      })
    }
    return { created: cues.length, replaced: Boolean(options.replace) }
  })
}
