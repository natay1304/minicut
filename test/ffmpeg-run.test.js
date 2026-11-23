import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { hasFfmpeg, makeVideo, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
const skip = hasFfmpeg() ? false : 'ffmpeg не найден'
const { buildRunArgs, checkFilterGraph } = await import('../src/ops/ffmpeg-run.js')
const ops = await import('../src/ops.js')

const project = { media: [{ id: 'm1', path: path.join(dir, 'src.mp4') }] }
const base = (extra = {}) => ({
  inputs: [{ path: path.join(dir, 'src.mp4') }],
  output: { path: path.join(dir, 'out.mp4') },
  ...extra,
})

test('фильтры: запрещены файловые, сетевые и чужие параметры', () => {
  assert.doesNotThrow(() => checkFilterGraph('[0:v]eq=contrast=1.1,scale=540:-2[v]'))
  assert.throws(() => checkFilterGraph('movie=/etc/passwd[v]'), /запрещён/)
  assert.throws(() => checkFilterGraph('[0:v]subtitles=a.srt'), /запрещён/)
  assert.throws(() => checkFilterGraph('drawtext=textfile=/etc/passwd'), /читающие файлы/)
  assert.throws(() => checkFilterGraph('scale=1:1,movie=a'), /запрещён/)
  assert.throws(() => checkFilterGraph("amovie='a.mp3'"), /запрещён/)
  assert.throws(() => checkFilterGraph('[0:v]scale=http://x'), /протокол/)
  assert.throws(() => checkFilterGraph('a b c'), /непонятное имя/)
})

test('аргументы: пути, перезапись и вход-источник', { skip }, () => {
  makeVideo(dir, 'src.mp4', 1)
  const ok = buildRunArgs(base({ vf: 'scale=160:-2' }), project)
  assert.ok(ok.args.includes('-vf'))
  assert.equal(ok.args.at(-1), path.join(realpathSync(dir), 'out.mp4'))
  assert.ok(ok.args.includes('-protocol_whitelist'))
  assert.throws(
    () => buildRunArgs(base({ output: { path: path.join(dir, 'src.mp4') } }), project),
    /совпадает|исходник/,
  )
  assert.throws(() => buildRunArgs(base({ output: { path: '/etc/x.mp4' } }), project), /вне разрешённых/)
  assert.throws(() => buildRunArgs(base({ output: { path: path.join(dir, 'x.sh') } }), project), /расширения/)
  assert.throws(
    () => buildRunArgs(base({ output: { path: path.join(dir, 'o.mp4'), videoCodec: 'rm' } }), project),
    /videoCodec/,
  )
  assert.throws(() => buildRunArgs(base({ inputs: [{ lavfi: 'movie=a' }] }), project), /lavfi|запрещён/)
  assert.throws(
    () => buildRunArgs(base({ inputs: [{ lavfi: 'color=c=red,scale=1:1' }] }), project),
    /без цепочки/,
  )
  assert.throws(() => buildRunArgs(base({ maps: ['0:v;rm'] }), project), /map/)
  assert.throws(() => buildRunArgs(base({ filterComplex: 'scale=1:1', vf: 'scale=1:1' }), project), /либо/)
})

test('запуск: цветокоррекция, генератор и импорт результата', { skip }, async () => {
  const file = makeVideo(dir, 'in.mp4', 2)
  await ops.newProject('run-test')
  const out = path.join(dir, 'graded.mp4')
  const res = await ops.ffmpegRun({
    inputs: [{ path: file }],
    vf: 'eq=saturation=1.5',
    output: { path: out, videoCodec: 'libx264', crf: 30, preset: 'ultrafast', audioCodec: 'aac' },
    importAs: true,
  })
  assert.ok(existsSync(out))
  assert.ok(Math.abs(res.duration - 2) < 0.2)
  assert.equal(res.imported.name, 'graded.mp4')
  await assert.rejects(
    () => ops.ffmpegRun({ inputs: [{ path: file }], output: { path: out }, overwrite: true }),
    /исходник проекта/,
  )
  const gen = await ops.ffmpegRun({
    inputs: [{ lavfi: 'color=c=blue:s=160x284:d=1:r=30' }],
    output: { path: path.join(dir, 'bg.mp4'), videoCodec: 'libx264', pixFmt: 'yuv420p', preset: 'ultrafast' },
  })
  assert.ok(Math.abs(gen.duration - 1) < 0.2)
  const again = { inputs: [{ path: file }], output: { path: path.join(dir, 'bg.mp4') } }
  await assert.rejects(() => ops.ffmpegRun(again), /уже существует/)
})
