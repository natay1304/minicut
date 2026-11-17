const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[process.env.MINICUT_LOG] ?? LEVELS.info

function write(level, message, extra) {
  if (LEVELS[level] < threshold) return
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(extra instanceof Error ? `${line}\n${extra.stack}\n` : `${line}\n`)
}

export const log = {
  debug: (message, extra) => write('debug', message, extra),
  info: (message, extra) => write('info', message, extra),
  warn: (message, extra) => write('warn', message, extra),
  error: (message, extra) => write('error', message, extra),
}
