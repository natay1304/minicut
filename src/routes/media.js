import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { MIME } from '../config.js'
import * as ops from '../ops.js'

export function mountMedia(app) {
  app.get('/preview.mp4', (req, res, next) => {
    const file = ops.previewFile()
    if (!existsSync(file)) {
      res.status(404).json({ error: 'Превью ещё не собрано' })
      return
    }
    res.sendFile(
      file,
      {
        headers: { 'Cache-Control': 'no-cache' },
      },
      (err) => {
        if (err && !res.headersSent) next(err)
      },
    )
  })

  app.get('/media/:id', (req, res) => {
    streamMedia(req, res)
  })
}

function streamMedia(req, res) {
  const media = ops.getProject().media.find((item) => item.id === req.params.id)
  if (!media || !existsSync(media.path)) {
    res.status(404).json({ error: 'Медиа не найдено' })
    return
  }
  let size
  try {
    size = statSync(media.path).size
  } catch {
    res.status(404).json({ error: 'Файл не найден' })
    return
  }
  const type = MIME[path.extname(media.path).toLowerCase()] || 'application/octet-stream'
  const range = req.headers.range
  if (!range) {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    })
    pipeFile(res, media.path)
    return
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
  if (!match || (match[1] === '' && match[2] === '')) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  end = Math.min(end, size - 1)
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': type,
  })
  pipeFile(res, media.path, start, end)
}

function pipeFile(res, filePath, start, end) {
  const stream = createReadStream(filePath, start == null ? {} : { start, end })
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end()
    else res.destroy()
  })
  stream.pipe(res)
  res.on('close', () => stream.destroy())
}
