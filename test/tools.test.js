import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasFfmpeg, makeVideo, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
const skip = hasFfmpeg() ? false : 'ffmpeg не найден'
const ops = await import('../src/ops.js')

const isJpeg = (b64) => Buffer.from(b64, 'base64').subarray(0, 3).toString('hex') === 'ffd8ff'

test('probe: форматы и дорожки', { skip }, async () => {
  const file = makeVideo(dir, 'p.mp4', 2)
  const info = await ops.probeFile({ path: file })
  assert.equal(info.streams.find((s) => s.type === 'video').width, 320)
  assert.ok(info.streams.some((s) => s.type === 'audio'))
  await assert.rejects(() => ops.probeFile({ path: '/etc/passwd' }), /вне разрешённых|расширения/)
})

test('кадр из файла и из проекта', { skip }, async () => {
  const file = makeVideo(dir, 'f.mp4', 3)
  await ops.newProject('frame-test')
  const media = await ops.importMedia(file)
  ops.addClip(media.id, 0, 3)
  const src = await ops.mediaFrame({ mediaId: media.id, time: 1, width: 200 })
  assert.equal(src.mimeType, 'image/jpeg')
  assert.ok(isJpeg(src.data))
  const proj = await ops.frame({ time: 1, width: 270 })
  assert.ok(isJpeg(proj.data))
  assert.equal(proj.width, 270)
  assert.equal(proj.height, 480)
  await assert.rejects(() => ops.frame({ time: 99 }), /time должен/)
  await assert.rejects(() => ops.frame({ time: 1, width: 5000 }), /width/)
})

test('ffmpeg_help: список фильтров и параметры одного', { skip }, async () => {
  const list = await ops.ffmpegHelp({ kind: 'filters', query: 'scale' })
  assert.ok(list.total > 0 && /scale/.test(list.text))
  const one = await ops.ffmpegHelp({ kind: 'filter', name: 'scale' })
  assert.ok(/width/.test(one.text))
  await assert.rejects(() => ops.ffmpegHelp({ kind: 'filter', name: 'a;b' }), /name/)
  await assert.rejects(() => ops.ffmpegHelp({ kind: 'nope' }), /kind/)
})
