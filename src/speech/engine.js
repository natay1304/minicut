// Запуск whisper.cpp: поиск программы и модели, извлечение звука, расшифровка с прогрессом.
// Работает на macOS, Windows и Linux. Программа и модели лежат в папке пользователя (MINICUT_HOME),
// а не в проекте, чтобы тяжёлые файлы не скачивались заново для каждой копии minicut.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_MODEL = 'large-v3-turbo-q5_0'
const EXE = process.platform === 'win32' ? '.exe' : ''
const BIN_NAMES = ['whisper-cli', 'whisper-cpp']

export class SpeechError extends Error {
  constructor(message, code = 'speech_error', status = 400) {
    super(message)
    this.name = 'SpeechError'
    this.code = code
    this.status = status
  }
}

export function speechHome() {
  const base = process.env.MINICUT_HOME
    ? path.resolve(process.env.MINICUT_HOME)
    : path.join(os.homedir(), '.minicut')
  return path.join(base, 'speech')
}

export const binDir = () => path.join(speechHome(), 'bin')
export const modelsDir = () => path.join(speechHome(), 'models')
export const modelFile = (name = DEFAULT_MODEL) => path.join(modelsDir(), `ggml-${name}.bin`)

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

// Ищет файл по имени в папке и её подпапках (в архивах для Windows программа лежит глубже).
function findInDir(root, names, depth = 4) {
  if (depth < 0 || !existsSync(root)) return null
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isFile() && names.some((name) => entry.name.toLowerCase() === `${name}${EXE}`)) {
      return path.join(root, entry.name)
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findInDir(path.join(root, entry.name), names, depth - 1)
      if (found) return found
    }
  }
  return null
}

function findOnPath(names) {
  const extra = process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...extra]
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, `${name}${EXE}`)
      if (isFile(file)) return file
    }
  }
  return null
}

/** Программа whisper.cpp: переменная MINICUT_WHISPER_BIN, папка minicut, затем PATH. */
export function findWhisperBinary() {
  const fromEnv = process.env.MINICUT_WHISPER_BIN
  if (fromEnv) return isFile(fromEnv) ? { file: fromEnv, source: 'env' } : null
  const local = findInDir(binDir(), BIN_NAMES)
  if (local) return { file: local, source: 'minicut' }
  const system = findOnPath(BIN_NAMES)
  return system ? { file: system, source: 'path' } : null
}

/** Модель ggml: переменная MINICUT_WHISPER_MODEL (путь) или файл в папке моделей. */
export function findModel(name = DEFAULT_MODEL) {
  const fromEnv = process.env.MINICUT_WHISPER_MODEL
  if (fromEnv) return isFile(fromEnv) ? { file: fromEnv, name: path.basename(fromEnv) } : null
  const file = modelFile(name)
  return isFile(file) ? { file, name } : null
}

export function setupHint() {
  return 'Выполните в папке minicut: npm run setup:speech (установит whisper.cpp и скачает модель, около 0,5 ГБ).'
}

export function speechStatus(name = DEFAULT_MODEL) {
  const bin = findWhisperBinary()
  const model = findModel(name)
  const missing = []
  if (!bin) missing.push('whisper.cpp')
  if (!model) missing.push(`модель ${name}`)
  return {
    ready: missing.length === 0,
    bin: bin?.file || null,
    binSource: bin?.source || null,
    model: model?.file || null,
    missing,
    hint: missing.length ? setupHint() : null,
  }
}

function runProcess(cmd, args, { onStderr, track } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    if (track) track(child)
    let stderr = ''
    child.stdout.resume()
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr = (stderr + text).slice(-20000)
      if (onStderr) onStderr(text)
    })
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new SpeechError(`${cmd} не найден`, 'binary_missing') : err),
    )
    child.on('close', (code, signal) => resolve({ code, signal, stderr }))
  })
}

/** Вытаскивает звук в mono 16 кГц WAV: в таком виде его ждёт whisper.cpp. */
export async function extractAudio(mediaPath, wavPath) {
  const { code, stderr } = await runProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    mediaPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    wavPath,
  ])
  if (code !== 0)
    throw new SpeechError(`ffmpeg не смог извлечь звук: ${stderr.trim().slice(-300)}`, 'audio_failed', 500)
}

let active = null

export function cancelWhisper() {
  if (!active) return false
  active.cancelled = true
  active.child?.kill()
  return true
}

export function whisperBusy() {
  return Boolean(active)
}

/**
 * Расшифровывает WAV. Возвращает разобранный JSON whisper.cpp.
 * onProgress получает проценты 0..100.
 */
export async function runWhisper({
  wavPath,
  workDir,
  language = 'auto',
  model = DEFAULT_MODEL,
  prompt,
  onProgress,
}) {
  if (active) throw new SpeechError('Расшифровка уже идёт', 'busy', 409)
  const status = speechStatus(model)
  if (!status.ready) {
    throw new SpeechError(
      `Не установлено: ${status.missing.join(', ')}. ${setupHint()}`,
      'not_installed',
      424,
    )
  }
  mkdirSync(workDir, { recursive: true })
  const outBase = path.join(workDir, 'result')
  const threads = Math.max(1, Math.min(8, os.cpus().length - 1))
  const args = [
    '-m',
    status.model,
    '-f',
    wavPath,
    '-l',
    language,
    '-oj',
    '-of',
    outBase,
    '-ml',
    '1',
    '-sow',
    '-pp',
    '-t',
    String(threads),
  ]
  if (prompt) args.push('--prompt', String(prompt))
  active = { child: null, cancelled: false }
  const state = active
  try {
    const { code, stderr } = await runProcess(status.bin, args, {
      track: (child) => {
        state.child = child
      },
      onStderr: (text) => {
        const match = [...text.matchAll(/progress\s*=\s*(\d+)%/g)].pop()
        if (match && onProgress) onProgress(Number(match[1]))
      },
    })
    if (state.cancelled) throw new SpeechError('Расшифровка отменена', 'cancelled', 499)
    if (code !== 0) {
      throw new SpeechError(
        `whisper.cpp завершился с ошибкой: ${stderr.trim().slice(-400)}`,
        'whisper_failed',
        500,
      )
    }
    const jsonFile = `${outBase}.json`
    if (!existsSync(jsonFile))
      throw new SpeechError('whisper.cpp не создал файл результата', 'whisper_failed', 500)
    return JSON.parse(readFileSync(jsonFile, 'utf8'))
  } finally {
    active = null
    try {
      rmSync(outBase + '.json', { force: true })
    } catch {
      // временный файл мог уже отсутствовать
    }
  }
}
