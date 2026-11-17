import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { round3 } from '../ffmpeg.js'
import { SUBTITLE_EXT, checkPath } from '../paths.js'
import { commit } from './history.js'
import { OpError, defaultStyle, findMedia, hasPathChars, mustNum, nextId, normalizeStyle } from './project.js'

function cueFrom(draft, fields, current = {}) {
  const start = fields.start === undefined ? current.start : round3(mustNum(fields.start, 'start'))
  const end = fields.end === undefined ? current.end : round3(mustNum(fields.end, 'end'))
  const text = fields.text === undefined ? current.text : fields.text
  const style = fields.style === undefined ? current.style || 'sub' : fields.style
  if (typeof text !== 'string' || !text.trim()) throw new OpError('Пустой текст')
  if (typeof style !== 'string' || !draft.styles[style]) throw new OpError(`Стиль не найден: ${style}`)
  if (!(end > start) || start < 0) throw new OpError('Некорректный интервал подписи')
  return { start, end, text, style }
}

export function addText(fields = {}) {
  return commit((draft) => {
    const cue = { id: nextId(draft.texts, 't'), ...cueFrom(draft, fields) }
    draft.texts.push(cue)
    return cue
  })
}

export function setText(id, patch = {}) {
  return commit((draft) => {
    const cue = draft.texts.find((item) => item.id === id)
    if (!cue) throw new OpError(`Подпись не найдена: ${id}`)
    Object.assign(cue, cueFrom(draft, patch, cue))
    return cue
  })
}

export function removeText(id) {
  return commit((draft) => {
    const index = draft.texts.findIndex((item) => item.id === id)
    if (index < 0) throw new OpError(`Подпись не найдена: ${id}`)
    const [removed] = draft.texts.splice(index, 1)
    return removed
  })
}

export function setStyle(name, patch = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new OpError('Не указано имя стиля')
  const key = name.trim()
  if (key.length > 40 || hasPathChars(key)) throw new OpError('Некорректное имя стиля')
  if (!patch || typeof patch !== 'object') throw new OpError('Параметры стиля должны быть объектом')
  return commit((draft) => {
    const prev = draft.styles[key] || defaultStyle()
    const shadow = patch.shadow && typeof patch.shadow === 'object' ? patch.shadow : {}
    draft.styles[key] = normalizeStyle({
      font: patch.font ?? prev.font,
      weight: patch.weight ?? prev.weight,
      size: patch.size ?? prev.size,
      color: patch.color ?? prev.color,
      x: patch.x ?? prev.x,
      y: patch.y ?? prev.y,
      align: patch.align ?? prev.align,
      shadow: { ...prev.shadow, ...shadow },
    })
    return draft.styles[key]
  })
}

function parseClock(raw) {
  const match = /(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(String(raw).trim())
  if (!match) throw new OpError(`Некорректное время: ${raw}`)
  const frac = match[4] ? Number(match[4]) / 10 ** match[4].length : 0
  return round3(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + frac)
}

function parseSrt(content) {
  const cues = []
  const blocks = content
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const timeIdx = lines.findIndex((line) => line.includes('-->'))
    if (timeIdx < 0) continue
    const match = /(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})/.exec(
      lines[timeIdx],
    )
    if (!match) continue
    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .trim()
    if (!text) continue
    cues.push({ start: parseClock(match[1]), end: parseClock(match[2]), text })
  }
  return cues
}

function parseAss(content) {
  const cues = []
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(line)) continue
    const parts = line.replace(/^Dialogue:\s*/i, '').split(',')
    if (parts.length < 10) continue
    let text = parts.slice(9).join(',')
    text = text
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ start: parseClock(parts[1]), end: parseClock(parts[2]), text })
  }
  return cues
}

export function importSubtitles(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new OpError('Не указан путь к файлу')
  const abs = checkPath(filePath, { extensions: SUBTITLE_EXT, label: 'Файл субтитров' })
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new OpError(`Файл не найден: ${abs}`)
  const ext = path.extname(abs).toLowerCase()
  const content = readFileSync(abs, 'utf8')
  let cues
  if (ext === '.srt') cues = parseSrt(content)
  else if (ext === '.ass' || ext === '.ssa') cues = parseAss(content)
  else throw new OpError('Нужен файл .srt или .ass')
  if (!cues.length) throw new OpError('В файле нет реплик')
  return commit((draft) => {
    const added = []
    for (const cue of cues) {
      if (!(cue.end > cue.start)) continue
      const item = { id: nextId(draft.texts, 't'), ...cue, style: 'sub' }
      draft.texts.push(item)
      added.push(item)
    }
    if (!added.length) throw new OpError('В файле нет реплик')
    return added
  })
}

export function importTranscript(mediaId, words) {
  if (!Array.isArray(words)) throw new OpError('words должен быть массивом')
  const clean = words.map((word, index) => {
    if (!word || typeof word !== 'object') throw new OpError(`Некорректное слово #${index + 1}`)
    const start = round3(mustNum(word.start, 'start'))
    const end = round3(mustNum(word.end, 'end'))
    if (!(end > start)) throw new OpError(`У слова #${index + 1} пустой интервал`)
    if (typeof word.text !== 'string') throw new OpError(`У слова #${index + 1} нет текста`)
    return { start, end, text: word.text }
  })
  return commit((draft) => {
    const media = findMedia(draft.media, mediaId)
    media.words = clean
    return clean
  })
}
