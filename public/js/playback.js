import { setStatus } from './api.js'
import { hooks } from './hooks.js'
import { mediaUrl, paintCanvas, paintTransport } from './preview-canvas.js'
import {
  clearMain,
  frontVideo,
  kickOverlay,
  pauseOverlays,
  playerIndexFor,
  showFrame,
  showSource,
  syncOverlay,
} from './preview-players.js'
import {
  canvasInfo,
  clipStart,
  locate,
  mainClips,
  mainDuration,
  mediaById,
  timelineSpan,
  topClipAt,
} from './project-model.js'
import { selectOnly } from './selection.js'
import { overlayVideos, playBtn, playhead, ruler, stage, state, timelineScroll, videos } from './state.js'
import { paintPlayhead, paintSelection, paintTimecode, timeFromClientX } from './timeline.js'
import { clamp } from './util.js'

export function pausePlayback() {
  state.playing = false
  state.shuttle = 0
  state.playbackArmed = false
  for (const video of videos) video.pause()
  pauseOverlays()
  if (state.raf) {
    cancelAnimationFrame(state.raf)
    state.raf = 0
  }
  paintTransport()
}

export function unlockAudio(player, mediaId) {
  if (player.dataset.mediaId !== mediaId) {
    player.dataset.mediaId = mediaId
    player.src = mediaUrl(mediaId)
  }
  const pending = player.play()
  if (pending) pending.catch(() => {})
  for (const video of videos) {
    if (video === player || video.dataset.unlocked) continue
    if (!video.dataset.mediaId) {
      video.dataset.mediaId = mediaId
      video.src = mediaUrl(mediaId)
    }
    video.dataset.unlocked = '1'
    video.muted = true
    const extra = video.play()
    if (!extra) {
      video.muted = false
      continue
    }
    extra
      .then(() => {
        if (video !== frontVideo()) video.pause()
        video.muted = false
      })
      .catch(() => {
        video.muted = false
      })
  }
}

export function startPlayback() {
  const total = mainDuration()
  if (total <= 0) {
    setStatus('На основной дорожке нет клипов', true)
    return
  }
  if (state.playhead >= total - 0.001) state.playhead = 0
  const loc = locate(state.playhead)
  if (!loc) return
  state.playIndex = loc.index
  state.playing = true
  paintTransport()
  ensureRaf()
  const source = loc.sourceTime >= loc.clip.out ? Math.max(loc.clip.in, loc.clip.out - 0.001) : loc.sourceTime
  const player = videos[playerIndexFor(loc.clip.mediaId, source)]
  if (state.shuttle > 0) {
    unlockAudio(player, loc.clip.mediaId)
    player.playbackRate = state.shuttle
    kickOverlay(state.playhead)
  } else {
    player.pause()
  }
  void showSource(loc, { play: state.shuttle > 0 })
}

export function resyncPlayback() {
  const total = mainDuration()
  if (total <= 0) {
    pausePlayback()
    clearMain()
    void syncOverlay(state.playhead, { play: false })
    return
  }
  const loc = locate(Math.min(state.playhead, Math.max(total - 0.001, 0)))
  if (!loc) {
    pausePlayback()
    return
  }
  state.playIndex = loc.index
  void showSource(loc, { play: state.shuttle > 0 })
}

export function togglePlay() {
  if (state.playing) pausePlayback()
  else {
    state.shuttle = 1
    startPlayback()
  }
}

export function ensureRaf() {
  if (state.raf) return
  state.lastTs = 0
  state.raf = requestAnimationFrame(tick)
}

export function tick(ts) {
  if (!state.playing) {
    state.raf = 0
    return
  }
  state.raf = requestAnimationFrame(tick)
  const dt = state.lastTs ? Math.min(0.1, (ts - state.lastTs) / 1000) : 0
  state.lastTs = ts
  if (state.shuttle > 0) followVideo()
  else if (state.shuttle < 0) reverseStep(dt)
}

export function followVideo() {
  if (!state.playbackArmed || state.transitioning || frontVideo().seeking) return
  const clips = mainClips()
  const clip = clips[state.playIndex]
  const player = frontVideo()
  if (!clip || player.dataset.mediaId !== clip.mediaId) return
  const start = clipStart(state.playIndex)
  const dur = clip.out - clip.in
  const slop = Math.min(0.015, dur * 0.25)
  if (player.currentTime >= clip.out - slop) {
    const overshoot = Math.max(0, player.currentTime - clip.out)
    continueFrom(start + dur + overshoot)
    return
  }
  const local = player.currentTime - clip.in
  if (local < -0.08) return
  state.playhead = start + clamp(local, 0, dur)
  paintPlayhead()
  paintTimecode()
  paintCanvas()
  revealPlayhead()
  void syncOverlay(state.playhead, { play: true })
}

export function reverseStep(dt) {
  const speed = Math.abs(state.shuttle)
  const time = state.playhead - dt * speed
  if (time <= 0) {
    state.playhead = 0
    pausePlayback()
    void showFrame(0)
    return
  }
  state.playhead = time
  paintPlayhead()
  paintTimecode()
  paintCanvas()
  revealPlayhead()
  void syncOverlay(time, { play: false })
  if (state.transitioning) return
  const total = mainDuration()
  if (time >= total) return
  const loc = locate(time)
  if (!loc) return
  const player = frontVideo()
  const crossed = loc.index !== state.playIndex || player.dataset.mediaId !== loc.clip.mediaId
  const drift = Math.abs(player.currentTime - loc.sourceTime)
  if (crossed || drift > 0.05) {
    state.playIndex = loc.index
    void showSource(loc, { play: false })
  }
}

export function continueFrom(time) {
  if (state.transitioning) return
  const total = mainDuration()
  if (time >= total - 0.0005) {
    state.playhead = total
    pausePlayback()
    paintPlayhead()
    paintTimecode()
    paintCanvas()
    pauseOverlays()
    return
  }
  const loc = locate(time)
  if (!loc) {
    pausePlayback()
    return
  }
  state.playIndex = loc.index
  state.playhead = loc.start + loc.local
  void showSource(loc, { play: state.shuttle > 0 })
}

export function revealPlayhead() {
  const x = state.playhead * state.zoom
  const viewLeft = timelineScroll.scrollLeft
  const viewWidth = timelineScroll.clientWidth
  const margin = 48
  if (x < viewLeft + margin) timelineScroll.scrollLeft = Math.max(0, x - margin)
  else if (x > viewLeft + viewWidth - margin) timelineScroll.scrollLeft = x - viewWidth + margin
}

export function scrubTo(clientX) {
  state.playhead = clamp(timeFromClientX(clientX), 0, timelineSpan())
  paintPlayhead()
  paintTimecode()
  paintCanvas()
  if (state.scrubRaf) return
  state.scrubRaf = requestAnimationFrame(() => {
    state.scrubRaf = 0
    void showFrame(state.playhead)
  })
}

export function beginScrub(event) {
  if (event.button !== 0) return
  event.preventDefault()
  const wasPlaying = state.playing
  pausePlayback()
  scrubTo(event.clientX)
  const onMove = (ev) => scrubTo(ev.clientX)
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (wasPlaying) {
      state.shuttle = 1
      startPlayback()
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

export function currentFps() {
  const total = mainDuration()
  const t = total > 0 ? clamp(state.playhead, 0, Math.max(total - 0.001, 0)) : 0
  const loc = total > 0 ? locate(t) : null
  const fps = loc ? mediaById(loc.clip.mediaId)?.fps : canvasInfo().fps
  return fps > 0 ? fps : 30
}

export function stepFrame(dir) {
  pausePlayback()
  const frame = 1 / currentFps()
  void showFrame(clamp(state.playhead + dir * frame, 0, timelineSpan()))
  revealPlayhead()
}

export function shuttle(dir) {
  const prev = state.shuttle
  if (dir > 0) state.shuttle = prev > 0 ? Math.min(prev * 2, 8) : 1
  else state.shuttle = prev < 0 ? Math.max(prev * 2, -8) : -1
  if (state.playing && prev > 0 && state.shuttle > 0 && frontVideo().dataset.mediaId) {
    frontVideo().playbackRate = state.shuttle
    for (const video of overlayVideos.values()) {
      if (video.classList.contains('is-on') && !video.paused) video.playbackRate = state.shuttle
    }
    paintTransport()
    return
  }
  startPlayback()
}

export function bindPlayback() {
  playBtn.addEventListener('click', togglePlay)
  stage.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input, textarea, select')) return
    if (event.target.closest('#canvas-box')) {
      const clip = topClipAt(state.playhead)
      if (clip) {
        selectOnly(clip.id)
        paintSelection()
        hooks.fillClipForm()
        return
      }
    }
    togglePlay()
  })
  ruler.addEventListener('pointerdown', beginScrub)
  playhead.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    beginScrub(event)
  })
  for (const video of videos) {
    video.addEventListener('ended', () => {
      if (!state.playing || state.shuttle <= 0 || state.transitioning || video !== frontVideo()) return
      const clip = mainClips()[state.playIndex]
      if (!clip || video.dataset.mediaId !== clip.mediaId) return
      if (video.currentTime + 0.08 < clip.out) return
      continueFrom(clipStart(state.playIndex) + (clip.out - clip.in))
    })
  }
}
