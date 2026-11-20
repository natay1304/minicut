import { postOp, setStatus } from './api.js'
import { $, state } from './state.js'

function renderProjectList(names) {
  const list = $('project-list')
  list.replaceChildren()
  if (!names.length) {
    const li = document.createElement('li')
    li.className = 'empty-note'
    li.textContent = 'Пока нет сохранённых проектов'
    list.append(li)
    return
  }
  for (const name of names) {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = name
    if (name === state.project.name) button.classList.add('is-current')
    button.addEventListener('click', () => {
      $('project-menu').open = false
      void loadNamed(name)
    })
    li.append(button)
    list.append(li)
  }
}

async function refreshProjects() {
  try {
    const names = await postOp('listProjects', {})
    renderProjectList(Array.isArray(names) ? names : [])
  } catch {
    /* статус уже показан */
  }
}

async function createProject() {
  const name = $('project-name').value.trim()
  if (!name) {
    setStatus('Укажите имя проекта', true)
    return
  }
  try {
    await postOp('newProject', { name })
    $('project-name').value = ''
    $('project-menu').open = false
    setStatus(`Новый проект «${name}»`)
  } catch {
    /* статус уже показан */
  }
}

async function saveAs() {
  const name = $('project-name').value.trim()
  if (!name) {
    setStatus('Укажите имя проекта', true)
    return
  }
  try {
    await postOp('saveProjectAs', { name })
    $('project-menu').open = false
    setStatus(`Сохранено как «${name}»`)
  } catch {
    /* статус уже показан */
  }
}

async function loadNamed(name) {
  try {
    await postOp('loadProject', { name })
    setStatus(`Открыт проект «${name}»`)
  } catch {
    /* статус уже показан */
  }
}

export function bindProjects() {
  $('project-menu').addEventListener('toggle', () => {
    if ($('project-menu').open) void refreshProjects()
  })
  document.addEventListener('pointerdown', (event) => {
    const menu = $('project-menu')
    if (!menu.contains(event.target)) menu.open = false
  })
  $('project-create').addEventListener('submit', (event) => {
    event.preventDefault()
    void createProject()
  })
  $('project-save').addEventListener('click', () => {
    void saveAs()
  })
}
