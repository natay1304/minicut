import { setStatus } from './api.js'
import { hooks } from './hooks.js'
import { applyFrame, mediaUrl, paintCanvas } from './preview-canvas.js'
import {
  clipOnTrackAt,
  freeTracks,
  locate,
  mainClips,
  mainDuration,
  overlayIndex,
  overlaySourceTime,
  timelineSpan,
  viewClip,
} from './project-model.js'
import { $, overlayVideos, state, videos } from './state.js'
import { paintPlayhead, paintTimecode } from './timeline.js'
import { clamp } from './util.js'

export function frontVideo() {
  return videos[state.front]
}

export function playerIndexFor(mediaId, sourceTime) {
  const score = (index) => {
    const video = videos[index]
    if (video.dataset.mediaId !== mediaId || video.readyState < 2) return Infinity
    return Math.abs((video.currentTime || 0) - sourceTime)
  }
  const frontScore = score(state.front)
  const backScore = score(1 - state.front)
  if (frontScore < Infinity && frontScore <= backScore + 0.03) return state.front
  if (backScore < Infinity) return 1 - state.front
  return state.front
}

function reveal(index) {
  videos[index].classList.add('is-on')
  videos[1 - index].classList.remove('is-on')
  if (state.front !== index) {
    videos[state.front].pause()
    state.front = index
  }
}

export function clearMain() {
  state.sourceToken += 1
  state.transitioning = false
  state.playbackArmed = false
  for (const video of videos) {
    video.pause()
    video.classList.remove('is-on')
    video.removeAttribute('src')
    video.dataset.mediaId = ''
    video.dataset.token = String(Number(video.dataset.token || 0) + 1)
    try {
      video.load()
    } catch {
      /* уже пустой */
    }
    applyFrame(video, null)
  }
  state.front = 0
}

function releaseOverlayVideo(video) {
  video.dataset.job = String(Number(video.dataset.job || 0) + 1)
  video.pause()
  video.classList.remove('is-on')
  video.removeAttribute('src')
  video.dataset.mediaId = ''
  video.dataset.clipId = ''
  video.dataset.failClip = ''
  video.dataset.preparing = ''
  video.dataset.token = String(Number(video.dataset.token || 0) + 1)
  try {
    video.load()
  } catch {
    /* уже пустой */
  }
  applyFrame(video, null)
}

function clearOverlay() {
  for (const id of [...overlayVideos.keys()]) {
    const video = overlayVideos.get(id)
    releaseOverlayVideo(video)
    video.remove()
    overlayVideos.delete(id)
  }
}

export function syncOverlayPool() {
  const ids = new Set(freeTracks().map((track) => track.id))
  for (const id of [...overlayVideos.keys()]) {
    if (ids.has(id)) continue
    const video = overlayVideos.get(id)
    releaseOverlayVideo(video)
    video.remove()
    overlayVideos.delete(id)
  }
  const before = $('captions')
  const box = $('canvas-box')
  for (const track of freeTracks()) {
    let video = overlayVideos.get(track.id)
    if (!video) {
      video = document.createElement('video')
      video.className = 'preview-video preview-overlay'
      video.playsInline = true
      video.preload = 'auto'
      video.muted = true
      video.dataset.track = track.id
      box.insertBefore(video, before)
      overlayVideos.set(track.id, video)
    }
    video.style.zIndex = String(1 + overlayIndex(track.id))
  }
}

export function clearPlayers() {
  clearMain()
  clearOverlay()
}

function clampMediaTime(video, time) {
  const dur = video.duration
  if (!Number.isFinite(dur) || dur <= 0) return Math.max(0, time)
  return clamp(time, 0, Math.max(0, dur - 0.001))
}

export function listen(video, event, token) {
  let settled = false
  let finish = () => {}
  const promise = new Promise((resolve) => {
    finish = (ok) => {
      if (settled) return
      settled = true
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onBad)
      clearTimeout(timer)
      resolve(ok && Number(video.dataset.token) === token)
    }
    const onOk = () => finish(true)
    const onBad = () => finish(false)
    const timer = setTimeout(() => finish(false), 8000)
    video.addEventListener(event, onOk)
    video.addEventListener('error', onBad)
  })
  return { promise, finish }
}

async function prepare(video, mediaId, time) {
  const token = Number(video.dataset.token || 0) + 1
  video.dataset.token = String(token)
  const still = () => Number(video.dataset.token) === token
  if (video.dataset.mediaId !== mediaId || video.readyState < 2) {
    const needsSrc = video.dataset.mediaId !== mediaId
    if (needsSrc) video.dataset.mediaId = mediaId
    const ready = listen(video, 'loadeddata', token)
    if (needsSrc) video.src = mediaUrl(mediaId)
    if (video.readyState >= 2) ready.finish(true)
    const loaded = await ready.promise
    if (!still()) return 'stale'
    if (!loaded) return 'error'
  }
  const target = clampMediaTime(video, time)
  if (Math.abs((video.currentTime || 0) - target) > 0.02) {
    const seeked = listen(video, 'seeked', token)
    try {
      video.currentTime = target
    } catch {
      return still() ? 'error' : 'stale'
    }
    if (!video.seeking && Math.abs(video.currentTime - target) <= 0.02) seeked.finish(true)
    const landed = await seeked.promise
    if (!still()) return 'stale'
    if (!landed) return 'error'
  }
  return still() ? 'ok' : 'stale'
}

function applyMainAudio(player, clip) {
  const view = viewClip(clip)
  player.muted = Boolean(view.muted)
  player.volume = clamp(Number(view.volume ?? 1), 0, 1)
  applyFrame(player, view)
}

export async function showSource(loc, { play }) {
  const token = ++state.sourceToken
  state.transitioning = true
  state.playbackArmed = false
  const source = loc.sourceTime >= loc.clip.out ? Math.max(loc.clip.in, loc.clip.out - 0.001) : loc.sourceTime
  const index = playerIndexFor(loc.clip.mediaId, source)
  const player = videos[index]
  try {
    const result = await prepare(player, loc.clip.mediaId, source)
    if (token !== state.sourceToken || result === 'stale') return
    if (result !== 'ok') throw new Error('Не удалось открыть видео')
    applyMainAudio(player, loc.clip)
    reveal(index)
    const back = videos[1 - state.front]
    if (back !== player) back.pause()
    if (play && state.playing && state.shuttle > 0) {
      player.playbackRate = state.shuttle
      state.playbackArmed = true
      await player.play()
    } else {
      player.pause()
      state.playbackArmed = state.playing && state.shuttle < 0
    }
  } catch (err) {
    if (token === state.sourceToken) {
      hooks.pausePlayback()
      setStatus(err.message || 'Не удалось показать кадр', true)
    }
  } finally {
    if (token === state.sourceToken) {
      state.transitioning = false
      void syncOverlay(state.playhead, { play: play && state.playing && state.shuttle > 0 })
      if (state.playing) void preloadNeighbor()
    }
  }
}

async function preloadNeighbor() {
  if (!state.playing || state.transitioning) return
  const dir = state.shuttle >= 0 ? 1 : -1
  const clip = mainClips()[state.playIndex + dir]
  if (!clip) return
  const back = videos[1 - state.front]
  const generation = state.sourceToken
  const time = dir > 0 ? clip.in : Math.max(clip.in, clip.out - 0.04)
  const result = await prepare(back, clip.mediaId, time)
  if (result !== 'ok' || generation !== state.sourceToken || state.transitioning) return
  if (back !== frontVideo()) back.pause()
}

function syncOneOverlay(track, time, play) {
  const video = overlayVideos.get(track.id)
  if (!video) return Promise.resolve()
  const clip = clipOnTrackAt(track, time)
  if (!clip) {
    video.dataset.job = String(Number(video.dataset.job || 0) + 1)
    if (!video.paused) video.pause()
    video.classList.remove('is-on')
    video.dataset.clipId = ''
    return Promise.resolve()
  }
  const view = viewClip(clip)
  applyFrame(video, view)
  video.muted = Boolean(view.muted)
  video.volume = clamp(Number(view.volume ?? 1), 0, 1)
  const source = overlaySourceTime(clip, time)
  if (video.dataset.failClip === clip.id) return Promise.resolve()
  const ready =
    video.dataset.clipId === clip.id && video.dataset.mediaId === clip.mediaId && video.readyState >= 2
  if (ready && video.dataset.preparing !== '1' && !video.seeking) {
    const drift = Math.abs((video.currentTime || 0) - source)
    if (video.currentTime < clip.out - 0.02 && drift <= 0.15) {
      video.classList.add('is-on')
      if (play && state.playing && state.shuttle > 0) {
        video.playbackRate = state.shuttle
        if (video.paused) video.play().catch(() => {})
      } else if (!video.paused) video.pause()
      return Promise.resolve()
    }
  }
  if (video.dataset.preparing === '1' && video.dataset.clipId === clip.id) return Promise.resolve()
  return seekOverlay(video, track, clip, Math.min(source, Math.max(clip.in, clip.out - 0.001)), play)
}

export function syncOverlay(time, { play }) {
  syncOverlayPool()
  return Promise.all(freeTracks().map((track) => syncOneOverlay(track, time, play)))
}

function seekOverlay(video, track, clip, source, play) {
  const job = Number(video.dataset.job || 0) + 1
  video.dataset.job = String(job)
  video.dataset.clipId = clip.id
  video.dataset.preparing = '1'
  video.dataset.failClip = ''
  return prepare(video, clip.mediaId, source).then((result) => {
    if (video.dataset.clipId === clip.id) video.dataset.preparing = ''
    if (Number(video.dataset.job) !== job) return
    if (result !== 'ok') {
      video.dataset.failClip = clip.id
      video.classList.remove('is-on')
      return
    }
    const still = clipOnTrackAt(track, state.playhead)
    if (!still || still.id !== clip.id) {
      video.classList.remove('is-on')
      video.dataset.clipId = ''
      return
    }
    applyFrame(video, viewClip(still))
    video.classList.add('is-on')
    video.muted = Boolean(viewClip(still).muted)
    video.volume = clamp(Number(viewClip(still).volume ?? 1), 0, 1)
    if (play && state.playing && state.shuttle > 0) {
      video.playbackRate = state.shuttle
      return video.play().catch(() => {})
    }
    video.pause()
  })
}

export function kickOverlay(time) {
  if (state.shuttle <= 0) return
  syncOverlayPool()
  for (const track of freeTracks()) {
    const clip = clipOnTrackAt(track, time)
    const video = overlayVideos.get(track.id)
    if (!clip || !video) continue
    if (video.dataset.mediaId !== clip.mediaId) {
      video.dataset.mediaId = clip.mediaId
      video.src = mediaUrl(clip.mediaId)
    }
    const view = viewClip(clip)
    video.muted = Boolean(view.muted)
    video.volume = clamp(Number(view.volume ?? 1), 0, 1)
    video.playbackRate = state.shuttle
    const pending = video.play()
    if (pending) pending.catch(() => {})
  }
}

export function pauseOverlays() {
  for (const video of overlayVideos.values()) video.pause()
}

export async function showFrame(time) {
  const token = ++state.frameToken
  const span = timelineSpan()
  state.playhead = clamp(time, 0, span)
  paintPlayhead()
  paintTimecode()
  paintCanvas()
  const total = mainDuration()
  if (total <= 0) {
    clearMain()
    if (token === state.frameToken) await syncOverlay(state.playhead, { play: false })
    return
  }
  const loc = locate(Math.min(state.playhead, Math.max(total - 0.001, 0)))
  if (!loc) clearMain()
  else await showSource(loc, { play: false })
  if (token !== state.frameToken) return
  await syncOverlay(state.playhead, { play: false })
}
