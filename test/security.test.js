import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jsonOnly, localOnly } from '../src/security.js'

function run(middleware, headers, method = 'GET') {
  const out = { status: null, nexted: false }
  const res = {
    status(code) {
      out.status = code
      return this
    },
    json() {
      return this
    },
  }
  middleware({ headers, method }, res, () => {
    out.nexted = true
  })
  return out
}

const guard = localOnly({ port: 4317 })

test('пропускает 127.0.0.1 и localhost', () => {
  assert.ok(run(guard, { host: '127.0.0.1:4317' }).nexted)
  assert.ok(run(guard, { host: 'localhost:4317', origin: 'http://localhost:4317' }).nexted)
})

test('блокирует чужой Host (DNS rebinding)', () => {
  assert.equal(run(guard, { host: 'evil.com' }).status, 403)
  assert.equal(run(guard, { host: 'evil.com:4317' }).status, 403)
})

test('блокирует чужой Origin и cross-site', () => {
  assert.equal(run(guard, { host: '127.0.0.1:4317', origin: 'https://evil.com' }).status, 403)
  assert.equal(run(guard, { host: '127.0.0.1:4317', 'sec-fetch-site': 'cross-site' }).status, 403)
})

test('POST принимает только JSON', () => {
  const post = { 'content-length': '10', 'content-type': 'text/plain' }
  assert.equal(run(jsonOnly, post, 'POST').status, 415)
  assert.ok(run(jsonOnly, { ...post, 'content-type': 'application/json' }, 'POST').nexted)
  assert.ok(run(jsonOnly, {}, 'GET').nexted)
})
