import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, clampSize } from '../public/js/panels.js'

test('clampSize: минимум, максимум и доля доступного места', () => {
  assert.equal(clampSize('lib', 10, 1400), LIMITS.lib.min)
  assert.equal(clampSize('lib', 9999, 1400), LIMITS.lib.max)
  assert.equal(clampSize('lib', 300, 1400), 300)
  // на узком окне панель не съедает больше своей доли
  assert.equal(clampSize('insp', 600, 800), Math.round(800 * LIMITS.insp.share))
  assert.equal(clampSize('time', 9999, 700), Math.round(700 * LIMITS.time.share))
  // мусор вместо числа даёт минимум
  assert.equal(clampSize('time', 'abc', 900), LIMITS.time.min)
})
