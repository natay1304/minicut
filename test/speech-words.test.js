import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cuesFromTimelineWords,
  findPhrase,
  findRepeats,
  groupUtterances,
  normalizeText,
  parseWhisperJson,
  similarity,
  tokens,
  wordsOnTimeline,
} from '../src/speech/words.js'

const seg = (text, from, to) => ({ text, offsets: { from, to } })
const mk = (text, start = 0.12, step = 0.33) =>
  text.split(' ').map((word, i) => ({ text: word, start: start + i * step, end: start + i * step + 0.3 }))

test('normalizeText: регистр, ё, знаки препинания', () => {
  assert.equal(normalizeText('  Ёлка, ПРИВЕТ!!  Мир… '), 'елка привет мир')
  assert.deepEqual(tokens('Три способа.'), ['три', 'способа'])
})

test('parseWhisperJson: слова, склейка знаков, служебные метки', () => {
  const json = {
    result: { language: 'ru' },
    transcription: [
      seg(' Привет', 120, 500),
      seg(',', 500, 520),
      seg(' мир', 600, 900),
      seg(' [BLANK_AUDIO]', 900, 1200),
      seg(' (музыка)', 1200, 1500),
      seg(' пока', 1600, 1600),
    ],
  }
  const { language, words } = parseWhisperJson(json)
  assert.equal(language, 'ru')
  assert.deepEqual(
    words.map((w) => w.text),
    ['Привет,', 'мир', 'пока'],
  )
  assert.equal(words[0].end, 0.52)
  assert.ok(words[2].end > words[2].start, 'нулевая длина исправляется')
})

test('groupUtterances: пауза и конец предложения разделяют фразы', () => {
  const words = [...mk('Привет мир.'), ...mk('Как дела', 3), ...mk('хорошо', 6)]
  const u = groupUtterances(words)
  assert.deepEqual(
    u.map((x) => x.text),
    ['Привет мир.', 'Как дела', 'хорошо'],
  )
})

test('similarity и findPhrase: точное и похожее совпадение', () => {
  assert.ok(similarity(['а', 'б', 'в'], ['а', 'б', 'в']) === 1)
  assert.ok(similarity(['а', 'б', 'в', 'г'], ['а', 'б', 'в', 'д']) >= 0.75)
  const words = mk('Сегодня мы расскажем про три способа монтажа видео')
  const exact = findPhrase(words, 'Три способа, МОНТАЖА')
  assert.equal(exact.length, 1)
  assert.equal(exact[0].exact, true)
  assert.equal(exact[0].start, words[4].start)
  assert.equal(findPhrase(words, 'совсем другое').length, 0)
  assert.equal(findPhrase(words, 'три способа монтажа видоо')[0]?.exact, false)
})

test('findRepeats: повторный дубль и оборванное начало, оставить последний', () => {
  const words = [
    ...mk('Сегодня мы расскажем про три способа монтажа.', 0),
    ...mk('Сегодня мы расскажем про три способа монтажа видео.', 4),
    ...mk('Первый способ самый быстрый.', 9),
  ]
  const groups = findRepeats(words)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].takes.length, 2)
  assert.equal(groups[0].keep, 1)
  assert.match(groups[0].phrase, /видео\.$/)
  const restart = [
    ...mk('Сегодня мы расскажем про', 0),
    ...mk('Сегодня мы расскажем про три способа монтажа.', 4),
  ]
  assert.equal(findRepeats(restart)[0].takes.length, 2)
})

test('wordsOnTimeline: слова переносятся по клипам, вырезанное пропадает', () => {
  const words = [
    { text: 'раз', start: 0, end: 1 },
    { text: 'два', start: 1, end: 2 },
    { text: 'три', start: 5, end: 6 },
  ]
  const clips = [
    { mediaId: 'm1', in: 0, out: 1 },
    { mediaId: 'm2', in: 0, out: 3 },
    { mediaId: 'm1', in: 5, out: 6 },
  ]
  const out = wordsOnTimeline(words, clips, 'm1')
  assert.deepEqual(
    out.map((w) => [w.text, w.start, w.end]),
    [
      ['раз', 0, 1],
      ['три', 4, 5],
    ],
  )
})

test('cuesFromTimelineWords: длина, паузы и без одинокого последнего слова', () => {
  const words = mk('Сегодня мы расскажем про три способа монтажа видео.')
  const cues = cuesFromTimelineWords(words)
  assert.equal(cues.length, 1)
  const two = cuesFromTimelineWords([...words, ...mk('Первый способ самый быстрый.', 12)])
  assert.equal(two.length, 2)
  assert.ok(two[0].end <= two[1].start)
})
