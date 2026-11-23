// Инструменты для Claude: данные о файле, кадр из файла и справка по ffmpeg. Только чтение.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { capture, round3 } from '../ffmpeg.js'
import { VIDEO_EXT, checkPath } from '../paths.js'
import { dataRoot, getProject } from './history.js'
import { OpError, findMedia, mustNum } from './project.js'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
export const PROBE_EXT = new Set([...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT])

function fileFrom(options, extensions) {
  if (options.mediaId != null) return findMedia(getProject().media, options.mediaId).path
  if (typeof options.path !== 'string' || !options.path.trim()) throw new OpError('Укажите path или mediaId')
  const abs = checkPath(options.path, { extensions, label: 'Файл' })
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new OpError(`Файл не найден: ${abs}`)
  return abs
}

function rate(value) {
  if (!value || value === '0/0') return undefined
  const [a, b] = String(value).split('/').map(Number)
  return Number.isFinite(a) && a > 0 ? round3(b ? a / b : a) : undefined
}

/** Сводка ffprobe по файлу: формат и дорожки. */
export async function probeFile(options = {}) {
  const file = fileFrom(options, PROBE_EXT)
  let data
  try {
    const { stdout } = await capture('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ])
    data = JSON.parse(stdout)
  } catch (err) {
    throw new OpError(`Не удалось прочитать файл: ${err.message}`, 500)
  }
  const format = data.format ?? {}
  return {
    path: file,
    format: String(format.format_name ?? ''),
    duration: format.duration == null ? undefined : round3(format.duration),
    sizeBytes: format.size == null ? undefined : Number(format.size),
    bitRate: format.bit_rate == null ? undefined : Number(format.bit_rate),
    streams: (data.streams ?? []).map((s) => ({
      index: s.index,
      type: s.codec_type,
      codec: s.codec_name,
      profile: s.profile,
      width: s.width,
      height: s.height,
      fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
      pixFmt: s.pix_fmt,
      sampleRate: s.sample_rate == null ? undefined : Number(s.sample_rate),
      channels: s.channels,
      duration: s.duration == null ? undefined : round3(s.duration),
      bitRate: s.bit_rate == null ? undefined : Number(s.bit_rate),
      rotation: s.side_data_list?.find((item) => item.rotation != null)?.rotation,
      language: s.tags?.language,
    })),
  }
}

function frameWidth(value) {
  const width = value == null ? 540 : Math.round(mustNum(value, 'width'))
  if (width < 120 || width > 1080) throw new OpError('width должен быть от 120 до 1080')
  return width
}

/** Кадр из файла или медиа проекта на секунде time (по исходному файлу), JPEG в base64. */
export async function mediaFrame(options = {}) {
  const file = fileFrom(options, new Set([...VIDEO_EXT, ...IMAGE_EXT]))
  const time = options.time == null ? 0 : mustNum(options.time, 'time')
  if (time < 0) throw new OpError('time не может быть отрицательным')
  const width = frameWidth(options.width)
  const tmp = path.join(dataRoot(), 'tmp', `${randomBytes(6).toString('hex')}.jpg`)
  mkdirSync(path.dirname(tmp), { recursive: true })
  try {
    await capture('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(time),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:-2`,
      '-q:v',
      '3',
      tmp,
    ])
    if (!existsSync(tmp)) throw new OpError('В этой точке нет кадра (время больше длительности?)')
    return { mimeType: 'image/jpeg', time, width, data: readFileSync(tmp).toString('base64') }
  } catch (err) {
    if (err instanceof OpError) throw err
    throw new OpError(`Не удалось получить кадр: ${err.message}`, 500)
  } finally {
    rmSync(tmp, { force: true })
  }
}

export { frameWidth }

const HELP_KINDS = {
  filters: ['-filters'],
  encoders: ['-encoders'],
  decoders: ['-decoders'],
  formats: ['-formats'],
  pix_fmts: ['-pix_fmts'],
}
const HELP_LIMIT = 160

/**
 * Справка по ffmpeg из вашей сборки: списки фильтров, кодеков, форматов или параметры одного фильтра.
 * kind: filters | encoders | decoders | formats | pix_fmts | filter (нужен name).
 */
export async function ffmpegHelp(options = {}) {
  const kind = options.kind ?? 'filters'
  let args
  if (kind === 'filter') {
    const name = String(options.name ?? '')
    if (!/^[a-z0-9_]{1,40}$/.test(name)) throw new OpError('Укажите name фильтра (латиница, цифры, _)')
    args = ['-hide_banner', '-h', `filter=${name}`]
  } else if (HELP_KINDS[kind]) {
    args = ['-hide_banner', ...HELP_KINDS[kind]]
  } else {
    throw new OpError(`kind: filters, encoders, decoders, formats, pix_fmts или filter`)
  }
  let text
  try {
    const out = await capture('ffmpeg', args)
    text = out.stdout || out.stderr
  } catch (err) {
    throw new OpError(`ffmpeg не ответил: ${err.message}`, 500)
  }
  let lines = text.split(/\r?\n/).filter((line) => line.trim())
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  if (query && kind !== 'filter') lines = lines.filter((line) => line.toLowerCase().includes(query))
  const total = lines.length
  return { kind, total, shown: Math.min(total, HELP_LIMIT), text: lines.slice(0, HELP_LIMIT).join('\n') }
}
