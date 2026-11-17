import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST, JSON_LIMIT, PORT } from './config.js'
import { log } from './logger.js'
import { stopRender } from './ops.js'
import { closeClients, mountApi, mountApiFallback } from './routes/api.js'
import { mountMedia } from './routes/media.js'
import { jsonOnly, localOnly } from './security.js'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')

const app = express()
app.disable('x-powered-by')
app.use(localOnly({ port: PORT }))
app.use(jsonOnly)
app.use(express.json({ limit: JSON_LIMIT }))

mountApi(app)
mountMedia(app)
mountApiFallback(app)

app.use(
  express.static(publicDir, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache')
    },
  }),
)

app.use((err, req, res, _next) => {
  const status = Number(err.status) || 500
  if (status >= 500) log.error(`${req.method} ${req.originalUrl}`, err)
  res.status(status).json({
    error: err.message || 'Внутренняя ошибка',
    code: err.code && typeof err.code === 'string' ? err.code : status >= 500 ? 'internal' : 'bad_request',
  })
})

const server = app.listen(PORT, HOST, () => {
  log.info(`minicut listening on http://${HOST}:${PORT}`)
})

function shutdown() {
  stopRender()
  closeClients()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 400).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.on('error', (err) => {
  log.error(err.message)
  process.exit(1)
})
