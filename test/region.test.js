import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { videoChain } from '../src/ffmpeg.js'
import { normalizeProject } from '../src/ops/project.js'
import { hasFfmpeg, useTempData } from './helpers.js'

const dir = useTempData()
process.env.MINICUT_ROOTS = dir
const skip = hasFfmpeg() ? false : 'ffmpeg не найден'
const ops = await import('../src/ops.js')

const plainGraph =
  "[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2:flags=bicubic,setsar=1,crop=w='min(iw\\,1080)':h='min(ih\\,1920)':x='if(lte(iw\\,1080)\\,0\\,trunc(max(0\\,min(iw-1080\\,(iw-1080)/2-(0.000)))/2)*2)':y='if(lte(ih\\,1920)\\,0\\,trunc(max(0\\,min(ih-1920\\,(ih-1920)/2-(0.000)))/2)*2)',pad=1080:1920:trunc(max(0\\,min(1080-iw\\,(1080-iw)/2+(0.000)))/2)*2:trunc(max(0\\,min(1920-ih\\,(1920-ih)/2+(0.000)))/2)*2:black,fps=30,format=yuv420p"
const alphaGraph =
  "[1:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2:flags=bicubic,setsar=1,crop=w='min(iw\\,1080)':h='min(ih\\,1920)':x='if(lte(iw\\,1080)\\,0\\,trunc(max(0\\,min(iw-1080\\,(iw-1080)/2-(0.000)))/2)*2)':y='if(lte(ih\\,1920)\\,0\\,trunc(max(0\\,min(ih-1920\\,(ih-1920)/2-(0.000)))/2)*2)',format=yuva420p,pad=1080:1920:trunc(max(0\\,min(1080-iw\\,(1080-iw)/2+(0.000)))/2)*2:trunc(max(0\\,min(1920-ih\\,(1920-ih)/2+(0.000)))/2)*2:black@0,fps=30,format=yuva420p,setpts=PTS-STARTPTS+0.500/TB"

function colorVideo(name, color) {
  const file = path.join(dir, name)
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=160x160:r=30:d=1`,
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ])
  return file
}

function pixel(file, x, y, width = 160) {
  const buf = execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '0.2',
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ])
  assert.equal(buf.length, width * width * 3)
  const i = (y * width + x) * 3
  return [buf[i], buf[i + 1], buf[i + 2]]
}

test('videoChain без region не меняет граф', () => {
  const clip = { in: 0, out: 1, scale: 1, x: 0, y: 0 }
  assert.equal(videoChain('[0:v]', clip, 1080, 1920, 30, false, false), plainGraph)
  assert.equal(videoChain('[1:v]', { ...clip, start: 0.5 }, 1080, 1920, 30, true, true), alphaGraph)
  const top = videoChain(
    '[0:v]',
    { ...clip, region: { x: 0, y: 0, w: 1, h: 0.5 } },
    160,
    160,
    30,
    false,
    false,
  )
  assert.match(top, /pad=160:160:0:0:black/)
  assert.equal(top.includes('rgba'), false)
  const bottom = videoChain(
    '[1:v]',
    { ...clip, start: 0, region: { x: 0, y: 0.5, w: 1, h: 0.5 } },
    160,
    160,
    30,
    true,
    true,
  )
  assert.match(bottom, /format=rgba/)
  assert.match(bottom, /pad=160:160:0:80:black@0/)
})

test('region: валидация', { skip }, async () => {
  const normalized = normalizeProject(
    {
      version: 2,
      name: 't',
      media: [{ id: 'm1', path: '/tmp/a.mp4', duration: 1, width: 16, height: 16 }],
      tracks: [
        {
          id: 'main',
          kind: 'ripple',
          clips: [
            { id: 'c1', mediaId: 'm1', in: 0, out: 1, region: { x: 0, y: 0, w: 1, h: 0.5 } },
            { id: 'c2', mediaId: 'm1', in: 0, out: 1, region: { x: 0, y: 0, w: 0.01, h: 0.5 } },
          ],
        },
      ],
    },
    't',
  )
  assert.deepEqual(normalized.tracks[0].clips[0].region, { x: 0, y: 0, w: 1, h: 0.5 })
  assert.equal(normalized.tracks[0].clips[1].region, null)

  const media = await ops.importMedia(colorVideo('solid.mp4', 'green'))
  const clip = ops.addClip(media.id, 0, media.duration)
  const over = ops.addClip(media.id, 0, media.duration, undefined, 'overlay')
  ops.setClip(clip.id, { region: { x: 0, y: 0, w: 1, h: 0.5 } })
  assert.deepEqual(ops.getProject().tracks[0].clips.find((item) => item.id === clip.id).region, {
    x: 0,
    y: 0,
    w: 1,
    h: 0.5,
  })
  ops.setClip(clip.id, { region: { x: 0, y: 0, w: 1.001, h: 0.5 } })
  assert.equal(ops.getProject().tracks[0].clips.find((item) => item.id === clip.id).region.w, 1.001)
  assert.throws(() => ops.setClip(clip.id, { region: { x: 0, y: 0, w: 0.04, h: 0.5 } }), /не меньше 0\.05/)
  assert.throws(() => ops.setClip(clip.id, { region: { x: 0.6, y: 0, w: 0.5, h: 0.5 } }), /выходит за кадр/)
  assert.throws(() => ops.setClip(clip.id, { region: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }), /от 0 до 1/)
  assert.throws(() => ops.setClip(clip.id, { region: { x: 0.002, y: 0, w: 1, h: 0.5 } }), /выходит за кадр/)
  assert.throws(() => ops.setClip(clip.id, { region: 'top' }), /объектом или null/)
  ops.setClip(clip.id, { region: null })
  assert.equal(ops.getProject().tracks[0].clips.find((item) => item.id === clip.id).region, null)
  ops.setClips([clip.id, over.id], { region: { x: 0, y: 0.5, w: 1, h: 0.5 } })
  const saved = ops.getProject()
  for (const id of [clip.id, over.id]) {
    const found = saved.tracks.flatMap((track) => track.clips).find((item) => item.id === id)
    assert.deepEqual(found.region, { x: 0, y: 0.5, w: 1, h: 0.5 })
  }
  ops.saveProjectAs('region-keep')
  ops.newProject('region-other')
  ops.loadProject('region-keep')
  const loaded = ops
    .getProject()
    .tracks.flatMap((track) => track.clips)
    .find((item) => item.id === clip.id)
  assert.deepEqual(loaded.region, { x: 0, y: 0.5, w: 1, h: 0.5 })
})

test('region делит кадр на красную и синюю половины', { skip, timeout: 60000 }, async () => {
  ops.newProject('halves')
  const red = await ops.importMedia(colorVideo('red.mp4', 'red'))
  const blue = await ops.importMedia(colorVideo('blue.mp4', 'blue'))
  const top = ops.addClip(red.id, 0, red.duration)
  const bottom = ops.addClip(blue.id, 0, blue.duration, undefined, 'overlay')
  ops.setClip(top.id, { region: { x: 0, y: 0, w: 1, h: 0.5 } })
  ops.setClip(bottom.id, { region: { x: 0, y: 0.5, w: 1, h: 0.5 } })
  const out = path.join(dir, 'halves.mp4')
  await ops.render({ output: out, width: 160, height: 160, fps: 30, crf: 16, preset: 'ultrafast' })
  const upper = pixel(out, 80, 40)
  const lower = pixel(out, 80, 120)
  assert.ok(upper[0] > 180 && upper[1] < 60 && upper[2] < 60, `верх ${upper.join(',')}`)
  assert.ok(lower[2] > 180 && lower[0] < 60 && lower[1] < 60, `низ ${lower.join(',')}`)
})
