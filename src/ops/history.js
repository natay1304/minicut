import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../logger.js'
import { OpError, bindCommit, emptyProject, hasPathChars, normalizeProject } from './project.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = process.env.MINICUT_DATA ? path.resolve(process.env.MINICUT_DATA) : path.join(root, 'data')
const projectFile = path.join(dataDir, 'project.json')
const projectsDir = path.join(dataDir, 'projects')
const currentFile = path.join(dataDir, 'current.txt')
const previewMp4 = path.join(dataDir, 'preview.mp4')
const HISTORY_LIMIT = 100

const listeners = new Map()

export function on(event, fn) {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(fn)
  return () => set.delete(fn)
}

export function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) fn(data)
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function atomicWrite(file, data) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, file)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err instanceof OpError) throw err
    throw new Error(`Не удалось прочитать ${file}`)
  }
}

function projectPath(name) {
  return path.join(projectsDir, `${name}.json`)
}

function safeName(name) {
  if (typeof name !== 'string') throw new OpError('Не указано имя проекта')
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80 || trimmed === '.' || trimmed === '..' || hasPathChars(trimmed)) {
    throw new OpError('Некорректное имя проекта')
  }
  return trimmed
}

function readCurrentName() {
  if (!existsSync(currentFile)) return null
  let text
  try {
    text = readFileSync(currentFile, 'utf8').trim()
  } catch {
    return null
  }
  if (!text || text.length > 80 || hasPathChars(text)) return null
  return text
}

function loadInitial() {
  const current = readCurrentName()
  if (current && existsSync(projectPath(current))) {
    return normalizeProject(readJson(projectPath(current)), current)
  }
  if (existsSync(projectFile)) return normalizeProject(readJson(projectFile), 'default')
  return emptyProject('untitled')
}

let project
try {
  project = loadInitial()
} catch (err) {
  log.error(err.message)
  process.exit(1)
}

let undoStack = []
let redoStack = []

function persist(next) {
  mkdirSync(projectsDir, { recursive: true })
  atomicWrite(projectPath(next.name), next)
  const tmp = `${currentFile}.tmp`
  writeFileSync(tmp, `${next.name}\n`)
  renameSync(tmp, currentFile)
}

export function commit(mutator) {
  const next = clone(project)
  const result = mutator(next)
  undoStack.push(clone(project))
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack = []
  project = next
  persist(project)
  emit('project', clone(project))
  return clone(result)
}

function publish(next) {
  project = next
  persist(project)
  const snapshot = clone(project)
  emit('project', snapshot)
  return snapshot
}

function replaceDraft(draft, next) {
  for (const key of Object.keys(draft)) delete draft[key]
  Object.assign(draft, next)
}

bindCommit(commit)

export function dataRoot() {
  return dataDir
}

export function getProject() {
  return clone(project)
}

export function previewFile() {
  return previewMp4
}

export function undo() {
  if (!undoStack.length) throw new OpError('Нечего отменять')
  redoStack.push(clone(project))
  if (redoStack.length > HISTORY_LIMIT) redoStack.shift()
  return publish(undoStack.pop())
}

export function redo() {
  if (!redoStack.length) throw new OpError('Нечего повторять')
  undoStack.push(clone(project))
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  return publish(redoStack.pop())
}

export function listProjects() {
  if (!existsSync(projectsDir)) return []
  return readdirSync(projectsDir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b))
}

export function newProject(name) {
  const safe = safeName(name)
  if (existsSync(projectPath(safe))) throw new OpError(`Проект уже существует: ${safe}`)
  return commit((draft) => {
    replaceDraft(draft, emptyProject(safe))
    return { name: safe }
  })
}

export function loadProject(name) {
  const safe = safeName(name)
  const file = projectPath(safe)
  if (!existsSync(file)) throw new OpError(`Проект не найден: ${safe}`)
  let next
  try {
    next = normalizeProject(readJson(file), safe)
  } catch (err) {
    throw new OpError(err.message)
  }
  next.name = safe
  return commit((draft) => {
    replaceDraft(draft, next)
    return { name: safe }
  })
}

export function saveProjectAs(name) {
  const safe = safeName(name)
  return commit((draft) => {
    draft.name = safe
    return { name: safe }
  })
}
