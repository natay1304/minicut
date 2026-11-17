import { detectSilence as ffmpegSilence, round3 } from '../ffmpeg.js'
import { commit, getProject } from './history.js'
import { OpError, findMedia, mustNum } from './project.js'
import { trackById } from './tracks.js'

export async function detectSilence(mediaId, options = {}) {
  const media = findMedia(getProject().media, mediaId)
  if (!media.hasAudio) throw new OpError('В медиа нет звуковой дорожки')
  const noiseDb = options.noiseDb == null ? -30 : mustNum(options.noiseDb, 'noiseDb')
  const minDur = options.minDur == null ? 0.4 : mustNum(options.minDur, 'minDur')
  if (!(minDur > 0)) throw new OpError('minDur должен быть больше нуля')
  try {
    return await ffmpegSilence(media.path, { noiseDb, minDur, duration: media.duration })
  } catch (err) {
    throw new OpError(`Не удалось найти тишину: ${err.message}`, 500)
  }
}

// pad оставляет короткую тишину у речи и не сохраняет обрезок в начале или конце клипа.
function silenceCut(interval, clip, pad) {
  const overlapsStart = interval.start <= clip.in + 0.0005
  const overlapsEnd = interval.end >= clip.out - 0.0005
  let start = Math.max(interval.start, clip.in)
  let end = Math.min(interval.end, clip.out)
  if (!(end > start)) return null
  if (!overlapsStart) start += pad
  if (!overlapsEnd) end -= pad
  start = Math.max(start, clip.in)
  end = Math.min(end, clip.out)
  if (!(end > start)) return null
  return { start: round3(start), end: round3(end) }
}

function keepRanges(clip, silences, pad) {
  const cuts = []
  for (const interval of silences) {
    const cut = silenceCut(interval, clip, pad)
    if (!cut) continue
    const last = cuts[cuts.length - 1]
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end)
    else cuts.push({ ...cut })
  }
  const keeps = []
  let cursor = clip.in
  for (const cut of cuts) {
    if (cut.start > cursor) keeps.push({ in: round3(cursor), out: round3(cut.start) })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < clip.out) keeps.push({ in: round3(cursor), out: round3(clip.out) })
  return keeps.filter((range) => range.out > range.in)
}

// После вырезания тишины по краям клипа остаются обрывки. Короче 0.25 с их не оставляем.
function dropEdgeScraps(keeps, clip) {
  if (!keeps.length) return keeps
  const piece = (range) => round3(range.out - range.in)
  const untouched =
    keeps.length === 1 && round3(keeps[0].in) === round3(clip.in) && round3(keeps[0].out) === round3(clip.out)
  if (untouched) return keeps
  const next = keeps.slice()
  while (next.length && piece(next[0]) < 0.25) next.shift()
  while (next.length && piece(next[next.length - 1]) < 0.25) next.pop()
  return next
}

export async function removeSilence(options = {}) {
  const noiseDb = options.noiseDb == null ? -30 : mustNum(options.noiseDb, 'noiseDb')
  const minDur = options.minDur == null ? 0.4 : mustNum(options.minDur, 'minDur')
  const pad = options.pad == null ? 0.08 : mustNum(options.pad, 'pad')
  if (!(minDur > 0)) throw new OpError('minDur должен быть больше нуля')
  if (pad < 0) throw new OpError('pad не может быть отрицательным')
  const current = getProject()
  const main = trackById(current, 'main')
  const targets = options.clipId
    ? main.clips.filter((clip) => clip.id === options.clipId)
    : main.clips.slice()
  if (options.clipId && !targets.length) throw new OpError(`Клип не найден: ${options.clipId}`)
  if (!targets.length) throw new OpError('Нет клипов для нарезки')
  const cache = new Map()
  for (const clip of targets) {
    const media = findMedia(current.media, clip.mediaId)
    if (!media.hasAudio) throw new OpError(`В медиа ${media.id} нет звуковой дорожки`)
    if (cache.has(media.id)) continue
    try {
      cache.set(media.id, await ffmpegSilence(media.path, { noiseDb, minDur, duration: media.duration }))
    } catch (err) {
      throw new OpError(`Не удалось найти тишину: ${err.message}`, 500)
    }
  }
  const ids = new Set(targets.map((clip) => clip.id))
  return commit((draft) => {
    const track = trackById(draft, 'main')
    let max = 0
    for (const clip of draft.tracks.flatMap((item) => item.clips)) {
      const n = Number(String(clip.id).slice(1))
      if (Number.isInteger(n) && n > max) max = n
    }
    const nextIdFor = () => `c${++max}`
    const next = []
    for (const clip of track.clips) {
      if (!ids.has(clip.id)) {
        next.push(clip)
        continue
      }
      const media = findMedia(draft.media, clip.mediaId)
      const keeps = dropEdgeScraps(keepRanges(clip, cache.get(media.id) || [], pad), clip)
      keeps.forEach((range, index) => {
        next.push({
          ...clip,
          id: index === 0 ? clip.id : nextIdFor(),
          in: range.in,
          out: range.out,
        })
      })
    }
    track.clips = next
    return next
  })
}
