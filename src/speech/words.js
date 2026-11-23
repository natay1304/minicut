// Чистые функции для работы со словами расшифровки (без файлов и процессов, поэтому легко тестируются).
// Слово: { start, end, text } в секундах исходного файла.

const SENTENCE_END = /[.!?…]["»”)]*$/

export function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

/** Нормализует текст для сравнения: нижний регистр, ё→е, без знаков препинания. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(text) {
  const norm = normalizeText(text)
  return norm ? norm.split(' ') : []
}

/**
 * Разбирает JSON whisper.cpp (`-oj`, запуск с `-ml 1 -sow`: один сегмент = одно слово).
 * Сегменты без пробела в начале, состоящие из знаков препинания, приклеиваются к предыдущему слову.
 * Служебные метки вроде [BLANK_AUDIO] и (музыка) отбрасываются.
 */
export function parseWhisperJson(json) {
  const raw = Array.isArray(json?.transcription) ? json.transcription : []
  const words = []
  for (const item of raw) {
    const text = String(item?.text ?? '')
    const trimmed = text.trim()
    if (!trimmed) continue
    if (/^[[(].*[\])]$/.test(trimmed)) continue
    const from = Number(item?.offsets?.from)
    const to = Number(item?.offsets?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const start = round3(from / 1000)
    let end = round3(to / 1000)
    const glue = !/^\s/.test(text) && words.length > 0 && /^[\p{P}\p{S}]+$/u.test(trimmed)
    if (glue) {
      const prev = words[words.length - 1]
      prev.text += trimmed
      prev.end = Math.max(prev.end, end)
      continue
    }
    if (!(end > start)) end = round3(start + 0.02)
    words.push({ start, end, text: trimmed })
  }
  return { language: json?.result?.language || null, words }
}

/** Разбивает слова на фразы по паузам и концам предложений. */
export function groupUtterances(words, { gap = 0.7, maxWords = 40 } = {}) {
  const out = []
  let cur = null
  const flush = () => {
    if (cur) out.push(cur)
    cur = null
  }
  words.forEach((word, index) => {
    if (cur && (word.start - cur.end >= gap || cur.count >= maxWords)) flush()
    if (!cur) cur = { start: word.start, end: word.end, text: word.text, from: index, to: index, count: 1 }
    else {
      cur.end = word.end
      cur.text += ` ${word.text}`
      cur.to = index
      cur.count += 1
    }
    if (SENTENCE_END.test(word.text)) flush()
  })
  flush()
  return out.map((u) => ({ start: u.start, end: u.end, text: u.text, wordFrom: u.from, wordTo: u.to }))
}

function charDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Слова считаем одинаковыми, если совпадают или отличаются на букву-две (опечатки распознавания).
function sameWord(a, b) {
  if (a === b) return true
  const len = Math.min(a.length, b.length)
  if (len < 5) return false
  return charDistance(a, b) <= (len >= 8 ? 2 : 1)
}

function wordDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (sameWord(a[i - 1], b[j - 1]) ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Похожесть двух списков слов от 0 до 1. */
export function similarity(a, b) {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - wordDistance(a, b) / max
}

/** Ищет фразу в словах: точное совпадение по нормализованным словам, затем похожее. */
export function findPhrase(words, query, { limit = 20, minSimilarity = 0.8 } = {}) {
  const q = tokens(query)
  if (!q.length) return []
  const norm = words.map((word) => tokens(word.text).join(' '))
  const matches = []
  const taken = new Set()
  const push = (i, len, exact) => {
    if (taken.has(i)) return
    for (let k = i; k < i + len; k += 1) taken.add(k)
    const first = words[i]
    const last = words[i + len - 1]
    const around = words.slice(Math.max(0, i - 4), i + len + 4).map((w) => w.text)
    matches.push({
      start: first.start,
      end: last.end,
      wordFrom: i,
      wordTo: i + len - 1,
      exact,
      context: around.join(' '),
    })
  }
  for (let i = 0; i + q.length <= words.length && matches.length < limit; i += 1) {
    if (q.every((token, k) => norm[i + k] === token)) push(i, q.length, true)
  }
  if (matches.length < limit) {
    for (let i = 0; i + q.length <= words.length && matches.length < limit; i += 1) {
      const window = norm.slice(i, i + q.length)
      if (similarity(window, q) >= minSimilarity) push(i, q.length, false)
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}

const FILLER = new Set(['то', 'есть', 'ну', 'итак', 'собственно', 'получается', 'вот', 'а', 'и'])

// Дубли одной мысли часто начинаются одинаково, а продолжаются по-разному. Сравниваем первые слова
// после вводных («то есть», «итак»): если пять слов подряд совпали, это один и тот же дубль.
function sameOpening(a, b, count = 5) {
  const core = (list) => {
    let i = 0
    while (i < list.length - count && FILLER.has(list[i])) i += 1
    return list.slice(i, i + count)
  }
  const x = core(a)
  const y = core(b)
  return x.length === count && y.length === count && x.every((word, k) => sameWord(word, y[k]))
}

/**
 * Ищет повторные дубли: фразы, сказанные несколько раз подряд почти теми же словами,
 * и оборванные начала («Сегодня мы расскажем про… Сегодня мы расскажем про три способа»).
 * Рекомендует оставить последний дубль.
 */
export function findRepeats(words, { minWords = 3, minSimilarity = 0.75, window = 6 } = {}) {
  const utterances = groupUtterances(words, { gap: 0.6 })
  const toks = utterances.map((u) => tokens(u.text))
  const used = new Set()
  const groups = []
  for (let i = 0; i < utterances.length; i += 1) {
    if (used.has(i) || toks[i].length < minWords) continue
    const takes = [i]
    for (let j = i + 1; j < Math.min(utterances.length, i + 1 + window); j += 1) {
      if (used.has(j) || toks[j].length < minWords) continue
      const last = takes[takes.length - 1]
      const full = similarity(toks[last], toks[j])
      const shorter = toks[last].length < toks[j].length ? toks[last] : toks[j]
      const longer = shorter === toks[last] ? toks[j] : toks[last]
      const restart =
        similarity(shorter, longer.slice(0, shorter.length)) >= 0.85 && shorter.length >= minWords
      if (full >= minSimilarity || restart || sameOpening(toks[last], toks[j])) takes.push(j)
    }
    if (takes.length > 1) {
      takes.forEach((k) => used.add(k))
      groups.push({
        phrase: utterances[takes[takes.length - 1]].text,
        keep: takes.length - 1,
        takes: takes.map((k) => ({
          start: utterances[k].start,
          end: utterances[k].end,
          text: utterances[k].text,
        })),
      })
    }
  }
  return groups
}

/**
 * Переводит слова исходного файла во время таймлайна по клипам основной дорожки.
 * Возвращает слова с полем `at` (время на таймлайне) в порядке таймлайна.
 */
export function wordsOnTimeline(words, mainClips, mediaId) {
  const out = []
  let offset = 0
  for (const clip of mainClips) {
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1
    const length = round3((clip.out - clip.in) / speed)
    if (clip.mediaId === mediaId) {
      for (const word of words) {
        const mid = (word.start + word.end) / 2
        if (mid < clip.in || mid >= clip.out) continue
        const at = round3(offset + (Math.max(word.start, clip.in) - clip.in) / speed)
        const to = round3(offset + (Math.min(word.end, clip.out) - clip.in) / speed)
        out.push({ text: word.text, start: at, end: to > at ? to : round3(at + 0.02) })
      }
    }
    offset = round3(offset + length)
  }
  return out
}

/** Собирает подписи из слов на таймлайне: по длине строки, паузам и концам предложений. */
export function cuesFromTimelineWords(words, { maxChars = 36, maxGap = 0.6, hold = 0.12 } = {}) {
  const cues = []
  let cur = null
  const flush = () => {
    if (cur) cues.push(cur)
    cur = null
  }
  // Сколько слов осталось до конца предложения (если оно заканчивается в пределах двух слов).
  const wordsToSentenceEnd = (from) => {
    for (let k = 0; k <= 2 && from + k < words.length; k += 1) {
      if (SENTENCE_END.test(words[from + k].text)) return k + 1
      if (k > 0 && words[from + k].start - words[from + k - 1].end > maxGap) return Infinity
    }
    return Infinity
  }
  words.forEach((word, index) => {
    if (cur) {
      const joined = `${cur.text} ${word.text}`
      const gap = word.start - cur.end > maxGap
      let tooLong = joined.length > maxChars
      if (tooLong) {
        // Не оставляем на следующей подписи одно-два последних слова предложения.
        const tail = wordsToSentenceEnd(index)
        const rest = words
          .slice(index, index + tail)
          .map((w) => w.text)
          .join(' ')
        if (tail <= 2 && `${cur.text} ${rest}`.length <= maxChars * 1.45) tooLong = false
      }
      if (gap || tooLong) flush()
    }
    if (!cur) cur = { start: word.start, end: word.end, text: word.text }
    else {
      cur.end = word.end
      cur.text += ` ${word.text}`
    }
    if (SENTENCE_END.test(word.text)) flush()
  })
  flush()
  return cues.map((cue, index) => {
    const next = cues[index + 1]
    const end = round3(cue.end + hold)
    return { start: cue.start, end: next ? Math.min(end, next.start) : end, text: cue.text }
  })
}
