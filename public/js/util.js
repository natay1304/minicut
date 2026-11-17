export const ZOOM_MIN = 16
export const ZOOM_MAX = 280
export const MIN_CLIP = 0.05
export const SNAP_PX = 8
export const TRACK_H = 72
export const CLIP_COLORS = ['#3a4a6b', '#6b3b45', '#3f5a57', '#5a4a70', '#2f5266', '#6a5340']
export const CLIP_LIMITS = {
  scale: [0.05, 8],
  x: [-4, 4],
  y: [-4, 4],
  volume: [0, 2],
  fadeIn: [0, 60],
  fadeOut: [0, 60],
}

export function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function pad(n, len = 2) {
  return String(n).padStart(len, '0')
}

export function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  let millis = Math.round((safe % 1) * 1000)
  let whole = Math.floor(safe)
  if (millis === 1000) {
    millis = 0
    whole += 1
  }
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const body = `${pad(m)}:${pad(s)}.${pad(millis, 3)}`
  return h > 0 ? `${h}:${body}` : body
}

export function formatRuler(seconds) {
  const tenth = Math.round(seconds * 10) / 10
  const m = Math.floor(tenth / 60)
  const s = tenth - m * 60
  if (Math.abs(tenth - Math.round(tenth)) < 0.001) return `${pad(m)}:${pad(Math.round(s))}`
  return `${pad(m)}:${s.toFixed(1).padStart(4, '0')}`
}
