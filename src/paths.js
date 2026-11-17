import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg'])
export const SUBTITLE_EXT = new Set(['.srt', '.ass'])
export const OUTPUT_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm'])

export class PathError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PathError'
    this.status = 400
    this.code = 'path_denied'
  }
}

function realpathOrSelf(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Папки, внутри которых разрешено читать и писать. По умолчанию домашняя папка и временная. */
export function allowedRoots() {
  const fromEnv = (process.env.MINICUT_ROOTS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
  const roots = fromEnv.length ? fromEnv : [os.homedir(), os.tmpdir()]
  return roots.map((item) => realpathOrSelf(path.resolve(item)))
}

// realpath ближайшего существующего предка + хвост: так симлинки не выводят за пределы корней.
function resolveReal(abs) {
  let head = abs
  const tail = []
  while (!existsSync(head)) {
    const parent = path.dirname(head)
    if (parent === head) break
    tail.unshift(path.basename(head))
    head = parent
  }
  return path.join(realpathOrSelf(head), ...tail)
}

function isInside(child, root) {
  const rel = path.relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Проверяет путь и возвращает абсолютный. Бросает PathError, если путь вне разрешённых папок,
 * проходит через скрытую папку (например ~/.ssh) или имеет неподходящее расширение.
 */
export function checkPath(input, { extensions, label = 'Путь' } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new PathError(`${label} не указан`)
  const abs = resolveReal(path.resolve(input))
  const root = allowedRoots().find((item) => isInside(abs, item))
  if (!root) throw new PathError(`${label} вне разрешённых папок. Задай MINICUT_ROOTS, если нужна другая`)
  const hidden = path
    .relative(root, abs)
    .split(path.sep)
    .some((part) => part.startsWith('.') && part !== '.')
  if (hidden) throw new PathError(`${label} ведёт в скрытую папку или файл`)
  if (extensions && !extensions.has(path.extname(abs).toLowerCase())) {
    throw new PathError(`${label}: допустимые расширения ${[...extensions].join(', ')}`)
  }
  return abs
}
