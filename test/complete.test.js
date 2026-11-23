import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { completePath } from '../src/routes/api.js'

const base = mkdtempSync(path.join(os.tmpdir(), 'minicut-complete-'))
mkdirSync(path.join(base, 'reels'))
mkdirSync(path.join(base, 'raw'))
mkdirSync(path.join(base, '.hidden'))
writeFileSync(path.join(base, 'ready.mp4'), 'x')
writeFileSync(path.join(base, 'notes.txt'), 'x')

test('подсказки по началу имени: папки сначала, только видеофайлы', () => {
  const items = completePath(path.join(base, 'r'))
  assert.deepEqual(
    items.map((i) => i.name),
    ['raw', 'reels', 'ready.mp4'],
  )
  assert.ok(items[0].path.endsWith(path.sep))
})

test('после слэша показывает содержимое папки без скрытого и не-видео', () => {
  const names = completePath(`${base}${path.sep}`).map((i) => i.name)
  assert.deepEqual(names, ['raw', 'reels', 'ready.mp4'])
})

test('вне разрешённых папок и в скрытые подсказок нет', () => {
  assert.deepEqual(completePath('/etc/'), [])
  assert.deepEqual(completePath(`${base}${path.sep}.hidden${path.sep}`), [])
})
