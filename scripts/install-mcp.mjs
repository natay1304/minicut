#!/usr/bin/env node
// Подключает MCP-сервер minicut к Claude с абсолютными путями этой копии проекта.
//   node scripts/install-mcp.mjs            показать конфиг и команды (ничего не меняет)
//   node scripts/install-mcp.mjs --code     зарегистрировать в Claude Code (claude mcp add, для всех папок)
//   node scripts/install-mcp.mjs --desktop  дописать в конфиг Claude Desktop (и Cowork), с резервной копией
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = { command: process.execPath, args: [path.join(root, 'src/mcp.js')] }
const flags = new Set(process.argv.slice(2))

function desktopConfigPath() {
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json')
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
  return path.join(os.homedir(), '.config/Claude/claude_desktop_config.json')
}

function installCode() {
  try {
    execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'minicut'], { stdio: 'ignore' })
  } catch {
    // сервера ещё не было
  }
  execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'minicut', '--', server.command, ...server.args], {
    stdio: 'inherit',
  })
  console.log('Claude Code: готово. Открой новую сессию, инструменты minicut появятся в списке.')
}

function installDesktop() {
  const file = desktopConfigPath()
  let config = {}
  if (existsSync(file)) {
    config = JSON.parse(readFileSync(file, 'utf8'))
    copyFileSync(file, `${file}.bak-before-minicut`)
  } else {
    mkdirSync(path.dirname(file), { recursive: true })
  }
  config.mcpServers = { ...config.mcpServers, minicut: server }
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`Claude Desktop: записано в ${file}. Полностью перезапусти приложение (Cmd+Q и открыть снова).`)
}

if (flags.has('--code')) installCode()
if (flags.has('--desktop')) installDesktop()

if (!flags.has('--code') && !flags.has('--desktop')) {
  console.log('Конфиг для Claude Desktop / Cowork (claude_desktop_config.json) и любого MCP-клиента:\n')
  console.log(JSON.stringify({ mcpServers: { minicut: server } }, null, 2))
  console.log('\nClaude Code (для всех папок):')
  console.log(`  claude mcp add --scope user minicut -- ${server.command} ${server.args.join(' ')}`)
  console.log('\nАвтоматически: npm run mcp:install -- --code   и/или   npm run mcp:install -- --desktop')
}
