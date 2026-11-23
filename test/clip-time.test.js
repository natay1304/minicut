import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clipLength,
  formatSpeed,
  playbackRateFor,
  sourceTimeAt,
  speedOf,
  timelineOffset,
} from '../public/js/clip-time.js'

test('speedOf: нет поля и мусор — 1', () => {
  assert.equal(speedOf({}), 1)
  assert.equal(speedOf(null), 1)
  assert.equal(speedOf({ speed: 0 }), 1)
  assert.equal(speedOf({ speed: -2 }), 1)
  assert.equal(speedOf({ speed: 'нет' }), 1)
  assert.equal(speedOf({ speed: 2 }), 2)
  assert.equal(speedOf({ speed: 0.5 }), 0.5)
})

test('clipLength делит исходный отрезок на скорость', () => {
  assert.equal(clipLength({ in: 0, out: 4 }), 4)
  assert.equal(clipLength({ in: 1, out: 5, speed: 2 }), 2)
  assert.equal(clipLength({ in: 0, out: 2, speed: 0.5 }), 4)
  assert.equal(clipLength({ in: 0, out: 4, speed: 0 }), 4)
  assert.equal(clipLength(null), 0)
})

test('метка исходника и таймлайна обратны друг другу', () => {
  const clip = { in: 1, out: 5, speed: 2 }
  assert.equal(sourceTimeAt(clip, 0), 1)
  assert.equal(sourceTimeAt(clip, 2), 5)
  assert.equal(timelineOffset(clip, 5), 2)
  assert.equal(timelineOffset(clip, sourceTimeAt(clip, 0.75)), 0.75)
  assert.equal(sourceTimeAt({ in: 0, out: 4 }, 1.5), 1.5)
})

test('formatSpeed: ×2 и ×0.5', () => {
  assert.equal(formatSpeed({ speed: 2 }), '×2')
  assert.equal(formatSpeed({ speed: 0.5 }), '×0.5')
  assert.equal(formatSpeed({ speed: 1.5 }), '×1.5')
  assert.equal(formatSpeed({}), '×1')
})

test('playbackRateFor умножает скорость клипа на шаттл и держит диапазон браузера', () => {
  assert.equal(playbackRateFor({ speed: 1 }, 1), 1)
  assert.equal(playbackRateFor({}, 2), 2)
  assert.equal(playbackRateFor({ speed: 2 }, 1), 2)
  assert.equal(playbackRateFor({ speed: 2 }, 4), 8)
  assert.equal(playbackRateFor({ speed: 0.25 }, 1), 0.25)
  assert.equal(playbackRateFor({ speed: 4 }, 8), 16)
  assert.equal(playbackRateFor({ speed: 2 }, 0), 2)
})
