/** Скорость клипа на таймлайне. Поле в проекте есть только если скорость не 1. */

export const SPEED_MIN = 0.25
export const SPEED_MAX = 4

const PLAYBACK_RATE_MIN = 0.0625
const PLAYBACK_RATE_MAX = 16

/** Скорость клипа: 1 — как в исходнике, 2 — вдвое быстрее. Нечисло и неположительное значение — 1. */
export function speedOf(clip) {
  const speed = Number(clip?.speed)
  return Number.isFinite(speed) && speed > 0 ? speed : 1
}

/** Длина клипа на таймлайне в секундах: исходный отрезок делится на скорость. */
export function clipLength(clip) {
  const span = Number(clip?.out) - Number(clip?.in)
  if (!Number.isFinite(span)) return 0
  return span / speedOf(clip)
}

/** Метка в исходнике: in + время на клипе × скорость. */
export function sourceTimeAt(clip, local) {
  const inn = Number(clip?.in)
  const base = Number.isFinite(inn) ? inn : 0
  const along = Number(local)
  const offset = Number.isFinite(along) ? along : 0
  return base + offset * speedOf(clip)
}

/** Время на таймлайне от in клипа до метки исходника. */
export function timelineOffset(clip, sourceTime) {
  const inn = Number(clip?.in)
  const base = Number.isFinite(inn) ? inn : 0
  const at = Number(sourceTime)
  const source = Number.isFinite(at) ? at : base
  return (source - base) / speedOf(clip)
}

/** Подпись «×2» / «×0.5». */
export function formatSpeed(clip) {
  const rounded = Math.round(speedOf(clip) * 1000) / 1000
  return `×${rounded}`
}

/**
 * Скорость элемента video: скорость клипа, умноженная на шаттл.
 * Диапазон ограничен тем, что обычно принимают браузеры.
 */
export function playbackRateFor(clip, shuttle = 1) {
  const extra = Number(shuttle)
  const factor = Number.isFinite(extra) && extra > 0 ? extra : 1
  const rate = speedOf(clip) * factor
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate))
}
