import { round3 } from '../ffmpeg.js'
import { checkClipFilters } from './ffmpeg-run.js'
import { commit, getProject } from './history.js'
import {
  OpError,
  SPEED_MAX,
  SPEED_MIN,
  clipLength,
  findMedia,
  mustInt,
  mustNum,
  nextClipId,
  requireRegion,
  speedOf,
} from './project.js'
import { findClip, findClipAnywhere, parseTrack, trackById, trackOf } from './tracks.js'

function bounds(inPoint, outPoint, duration) {
  const inn = round3(inPoint)
  const out = round3(outPoint)
  if (inn < 0 || out > duration || !(inn < out)) {
    throw new OpError(`Границы клипа вне исходника (0…${duration} с)`)
  }
  return { in: inn, out }
}

function clipPatch(patch, track) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new OpError('Параметры клипа должны быть объектом')
  }
  const clean = {}
  if (patch.scale !== undefined) {
    const scale = mustNum(patch.scale, 'scale')
    if (!(scale > 0 && scale <= 8)) throw new OpError('Масштаб должен быть больше 0 и не больше 8')
    clean.scale = round3(scale)
  }
  if (patch.x !== undefined) {
    const x = mustNum(patch.x, 'x')
    if (Math.abs(x) > 4) throw new OpError('Смещение x слишком большое')
    clean.x = round3(x)
  }
  if (patch.y !== undefined) {
    const y = mustNum(patch.y, 'y')
    if (Math.abs(y) > 4) throw new OpError('Смещение y слишком большое')
    clean.y = round3(y)
  }
  if (patch.speed !== undefined) {
    const speed = mustNum(patch.speed, 'speed')
    if (speed < SPEED_MIN || speed > SPEED_MAX) {
      throw new OpError(`Скорость должна быть от ${SPEED_MIN} до ${SPEED_MAX}`)
    }
    clean.speed = round3(speed)
  }
  if (patch.vfilters !== undefined) clean.vfilters = checkClipFilters(patch.vfilters, 'vfilters')
  if (patch.afilters !== undefined) clean.afilters = checkClipFilters(patch.afilters, 'afilters')
  if (patch.region !== undefined) clean.region = requireRegion(patch.region)
  if (patch.volume !== undefined) {
    const volume = mustNum(patch.volume, 'volume')
    if (volume < 0 || volume > 2) throw new OpError('Громкость должна быть от 0 до 2')
    clean.volume = round3(volume)
  }
  if (patch.muted !== undefined) {
    if (typeof patch.muted !== 'boolean') throw new OpError('muted должен быть true или false')
    clean.muted = patch.muted
  }
  if (patch.fadeIn !== undefined) {
    const fadeIn = mustNum(patch.fadeIn, 'fadeIn')
    if (fadeIn < 0) throw new OpError('fadeIn не может быть отрицательным')
    clean.fadeIn = round3(fadeIn)
  }
  if (patch.fadeOut !== undefined) {
    const fadeOut = mustNum(patch.fadeOut, 'fadeOut')
    if (fadeOut < 0) throw new OpError('fadeOut не может быть отрицательным')
    clean.fadeOut = round3(fadeOut)
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') throw new OpError('Имя клипа должно быть строкой')
    clean.name = patch.name.slice(0, 200)
  }
  if (patch.start !== undefined) {
    if (!track || track.kind !== 'free') throw new OpError('start задаётся только для оверлей-дорожки')
    const start = mustNum(patch.start, 'start')
    if (start < 0) throw new OpError('start не может быть отрицательным')
    clean.start = round3(start)
  }
  if (!Object.keys(clean).length) throw new OpError('Нечего менять')
  return clean
}

export function addClip(mediaId, inPoint, outPoint, index, track = 'main') {
  parseTrack(track)
  return commit((draft) => {
    const trackId = trackOf(draft, track)
    const target = trackById(draft, trackId)
    const media = findMedia(draft.media, mediaId)
    const { in: inn, out } = bounds(
      inPoint == null ? 0 : mustNum(inPoint, 'in'),
      outPoint == null ? media.duration : mustNum(outPoint, 'out'),
      media.duration,
    )
    const at = index == null ? target.clips.length : mustInt(index, 'index')
    if (at < 0 || at > target.clips.length) throw new OpError('Некорректная позиция')
    const clip = {
      id: nextClipId(draft),
      mediaId: media.id,
      in: inn,
      out,
      name: media.name,
      scale: 1,
      x: 0,
      y: 0,
      region: null,
      volume: 1,
      muted: target.kind === 'free',
      fadeIn: 0,
      fadeOut: 0,
    }
    if (target.kind === 'free') clip.start = 0
    target.clips.splice(at, 0, clip)
    return clip
  })
}

// t — секунды от левого края клипа на таймлайне, не метка внутри исходного файла.
export function split(clipId, t, track = 'main') {
  parseTrack(track)
  return commit((draft) => {
    const trackId = trackOf(draft, track)
    const found = findClip(draft, clipId, trackId)
    const local = round3(mustNum(t, 't'))
    const speed = speedOf(found.clip)
    const dur = round3(clipLength(found.clip))
    const cut = round3(found.clip.in + local * speed)
    if (!(local > 0 && local < dur) || !(found.clip.in < cut && cut < found.clip.out)) {
      throw new OpError('Точка разреза должна быть внутри клипа')
    }
    const right = { ...found.clip, id: nextClipId(draft), in: cut, out: found.clip.out }
    found.clip.out = cut
    if (found.track.kind === 'free') right.start = round3((found.clip.start ?? 0) + local)
    found.track.clips.splice(found.index + 1, 0, right)
    return [found.clip, right]
  })
}

export function splitAt(timelineTime, track = 'main') {
  const trackId = parseTrack(track)
  const t = round3(mustNum(timelineTime, 't'))
  const target = getProject().tracks.find((item) => item.id === trackId)
  if (!target) throw new OpError('В этой точке таймлайна нечего резать')
  if (target.kind === 'ripple') {
    let acc = 0
    for (const clip of target.clips) {
      const dur = round3(clipLength(clip))
      const next = round3(acc + dur)
      if (t > acc && t < next) return split(clip.id, round3(t - acc), trackId)
      acc = next
    }
  } else {
    for (const clip of target.clips) {
      const start = clip.start ?? 0
      const dur = round3(clipLength(clip))
      if (t > start && t < round3(start + dur)) return split(clip.id, round3(t - start), trackId)
    }
  }
  throw new OpError('В этой точке таймлайна нечего резать')
}

export function trim(clipId, edges = {}, track = 'main') {
  parseTrack(track)
  return commit((draft) => {
    const trackId = trackOf(draft, track)
    const { clip } = findClip(draft, clipId, trackId)
    const media = findMedia(draft.media, clip.mediaId)
    const next = bounds(
      edges.in == null ? clip.in : mustNum(edges.in, 'in'),
      edges.out == null ? clip.out : mustNum(edges.out, 'out'),
      media.duration,
    )
    clip.in = next.in
    clip.out = next.out
    return clip
  })
}

export function remove(clipId, track = 'main') {
  parseTrack(track)
  return commit((draft) => {
    const trackId = trackOf(draft, track)
    const found = findClip(draft, clipId, trackId)
    const [removed] = found.track.clips.splice(found.index, 1)
    return removed
  })
}

export function removeClips(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new OpError('Не указаны клипы')
  const unique = [...new Set(ids)]
  return commit((draft) => {
    const found = unique.map((id) => findClipAnywhere(draft, id))
    const drop = new Set(unique)
    const removed = []
    for (const track of draft.tracks) {
      track.clips = track.clips.filter((clip) => {
        if (!drop.has(clip.id)) return true
        removed.push(clip)
        return false
      })
    }
    return removed.length ? removed : found.map((item) => item.clip)
  })
}

// newIndex — место клипа в списке после перемещения.
export function move(clipId, newIndex, track = 'main') {
  parseTrack(track)
  return commit((draft) => {
    const trackId = trackOf(draft, track)
    const found = findClip(draft, clipId, trackId)
    const to = mustInt(newIndex, 'index')
    if (to < 0 || to >= found.track.clips.length) throw new OpError('Некорректная позиция')
    if (found.index === to) return found.clip
    const [clip] = found.track.clips.splice(found.index, 1)
    found.track.clips.splice(to, 0, clip)
    return clip
  })
}

function dropEmpty(clip) {
  if (clip.vfilters == null) delete clip.vfilters
  if (clip.afilters == null) delete clip.afilters
}

/**
 * Применяет патч к клипу. Если у клипа главной дорожки меняется длина (скорость), подписи и старты оверлеев
 * сдвигаются вместе с видео: то, что было после клипа, остаётся после него, то, что внутри, растягивается.
 */
function applyPatch(draft, found, clean) {
  const main = found.track.kind === 'ripple'
  const before = main ? clipLength(found.clip) : 0
  let offset = 0
  if (main) {
    for (const clip of found.track.clips) {
      if (clip === found.clip) break
      offset += clipLength(clip)
    }
  }
  Object.assign(found.clip, clean)
  dropEmpty(found.clip)
  if (!main || clean.speed === undefined) return
  const after = clipLength(found.clip)
  if (Math.abs(after - before) < 1e-9) return
  const end = offset + before
  const remap = (t) => {
    if (t <= offset) return t
    if (t >= end) return round3(t + after - before)
    return round3(offset + ((t - offset) * after) / before)
  }
  for (const text of draft.texts) {
    text.start = remap(text.start)
    text.end = remap(text.end)
  }
  for (const track of draft.tracks) {
    if (track.kind !== 'free') continue
    for (const clip of track.clips) clip.start = remap(clip.start ?? 0)
  }
}

export function setClip(clipId, patch) {
  return commit((draft) => {
    const found = findClipAnywhere(draft, clipId)
    applyPatch(draft, found, clipPatch(patch, found.track))
    return found.clip
  })
}

export function setClips(clipIds, patch) {
  if (!Array.isArray(clipIds) || !clipIds.length) throw new OpError('Не указаны клипы')
  return commit((draft) => {
    const found = clipIds.map((id) => findClipAnywhere(draft, id))
    const clean = clipPatch(patch, found.every((item) => item.track.kind === 'free') ? found[0].track : null)
    if (clean.start !== undefined && found.some((item) => item.track.kind !== 'free')) {
      throw new OpError('start задаётся только для оверлей-дорожки')
    }
    for (const item of found) applyPatch(draft, item, clean)
    return found.map((item) => item.clip)
  })
}

/**
 * Меняет скорость всего проекта в `factor` раз: у каждого клипа скорость умножается на factor,
 * старты оверлеев и подписи сдвигаются, чтобы всё осталось на своих местах относительно видео.
 */
export function scaleSpeed(factor) {
  const f = mustNum(factor, 'factor')
  if (!(f > 0)) throw new OpError('factor должен быть больше нуля')
  return commit((draft) => {
    const all = draft.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })))
    if (!all.length) throw new OpError('В проекте нет клипов')
    for (const { clip } of all) {
      const next = speedOf(clip) * f
      if (next < SPEED_MIN - 1e-9 || next > SPEED_MAX + 1e-9) {
        throw new OpError(`Клип ${clip.id}: скорость ${round3(next)} вне пределов ${SPEED_MIN}…${SPEED_MAX}`)
      }
    }
    for (const { clip, track } of all) {
      const next = round3(Math.min(SPEED_MAX, Math.max(SPEED_MIN, speedOf(clip) * f)))
      if (next === 1) delete clip.speed
      else clip.speed = next
      if (track.kind === 'free') clip.start = round3((clip.start ?? 0) / f)
    }
    for (const text of draft.texts) {
      text.start = round3(text.start / f)
      text.end = round3(text.end / f)
    }
    return { factor: f, clips: all.length, texts: draft.texts.length }
  })
}
