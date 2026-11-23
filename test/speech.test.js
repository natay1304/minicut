import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import { slimProject } from '../src/routes/api.js'
import { MODEL_SIZES, modelUrl, pickWindowsAsset } from '../src/speech/setup.js'
import { hasFfmpeg, makeVideo, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
process.env.MINICUT_HOME = path.join(dir, 'home')
const posix = process.platform !== 'win32'
const skip = !posix ? 'нужен POSIX для поддельного whisper' : hasFfmpeg() ? false : 'ffmpeg не найден'

// Поддельный whisper-cli: пишет JSON в формате whisper.cpp и печатает прогресс.
const fake = path.join(dir, 'whisper-fake.mjs')
writeFileSync(
  fake,
  `#!/usr/bin/env node
const a = process.argv.slice(2)
const of = a[a.indexOf('-of') + 1]
const seg = (t, f, e) => ({ text: t, offsets: { from: f, to: e } })
process.stderr.write('whisper_print_progress_callback: progress =  50%\\n')
process.stderr.write('whisper_print_progress_callback: progress = 100%\\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(of + '.json', JSON.stringify({ result: { language: a[a.indexOf('-l') + 1] }, transcription: [
  seg(' Сегодня', 100, 600), seg(' мы', 600, 800), seg(' расскажем', 800, 1500), seg(' про', 1500, 1700), seg(' три', 1700, 2000), seg(' способа', 2000, 2600), seg('.', 2600, 2620),
  seg(' Сегодня', 3000, 3500), seg(' мы', 3500, 3700), seg(' расскажем', 3700, 4300), seg(' про', 4300, 4500), seg(' три', 4500, 4800), seg(' способа', 4800, 5400), seg(' монтажа', 5400, 6000), seg('.', 6000, 6020),
] }))
`,
)
if (posix) chmodSync(fake, 0o755)
const model = path.join(dir, 'ggml-fake.bin')
writeFileSync(model, 'x')
process.env.MINICUT_WHISPER_BIN = fake
process.env.MINICUT_WHISPER_MODEL = model

const ops = await import('../src/ops.js')
let media

before(async () => {
  if (skip) return
  media = await ops.importMedia(makeVideo(dir, 'speech.mp4', 8))
  ops.addClip(media.id, 0, media.duration)
})

test('speechState видит программу и модель', { skip }, () => {
  const state = ops.speechState()
  assert.equal(state.ready, true)
  assert.equal(state.bin, fake)
})

test('transcribe сохраняет слова, прогресс идёт событиями', { skip, timeout: 60000 }, async () => {
  const seen = []
  const off = ops.on('transcribe-progress', (e) => seen.push(e.pct))
  const res = await ops.transcribe(media.id, { language: 'ru' })
  off()
  assert.equal(res.wordCount, 13)
  assert.equal(res.language, 'ru')
  assert.ok(seen.includes(100) && seen[0] === 0)
  assert.equal(ops.getProject().media[0].words.length, 13)
})

test('API отдаёт число слов вместо самих слов', { skip }, () => {
  const slim = slimProject(ops.getProject())
  assert.equal(slim.media[0].words, undefined)
  assert.equal(slim.media[0].wordCount, 13)
})

test('getTranscript: фразы компактно и слова по запросу', { skip }, () => {
  const t = ops.getTranscript(media.id)
  assert.equal(t.utterances.length, 2)
  assert.match(t.utterances[1].text, /монтажа\.$/)
  assert.equal(ops.getTranscript(media.id, { words: true }).words.length, 13)
  assert.equal(ops.getTranscript(media.id, { from: 2.9 }).utterances.length, 1)
})

test('findInTranscript и findRepeats', { skip }, () => {
  const found = ops.findInTranscript('три способа')
  assert.equal(found.length, 2)
  const groups = ops.findRepeats(media.id).groups
  assert.equal(groups.length, 1)
  assert.equal(groups[0].keep, 1)
})

test('subtitlesFromTranscript создаёт подписи по таймлайну', { skip }, () => {
  const res = ops.subtitlesFromTranscript(media.id, { replace: true })
  assert.ok(res.created >= 2)
  assert.ok(ops.getProject().texts.every((t) => t.end > t.start))
})

test('cutSourceRange вырезает дубль, undo возвращает', { skip }, () => {
  const [first] = ops.findRepeats(media.id).groups[0].takes
  const before = ops.getProject().tracks[0].clips.length
  const res = ops.cutSourceRange(media.id, first.start, first.end)
  assert.ok(res.removedSeconds > 2)
  const clips = ops.getProject().tracks[0].clips
  assert.ok(clips.every((c) => c.out - c.in >= 0.25))
  assert.ok(!clips.some((c) => c.in < first.end && c.out > first.start))
  ops.undo()
  assert.equal(ops.getProject().tracks[0].clips.length, before)
  assert.throws(() => ops.cutSourceRange(media.id, 5, 4))
})

test('без программы transcribe отвечает понятной ошибкой', { skip }, async () => {
  const saved = process.env.MINICUT_WHISPER_BIN
  process.env.MINICUT_WHISPER_BIN = path.join(os.tmpdir(), 'нет-такой-программы')
  try {
    await assert.rejects(ops.transcribe(media.id), /npm run setup:speech/)
  } finally {
    process.env.MINICUT_WHISPER_BIN = saved
  }
})

test('setup: ссылка на модель и выбор архива для Windows', () => {
  assert.equal(modelUrl('small'), 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin')
  assert.throws(() => modelUrl('../evil'))
  assert.ok(MODEL_SIZES['large-v3-turbo-q5_0'])
  const assets = [
    { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'cuda' },
    { name: 'whisper-blas-bin-x64.zip', browser_download_url: 'blas' },
    { name: 'whisper-bin-Win32.zip', browser_download_url: 'w32' },
    { name: 'whisper-bin-x64.zip', browser_download_url: 'plain' },
  ]
  assert.equal(pickWindowsAsset(assets).url, 'plain')
  assert.equal(pickWindowsAsset([{ name: 'something.tar.gz' }]), null)
  assert.equal(mkdtempSync(path.join(os.tmpdir(), 'x')).length > 0, true)
})
