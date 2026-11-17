import { CLIP_COLORS, clamp } from './util.js'
import { state } from './state.js'

export function tracks(project = state.project) {
  return project.tracks || []
}

export function overlayIndex(id) {
  if (id === 'overlay') return 1
  const match = /^overlay(\d+)$/.exec(id || '')
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isInteger(n) || n < 1 || n > 10) return null
  return n
}

export function trackLabel(id) {
  if (id === 'main') return 'V1'
  const n = overlayIndex(id)
  return n ? `O${n}` : id
}

export function trackByName(id, project = state.project) {
  return tracks(project).find((track) => track.id === id) || null
}

export function mainClips(project = state.project) {
  return trackByName('main', project)?.clips || []
}

export function freeTracks(project = state.project) {
  return tracks(project)
    .filter((track) => overlayIndex(track.id))
    .sort((a, b) => overlayIndex(a.id) - overlayIndex(b.id))
}

export function displayTracks(project = state.project) {
  const main = trackByName('main', project)
  return [...freeTracks(project)].reverse().concat(main ? [main] : [])
}

export function overlayClips(project = state.project) {
  return freeTracks(project).flatMap((track) => track.clips)
}

export function texts(project = state.project) {
  return project.texts || []
}

export function styleMap(project = state.project) {
  return project.styles || {}
}

export function canvasInfo(project = state.project) {
  return project.canvas || { width: 1080, height: 1920, fps: 30 }
}

export function mediaById(id) {
  return state.project.media.find((item) => item.id === id) || null
}

export function clipById(id, project = state.project) {
  for (const track of tracks(project)) {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index >= 0) return { track, index, clip: track.clips[index] }
  }
  return null
}

export function primaryClip() {
  const id =
    state.primaryId && state.selectedIds.has(state.primaryId) ? state.primaryId : [...state.selectedIds][0]
  return id ? clipById(id)?.clip || null : null
}

export function clipColor(mediaId) {
  let n = 0
  for (const ch of String(mediaId || '')) n = (n * 33 + ch.charCodeAt(0)) >>> 0
  return CLIP_COLORS[n % CLIP_COLORS.length]
}

export function mainDuration(project = state.project) {
  let sum = 0
  for (const clip of mainClips(project)) sum += Math.max(0, clip.out - clip.in)
  return Math.max(0, sum)
}

export function timelineSpan(project = state.project) {
  let end = mainDuration(project)
  for (const clip of overlayClips(project)) {
    end = Math.max(end, (clip.start || 0) + Math.max(0, clip.out - clip.in))
  }
  for (const text of texts(project)) end = Math.max(end, Number(text.end) || 0)
  return Math.max(0, end)
}

export function clipOnTrackAt(track, time) {
  let hit = null
  for (const clip of track?.clips || []) {
    const start = clip.start || 0
    const dur = clip.out - clip.in
    if (time >= start && time < start + dur - 0.0001) hit = clip
  }
  return hit
}

export function clipStart(index, clips = mainClips()) {
  let acc = 0
  for (let i = 0; i < index; i++) acc += clips[i].out - clips[i].in
  return acc
}

export function locate(time, clips = mainClips()) {
  if (!clips.length) return null
  let acc = 0
  const total = clips.reduce((sum, clip) => sum + (clip.out - clip.in), 0)
  const t = clamp(time, 0, total)
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const len = clip.out - clip.in
    const end = acc + len
    const last = i === clips.length - 1
    if (t < end || last) {
      const local = clamp(t - acc, 0, len)
      return { index: i, clip, start: acc, dur: len, local, sourceTime: clip.in + local }
    }
    acc = end
  }
  return null
}

export function overlayAt(time) {
  let hit = null
  for (const track of freeTracks()) {
    const clip = clipOnTrackAt(track, time)
    if (clip) hit = clip
  }
  return hit
}

export function topClipAt(time) {
  const over = overlayAt(time)
  if (over) return over
  const total = mainDuration()
  if (total > 0 && time < total) return locate(time)?.clip || null
  return null
}

export function overlaySourceTime(clip, time) {
  const dur = Math.max(0.001, clip.out - clip.in)
  const local = clamp(time - (clip.start || 0), 0, dur - 0.001)
  return clip.in + local
}

export function projectSignature(project) {
  const body = (project.tracks || []).map((track) => ({
    id: track.id,
    clips: track.clips.map((clip) => [clip.id, clip.mediaId, clip.in, clip.out, clip.start ?? null]),
  }))
  const media = (project.media || []).map((item) => `${item.id}:${item.path}`)
  return JSON.stringify({ body, media })
}

export function viewClip(clip) {
  if (!clip || !state.previewPatch || state.previewPatch.id !== clip.id) return clip
  return { ...clip, ...state.previewPatch }
}
