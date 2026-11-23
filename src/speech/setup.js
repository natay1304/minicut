// Установка whisper.cpp и модели. Используется командой npm run setup:speech.
// macOS: Homebrew. Windows: готовый архив с GitHub Releases. Linux: подсказка по сборке.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DEFAULT_MODEL, binDir, findWhisperBinary, modelFile, modelsDir } from './engine.js'

const RELEASES_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'
export const RELEASES_PAGE = 'https://github.com/ggml-org/whisper.cpp/releases'

export const MODEL_SIZES = {
  tiny: '~75 МБ',
  base: '~140 МБ',
  small: '~470 МБ',
  medium: '~1,5 ГБ',
  'large-v3': '~3 ГБ',
  'large-v3-turbo': '~1,6 ГБ',
  'large-v3-turbo-q5_0': '~570 МБ',
}

export function modelUrl(name = DEFAULT_MODEL) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Некорректное имя модели')
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`
}

/** Выбирает из ассетов релиза архив whisper.cpp для Windows x64 без CUDA и BLAS. */
export function pickWindowsAsset(assets) {
  const names = (assets || []).map((asset) => ({
    name: String(asset.name || ''),
    url: asset.browser_download_url,
  }))
  const plain = names.filter(
    (a) => /x64\.zip$/i.test(a.name) && !/cublas|cuda|blas|vulkan|openblas/i.test(a.name),
  )
  return (
    plain.find((a) => /^whisper-bin-x64\.zip$/i.test(a.name)) ||
    plain.find((a) => /bin/i.test(a.name)) ||
    plain[0] ||
    null
  )
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...options })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} завершился с кодом ${code}`)),
    )
  })
}

function hasCommand(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    const child = spawn(probe, [cmd], { stdio: 'ignore', windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

export async function downloadFile(url, dest, { onProgress } = {}) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'minicut-setup' } })
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let done = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    done += chunk.length
    if (onProgress) onProgress(done, total)
  })
  try {
    await pipeline(body, createWriteStream(part))
    if (total && statSync(part).size !== total) throw new Error('Файл скачан не полностью')
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

async function extractZip(zip, dest) {
  mkdirSync(dest, { recursive: true })
  if (process.platform === 'win32') {
    try {
      await run('tar', ['-xf', zip, '-C', dest])
      return
    } catch {
      await run('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
      ])
      return
    }
  }
  await run('unzip', ['-o', zip, '-d', dest])
}

/** Ставит программу whisper.cpp. Возвращает путь к ней. Ничего не делает, если она уже есть. */
export async function installBinary({ log = console.log } = {}) {
  const existing = findWhisperBinary()
  if (existing) {
    log(`whisper.cpp уже есть: ${existing.file}`)
    return existing.file
  }
  if (process.platform === 'darwin') {
    if (!(await hasCommand('brew'))) {
      throw new Error(
        'Нужен Homebrew (https://brew.sh). Поставьте его и повторите команду, либо соберите whisper.cpp сами и укажите путь в MINICUT_WHISPER_BIN.',
      )
    }
    log('Ставлю whisper.cpp через Homebrew (brew install whisper-cpp)…')
    await run('brew', ['install', 'whisper-cpp'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } })
  } else if (process.platform === 'win32') {
    log('Ищу архив whisper.cpp для Windows на GitHub…')
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': 'minicut-setup', Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub вернул HTTP ${res.status}. Скачайте архив вручную: ${RELEASES_PAGE}`)
    const release = await res.json()
    const asset = pickWindowsAsset(release.assets)
    if (!asset) {
      throw new Error(
        `В релизе ${release.tag_name} нет подходящего архива для Windows x64. Скачайте программу вручную (${RELEASES_PAGE}), распакуйте в ${binDir()} или укажите путь в MINICUT_WHISPER_BIN.`,
      )
    }
    log(`Скачиваю ${asset.name} (${release.tag_name})…`)
    const zip = path.join(binDir(), asset.name)
    await downloadFile(asset.url, zip, { onProgress: progressPrinter(log) })
    log('Распаковываю…')
    await extractZip(zip, binDir())
    rmSync(zip, { force: true })
  } else {
    throw new Error(
      [
        'На Linux whisper.cpp нужно собрать (нужны git, cmake и компилятор):',
        '  git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp',
        '  cmake -B build && cmake --build build -j --config Release',
        'Затем укажите путь к build/bin/whisper-cli в переменной MINICUT_WHISPER_BIN и повторите команду.',
      ].join('\n'),
    )
  }
  const found = findWhisperBinary()
  if (!found) throw new Error('Установка завершилась, но whisper-cli не найден')
  log(`Готово: ${found.file}`)
  return found.file
}

function progressPrinter(log) {
  let last = -1
  return (done, total) => {
    if (!total) return
    const pct = Math.floor((done / total) * 100)
    if (pct >= last + 10) {
      last = pct
      log(`  ${pct}% (${(done / 1048576).toFixed(0)} из ${(total / 1048576).toFixed(0)} МБ)`)
    }
  }
}

/** Скачивает модель ggml. Ничего не делает, если файл уже есть. */
export async function installModel(name = DEFAULT_MODEL, { log = console.log } = {}) {
  const file = modelFile(name)
  if (existsSync(file)) {
    log(`Модель уже есть: ${file}`)
    return file
  }
  mkdirSync(modelsDir(), { recursive: true })
  log(
    `Скачиваю модель ${name} ${MODEL_SIZES[name] ? `(${MODEL_SIZES[name]}) ` : ''}с huggingface.co/ggerganov/whisper.cpp…`,
  )
  await downloadFile(modelUrl(name), file, { onProgress: progressPrinter(log) })
  log(`Готово: ${file}`)
  return file
}
