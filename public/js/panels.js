// Размер панелей меняется мышью: ширина библиотеки и инспектора, высота таймлайна.
// Размеры хранятся в браузере (localStorage), двойной клик по разделителю возвращает стандартный размер.

const STORAGE_KEY = 'minicut-panels'
const KEYBOARD_STEP = 16
const KEYBOARD_STEP_BIG = 48

export const LIMITS = {
  lib: { min: 140, max: 560, share: 0.4 },
  insp: { min: 180, max: 640, share: 0.45 },
  time: { min: 140, max: 640, share: 0.65 },
}

/**
 * Ограничивает размер панели: не меньше минимума, не больше максимума и доли доступного места.
 * @param {'lib'|'insp'|'time'} kind
 * @param {number} value размер в пикселях
 * @param {number} available ширина (для lib, insp) или высота (для time) всего приложения
 */
export function clampSize(kind, value, available) {
  const limit = LIMITS[kind]
  const max = Math.max(limit.min, Math.min(limit.max, Math.round(available * limit.share)))
  return Math.round(Math.min(max, Math.max(limit.min, Number(value) || limit.min)))
}

const VARS = { lib: '--col-lib', insp: '--col-insp', time: '--row-time' }

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

function save(sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes))
  } catch {
    // хранилище недоступно: размеры просто не запомнятся
  }
}

export function bindPanels() {
  const app = document.querySelector('.app')
  const panels = {
    lib: document.querySelector('.library'),
    insp: document.querySelector('.inspector'),
    time: document.querySelector('.timeline-wrap'),
  }
  if (!app || !panels.lib || !panels.insp || !panels.time) return

  const sizes = load()
  const handles = {}
  const labels = {
    lib: 'Ширина библиотеки',
    insp: 'Ширина панели свойств',
    time: 'Высота таймлайна',
  }

  const available = (kind) => (kind === 'time' ? app.clientHeight : app.clientWidth)

  function apply() {
    for (const kind of Object.keys(VARS)) {
      if (sizes[kind] == null) app.style.removeProperty(VARS[kind])
      else app.style.setProperty(VARS[kind], `${clampSize(kind, sizes[kind], available(kind))}px`)
    }
  }

  function place() {
    const box = app.getBoundingClientRect()
    const narrow = window.innerWidth < 700
    for (const kind of Object.keys(handles)) handles[kind].hidden = narrow
    if (narrow) return
    const lib = panels.lib.getBoundingClientRect()
    const insp = panels.insp.getBoundingClientRect()
    const time = panels.time.getBoundingClientRect()
    Object.assign(handles.lib.style, {
      left: `${lib.right - box.left - 5}px`,
      top: `${lib.top - box.top}px`,
      height: `${lib.height}px`,
    })
    Object.assign(handles.insp.style, {
      left: `${insp.left - box.left - 5}px`,
      top: `${insp.top - box.top}px`,
      height: `${insp.height}px`,
    })
    Object.assign(handles.time.style, {
      top: `${time.top - box.top - 5}px`,
      left: '0px',
      width: `${box.width}px`,
    })
  }

  function current(kind) {
    const rect = panels[kind].getBoundingClientRect()
    return kind === 'time' ? rect.height : rect.width
  }

  function set(kind, value, persist = false) {
    sizes[kind] = clampSize(kind, value, available(kind))
    apply()
    place()
    if (persist) save(sizes)
    window.dispatchEvent(new Event('resize'))
  }

  function reset(kind) {
    delete sizes[kind]
    apply()
    place()
    save(sizes)
    window.dispatchEvent(new Event('resize'))
  }

  for (const kind of ['lib', 'insp', 'time']) {
    const el = document.createElement('div')
    el.className = `splitter splitter-${kind === 'time' ? 'h' : 'v'}`
    el.setAttribute('role', 'separator')
    el.setAttribute('aria-orientation', kind === 'time' ? 'horizontal' : 'vertical')
    el.setAttribute('aria-label', `${labels[kind]}: потяните мышью или стрелками, двойной клик сбрасывает`)
    el.tabIndex = 0
    el.title = `${labels[kind]} (двойной клик: сбросить)`
    handles[kind] = el
    app.append(el)

    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // без захвата указателя жест всё равно работает, пока курсор над разделителем
      }
      el.classList.add('is-active')
      document.body.classList.add('is-resizing')
      let frame = 0
      const move = (e) => {
        const box = app.getBoundingClientRect()
        const next =
          kind === 'lib'
            ? e.clientX - box.left
            : kind === 'insp'
              ? box.right - e.clientX
              : box.bottom - e.clientY
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => set(kind, next))
      }
      const up = () => {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // захвата могло не быть
        }
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        el.classList.remove('is-active')
        document.body.classList.remove('is-resizing')
        cancelAnimationFrame(frame)
        save(sizes)
        window.dispatchEvent(new Event('resize'))
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })

    el.addEventListener('dblclick', () => reset(kind))

    el.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? KEYBOARD_STEP_BIG : KEYBOARD_STEP
      const grow = kind === 'time' ? 'ArrowUp' : kind === 'lib' ? 'ArrowRight' : 'ArrowLeft'
      const shrink = kind === 'time' ? 'ArrowDown' : kind === 'lib' ? 'ArrowLeft' : 'ArrowRight'
      if (event.key === grow) set(kind, current(kind) + step, true)
      else if (event.key === shrink) set(kind, current(kind) - step, true)
      else if (event.key === 'Home') reset(kind)
      else return
      event.preventDefault()
    })
  }

  apply()
  place()
  const observer = new ResizeObserver(() => {
    apply()
    place()
  })
  observer.observe(app)
  window.addEventListener('resize', place)
}
