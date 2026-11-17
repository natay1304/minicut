import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import * as ops from '../ops.js'
import { VIDEO_EXT, checkPath } from '../paths.js'

const CLIP_PATCH_KEYS = ['scale', 'x', 'y', 'volume', 'muted', 'fadeIn', 'fadeOut', 'name', 'start']

const clients = new Set()

ops.on('project', (project) => broadcast('project', project))
ops.on('render-progress', (info) => broadcast('render-progress', info))

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

export function closeClients() {
  for (const client of clients) client.end()
}

export function mountApi(app) {
  app.get('/api/project', (_req, res) => {
    res.json(ops.getProject())
  })

  app.post('/api/import', async (req, res, next) => {
    try {
      res.json(await ops.importMedia(req.body?.path))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/browse', (req, res, next) => {
    try {
      res.json(listVideos(req.query.dir))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('\n')
    clients.add(res)
    res.write(`event: project\ndata: ${JSON.stringify(ops.getProject())}\n\n`)
    const timer = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => {
      clearInterval(timer)
      clients.delete(res)
    })
  })

  app.post('/api/op', async (req, res, next) => {
    try {
      const { op, args } = req.body ?? {}
      const result = await runOp(op, args)
      res.json({ project: ops.getProject(), result })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/render', async (req, res, next) => {
    try {
      res.json(await ops.render(req.body ?? {}))
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/render/cancel', async (_req, res, next) => {
    try {
      res.json(await ops.cancelRender())
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/preview', async (_req, res, next) => {
    try {
      res.json(await ops.preview())
    } catch (err) {
      next(err)
    }
  })
}

export function mountApiFallback(app) {
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Не найдено' })
  })
}

function runOp(op, args) {
  if (typeof op !== 'string' || !op) throw new ops.OpError('Не указана операция')
  switch (op) {
    case 'importMedia':
      return ops.importMedia(field(args, 'path', 0))
    case 'addClip':
      return ops.addClip(
        field(args, 'mediaId', 0),
        field(args, 'in', 1),
        field(args, 'out', 2),
        field(args, 'index', 3),
        field(args, 'track', 4),
      )
    case 'split':
      return ops.split(field(args, 'clipId', 0), field(args, 't', 1), field(args, 'track', 2))
    case 'splitAt':
      return ops.splitAt(field(args, 't', 0) ?? field(args, 'timelineTime', 0), field(args, 'track', 1))
    case 'trim':
      return ops.trim(field(args, 'clipId', 0), trimBounds(args), field(args, 'track', 2))
    case 'remove':
      return ops.remove(field(args, 'clipId', 0), field(args, 'track', 1))
    case 'removeClips':
      return ops.removeClips(field(args, 'ids', 0) ?? field(args, 'clipIds', 0))
    case 'move':
      return ops.move(field(args, 'clipId', 0), field(args, 'newIndex', 1), field(args, 'track', 2))
    case 'setClip':
      return ops.setClip(field(args, 'clipId', 0), clipPatch(args))
    case 'setClips':
      return ops.setClips(field(args, 'clipIds', 0) ?? field(args, 'ids', 0), clipPatch(args))
    case 'addOverlayTrack':
      return ops.addOverlayTrack()
    case 'removeOverlayTrack':
      return ops.removeOverlayTrack(field(args, 'id', 0) ?? field(args, 'track', 0))
    case 'moveClipToTrack':
      return ops.moveClipToTrack(field(args, 'clipId', 0), field(args, 'track', 1), field(args, 'start', 2))
    case 'getProject':
      return ops.getProject()
    case 'undo':
      return ops.undo()
    case 'redo':
      return ops.redo()
    case 'detectSilence':
      return ops.detectSilence(field(args, 'mediaId', 0), silenceOpts(args))
    case 'removeSilence':
      return ops.removeSilence(objectArgs(args))
    case 'setCanvas':
      return ops.setCanvas(objectArgs(args))
    case 'addText':
      return ops.addText(objectArgs(args))
    case 'setText':
      return ops.setText(field(args, 'id', 0), textPatch(args))
    case 'removeText':
      return ops.removeText(field(args, 'id', 0))
    case 'setStyle':
      return ops.setStyle(field(args, 'name', 0), stylePatch(args))
    case 'importSubtitles':
      return ops.importSubtitles(field(args, 'path', 0))
    case 'importTranscript':
      return ops.importTranscript(field(args, 'mediaId', 0), field(args, 'words', 1))
    case 'listProjects':
      return ops.listProjects()
    case 'newProject':
      return ops.newProject(field(args, 'name', 0))
    case 'loadProject':
      return ops.loadProject(field(args, 'name', 0))
    case 'saveProjectAs':
      return ops.saveProjectAs(field(args, 'name', 0))
    case 'render':
      return ops.render(renderOpts(args))
    case 'preview':
      return ops.preview()
    case 'cancelRender':
      return ops.cancelRender()
    default:
      throw new ops.OpError(`Неизвестная операция: ${op}`)
  }
}

function field(args, name, index) {
  if (Array.isArray(args)) return args[index]
  if (args && typeof args === 'object') return args[name]
  return undefined
}

function objectArgs(args) {
  if (Array.isArray(args)) {
    if (args[0] == null) return {}
    if (typeof args[0] !== 'object') throw new ops.OpError('Параметры должны быть объектом')
    return args[0]
  }
  if (args && typeof args === 'object') return args
  return {}
}

function picked(args, keys, index) {
  if (Array.isArray(args)) {
    if (args[index] == null) return {}
    if (typeof args[index] !== 'object') throw new ops.OpError('Параметры должны быть объектом')
    return args[index]
  }
  if (!args || typeof args !== 'object') return {}
  if (args.patch && typeof args.patch === 'object') return args.patch
  const patch = {}
  for (const key of keys) {
    if (args[key] !== undefined) patch[key] = args[key]
  }
  return patch
}

function clipPatch(args) {
  return picked(args, CLIP_PATCH_KEYS, 1)
}

function textPatch(args) {
  return picked(args, ['start', 'end', 'text', 'style'], 1)
}

function stylePatch(args) {
  return picked(args, ['font', 'weight', 'size', 'color', 'x', 'y', 'align', 'shadow'], 1)
}

function trimBounds(args) {
  if (Array.isArray(args)) {
    if (args[1] == null) return {}
    if (typeof args[1] !== 'object') throw new ops.OpError('Границы trim должны быть объектом { in, out }')
    return args[1]
  }
  if (args && typeof args === 'object') return { in: args.in, out: args.out }
  return {}
}

function silenceOpts(args) {
  if (Array.isArray(args)) {
    if (args[1] == null) return {}
    if (typeof args[1] !== 'object') throw new ops.OpError('Параметры detectSilence должны быть объектом')
    return args[1]
  }
  if (args && typeof args === 'object') return { noiseDb: args.noiseDb, minDur: args.minDur }
  return {}
}

function renderOpts(args) {
  if (Array.isArray(args)) {
    if (args[0] == null) return {}
    if (typeof args[0] !== 'object') throw new ops.OpError('Параметры render должны быть объектом')
    return args[0]
  }
  if (args && typeof args === 'object') return args
  return {}
}

function listVideos(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw new ops.OpError('Не указана папка')
  const abs = checkPath(dir, { label: 'Папка' })
  if (!existsSync(abs)) throw new ops.OpError(`Папка не найдена: ${abs}`)
  if (!statSync(abs).isDirectory()) throw new ops.OpError('Это не папка')
  const files = readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .filter((entry) => VIDEO_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({ name: entry.name, path: path.join(abs, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { dir: abs, files }
}
