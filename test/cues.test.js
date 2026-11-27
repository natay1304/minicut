import assert from 'node:assert/strict'
import { test } from 'node:test'
import { avoidOverlap, nextRange } from '../public/js/cue-math.js'

const orig = { start: 2, end: 4 }

test('сдвиг подписи сохраняет длину и не уходит левее нуля', () => {
  assert.deepEqual(nextRange('move', orig, 1.5), { start: 3.5, end: 5.5, snapTime: null })
  assert.deepEqual(nextRange('move', orig, -5), { start: 0, end: 2, snapTime: null })
})

test('начало и конец меняются независимо, минимальная длина сохраняется', () => {
  assert.equal(nextRange('in', orig, 1).start, 3)
  assert.equal(nextRange('in', orig, 5).start, 3.8)
  assert.equal(nextRange('out', orig, 1).end, 5)
  assert.equal(nextRange('out', orig, -5).end, 2.2)
})

test('привязка к границам: притягивается начало или конец', () => {
  const snap = (t) => (Math.abs(t - 10) < 0.1 ? { time: 10, hit: true } : { time: t, hit: false })
  assert.deepEqual(nextRange('move', orig, 8.05, snap), { start: 10, end: 12, snapTime: 10 })
  assert.deepEqual(nextRange('move', orig, 5.95, snap), { start: 8, end: 10, snapTime: 10 })
})

test('подпись не наезжает на соседей: перенос выталкивает к краю, края упираются', () => {
  const others = [
    { start: 0, end: 2 },
    { start: 6, end: 8 },
  ]
  const o = { start: 3, end: 5 }
  const moved = avoidOverlap('move', o, { start: 1.5, end: 3.5, snapTime: null }, others)
  assert.deepEqual([moved.start, moved.end], [2, 4])
  const moved2 = avoidOverlap('move', o, { start: 5.5, end: 7.5, snapTime: null }, others)
  assert.deepEqual([moved2.start, moved2.end], [4, 6])
  assert.equal(avoidOverlap('out', o, { start: 3, end: 7, snapTime: null }, others).end, 6)
  assert.equal(avoidOverlap('in', o, { start: 1, end: 5, snapTime: null }, others).start, 2)
})

test('мелкий существующий нахлёст не мешает двигать подпись', () => {
  const others = [{ start: 0, end: 3.02 }]
  const r = avoidOverlap('move', { start: 3, end: 5 }, { start: 3.5, end: 5.5, snapTime: null }, others)
  assert.deepEqual([r.start, r.end], [3.5, 5.5])
})
