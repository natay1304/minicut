// Ограниченный запуск ffmpeg для Claude: он описывает входы, фильтры и выход, а команду собираем мы.
// Нет оболочки, нет сети, нет файловых фильтров; пути только внутри разрешённых папок.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { runJob, round3 } from '../ffmpeg.js'
import { VIDEO_EXT, checkPath } from '../paths.js'
import { getProject } from './history.js'
import { OpError, findMedia, importMedia, mustNum } from './project.js'
import { PROBE_EXT, probeFile } from './tools.js'

export const RUN_OUTPUT_EXT = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.gif',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
])

const VIDEO_CODECS = new Set(['libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'mjpeg', 'png', 'gif', 'copy'])
const AUDIO_CODECS = new Set(['aac', 'libmp3lame', 'pcm_s16le', 'flac', 'libopus', 'copy'])
const PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'])
const PIX_FMTS = new Set(['yuv420p', 'yuv422p', 'yuv444p', 'yuva420p', 'rgba', 'gray'])
const GENERATORS = new Set([
  'color',
  'nullsrc',
  'testsrc',
  'testsrc2',
  'smptebars',
  'gradients',
  'sine',
  'anullsrc',
])

// Фильтры, которые читают чужие файлы или управляются снаружи. Остальные считаем безопасными.
const DENIED_FILTERS = new Set([
  'movie',
  'amovie',
  'subtitles',
  'ass',
  'sendcmd',
  'asendcmd',
  'zmq',
  'azmq',
  'lut3d',
  'haldclut',
  'ocr',
  'libplacebo',
  'sofalizer',
  'afir',
])
const DENIED_OPTIONS = /(^|[:=,|])\s*(textfile|fontfile|filename|reload|script|file)\s*=/i
const DENIED_TEXT = /(https?|ftp|rtmp|rtsp|tcp|udp|pipe|file|concat|subfile|data|crypto|gopher):/i

const MAX_INPUTS = 8
const MAX_GRAPH = 8000

/** Делит строку фильтров по разделителям вне кавычек и экранирования. */
function splitTop(text, separators) {
  const parts = []
  let current = ''
  let quote = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      current += ch + (text[i + 1] ?? '')
      i++
      continue
    }
    if (ch === "'") quote = !quote
    if (!quote && ch === '[') depth++
    if (!quote && ch === ']') depth = Math.max(0, depth - 1)
    if (!quote && depth === 0 && separators.includes(ch)) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts
}

/** Проверяет строку фильтров. Бросает OpError, если фильтр запрещён или есть признаки чтения файлов и сети. */
export function checkFilterGraph(text, label = 'filterComplex') {
  if (typeof text !== 'string' || !text.trim()) throw new OpError(`${label}: пустая строка`)
  if (text.length > MAX_GRAPH) throw new OpError(`${label} слишком длинный`)
  if (DENIED_TEXT.test(text)) throw new OpError(`${label}: протоколы и пути вида file:, http: запрещены`)
  if (/[\0\r]/.test(text)) throw new OpError(`${label}: недопустимые символы`)
  for (const chain of splitTop(text, [';'])) {
    for (const segment of splitTop(chain, [','])) {
      const bare = segment.replace(/\[[^\]]*\]/g, '').trim()
      if (!bare) continue
      const name = bare.split('=')[0].split('@')[0].trim().toLowerCase()
      if (!/^[a-z0-9_]+$/.test(name)) throw new OpError(`${label}: непонятное имя фильтра «${name}»`)
      if (DENIED_FILTERS.has(name))
        throw new OpError(`Фильтр ${name} запрещён (читает файлы или выполняет команды)`)
      if (DENIED_OPTIONS.test(bare.slice(name.length))) {
        throw new OpError(
          `${label}: параметры, читающие файлы (textfile, fontfile, filename, reload), запрещены`,
        )
      }
    }
  }
  return text.trim()
}

function checkMap(value) {
  const text = String(value)
  if (!/^(\d{1,2}(:[avs](:\d{1,2})?)?|\[[A-Za-z0-9_]{1,32}\])$/.test(text)) {
    throw new OpError(`map «${text}»: используйте 0:v, 1:a:0 или [метка]`)
  }
  return text
}

function checkGenerator(text) {
  checkFilterGraph(text, 'lavfi')
  const first = text.trim().split(/[=:]/)[0].toLowerCase()
  if (!GENERATORS.has(first)) {
    throw new OpError(`lavfi: источник «${first}» не разрешён (${[...GENERATORS].join(', ')})`)
  }
  if (text.includes(',') || text.includes(';')) throw new OpError('lavfi: только один источник без цепочки')
  return text.trim()
}

function boundedNumber(value, label, min, max) {
  const n = mustNum(value, label)
  if (n < min || n > max) throw new OpError(`${label} должен быть от ${min} до ${max}`)
  return n
}

function oneOf(value, set, label) {
  if (!set.has(value)) throw new OpError(`${label}: допустимо ${[...set].join(', ')}`)
  return value
}

/** Собирает и проверяет аргументы ffmpeg. Возвращает { args, output, inputs }. */
export function buildRunArgs(options = {}, project = getProject()) {
  const inputsIn = Array.isArray(options.inputs) ? options.inputs : []
  if (!inputsIn.length || inputsIn.length > MAX_INPUTS) {
    throw new OpError(`inputs: от 1 до ${MAX_INPUTS} входов`)
  }
  const mediaPaths = new Set(project.media.map((item) => path.resolve(item.path)))
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
  const used = []
  for (const input of inputsIn) {
    if (!input || typeof input !== 'object') throw new OpError('Вход должен быть объектом')
    if (input.lavfi != null) {
      args.push('-f', 'lavfi', '-i', checkGenerator(String(input.lavfi)))
      continue
    }
    let file
    if (input.mediaId != null) file = findMedia(project.media, input.mediaId).path
    else {
      file = checkPath(String(input.path ?? ''), { extensions: PROBE_EXT, label: 'Вход' })
      if (!existsSync(file) || !statSync(file).isFile()) throw new OpError(`Файл не найден: ${file}`)
    }
    used.push(path.resolve(file))
    args.push('-protocol_whitelist', 'file')
    if (input.ss != null) args.push('-ss', String(boundedNumber(input.ss, 'ss', 0, 86400)))
    if (input.t != null) args.push('-t', String(boundedNumber(input.t, 't', 0.01, 86400)))
    if (input.loop === true) args.push('-loop', '1')
    args.push('-i', file)
  }

  if (options.filterComplex != null && (options.vf != null || options.af != null)) {
    throw new OpError('Используйте либо filterComplex, либо vf и af')
  }
  if (options.filterComplex != null) args.push('-filter_complex', checkFilterGraph(options.filterComplex))
  for (const map of options.maps ?? []) args.push('-map', checkMap(map))

  const out = options.output
  if (!out || typeof out !== 'object') throw new OpError('output: укажите path и параметры')
  const target = checkPath(String(out.path ?? ''), { extensions: RUN_OUTPUT_EXT, label: 'Выходной файл' })
  if (used.includes(target)) throw new OpError('Выходной файл совпадает с входным')
  if (mediaPaths.has(target)) throw new OpError('Нельзя перезаписать исходник проекта')
  if (existsSync(target) && options.overwrite !== true) {
    throw new OpError(`Файл уже существует: ${target}. Выберите другое имя или передайте overwrite: true`)
  }
  if (out.noVideo) args.push('-vn')
  if (out.noAudio) args.push('-an')
  if (options.vf != null) args.push('-vf', checkFilterGraph(options.vf, 'vf'))
  if (options.af != null) args.push('-af', checkFilterGraph(options.af, 'af'))
  if (out.videoCodec != null) args.push('-c:v', oneOf(out.videoCodec, VIDEO_CODECS, 'videoCodec'))
  if (out.audioCodec != null) args.push('-c:a', oneOf(out.audioCodec, AUDIO_CODECS, 'audioCodec'))
  if (out.crf != null) args.push('-crf', String(Math.round(boundedNumber(out.crf, 'crf', 0, 51))))
  if (out.preset != null) args.push('-preset', oneOf(out.preset, PRESETS, 'preset'))
  if (out.pixFmt != null) args.push('-pix_fmt', oneOf(out.pixFmt, PIX_FMTS, 'pixFmt'))
  if (out.fps != null) args.push('-r', String(boundedNumber(out.fps, 'fps', 1, 120)))
  if (out.videoBitrate != null) {
    if (!/^\d{2,5}k$/.test(String(out.videoBitrate))) throw new OpError('videoBitrate вида 4000k')
    args.push('-b:v', String(out.videoBitrate))
  }
  if (out.audioBitrate != null) {
    if (!/^\d{2,4}k$/.test(String(out.audioBitrate))) throw new OpError('audioBitrate вида 192k')
    args.push('-b:a', String(out.audioBitrate))
  }
  if (out.duration != null) args.push('-t', String(boundedNumber(out.duration, 'duration', 0.01, 86400)))
  if (out.frames != null)
    args.push('-frames:v', String(Math.round(boundedNumber(out.frames, 'frames', 1, 100000))))
  if (/\.(mp4|mov|m4a)$/i.test(target)) args.push('-movflags', '+faststart')
  args.push('-y', target)
  return { args, output: target, inputs: used }
}

/** Запускает проверенный ffmpeg и при importAs: true добавляет видеорезультат в медиатеку. */
export async function ffmpegRun(options = {}) {
  const plan = buildRunArgs(options)
  const timeoutMin =
    options.timeoutMinutes == null ? 20 : boundedNumber(options.timeoutMinutes, 'timeoutMinutes', 1, 120)
  try {
    await runJob(plan.args, { output: plan.output, timeoutMs: timeoutMin * 60000 })
  } catch (err) {
    if (err.cancelled) throw new OpError('Задача отменена')
    throw new OpError(`ffmpeg: ${err.message}`, 500)
  }
  const result = { output: plan.output, sizeBytes: statSync(plan.output).size }
  try {
    const info = await probeFile({ path: plan.output })
    result.duration = info.duration
    result.streams = info.streams.map(
      (s) => `${s.type}:${s.codec}${s.width ? ` ${s.width}x${s.height}` : ''}`,
    )
  } catch {
    // у картинок и некоторых контейнеров длительности нет
  }
  if (options.importAs === true) {
    if (!VIDEO_EXT.has(path.extname(plan.output).toLowerCase())) {
      result.imported = null
      result.note = 'Импорт в проект возможен только для видеофайлов'
    } else {
      result.imported = await importMedia(plan.output)
    }
  }
  result.duration = result.duration == null ? undefined : round3(result.duration)
  return result
}

// Фильтры клипа не должны менять длительность или число кадров: длина клипа на таймлайне считается заранее.
const CLIP_DENIED = new Set([
  'trim',
  'atrim',
  'setpts',
  'asetpts',
  'fps',
  'loop',
  'aloop',
  'reverse',
  'areverse',
  'tpad',
  'apad',
  'concat',
  'framestep',
  'select',
  'aselect',
  'atempo',
  'minterpolate',
  'overlay',
  'amix',
  'amerge',
  'join',
  'movie',
])

/** Проверяет цепочку фильтров клипа (video или audio). Пустая строка и null означают «без фильтров». */
export function checkClipFilters(text, label) {
  if (text == null || text === '') return null
  const chain = checkFilterGraph(String(text), label)
  if (chain.length > 1000) throw new OpError(`${label} слишком длинный (не больше 1000 символов)`)
  if (/[;[\]]/.test(chain)) throw new OpError(`${label}: только одна цепочка без меток и точек с запятой`)
  for (const segment of splitTop(chain, [','])) {
    const name = segment.split('=')[0].split('@')[0].trim().toLowerCase()
    if (CLIP_DENIED.has(name)) {
      throw new OpError(
        `${label}: фильтр ${name} недоступен на клипе (меняет длительность; для скорости есть speed)`,
      )
    }
  }
  return chain
}
