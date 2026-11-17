import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { before, test } from 'node:test'
import { hasFfmpeg, makeVideo, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
const skip = hasFfmpeg() ? false : 'ffmpeg не найден'
const ops = await import('../src/ops.js')
let media

const track = (id) => ops.getProject().tracks.find((t) => t.id === id)
const ids = () => track('main').clips.map((c) => c.id)

before(async () => {
  if (skip) return
  media = await ops.importMedia(makeVideo(dir, 'a.mp4', 4))
})

test('importMedia заполняет метаданные', { skip }, () => {
  assert.equal(media.duration > 3.5, true)
  assert.equal(media.hasAudio, true)
  assert.equal(media.width, 320)
})

test('addClip и ripple-позиции main', { skip }, () => {
  ops.addClip(media.id, 0, 2)
  ops.addClip(media.id, 1, 3)
  assert.equal(track('main').clips.length, 2)
})

test('split режет клип на два', { skip }, () => {
  const before = track('main').clips.length
  ops.splitAt(1)
  assert.equal(track('main').clips.length, before + 1)
})

test('trim проверяет границы', { skip }, () => {
  const clip = track('main').clips[0]
  assert.throws(() => ops.trim(clip.id, { in: 0, out: 999 }), /Границы/)
  ops.trim(clip.id, { in: 0.2, out: 0.8 })
  assert.equal(track('main').clips[0].in, 0.2)
})

test('remove сдвигает клипы и undo/redo возвращают состояние', { skip }, () => {
  const first = ids()
  ops.remove(first[0])
  assert.equal(ids().length, first.length - 1)
  ops.undo()
  assert.deepEqual(ids(), first)
  ops.redo()
  assert.equal(ids().length, first.length - 1)
  ops.undo()
})

test('оверлей-дорожки создаются автоматически, максимум 10', { skip }, () => {
  ops.addClip(media.id, 0, 1, undefined, 'overlay3')
  const names = ops.getProject().tracks.map((t) => t.id)
  assert.deepEqual(names.slice(0, 4), ['main', 'overlay', 'overlay2', 'overlay3'])
  assert.throws(() => ops.addClip(media.id, 0, 1, undefined, 'overlay11'), /Максимум 10/)
})

test('removeOverlayTrack: пустую можно, с клипами и первую нельзя', { skip }, () => {
  ops.removeOverlayTrack('overlay2')
  assert.equal(
    ops.getProject().tracks.some((t) => t.id === 'overlay2'),
    false,
  )
  assert.throws(() => ops.removeOverlayTrack('overlay'))
})

test('moveClipToTrack переносит клип между дорожками', { skip }, () => {
  const clip = track('overlay3').clips[0]
  ops.moveClipToTrack(clip.id, 'overlay', 0.5)
  assert.equal(
    track('overlay').clips.some((c) => c.id === clip.id),
    true,
  )
})

test('setClip валидирует значения', { skip }, () => {
  const clip = track('main').clips[0]
  ops.setClip(clip.id, { scale: 1.5, volume: 0.5 })
  assert.equal(track('main').clips[0].scale, 1.5)
  assert.throws(() => ops.setClip(clip.id, { volume: 99 }))
})

test('importSubtitles читает .srt', { skip }, () => {
  const srt = path.join(dir, 's.srt')
  writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,500\nПривет\n\n2\n00:00:03,000 --> 00:00:04,000\nМир\n')
  ops.importSubtitles(srt)
  const texts = ops.getProject().texts
  assert.equal(texts.length, 2)
  assert.equal(texts[0].text, 'Привет')
  assert.equal(texts[0].start, 1)
})

test('importSubtitles не читает файлы вне допустимых расширений и корней', { skip }, () => {
  assert.throws(() => ops.importSubtitles('/etc/passwd'))
})

test('проекты: new, list, load', { skip }, () => {
  ops.saveProjectAs('copy')
  ops.newProject('other')
  assert.ok(ops.listProjects().length >= 2)
  ops.loadProject('copy')
  assert.equal(ops.getProject().name, 'copy')
  assert.throws(() => ops.loadProject('../evil'))
})

test('render пишет файл и отклоняет выход вне корней', { skip, timeout: 60000 }, async () => {
  ops.loadProject('copy')
  await assert.rejects(ops.render({ output: '/etc/x.mp4' }))
  const out = path.join(dir, 'out.mp4')
  await ops.render({ output: out, width: 270, height: 480, crf: 30, preset: 'ultrafast' })
  const { probe } = await import('../src/ffmpeg.js')
  const info = await probe(out)
  assert.equal(info.width, 270)
  assert.ok(info.duration > 0.5)
})
