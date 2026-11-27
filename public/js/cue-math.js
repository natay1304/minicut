// Геометрия подписей на таймлайне (без DOM, проверяется тестами).
import { round3 } from './util.js'

export const MIN_CUE = 0.2

/**
 * Считает новый интервал подписи.
 * @param {'move'|'in'|'out'} mode что тянем: всю подпись, начало или конец
 * @param {{start:number,end:number}} orig исходный интервал
 * @param {number} delta сдвиг мыши в секундах
 * @param {(time:number)=>{time:number,hit:boolean}} snap привязка к соседним границам
 */
export function nextRange(mode, orig, delta, snap = (time) => ({ time, hit: false })) {
  if (mode === 'move') {
    const length = orig.end - orig.start
    const start = Math.max(0, orig.start + delta)
    const a = snap(start)
    const b = snap(start + length)
    let from = start
    let hit = null
    if (a.hit) {
      from = a.time
      hit = a.time
    } else if (b.hit) {
      from = b.time - length
      hit = b.time
    }
    from = Math.max(0, from)
    return { start: round3(from), end: round3(from + length), snapTime: hit }
  }
  if (mode === 'in') {
    const raw = Math.min(Math.max(0, orig.start + delta), orig.end - MIN_CUE)
    const s = snap(raw)
    const start = Math.min(Math.max(0, s.time), orig.end - MIN_CUE)
    return { start: round3(start), end: orig.end, snapTime: s.hit ? s.time : null }
  }
  const raw = Math.max(orig.end + delta, orig.start + MIN_CUE)
  const s = snap(raw)
  const end = Math.max(s.time, orig.start + MIN_CUE)
  return { start: orig.start, end: round3(end), snapTime: s.hit ? s.time : null }
}

const EPS = 0.05

/**
 * Не даёт подписи наехать на соседние: при переносе выталкивает её к ближайшему краю соседа,
 * при растягивании упирает край в соседа. Уже существующие мелкие нахлёсты (до EPS) не считаются.
 * @param {'move'|'in'|'out'} mode
 * @param {{start:number,end:number}} orig исходный интервал
 * @param {{start:number,end:number,snapTime?:number|null}} next результат nextRange
 * @param {{start:number,end:number}[]} others остальные подписи
 */
export function avoidOverlap(mode, orig, next, others) {
  if (mode === 'in') {
    const limit = Math.max(0, ...others.filter((o) => o.end <= orig.start + EPS).map((o) => o.end))
    const start = Math.min(Math.max(next.start, limit), orig.end - MIN_CUE)
    return { ...next, start: round3(start) }
  }
  if (mode === 'out') {
    const ahead = others.filter((o) => o.start >= orig.end - EPS).map((o) => o.start)
    const limit = ahead.length ? Math.min(...ahead) : Infinity
    const end = Math.max(Math.min(next.end, limit), orig.start + MIN_CUE)
    return { ...next, end: round3(end) }
  }
  const length = next.end - next.start
  let from = next.start
  for (let pass = 0; pass < others.length + 1; pass++) {
    const hit = others.find((o) => from < o.end - EPS && from + length > o.start + EPS)
    if (!hit) break
    const before = hit.start - length
    const after = hit.end
    from = before >= 0 && Math.abs(before - from) <= Math.abs(after - from) ? before : after
  }
  from = Math.max(0, from)
  return { ...next, start: round3(from), end: round3(from + length) }
}
