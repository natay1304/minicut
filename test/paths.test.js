import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { OUTPUT_EXT, PathError, VIDEO_EXT, checkPath } from '../src/paths.js'

const dir = mkdtempSync(path.join(os.tmpdir(), 'minicut-paths-'))
process.env.MINICUT_ROOTS = dir

test('пропускает файл внутри разрешённой папки', () => {
  const file = path.join(dir, 'a.mp4')
  assert.equal(checkPath(file, { extensions: VIDEO_EXT }), path.join(realpathSync(dir), 'a.mp4'))
})

test('отклоняет путь вне корней', () => {
  assert.throws(() => checkPath('/etc/passwd'), PathError)
})

test('отклоняет выход через ..', () => {
  assert.throws(() => checkPath(path.join(dir, '..', 'x.mp4')), PathError)
})

test('отклоняет скрытые папки и файлы', () => {
  assert.throws(() => checkPath(path.join(dir, '.ssh', 'a.mp4')), /скрыт/)
  assert.throws(() => checkPath(path.join(dir, '.secret.mp4')), /скрыт/)
})

test('проверяет расширение', () => {
  assert.throws(() => checkPath(path.join(dir, 'x.sh'), { extensions: OUTPUT_EXT }), /расширения/)
})

test('симлинк наружу не обходит проверку', () => {
  const link = path.join(dir, 'link')
  symlinkSync('/etc', link)
  assert.throws(() => checkPath(path.join(link, 'passwd')), PathError)
})

test('пустой путь отклоняется', () => {
  assert.throws(() => checkPath('  '), PathError)
  assert.throws(() => checkPath(undefined), PathError)
})
