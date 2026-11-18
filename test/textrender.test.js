import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GlobalFonts } from '@napi-rs/canvas'
import { fontStack } from '../src/textrender.js'

test('встроенные шрифты регистрируются под собственными именами, с кириллицей', () => {
  const stack = fontStack('Manrope')
  assert.match(stack, /"Manrope minicut", "Manrope minicut Cyrillic"/)
  const families = GlobalFonts.families.map((item) => item.family)
  assert.ok(families.includes('Manrope minicut'))
  assert.ok(families.includes('Manrope minicut Cyrillic'))
})

test('неизвестный шрифт откатывается на встроенный JetBrains Mono', () => {
  const stack = fontStack('NoSuchFont123')
  assert.match(stack, /"JetBrains Mono minicut"/)
  assert.ok(stack.endsWith('sans-serif'))
})
