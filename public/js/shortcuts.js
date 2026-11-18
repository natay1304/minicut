import { postOp } from './api.js'
import { removeSelected, splitAtPlayhead } from './editing.js'
import { pausePlayback, shuttle, stepFrame, togglePlay } from './playback.js'
import { state } from './state.js'

export const keys = new Set()

function typingTarget(el) {
  if (!el || el === document.body) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function dialogOpen() {
  return [...document.querySelectorAll('dialog')].some((dialog) => dialog.open)
}

function onKeyDown(event) {
  keys.add(event.code)
  if (typingTarget(event.target)) return
  if (state.drag || state.renaming) return
  const meta = event.metaKey || event.ctrlKey
  if (dialogOpen() && !(meta && event.code === 'KeyZ')) return
  if (meta) {
    if (event.code === 'KeyZ') {
      event.preventDefault()
      if (event.shiftKey) void postOp('redo', {}).catch(() => {})
      else void postOp('undo', {}).catch(() => {})
    }
    return
  }
  const shuttleStep = (event.code === 'KeyJ' || event.code === 'KeyL') && keys.has('KeyK')
  if (event.repeat && event.code !== 'ArrowLeft' && event.code !== 'ArrowRight' && !shuttleStep) return
  switch (event.code) {
    case 'Space':
      event.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      event.preventDefault()
      stepFrame(-1)
      break
    case 'ArrowRight':
      event.preventDefault()
      stepFrame(1)
      break
    case 'KeyS':
      event.preventDefault()
      void splitAtPlayhead()
      break
    case 'Delete':
    case 'Backspace':
      event.preventDefault()
      void removeSelected()
      break
    case 'KeyK':
      event.preventDefault()
      pausePlayback()
      break
    case 'KeyL':
      event.preventDefault()
      if (keys.has('KeyK')) stepFrame(1)
      else shuttle(1)
      break
    case 'KeyJ':
      event.preventDefault()
      if (keys.has('KeyK')) stepFrame(-1)
      else shuttle(-1)
      break
    default:
      break
  }
}

export function bindShortcuts() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => keys.clear())
}
