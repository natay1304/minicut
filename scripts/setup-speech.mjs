#!/usr/bin/env node
// Устанавливает всё для расшифровки речи: whisper.cpp и модель.
//   npm run setup:speech                    программа + модель large-v3-turbo-q5_0 (~570 МБ)
//   npm run setup:speech -- --model small   другая модель (tiny, base, small, medium, large-v3, large-v3-turbo…)
//   npm run setup:speech -- --check         только показать состояние, ничего не менять
//   npm run setup:speech -- --yes           без вопроса (для запуска не в терминале)
import readline from 'node:readline/promises'
import { DEFAULT_MODEL, speechHome, speechStatus } from '../src/speech/engine.js'
import { MODEL_SIZES, installBinary, installModel } from '../src/speech/setup.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const model = valueOf('--model') || DEFAULT_MODEL

const status = speechStatus(model)
console.log(
  `Система: ${process.platform} ${process.arch}. Папка minicut для программ и моделей: ${speechHome()}`,
)
console.log(`whisper.cpp: ${status.bin ? `есть (${status.bin})` : 'не найден'}`)
console.log(`Модель ${model}: ${status.model ? `есть (${status.model})` : 'не скачана'}`)

if (flag('--check')) process.exit(status.ready ? 0 : 1)
if (status.ready) {
  console.log('Всё уже установлено.')
  process.exit(0)
}

const steps = []
if (!status.bin) {
  steps.push(
    process.platform === 'darwin'
      ? 'поставить whisper.cpp через Homebrew (brew install whisper-cpp)'
      : process.platform === 'win32'
        ? 'скачать whisper.cpp для Windows с github.com/ggml-org/whisper.cpp/releases'
        : 'показать, как собрать whisper.cpp (Linux)',
  )
}
if (!status.model)
  steps.push(`скачать модель ${model} ${MODEL_SIZES[model] || ''} с huggingface.co/ggerganov/whisper.cpp`)
console.log(`\nСейчас будет: ${steps.join('; ')}.`)

if (!flag('--yes')) {
  if (!process.stdin.isTTY) {
    console.error('Запуск не в терминале: добавьте --yes, чтобы подтвердить установку.')
    process.exit(2)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('Продолжить? [Y/n] ')).trim().toLowerCase()
  rl.close()
  if (answer && !['y', 'yes', 'д', 'да'].includes(answer)) {
    console.log('Отменено.')
    process.exit(0)
  }
}

try {
  if (!status.bin) await installBinary()
  if (!status.model) await installModel(model)
  const after = speechStatus(model)
  console.log(
    after.ready ? '\nГотово: расшифровка речи работает.' : `\nНе хватает: ${after.missing.join(', ')}`,
  )
  process.exit(after.ready ? 0 : 1)
} catch (err) {
  console.error(`\nОшибка: ${err.message}`)
  process.exit(1)
}
