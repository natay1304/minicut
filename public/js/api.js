import { state, statusEl } from './state.js'

let applyProject = () => {}

export function setApplyProject(fn) {
  applyProject = fn
}

export function setStatus(text, isError = false) {
  statusEl.textContent = text || ''
  statusEl.classList.toggle('is-error', Boolean(isError) && Boolean(text))
  clearTimeout(state.statusTimer)
  if (text && !isError) {
    state.statusTimer = setTimeout(() => {
      if (statusEl.textContent === text) statusEl.textContent = ''
    }, 4000)
  }
}

export async function request(method, url, body) {
  let res
  try {
    res = await fetch(
      url,
      method === 'GET'
        ? undefined
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          },
    )
  } catch {
    throw new Error('Нет связи с сервером')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса')
  return data
}

export function enqueue(fn) {
  const run = state.queue.then(fn, fn)
  state.queue = run.then(
    () => {},
    () => {},
  )
  return run
}

export function postOp(op, args) {
  return enqueue(async () => {
    const data = await request('POST', '/api/op', { op, args })
    if (data.project) applyProject(data.project)
    if (statusEl.classList.contains('is-error')) setStatus('')
    return data.result
  }).catch((err) => {
    setStatus(err.message, true)
    throw err
  })
}
