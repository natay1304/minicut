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
