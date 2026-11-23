import { spawn } from 'node:child_process'
import { mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

function tail(prev, chunk, max = 2_000_000) {
  const next = prev + chunk.toString()
  return next.length > max ? next.slice(-max) : next
}

/** Запускает программу без оболочки и возвращает { stdout, stderr }. */
export function capture(cmd, args) {
  return spawnProcess(cmd, args)
}

function spawnProcess(cmd, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      if (onStdout) onStdout(chunk.toString())
      else stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr = tail(stderr, chunk)
    })
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error(`${cmd} не найден в PATH`))
      else reject(err)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || `${cmd} завершился с кодом ${code}`
        reject(new Error(detail))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function parseFps(rate) {
  if (!rate || rate === '0/0') return null
  const [num, den] = String(rate).split('/').map(Number)
  if (!Number.isFinite(num) || num <= 0) return null
  const value = den ? num / den : num
  if (!Number.isFinite(value) || value <= 0) return null
  return round3(value)
}

// side data rotation=90/270 (и тег rotate) — это поворот дисплея, кадр хранится «лёжа».
function rotationOf(video) {
  const tags = video.tags ?? {}
  const raw = tags.rotate ?? tags.ROTATE
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  for (const item of video.side_data_list ?? []) {
    const n = Number(item?.rotation)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function quarterTurn(rotation) {
  const turns = ((rotation % 360) + 360) % 360
  return Math.abs(turns - 90) < 1 || Math.abs(turns - 270) < 1
}

export async function probe(filePath) {
  const { stdout } = await spawnProcess('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ])
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new Error('ffprobe вернул не JSON')
  }
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('В файле нет видеодорожки')
  const duration = Number(data.format?.duration ?? video.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Не удалось определить длительность')
  let width = Number(video.width)
  let height = Number(video.height)
  if (!width || !height) throw new Error('Не удалось определить размер кадра')
  if (quarterTurn(rotationOf(video))) {
    const stored = width
    width = height
    height = stored
  }
  return {
    duration: round3(duration),
    width,
    height,
    fps: parseFps(video.avg_frame_rate) ?? parseFps(video.r_frame_rate) ?? 30,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

export async function detectSilence(filePath, { noiseDb = -30, minDur = 0.4, duration } = {}) {
  const { stderr } = await spawnProcess('ffmpeg', [
    '-hide_banner',
    '-i',
    filePath,
    '-vn',
    '-af',
    `silencedetect=noise=${Number(noiseDb)}dB:d=${Number(minDur)}`,
    '-f',
    'null',
    '-',
  ])
  return parseSilence(stderr, duration)
}

function parseSilence(log, fileDuration) {
  const intervals = []
  let start = null
  for (const line of log.split(/\r?\n/)) {
    const opened = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/)
    if (opened) {
      start = Number(opened[1])
      continue
    }
    const closed = line.match(
      /silence_end:\s*(-?\d+(?:\.\d+)?)(?:\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?))?/,
    )
    if (closed && start != null) {
      const end = Number(closed[1])
      const dur = closed[2] != null ? Number(closed[2]) : end - start
      intervals.push({ start: round3(start), end: round3(end), duration: round3(dur) })
      start = null
    }
  }
  if (start != null && Number.isFinite(fileDuration) && fileDuration > start) {
    intervals.push({
      start: round3(start),
      end: round3(fileDuration),
      duration: round3(fileDuration - start),
    })
  }
  return intervals
}

function sec(n) {
  return round3(n).toFixed(3)
}

function px(n) {
  return (Math.round(Number(n) * 1000) / 1000).toFixed(3)
}

function evenDim(n) {
  const v = Math.max(2, Math.round(n))
  return v % 2 ? v + 1 : v
}

function fpsArg(fps) {
  const n = round3(fps)
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

// Запятая внутри выражения filtergraph разделяет фильтры, её нужно экранировать.
function esc(expr) {
  return expr.replaceAll(',', '\\,')
}

function evenPx(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return n - (n % 2)
}

// Прямоугольник области в чётных пикселях холста. Не вылезает за кадр.
function regionRect(region, width, height) {
  let w = evenPx(region.w * width)
  let h = evenPx(region.h * height)
  let x = evenPx(region.x * width)
  let y = evenPx(region.y * height)
  if (w < 2) w = 2
  if (h < 2) h = 2
  if (w > width) w = width
  if (h > height) h = height
  if (x > width - w) x = width - w
  if (y > height - h) y = height - h
  return { x, y, w, h }
}

// cover области, затем scale/x/y внутри неё. Снаружи области — чёрные или прозрачные поля.
function regionChain(input, clip, width, height, fps, shifted, alpha) {
  const rect = regionRect(clip.region, width, height)
  const scale = clip.scale > 0 ? clip.scale : 1
  const tw = evenDim(rect.w * scale)
  const th = evenDim(rect.h * scale)
  const dx = px((clip.x || 0) * rect.w)
  const dy = px((clip.y || 0) * rect.h)
  const cropW = esc(`min(iw,${rect.w})`)
  const cropH = esc(`min(ih,${rect.h})`)
  const cropX = esc(`if(lte(iw,${rect.w}),0,trunc(max(0,min(iw-${rect.w},(iw-${rect.w})/2-(${dx})))/2)*2)`)
  const cropY = esc(`if(lte(ih,${rect.h}),0,trunc(max(0,min(ih-${rect.h},(ih-${rect.h})/2-(${dy})))/2)*2)`)
  const padX = esc(`trunc(max(0,min(${rect.w}-iw,(${rect.w}-iw)/2+(${dx})))/2)*2`)
  const padY = esc(`trunc(max(0,min(${rect.h}-ih,(${rect.h}-ih)/2+(${dy})))/2)*2`)
  const fill = alpha ? 'black@0' : 'black'
  const chain = [
    `${input}trim=start=${sec(clip.in)}:end=${sec(clip.out)}`,
    videoPts(clip),
    ...(clip.vfilters ? [clip.vfilters] : []),
    `scale=${tw}:${th}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=bicubic`,
    'setsar=1',
    `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}'`,
  ]
  if (alpha) chain.push('format=rgba')
  chain.push(`pad=${rect.w}:${rect.h}:${padX}:${padY}:${fill}`)
  chain.push(`pad=${width}:${height}:${rect.x}:${rect.y}:${fill}`)
  chain.push(`fps=${fpsArg(fps)}`)
  chain.push(alpha ? 'format=rgba' : 'format=yuv420p')
  if (shifted) chain.push(`setpts=PTS-STARTPTS+${sec(clip.start || 0)}/TB`)
  return chain.join(',')
}

// scale 1 = cover холста (или области, если задан region); x/y — сдвиг от центра.
export function videoChain(input, clip, width, height, fps, shifted, alpha = false) {
  if (clip.region) return regionChain(input, clip, width, height, fps, shifted, alpha)
  const scale = clip.scale > 0 ? clip.scale : 1
  const tw = evenDim(width * scale)
  const th = evenDim(height * scale)
  const dx = px((clip.x || 0) * width)
  const dy = px((clip.y || 0) * height)
  const cropW = esc(`min(iw,${width})`)
  const cropH = esc(`min(ih,${height})`)
  const cropX = esc(`if(lte(iw,${width}),0,trunc(max(0,min(iw-${width},(iw-${width})/2-(${dx})))/2)*2)`)
  const cropY = esc(`if(lte(ih,${height}),0,trunc(max(0,min(ih-${height},(ih-${height})/2-(${dy})))/2)*2)`)
  const padX = esc(`trunc(max(0,min(${width}-iw,(${width}-iw)/2+(${dx})))/2)*2`)
  const padY = esc(`trunc(max(0,min(${height}-ih,(${height}-ih)/2+(${dy})))/2)*2`)
  const chain = [
    `${input}trim=start=${sec(clip.in)}:end=${sec(clip.out)}`,
    videoPts(clip),
    ...(clip.vfilters ? [clip.vfilters] : []),
    `scale=${tw}:${th}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=bicubic`,
    'setsar=1',
    `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}'`,
  ]
  if (alpha) chain.push('format=yuva420p')
  chain.push(`pad=${width}:${height}:${padX}:${padY}:${alpha ? 'black@0' : 'black'}`)
  chain.push(`fps=${fpsArg(fps)}`)
  chain.push(alpha ? 'format=yuva420p' : 'format=yuv420p')
  if (shifted) chain.push(`setpts=PTS-STARTPTS+${sec(clip.start || 0)}/TB`)
  return chain.join(',')
}

function speedOf(clip) {
  const speed = Number(clip.speed)
  return Number.isFinite(speed) && speed > 0 ? speed : 1
}

/** Длина клипа на таймлайне: исходный отрезок с учётом скорости. */
export function clipDuration(clip) {
  return (clip.out - clip.in) / speedOf(clip)
}

function videoPts(clip) {
  const speed = speedOf(clip)
  return speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${sec(speed)}`
}

// atempo принимает 0.5…100 (в старых сборках до 2), поэтому большие и малые значения идут цепочкой.
export function tempoChain(speed) {
  if (speed === 1) return []
  const steps = []
  let rest = speed
  while (rest > 2) {
    steps.push(2)
    rest /= 2
  }
  while (rest < 0.5) {
    steps.push(0.5)
    rest /= 0.5
  }
  steps.push(rest)
  return steps.map((step) => `atempo=${sec(step)}`)
}

function fadesFor(clip, dur) {
  const wantIn = clip.fadeIn > 0 ? clip.fadeIn : 0.02
  const wantOut = clip.fadeOut > 0 ? clip.fadeOut : 0.02
  let fadeIn = Math.min(wantIn, dur / 2)
  let fadeOut = Math.min(wantOut, Math.max(0, dur - fadeIn))
  if (fadeIn < 0.005) fadeIn = 0
  if (fadeOut < 0.005) fadeOut = 0
  return { fadeIn: round3(fadeIn), fadeOut: round3(fadeOut) }
}

function audioChain(inputIndex, clip, dur, delay) {
  if (clip.muted || !clip.hasAudio) {
    return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=start=0:end=${sec(dur)},asetpts=PTS-STARTPTS`
  }
  const fades = fadesFor(clip, dur)
  const parts = [
    `[${inputIndex}:a]atrim=start=${sec(clip.in)}:end=${sec(clip.out)}`,
    'asetpts=PTS-STARTPTS',
    ...tempoChain(speedOf(clip)),
    'asetpts=PTS-STARTPTS',
    ...(clip.afilters ? [clip.afilters] : []),
    `volume=${sec(clip.volume == null ? 1 : clip.volume)}`,
  ]
  if (fades.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${sec(fades.fadeIn)}`)
  if (fades.fadeOut > 0)
    parts.push(`afade=t=out:st=${sec(Math.max(0, dur - fades.fadeOut))}:d=${sec(fades.fadeOut)}`)
  parts.push('aformat=sample_rates=48000:channel_layouts=stereo')
  if (delay > 0) parts.push(`adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)}`)
  return parts.join(',')
}

function buildGraph(plan) {
  const { width, height, fps, duration, main, overlays, textList, loudnorm } = plan
  const audio = !plan.frame
  const frameScale = plan.frame?.width ? `,scale=${plan.frame.width}:-2` : ''
  const parts = []
  parts.push(`color=c=black:s=${width}x${height}:r=${fpsArg(fps)}:d=${sec(duration)},format=yuv420p[base]`)
  main.forEach((clip, index) => {
    const dur = clipDuration(clip)
    parts.push(`${videoChain(`[${index}:v]`, clip, width, height, fps, false)}[mv${index}]`)
    if (audio) parts.push(`${audioChain(index, clip, dur, 0)}[ma${index}]`)
  })
  parts.push(`${main.map((_, index) => `[mv${index}]`).join('')}concat=n=${main.length}:v=1:a=0[mainv]`)
  if (audio) {
    parts.push(`${main.map((_, index) => `[ma${index}]`).join('')}concat=n=${main.length}:v=0:a=1[maina]`)
  }
  parts.push('[base][mainv]overlay=0:0:eof_action=pass[v0]')

  let current = '[v0]'
  const overlayAudio = []
  overlays.forEach((clip, index) => {
    const input = main.length + index
    const dur = clipDuration(clip)
    const end = (clip.start || 0) + dur
    // ov/oa идут сквозным индексом по всем клипам всех оверлеев.
    // Прозрачные поля нужны, чтобы нижние дорожки были видны вокруг врезки.
    parts.push(`${videoChain(`[${input}:v]`, clip, width, height, fps, true, true)}[ov${index}]`)
    const next = `[v${index + 1}]`
    const enable = esc(`between(t,${sec(clip.start || 0)},${sec(end)})`)
    parts.push(`${current}[ov${index}]overlay=0:0:enable='${enable}':eof_action=pass${next}`)
    current = next
    if (audio && !clip.muted && clip.hasAudio) {
      parts.push(`${audioChain(input, clip, dur, clip.start || 0)}[oa${index}]`)
      overlayAudio.push(`[oa${index}]`)
    }
  })

  if (textList) {
    const input = main.length + overlays.length
    parts.push(`[${input}:v]fps=${fpsArg(fps)},format=rgba,setpts=PTS-STARTPTS[textv]`)
    parts.push(`${current}[textv]overlay=0:0:eof_action=pass,format=yuv420p${frameScale}[outv]`)
  } else {
    parts.push(`${current}format=yuv420p${frameScale}[outv]`)
  }
  if (!audio) return parts.join(';')

  if (overlayAudio.length) {
    parts.push(`[maina]apad=whole_dur=${sec(duration)}[maina2]`)
    const mix = ['[maina2]', ...overlayAudio].join('')
    parts.push(
      `${mix}amix=inputs=${overlayAudio.length + 1}:duration=longest:dropout_transition=0:normalize=0,atrim=start=0:end=${sec(duration)},asetpts=PTS-STARTPTS[mixa]`,
    )
  } else {
    parts.push(`[maina]apad=whole_dur=${sec(duration)},atrim=start=0:end=${sec(duration)}[mixa]`)
  }
  if (loudnorm) parts.push('[mixa]loudnorm=I=-16:TP=-1.5:LRA=11[outa]')
  else parts.push('[mixa]asetpts=PTS-STARTPTS[outa]')
  return parts.join(';')
}

// out_time_ms в -progress исторически задан в микросекундах, не в миллисекундах.
function timeFromProgress(block) {
  if (block.out_time_us != null && block.out_time_us !== 'N/A') return Number(block.out_time_us) / 1e6
  if (block.out_time_ms != null && block.out_time_ms !== 'N/A') return Number(block.out_time_ms) / 1e6
  if (block.out_time && block.out_time !== 'N/A') {
    const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(block.out_time)
    if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  }
  return null
}

function parseSpeed(value) {
  if (!value || value === 'N/A') return null
  const n = Number(String(value).replace(/x$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Один кадр проекта на момент plan.frame.time в JPEG (без звука). */
export async function renderFrame(plan, output) {
  mkdirSync(path.dirname(output), { recursive: true })
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  for (const clip of plan.main) args.push('-i', clip.path)
  for (const clip of plan.overlays) {
    if (/\.webm$/i.test(clip.path)) args.push('-c:v', 'libvpx-vp9')
    args.push('-i', clip.path)
  }
  if (plan.textList) args.push('-f', 'concat', '-safe', '0', '-i', plan.textList)
  args.push(
    '-filter_complex',
    buildGraph(plan),
    '-map',
    '[outv]',
    '-ss',
    sec(plan.frame.time),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    output,
  )
  await spawnProcess('ffmpeg', args)
  return { output }
}

/**
 * Запускает один произвольный (уже проверенный) вызов ffmpeg. Делит очередь с рендером:
 * одновременно работает только одна тяжёлая задача, её можно отменить через cancel_render.
 */
export function runJob(args, { output, timeoutMs = 20 * 60 * 1000 } = {}) {
  if (active) return Promise.reject(new Error('Экспорт или другая задача ffmpeg уже выполняется'))
  mkdirSync(path.dirname(output), { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    let finishWait = () => {}
    const finished = new Promise((done) => {
      finishWait = done
    })
    const job = { child, cancelled: false, finished, output }
    active = job
    const timer = setTimeout(() => {
      job.timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const settle = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (active === job) active = null
      if (err) removeFile(output)
      if (job.cancelled && err) {
        const error = new Error('Задача отменена')
        error.cancelled = true
        reject(error)
      } else if (job.timedOut) {
        reject(new Error(`Превышено время ожидания (${Math.round(timeoutMs / 60000)} мин)`))
      } else if (err) reject(err)
      else resolve({ output })
      finishWait({ cancelled: Boolean(job.cancelled && err) })
    }
    child.stderr.on('data', (chunk) => {
      stderr = tail(stderr, chunk, 20000)
    })
    child.on('error', (err) => settle(err.code === 'ENOENT' ? new Error('ffmpeg не найден в PATH') : err))
    child.on('close', (code) => {
      if (code === 0) settle(null)
      else
        settle(
          new Error(stderr.trim().split('\n').slice(-6).join('\n') || `ffmpeg завершился с кодом ${code}`),
        )
    })
  })
}

let active = null

export function requestCancel() {
  if (!active) return null
  active.cancelled = true
  if (active.child.exitCode == null && active.child.signalCode == null) active.child.kill('SIGKILL')
  return active.finished
}

function removeFile(file) {
  try {
    unlinkSync(file)
  } catch {
    // файла могло не появиться
  }
}

/** Параметры кодирования видео по выбранному кодеку. */
export function videoEncodeArgs(plan) {
  const codec = plan.videoCodec || 'libx264'
  const rate = plan.videoBitrate ? ['-b:v', plan.videoBitrate] : ['-crf', String(plan.crf)]
  if (codec === 'libx265') {
    return ['-c:v', 'libx265', '-preset', plan.preset, ...rate, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1']
  }
  if (codec === 'libvpx-vp9') {
    return [
      '-c:v',
      'libvpx-vp9',
      ...(plan.videoBitrate ? rate : ['-crf', String(plan.crf), '-b:v', '0']),
      '-pix_fmt',
      'yuv420p',
    ]
  }
  if (codec === 'prores_ks') return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
  return ['-c:v', 'libx264', '-preset', plan.preset, ...rate, '-pix_fmt', 'yuv420p']
}

export function audioEncodeArgs(plan) {
  const codec = plan.videoCodec || 'libx264'
  if (codec === 'libvpx-vp9') return ['-c:a', 'libopus', '-b:a', plan.audioBitrate]
  if (codec === 'prores_ks') return ['-c:a', 'pcm_s16le']
  return ['-c:a', 'aac', '-b:a', plan.audioBitrate]
}

export function render(plan) {
  if (active) return Promise.reject(new Error('Экспорт уже выполняется'))
  mkdirSync(path.dirname(plan.output), { recursive: true })
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  for (const clip of plan.main) args.push('-i', clip.path)
  // прозрачные .webm (VP9 alpha) нужно декодировать через libvpx-vp9
  for (const clip of plan.overlays) {
    if (/\.webm$/i.test(clip.path)) args.push('-c:v', 'libvpx-vp9')
    args.push('-i', clip.path)
  }
  if (plan.textList) args.push('-f', 'concat', '-safe', '0', '-i', plan.textList)
  args.push(
    '-filter_complex',
    buildGraph(plan),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    ...videoEncodeArgs(plan),
    ...audioEncodeArgs(plan),
    '-t',
    sec(plan.duration),
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    plan.output,
  )

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let buffer = ''
    let block = {}
    let settled = false
    let finishWait = () => {}
    const finished = new Promise((done) => {
      finishWait = done
    })
    const job = { child, cancelled: false, finished, output: plan.output }
    active = job

    const settle = (err) => {
      if (settled) return
      settled = true
      if (active === job) active = null
      if (job.cancelled && err) {
        removeFile(plan.output)
        const error = new Error('Рендер отменён')
        error.cancelled = true
        reject(error)
      } else if (err) {
        removeFile(plan.output)
        reject(err)
      } else {
        resolve({ output: plan.output })
      }
      finishWait({ cancelled: Boolean(job.cancelled && err) })
    }

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq)
        const value = line.slice(eq + 1)
        if (key !== 'progress') {
          block[key] = value
          continue
        }
        const time = timeFromProgress(block)
        const encodeFps = block.fps != null && block.fps !== 'N/A' ? Number(block.fps) : null
        const speed = parseSpeed(block.speed)
        block = {}
        if (!plan.onProgress) continue
        const ratio =
          value === 'end' || !(plan.duration > 0)
            ? 1
            : Math.max(0, Math.min(1, (Number.isFinite(time) ? time : 0) / plan.duration))
        const shown = value === 'end' ? plan.duration : Number.isFinite(time) ? time : 0
        let eta = null
        if (value === 'end') eta = 0
        else if (speed && shown < plan.duration) eta = round3((plan.duration - shown) / speed)
        plan.onProgress({
          time: round3(shown),
          total: plan.duration,
          ratio,
          pct: Math.round(ratio * 1000) / 10,
          fps: Number.isFinite(encodeFps) ? round3(encodeFps) : null,
          eta,
        })
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = tail(stderr, chunk)
    })
    child.on('error', (err) => {
      if (err.code === 'ENOENT') settle(new Error('ffmpeg не найден в PATH'))
      else settle(err)
    })
    child.on('close', (code) => {
      if (code === 0) settle(null)
      else settle(new Error(stderr.trim() || `ffmpeg завершился с кодом ${code ?? 'signal'}`))
    })
  })
}
