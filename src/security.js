/**
 * Защита локального API от запросов с чужих сайтов (CSRF и DNS rebinding).
 * Сервер слушает только 127.0.0.1, но браузер всё равно отправит туда запрос с любой страницы.
 */
export function localOnly({ port }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const origins = new Set([...hosts].map((host) => `http://${host}`))
  const deny = (res, message) => res.status(403).json({ error: message })

  return (req, res, next) => {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return deny(res, 'Недопустимый Host')
    const origin = req.headers.origin
    if (origin && !origins.has(origin)) return deny(res, 'Недопустимый Origin')
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny(res, 'Кросс-доменные запросы запрещены')
    next()
  }
}

/** POST принимает только JSON: простая кросс-доменная форма не сможет его отправить. */
export function jsonOnly(req, res, next) {
  if (req.method === 'POST') {
    const length = Number(req.headers['content-length'] || 0)
    const type = String(req.headers['content-type'] || '')
    if (length > 0 && !type.startsWith('application/json')) {
      return res.status(415).json({ error: 'Нужен Content-Type: application/json' })
    }
  }
  next()
}
