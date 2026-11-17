import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Изолированная папка данных: тесты не трогают рабочие проекты. */
export function useTempData() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minicut-test-'))
  process.env.MINICUT_DATA = path.join(dir, 'data')
  return dir
}

/** Короткое тестовое видео со звуком. */
export function makeVideo(dir, name = 'a.mp4', seconds = 4, size = '320x568') {
  const file = path.join(dir, name)
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${size}:rate=30:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file,
  ])
  return file
}
