import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FRAME_MIN,
  SCALE_MAX,
  SCALE_MIN,
  SHIFT_MAX,
  clipFrame,
  clampOffset,
  keepPicture,
  keepPictureCover,
  placeImage,
  panContent,
  regionFromFrame,
  resizeFrame,
  snapGuide,
  wheelFactor,
  zoomAtPoint,
} from '../public/js/crop-math.js'

const full = { x: 0, y: 0, w: 1, h: 1 }

function near(actual, expected, eps = 1e-9) {
  assert.ok(Number.isFinite(actual), `не число: ${actual}`)
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`)
}

function cover(frame, scale, shift, canvas) {
  const center = frame.x + frame.w * (0.5 + shift)
  return (canvas - center) / (frame.w * scale)
}

test('рамка клипа: весь холст или область', () => {
  assert.deepEqual(clipFrame(null), full)
  assert.deepEqual(clipFrame({ region: null }), full)
  assert.deepEqual(clipFrame({ region: { x: 0, y: 0.5, w: 1, h: 0.5 } }), { x: 0, y: 0.5, w: 1, h: 0.5 })
  assert.deepEqual(clipFrame({ region: { x: 0, y: 0, w: 0, h: 1 } }), full)
  assert.equal(regionFromFrame(full), null)
  assert.deepEqual(regionFromFrame({ x: 0, y: 0, w: 1, h: 0.5 }), { x: 0, y: 0, w: 1, h: 0.5 })
})

function sameFrame(frame, expected) {
  near(frame.x, expected.x)
  near(frame.y, expected.y)
  near(frame.w, expected.w)
  near(frame.h, expected.h)
}

test('ручки сторон и углов двигают только свои края', () => {
  sameFrame(resizeFrame(full, 'e', -0.25, 0.4), { x: 0, y: 0, w: 0.75, h: 1 })
  sameFrame(resizeFrame(full, 'n', 0.4, 0.25), { x: 0, y: 0.25, w: 1, h: 0.75 })
  sameFrame(resizeFrame(full, 'se', -0.25, -0.5), { x: 0, y: 0, w: 0.75, h: 0.5 })
  sameFrame(resizeFrame({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 }, 'nw', 0.1, 0.1), {
    x: 0.3,
    y: 0.2,
    w: 0.4,
    h: 0.3,
  })
})

test('рамка не меньше 0.05 и не выходит за холст', () => {
  const shrunk = resizeFrame(full, 'e', -0.99, 0)
  near(shrunk.w, FRAME_MIN)
  near(shrunk.x, 0)
  sameFrame(resizeFrame(full, 'w', -0.5, 0), full)
  sameFrame(resizeFrame(full, 'se', -0.99, -0.99), { x: 0, y: 0, w: FRAME_MIN, h: FRAME_MIN })
  const pinned = resizeFrame({ x: 0.2, y: 0, w: 0.8, h: 1 }, 'w', 0.9, 0)
  near(pinned.w, FRAME_MIN)
  near(pinned.x + pinned.w, 1)
  assert.ok(pinned.x >= 0 && pinned.y >= 0)
  assert.ok(pinned.y + pinned.h <= 1 + 1e-9)
})

test('привязка к третям и половине, Alt её выключает', () => {
  const snapped = resizeFrame(full, 's', 0, -0.49)
  assert.equal(snapped.h, 0.5)
  const exact = resizeFrame(full, 'e', -0.5 + 0.01, 0)
  assert.equal(exact.w, 0.5)
  const loose = resizeFrame(full, 'e', -0.5 + 0.02, 0)
  near(loose.w, 0.52)
  const free = resizeFrame(full, 's', 0, -0.49, { snap: false })
  near(free.h, 0.51)
  assert.equal(snapGuide(1 / 3 + 0.01, true), 1 / 3)
  near(snapGuide(1 / 3 + 0.01, false), 1 / 3 + 0.01)
  assert.equal(snapGuide(2 / 3 - 0.015), 2 / 3)
  near(snapGuide(2 / 3 - 0.016), 2 / 3 - 0.016)
})

test('привязка уступает минимальному размеру', () => {
  const frame = { x: 0.46, y: 0, w: 0.05, h: 1 }
  const next = resizeFrame(frame, 'e', -0.005, 0)
  assert.ok(next.w >= FRAME_MIN - 1e-9)
  assert.ok(next.x + next.w <= 1 + 1e-9)
})

test('картинка остаётся у неподвижного края, иначе сдвиг не меняется', () => {
  const cover1 = keepPicture(full, { x: 0, y: 0, w: 0.5, h: 1 }, 0, 0, 1)
  near(cover1.x, 0)
  near(cover1.y, 0)
  const zoomed = keepPicture(full, { x: 0, y: 0, w: 0.5, h: 1 }, 0, 0, 2)
  near(zoomed.x, -0.5)
  near(zoomed.y, 0)
  const beforeLeft = full.x + full.w * ((1 - 2) / 2 + 0)
  const afterLeft = 0 + 0.5 * ((1 - 2) / 2 + zoomed.x)
  near(afterLeft, beforeLeft)
  const tooFar = keepPicture(full, { x: 0, y: 0, w: FRAME_MIN, h: 1 }, 0, 0, 8)
  near(tooFar.x, 0)
  near(tooFar.y, 0)
  const top = keepPicture(full, { x: 0, y: 0.2, w: 1, h: 0.8 }, 0, 0.25, 1.5)
  near(top.x, 0)
  assert.notEqual(top.y, 0.25)
})

test('панорамирование делит пиксели на размер рамки и зажимает сдвиг', () => {
  const moved = panContent({ x: 0.1, y: -0.2 }, 50, -25, 100, 200)
  near(moved.x, 0.6)
  near(moved.y, -0.325)
  const hit = panContent({ x: 0, y: 0 }, 1000, -1000, 100, 100)
  assert.equal(hit.x, SHIFT_MAX)
  assert.equal(hit.y, -SHIFT_MAX)
  const idle = panContent({ x: 0.2, y: 0.3 }, 10, 10, 0, 0)
  near(idle.x, 0.2)
  near(idle.y, 0.3)
})

test('масштаб в точке курсора оставляет её на месте', () => {
  const frame = full
  const center = zoomAtPoint({ scale: 1, x: 0, y: 0 }, frame, 2, 0.5, 0.5)
  assert.equal(center.scale, 2)
  near(center.x, 0)
  near(center.y, 0)
  const before = { scale: 1, x: 0.25, y: -0.1 }
  const cursorX = 0.2
  const cursorY = 0.8
  const next = zoomAtPoint(before, frame, 1.5, cursorX, cursorY)
  near(next.scale, 1.5)
  near(cover(frame, before.scale, before.x, cursorX), cover(frame, next.scale, next.x, cursorX))
  near(
    cover({ ...frame, w: frame.h, x: frame.y }, before.scale, before.y, cursorY),
    cover(frame, next.scale, next.y, cursorY),
  )
  const edge = zoomAtPoint({ scale: 1, x: 0, y: 0 }, frame, 2, 0, 0.5)
  near(edge.x, 0.5)
  near(cover(frame, 1, 0, 0), cover(frame, edge.scale, edge.x, 0))
})

test('масштаб и сдвиг зажимаются по границам', () => {
  const hi = zoomAtPoint({ scale: 1, x: 0, y: 0 }, full, 100, 0.5, 0.5)
  assert.equal(hi.scale, SCALE_MAX)
  const lo = zoomAtPoint({ scale: 1, x: 0, y: 0 }, full, 0.0001, 0.5, 0.5)
  assert.equal(lo.scale, SCALE_MIN)
  const shifted = zoomAtPoint({ scale: 1, x: 3, y: -3 }, full, 8, 0, 1)
  assert.equal(shifted.scale, SCALE_MAX)
  assert.equal(shifted.x, SHIFT_MAX)
  assert.equal(shifted.y, -SHIFT_MAX)
  const coarse = wheelFactor(-100, false)
  const fine = wheelFactor(-100, true)
  assert.ok(coarse > 1 && fine > 1)
  assert.ok(fine < coarse)
  assert.equal(wheelFactor(100000, false), 0.5)
  assert.equal(wheelFactor(0, false), 1)
})

// Эталон: те же выражения, что в src/ffmpeg.js (regionChain), в пикселях без округления до чётных.
function exportPlacement(frame, x, y, scale, geo) {
  const fw = frame.w * geo.canvasW
  const fh = frame.h * geo.canvasH
  const f = Math.max((fw * scale) / geo.mediaW, (fh * scale) / geo.mediaH)
  const iw = geo.mediaW * f
  const ih = geo.mediaH * f
  const axis = (image, win, d) => {
    if (image > win) return -Math.max(0, Math.min(image - win, (image - win) / 2 - d))
    return Math.max(0, Math.min(win - image, (win - image) / 2 + d))
  }
  return {
    left: frame.x * geo.canvasW + axis(iw, fw, x * fw),
    top: frame.y * geo.canvasH + axis(ih, fh, y * fh),
    width: iw,
    height: ih,
  }
}

const GEO = { mediaW: 1080, mediaH: 1920, canvasW: 1080, canvasH: 1920 }
const closeTo = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('placeImage повторяет расчёт экспорта (ffmpeg)', () => {
  const frames = [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 1, h: 0.5 },
    { x: 0, y: 0.5, w: 1, h: 0.5 },
    { x: 0.1, y: 0.607, w: 0.7, h: 0.393 },
  ]
  const shifts = [
    [0, 0, 1],
    [0, 0.33, 1.12],
    [0.014, 0.65, 1],
    [0, 0.5, 1],
    [3, -3, 2],
    [0.2, 0.2, 0.5],
    [-0.4, 0.9, 0.2],
  ]
  for (const frame of frames) {
    for (const [x, y, scale] of shifts) {
      const got = placeImage(frame, { x, y }, scale, GEO)
      const want = exportPlacement(frame, x, y, scale, GEO)
      closeTo(got.left * GEO.canvasW, want.left, 1e-6)
      closeTo(got.top * GEO.canvasH, want.top, 1e-6)
      closeTo(got.width * GEO.canvasW, want.width, 1e-6)
      closeTo(got.height * GEO.canvasH, want.height, 1e-6)
    }
  }
})

test('placeImage: картинка с запасом по высоте не оставляет чёрного сверху при сдвиге вниз', () => {
  // верхняя половина, портрет 1080x1920, сдвиг 0.33: окно области всё ещё внутри картинки
  const frame = { x: 0, y: 0, w: 1, h: 0.5 }
  const placed = placeImage(frame, { x: 0, y: 0.33 }, 1.12, GEO)
  assert.ok(placed.top <= frame.y + 1e-9, 'верх картинки не ниже верха области')
  assert.ok(placed.top + placed.height >= frame.y + frame.h - 1e-9, 'низ картинки не выше низа области')
})

test('clampOffset: сдвиг за краем картинки зажимается, как в экспорте', () => {
  const frame = { x: 0, y: 0, w: 1, h: 0.5 }
  const big = clampOffset(frame, { x: 0, y: 3 }, 1, GEO)
  // картинка 1080x1920 в окне 1080x960: максимум сдвига вниз (1920-960)/2 / 960 = 0.5
  closeTo(big.y, 0.5)
  assert.equal(clampOffset(frame, { x: 0, y: 0.2 }, 1, GEO).y, 0.2)
})

test('keepPictureCover: при обрезке стороны картинка остаётся на месте и того же размера', () => {
  const before = { x: 0, y: 0, w: 1, h: 1 }
  const after = { x: 0, y: 0, w: 1, h: 0.5 }
  const was = placeImage(before, { x: 0, y: 0 }, 1, GEO)
  const next = keepPictureCover(before, after, 0, 0, 1, GEO)
  const now = placeImage(after, { x: next.x, y: next.y }, next.scale, GEO)
  closeTo(now.left, was.left)
  closeTo(now.top, was.top)
  closeTo(now.width, was.width)
  closeTo(now.height, was.height)
})
