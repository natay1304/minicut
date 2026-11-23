import { round3 } from '../ffmpeg.js'
import { commit } from './history.js'
import {
  OVERLAY_LIMIT,
  OpError,
  mustNum,
  overlayIndex,
  overlayTrackId,
  sortProjectTracks,
} from './project.js'

export function parseTrack(value) {
  if (value == null || value === '') return 'main'
  if (value === 'main') return 'main'
  const index = overlayIndex(value)
  if (index) return overlayTrackId(index)
  if (typeof value === 'string' && /^overlay\d+$/.test(value)) {
    throw new OpError('Максимум 10 оверлей-дорожек')
  }
  throw new OpError(`Неизвестная дорожка: ${value}`)
}

// Недостающие оверлеи до нужного номера создаются вместе с промежуточными.
function ensureOverlayTracks(draft, count) {
  for (let n = 1; n <= count; n++) {
    const id = overlayTrackId(n)
    if (!draft.tracks.some((track) => track.id === id)) {
      draft.tracks.push({ id, kind: 'free', clips: [] })
    }
  }
  draft.tracks = sortProjectTracks(draft.tracks)
}

export function trackOf(draft, value) {
  const id = parseTrack(value)
  const index = overlayIndex(id)
  if (index) ensureOverlayTracks(draft, index)
  return id
}

export function trackById(draft, id) {
  const track = draft.tracks.find((item) => item.id === id)
  if (!track) throw new OpError(`Неизвестная дорожка: ${id}`)
  return track
}

export function findClip(draft, clipId, trackId) {
  const track = trackById(draft, trackId)
  const index = track.clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) throw new OpError(`Клип не найден: ${clipId}`)
  return { track, index, clip: track.clips[index] }
}

export function findClipAnywhere(draft, clipId) {
  for (const track of draft.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId)
    if (index >= 0) return { track, index, clip: track.clips[index] }
  }
  throw new OpError(`Клип не найден: ${clipId}`)
}

function timelinePosition(track, index) {
  if (track.kind !== 'ripple') return round3(track.clips[index]?.start ?? 0)
  let acc = 0
  for (let i = 0; i < index; i++) acc += track.clips[i].out - track.clips[i].in
  return round3(acc)
}

function clipCore(clip) {
  return {
    id: clip.id,
    mediaId: clip.mediaId,
    in: clip.in,
    out: clip.out,
    name: clip.name,
    scale: clip.scale,
    x: clip.x,
    y: clip.y,
    region: clip.region ?? null,
    volume: clip.volume,
    muted: clip.muted,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  }
}

export function addOverlayTrack() {
  return commit((draft) => {
    const have = new Set(draft.tracks.map((track) => overlayIndex(track.id)).filter(Boolean))
    let next = 0
    for (let n = 1; n <= OVERLAY_LIMIT; n++) {
      if (!have.has(n)) {
        next = n
        break
      }
    }
    if (!next) throw new OpError('Максимум 10 оверлей-дорожек')
    const id = overlayTrackId(next)
    draft.tracks.push({ id, kind: 'free', clips: [] })
    draft.tracks = sortProjectTracks(draft.tracks)
    return id
  })
}

export function removeOverlayTrack(id) {
  const trackId = parseTrack(id)
  if (trackId === 'main') throw new OpError('Нельзя удалить основную дорожку')
  if (trackId === 'overlay') throw new OpError('Нельзя удалить первую оверлей-дорожку')
  return commit((draft) => {
    const track = draft.tracks.find((item) => item.id === trackId)
    if (!track) throw new OpError(`Дорожка не найдена: ${trackId}`)
    if (track.clips.length) throw new OpError('Дорожка не пустая')
    draft.tracks = draft.tracks.filter((item) => item.id !== trackId)
    return { id: trackId }
  })
}

export function moveClipToTrack(clipId, track, start) {
  const destId = parseTrack(track)
  return commit((draft) => {
    const index = overlayIndex(destId)
    if (index) ensureOverlayTracks(draft, index)
    const found = findClipAnywhere(draft, clipId)
    const pos = timelinePosition(found.track, found.index)
    const core = clipCore(found.clip)
    const target = draft.tracks.find((item) => item.id === destId)
    if (!target) throw new OpError(`Неизвестная дорожка: ${destId}`)
    if (found.track.id === target.id) {
      if (target.kind === 'free' && start != null) {
        const next = round3(mustNum(start, 'start'))
        if (next < 0) throw new OpError('start не может быть отрицательным')
        found.clip.start = next
      }
      return found.clip
    }
    found.track.clips.splice(found.index, 1)
    if (target.kind === 'ripple') {
      target.clips.push(core)
      return core
    }
    const nextStart = start == null ? pos : round3(mustNum(start, 'start'))
    if (nextStart < 0) throw new OpError('start не может быть отрицательным')
    const moved = { ...core, start: nextStart }
    target.clips.push(moved)
    return moved
  })
}
