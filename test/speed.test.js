import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { tempoChain } from '../src/ffmpeg.js'
import { clipLength } from '../src/ops/project.js'
import { wordsOnTimeline } from '../src/speech/words.js'
import { hasFfmpeg, makeVideo, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
const skip = hasFfmpeg() ? false : 'ffmpeg не найден'
const ops = await import('../src/ops.js')

test('длина клипа делится на скорость', () => {
  assert.equal(clipLength({ in: 0, out: 4 }), 4)
  assert.equal(clipLength({ in: 1, out: 5, speed: 2 }), 2)
  assert.equal(clipLength({ in: 0, out: 2, speed: 0.5 }), 4)
})

test('atempo: цепочка для скоростей вне 0.5–2', () => {
  assert.deepEqual(tempoChain(1), [])
  assert.deepEqual(tempoChain(1.5), ['atempo=1.500'])
  assert.deepEqual(tempoChain(4), ['atempo=2.000', 'atempo=2.000'])
  assert.deepEqual(tempoChain(0.25), ['atempo=0.500', 'atempo=0.500'])
})

test('слова на таймлайне учитывают скорость клипа', () => {
  const words = [{ text: 'раз', start: 2, end: 3 }]
  const out = wordsOnTimeline(words, [{ mediaId: 'm1', in: 0, out: 4, speed: 2 }], 'm1')
  assert.deepEqual(out, [{ text: 'раз', start: 1, end: 1.5 }])
})

test('скорость клипа: проверка границ и разрез по таймлайну', { skip }, async () => {
  const file = makeVideo(dir, 'a.mp4', 4)
  await ops.newProject('speed-test')
  const media = await ops.importMedia(file)
  const clip = ops.addClip(media.id, 0, 4)
  assert.throws(() => ops.setClip(clip.id, { speed: 9 }), /Скорость/)
  ops.setClip(clip.id, { speed: 2 })
  const [left, right] = ops.split(clip.id, 1)
  assert.equal(left.out, 2)
  assert.equal(right.in, 2)
  assert.equal(right.speed, 2)
})

test('scaleSpeed сдвигает подписи и оверлеи', { skip }, async () => {
  const file = makeVideo(dir, 'b.mp4', 4)
  await ops.newProject('speed-all')
  const media = await ops.importMedia(file)
  ops.addClip(media.id, 0, 4)
  ops.addText({ start: 2, end: 4, text: 'привет' })
  ops.scaleSpeed(2)
  const project = ops.getProject()
  assert.equal(project.tracks[0].clips[0].speed, 2)
  assert.deepEqual([project.texts[0].start, project.texts[0].end], [1, 2])
  assert.throws(() => ops.scaleSpeed(3), /вне пределов/)
  ops.scaleSpeed(0.5)
  assert.equal(ops.getProject().tracks[0].clips[0].speed, undefined)
})

test('экспорт: длительность и звук учитывают скорость', { skip }, async () => {
  const file = makeVideo(dir, 'c.mp4', 4)
  await ops.newProject('speed-render')
  const media = await ops.importMedia(file)
  const clip = ops.addClip(media.id, 0, 4)
  ops.setClip(clip.id, { speed: 2 })
  const out = path.join(dir, 'out.mp4')
  await ops.render({ output: out, width: 160, height: 284, fps: 30, crf: 30, preset: 'ultrafast' })
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', out]),
  )
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.15, `duration ${info.format.duration}`)
})
