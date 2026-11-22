/** Минимальная сторона области в долях холста. */
export const FRAME_MIN = 0.05

/** Множитель cover: нижняя и верхняя граница. */
export const SCALE_MIN = 0.05
export const SCALE_MAX = 8

/** Сдвиг содержимого в долях области. Дальше сервер не принимает. */
export const SHIFT_MAX = 4

/** Насколько близко к направляющей срабатывает привязка. */
export const SNAP_DISTANCE = 0.015

/** Верхняя половина кадра — то же значение, что в инспекторе. */
export const FRAME_TOP = Object.freeze({ x: 0, y: 0, w: 1, h: 0.5 })

/** Нижняя половина кадра — то же значение, что в инспекторе. */
export const FRAME_BOTTOM = Object.freeze({ x: 0, y: 0.5, w: 1, h: 0.5 })

const SNAP_STOPS = [0, 1 / 3, 1 / 2, 2 / 3, 1]
const EDGE = 1e-8

const HANDLES = {
  n: { top: true },
  s: { bottom: true },
  e: { right: true },
  w: { left: true },
  nw: { top: true, left: true },
  ne: { top: true, right: true },
  se: { bottom: true, right: true },
  sw: { bottom: true, left: true },
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function finite(n, fallback) {
  return Number.isFinite(n) ? n : fallback
}

/**
 * Рамка клипа в долях холста от левого верхнего угла.
 * `region: null` и битая область — весь кадр.
 * @param {{ region?: { x: number, y: number, w: number, h: number } | null } | null | undefined} clip
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function clipFrame(clip) {
  const region = clip?.region
  if (region && typeof region === 'object') {
    const x = Number(region.x)
    const y = Number(region.y)
    const w = Number(region.w)
    const h = Number(region.h)
    if ([x, y, w, h].every((n) => Number.isFinite(n)) && w > 0 && h > 0) return { x, y, w, h }
  }
  return { x: 0, y: 0, w: 1, h: 1 }
}

/**
 * Область для сохранения. Весь холст — `null`.
 * @param {{ x: number, y: number, w: number, h: number } | null | undefined} frame
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function regionFromFrame(frame) {
  if (!frame) return null
  const x = Number(frame.x)
  const y = Number(frame.y)
  const w = Number(frame.w)
  const h = Number(frame.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  if (Math.abs(x) <= EDGE && Math.abs(y) <= EDGE && Math.abs(w - 1) <= EDGE && Math.abs(h - 1) <= EDGE)
    return null
  return { x, y, w, h }
}

/**
 * Привязка доли холста к 0, 1/3, 1/2, 2/3 и 1, если точка ближе чем 0.015.
 * @param {number} value
 * @param {boolean} [enabled=true] `false` — без привязки (удержан Alt)
 * @returns {number}
 */
export function snapGuide(value, enabled = true) {
  if (!enabled || !Number.isFinite(value)) return value
  let best = null
  let bestDist = SNAP_DISTANCE + 1e-9
  for (const stop of SNAP_STOPS) {
    const dist = Math.abs(value - stop)
    if (dist <= bestDist) {
      best = stop
      bestDist = dist
    }
  }
  return best == null ? value : best
}

function fitSpan(start, end, moveStart, moveEnd) {
  let a = clamp(start, 0, 1)
  let b = clamp(end, 0, 1)
  if (b - a < FRAME_MIN) {
    if (moveStart && !moveEnd) a = b - FRAME_MIN
    else b = a + FRAME_MIN
  }
  if (a < 0) {
    a = 0
    if (b < FRAME_MIN) b = FRAME_MIN
  }
  if (b > 1) {
    b = 1
    if (a > 1 - FRAME_MIN) a = 1 - FRAME_MIN
  }
  if (b - a < FRAME_MIN) {
    if (a <= 0) b = FRAME_MIN
    else {
      a = 1 - FRAME_MIN
      b = 1
    }
  }
  return { start: a, end: b }
}

/**
 * Новая рамка после перетаскивания ручки. Противоположный край стоит на месте.
 * Сторона не меньше 0.05 и не выходит за холст. Привязка уступает этим пределам.
 * @param {{ x: number, y: number, w: number, h: number }} frame
 * @param {'n'|'s'|'e'|'w'|'nw'|'ne'|'se'|'sw'} handle
 * @param {number} dx сдвиг в долях холста
 * @param {number} dy сдвиг в долях холста
 * @param {{ snap?: boolean }} [options] `snap: false` отключает привязку
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function resizeFrame(frame, handle, dx, dy, options = {}) {
  const spec = HANDLES[handle]
  const base = {
    x: finite(frame?.x, 0),
    y: finite(frame?.y, 0),
    w: finite(frame?.w, 1) > 0 ? finite(frame?.w, 1) : 1,
    h: finite(frame?.h, 1) > 0 ? finite(frame?.h, 1) : 1,
  }
  if (!spec) return { ...base }
  const snap = options.snap !== false
  const moveX = finite(dx, 0)
  const moveY = finite(dy, 0)
  let left = base.x
  let right = base.x + base.w
  let top = base.y
  let bottom = base.y + base.h
  if (spec.left) left = snapGuide(left + moveX, snap)
  if (spec.right) right = snapGuide(right + moveX, snap)
  if (spec.top) top = snapGuide(top + moveY, snap)
  if (spec.bottom) bottom = snapGuide(bottom + moveY, snap)
  if (spec.left || spec.right) {
    const span = fitSpan(left, right, Boolean(spec.left), Boolean(spec.right))
    left = span.start
    right = span.end
  }
  if (spec.top || spec.bottom) {
    const span = fitSpan(top, bottom, Boolean(spec.top), Boolean(spec.bottom))
    top = span.start
    bottom = span.end
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function imageBox(frame, x, y, scale) {
  const safe = finite(scale, 1) > 0 ? finite(scale, 1) : 1
  const left = frame.x + frame.w * ((1 - safe) / 2 + x)
  const top = frame.y + frame.h * ((1 - safe) / 2 + y)
  return { left, top, right: left + frame.w * safe, bottom: top + frame.h * safe, scale: safe }
}

function keepShift(next, previous) {
  return Number.isFinite(next) && Math.abs(next) <= SHIFT_MAX ? next : previous
}

/**
 * Сдвиг содержимого после смены рамки, чтобы картинка не уехала по холсту.
 * Масштаб не меняется. Двигается только тот край, который переехал: противоположный
 * край картинки остаётся на месте. Если для этого нужен сдвиг дальше ±4, ось не трогаем.
 * @param {{ x: number, y: number, w: number, h: number }} before
 * @param {{ x: number, y: number, w: number, h: number }} after
 * @param {number} x
 * @param {number} y
 * @param {number} [scale=1]
 * @returns {{ x: number, y: number }}
 */
export function keepPicture(before, after, x, y, scale = 1) {
  const box = imageBox(before, finite(x, 0), finite(y, 0), scale)
  const s = box.scale
  const leftMoved = Math.abs(after.x - before.x) > EDGE
  const rightMoved = Math.abs(after.x + after.w - (before.x + before.w)) > EDGE
  const topMoved = Math.abs(after.y - before.y) > EDGE
  const bottomMoved = Math.abs(after.y + after.h - (before.y + before.h)) > EDGE
  let nextX = finite(x, 0)
  let nextY = finite(y, 0)
  if (after.w > 0) {
    if (leftMoved && !rightMoved) nextX = (box.right - after.x) / after.w - (1 + s) / 2
    else if (rightMoved && !leftMoved) nextX = (box.left - after.x) / after.w - (1 - s) / 2
    else if (leftMoved && rightMoved) {
      const center = (box.left + box.right) / 2
      nextX = (center - after.x) / after.w - 0.5
    }
  }
  if (after.h > 0) {
    if (topMoved && !bottomMoved) nextY = (box.bottom - after.y) / after.h - (1 + s) / 2
    else if (bottomMoved && !topMoved) nextY = (box.top - after.y) / after.h - (1 - s) / 2
    else if (topMoved && bottomMoved) {
      const center = (box.top + box.bottom) / 2
      nextY = (center - after.y) / after.h - 0.5
    }
  }
  return { x: keepShift(nextX, finite(x, 0)), y: keepShift(nextY, finite(y, 0)) }
}

/**
 * Панорамирование: сдвиг указателя в пикселях делится на ширину и высоту рамки в пикселях.
 * Вправо и вниз увеличивают x и y. Результат зажат в ±4.
 * @param {{ x?: number, y?: number }} offset
 * @param {number} pixelDx
 * @param {number} pixelDy
 * @param {number} frameWidthPx
 * @param {number} frameHeightPx
 * @returns {{ x: number, y: number }}
 */
export function panContent(offset, pixelDx, pixelDy, frameWidthPx, frameHeightPx) {
  const x = finite(offset?.x, 0)
  const y = finite(offset?.y, 0)
  const dx = frameWidthPx > 0 && Number.isFinite(pixelDx) ? pixelDx / frameWidthPx : 0
  const dy = frameHeightPx > 0 && Number.isFinite(pixelDy) ? pixelDy / frameHeightPx : 0
  return { x: clamp(x + dx, -SHIFT_MAX, SHIFT_MAX), y: clamp(y + dy, -SHIFT_MAX, SHIFT_MAX) }
}

/**
 * Множитель колеса мыши. Отрицательный deltaY (от себя) увеличивает масштаб.
 * `fine` — мелкий шаг (зажат Shift). Один жест не прыгает сильнее чем в 2 раза.
 * @param {number} deltaY
 * @param {boolean} [fine=false]
 * @param {number} [deltaMode=0] 0 — пиксели, 1 — строки, 2 — страницы
 * @returns {number}
 */
export function wheelFactor(deltaY, fine = false, deltaMode = 0) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  const speed = fine ? 0.001 : 0.0025
  return clamp(Math.exp(-pixels * speed), 0.5, 2)
}

/**
 * Масштаб множителем вокруг точки холста. Точка под курсором остаётся на картинке,
 * пока x и y помещаются в ±4. Масштаб зажат в 0.05..8.
 * @param {{ scale?: number, x?: number, y?: number }} content
 * @param {{ x: number, y: number, w: number, h: number }} frame
 * @param {number} factor
 * @param {number} canvasX доля холста
 * @param {number} canvasY доля холста
 * @returns {{ scale: number, x: number, y: number }}
 */
export function zoomAtPoint(content, frame, factor, canvasX, canvasY) {
  const scale0 = clamp(finite(content?.scale, 1) > 0 ? finite(content?.scale, 1) : 1, SCALE_MIN, SCALE_MAX)
  const raw = Number.isFinite(factor) && factor > 0 ? factor : 1
  const scale = clamp(scale0 * raw, SCALE_MIN, SCALE_MAX)
  const applied = scale0 > 0 ? scale / scale0 : 1
  const x0 = finite(content?.x, 0)
  const y0 = finite(content?.y, 0)
  const safe = frame?.w > 0 && frame?.h > 0 ? frame : { x: 0, y: 0, w: 1, h: 1 }
  const qx = (finite(canvasX, safe.x + safe.w / 2) - safe.x) / safe.w
  const qy = (finite(canvasY, safe.y + safe.h / 2) - safe.y) / safe.h
  const x = qx - 0.5 - (qx - 0.5 - x0) * applied
  const y = qy - 0.5 - (qy - 0.5 - y0) * applied
  return {
    scale,
    x: clamp(Number.isFinite(x) ? x : x0, -SHIFT_MAX, SHIFT_MAX),
    y: clamp(Number.isFinite(y) ? y : y0, -SHIFT_MAX, SHIFT_MAX),
  }
}
