import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts')
const BUNDLED = { 'jetbrains-mono': 'JetBrains Mono', manrope: 'Manrope', cormorant: 'Cormorant' }
const DEFAULT_FAMILY = 'JetBrains Mono'
const readyFonts = new Set()
let bundledLoaded = false

// Шрифты из public/fonts идут вместе с проектом, поэтому подписи выглядят одинаково на любой ОС.
// Они регистрируются под своими именами (чтобы не пересечься с системными одноимёнными):
// латиница как "Семейство minicut", кириллица как "Семейство minicut Cyrillic".
const alias = (family, cyrillic = false) => `${family} minicut${cyrillic ? ' Cyrillic' : ''}`

function loadBundledFonts() {
  if (bundledLoaded) return
  bundledLoaded = true
  if (!existsSync(fontsDir)) return
  for (const file of readdirSync(fontsDir)) {
    const match = /^(.+)-(latin|cyrillic)-\d+-(?:normal|italic)\.woff2$/.exec(file)
    if (!match || !BUNDLED[match[1]]) continue
    const family = BUNDLED[match[1]]
    try {
      GlobalFonts.registerFromPath(path.join(fontsDir, file), alias(family, match[2] === 'cyrillic'))
      readyFonts.add(family)
    } catch {
      // Файл не удалось прочитать: canvas возьмёт запасной шрифт.
    }
  }
}

// Системный шрифт нужен только для семейств, которых нет среди встроенных.
// ffmpeg собран без libass/freetype, поэтому подписи — это одна PNG-дорожка.
function systemFontFile(family) {
  try {
    const out = execFileSync('fc-list', [family, 'file'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = out
      .split('\n')
      .map((item) => item.trim())
      .find(Boolean)
    return line ? line.split(':')[0] : null
  } catch {
    return null
  }
}

// Возвращает CSS-список семейств для ctx.font: выбранный шрифт, его кириллица, запасной встроенный.
export function fontStack(requested) {
  loadBundledFonts()
  const name = requested || DEFAULT_FAMILY
  const stack = []
  if (readyFonts.has(name)) {
    stack.push(alias(name), alias(name, true))
  } else {
    if (!readyFonts.has(`system:${name}`)) {
      const file = systemFontFile(name)
      if (file) {
        try {
          GlobalFonts.registerFromPath(file, name)
        } catch {
          // Дальше сработает запасной шрифт из списка.
        }
      }
      readyFonts.add(`system:${name}`)
    }
    stack.push(name)
  }
  stack.push(alias(DEFAULT_FAMILY), alias(DEFAULT_FAMILY, true))
  return [...new Set(stack.map((item) => `"${item}"`)), 'sans-serif'].join(', ')
}

function cssColor(value) {
  const hex = String(value || '').trim()
  const match = /^#([0-9a-fA-F]{8})$/.exec(hex)
  if (!match) return hex || '#ffffff'
  const raw = match[1]
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const a = (parseInt(raw.slice(6, 8), 16) / 255).toFixed(3)
  return `rgba(${r},${g},${b},${a})`
}

function wrap(ctx, text, maxWidth) {
  const lines = []
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = words[0]
    for (const word of words.slice(1)) {
      const trial = `${current} ${word}`
      if (ctx.measureText(trial).width <= maxWidth) current = trial
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines.length ? lines : ['']
}

function drawText(ctx, width, height, text, style, pixelScale) {
  const size = Math.max(8, (Number(style.size) || 62) * pixelScale)
  const weight = Number(style.weight) || 700
  ctx.font = `${weight} ${size}px ${fontStack(style.font)}`
  ctx.fillStyle = cssColor(style.color || '#F3E9DC')
  const shadow = style.shadow || {}
  ctx.shadowColor = cssColor(shadow.color || 'transparent')
  ctx.shadowOffsetX = (Number(shadow.dx) || 0) * pixelScale
  ctx.shadowOffsetY = (Number(shadow.dy) || 0) * pixelScale
  ctx.shadowBlur = (Number(shadow.blur) || 0) * pixelScale
  const align = style.align === 'left' || style.align === 'right' ? style.align : 'center'
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, text, width * 0.86)
  const lineHeight = size * 1.25
  const anchorX = (Number(style.x) || 0) * width
  let y = (Number(style.y) || 0) * height - ((lines.length - 1) * lineHeight) / 2
  for (const line of lines) {
    ctx.fillText(line, anchorX, y)
    y += lineHeight
  }
}

function writePng(file, width, height, draw) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  draw(ctx)
  writeFileSync(file, canvas.toBuffer('image/png'))
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

function slices(texts, duration) {
  const points = [0, duration]
  for (const text of texts) {
    points.push(Math.min(duration, Math.max(0, text.start)))
    points.push(Math.min(duration, Math.max(0, text.end)))
  }
  points.sort((a, b) => a - b)
  const marks = []
  for (const point of points) {
    if (!marks.length || point - marks[marks.length - 1] > 0.0005) marks.push(point)
  }
  const pieces = []
  for (let i = 0; i < marks.length - 1; i++) {
    const start = marks[i]
    const end = marks[i + 1]
    pieces.push({
      start,
      end,
      duration: end - start,
      texts: texts.filter((text) => text.start < end - 1e-6 && text.end > start + 1e-6),
    })
  }
  if (!pieces.length) return []
  let used = 0
  for (let i = 0; i < pieces.length - 1; i++) {
    pieces[i].duration = round6(pieces[i].duration)
    used += pieces[i].duration
  }
  pieces[pieces.length - 1].duration = Math.max(0.001, round6(duration - used))
  return pieces
}

function escapePath(file) {
  return file.replace(/'/g, `'\\''`)
}

// duration последнего файла concat-demuxer не учитывается, поэтому файл повторяется.
function concatScript(files, pieces) {
  const lines = ['ffconcat version 1.0']
  pieces.forEach((piece, index) => {
    lines.push(`file '${escapePath(files[index])}'`)
    lines.push(`duration ${piece.duration.toFixed(6)}`)
  })
  lines.push(`file '${escapePath(files[files.length - 1])}'`)
  return `${lines.join('\n')}\n`
}

export function buildTextTrack({ dir, width, height, duration, texts, styles, pixelScale = 1 }) {
  if (!(duration > 0) || !(width > 0) || !(height > 0)) return null
  const visible = (texts || []).filter(
    (text) => text && text.end > 0 && text.start < duration && String(text.text || '').trim(),
  )
  if (!visible.length) return null
  mkdirSync(dir, { recursive: true })
  const pieces = slices(visible, duration)
  if (!pieces.length) return null
  const blank = `${dir}/blank.png`
  writePng(blank, width, height, () => {})
  const files = pieces.map((piece, index) => {
    if (!piece.texts.length) return blank
    const file = `${dir}/t${index}.png`
    writePng(file, width, height, (ctx) => {
      for (const item of piece.texts) {
        drawText(ctx, width, height, item.text, styles[item.style] || styles.sub, pixelScale)
      }
    })
    return file
  })
  const list = `${dir}/text.txt`
  writeFileSync(list, concatScript(files, pieces))
  return list
}
