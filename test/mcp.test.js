import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Поднимает MCP по stdio на свободном порту с временной папкой данных и спрашивает список инструментов.
test('MCP: initialize, instructions и список инструментов', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minicut-mcp-'))
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, ['src/mcp.js'], {
    env: { ...process.env, PORT: String(port), MINICUT_DATA: path.join(dir, 'data') },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const lines = []
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts.pop()
    for (const line of parts) if (line.trim()) lines.push(JSON.parse(line))
  })
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const waitFor = async (id) => {
    for (let i = 0; i < 200; i += 1) {
      const found = lines.find((item) => item.id === id)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`нет ответа на запрос ${id}`)
  }
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })
    const init = await waitFor(1)
    assert.match(init.result.instructions, /get_project/)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = (await waitFor(2)).result.tools.map((tool) => tool.name)
    for (const name of [
      'get_project',
      'import_media',
      'add_clip',
      'set_clip',
      'render',
      'move_clip_to_track',
    ]) {
      assert.ok(names.includes(name), `нет инструмента ${name}`)
    }
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project', arguments: {} } })
    const project = JSON.parse((await waitFor(3)).result.content[0].text)
    assert.equal(project.version, 2)
  } finally {
    child.kill('SIGTERM')
  }
})
