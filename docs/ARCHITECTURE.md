# Архитектура

```
Браузер (public/)  ──HTTP/SSE──►  Express (src/server.js)  ──►  ops (src/ops/*)  ──►  ffmpeg (src/ffmpeg.js)
Claude (MCP)       ──stdio────►  src/mcp.js ──HTTP──┘                  │
                                                                      └──► data/projects/*.json
```

Единственный источник правды — проект в памяти процесса сервера (`src/ops/history.js`). Каждая мутация проходит через `commit()`: валидация, снимок для undo, запись на диск (атомарно: временный файл и `rename`), событие `project` по SSE. UI и агент работают с одним и тем же проектом и видят изменения друг друга сразу.

## Бэкенд (`src/`)
| Модуль | Назначение |
| --- | --- |
| `server.js` | точка входа: middleware, статика, обработчик ошибок, shutdown |
| `config.js` | порт, хост, лимиты, MIME |
| `security.js` | проверка `Host`/`Origin`, только JSON в POST |
| `paths.js` | разрешённые папки (`MINICUT_ROOTS`), расширения, скрытые пути |
| `routes/api.js` | `/api/*` и диспетчер операций `/api/op` |
| `routes/media.js` | стрим исходников с Range, `/preview.mp4` |
| `ops.js` | фасад: единый публичный API операций |
| `ops/project.js` | модель проекта, нормализация и миграция v1→v2, холст, импорт медиа |
| `ops/history.js` | состояние, `commit`, undo/redo, хранение проектов |
| `ops/clips.js`, `ops/tracks.js` | клипы; оверлей-дорожки и перенос между ними |
| `ops/texts.js` | подписи, стили, импорт `.srt`/`.ass`, транскрипт |
| `ops/silence.js` | поиск и вырезание пауз |
| `ops/render.js` | план рендера, экспорт, предпросмотр, отмена |
| `ops/speech.js` | расшифровка, поиск, дубли, вырезание по тексту, подписи из расшифровки |
| `speech/engine.js` | поиск whisper.cpp и модели, запуск, прогресс (macOS, Windows, Linux) |
| `speech/words.js` | чистые функции: разбор результата, фразы, поиск, дубли, перенос слов на таймлайн |
| `speech/setup.js` | установка whisper.cpp и модели (`npm run setup:speech`) |
| `ffmpeg.js` | `ffprobe`, `silencedetect`, сборка `filter_complex`, запуск ffmpeg |
| `textrender.js` | текст в PNG через `@napi-rs/canvas` (в ffmpeg нет `drawtext`) |
| `mcp.js` | MCP-сервер (stdio), тонкая обёртка над HTTP API |
| `logger.js` | логи с уровнями |

## Рендер
План (`ops/render.js`) превращает проект в список клипов с параметрами. `ffmpeg.js` собирает один `filter_complex`: чёрный холст, клипы `main` (trim, scale/crop, concat), затем оверлеи по порядку дорожек (`overlay` с `enable='between(t,a,b)'`), затем текстовая дорожка из PNG. Звук: `afade` на каждом клипе, смешивание оверлеев через `amix`, опционально `loudnorm`.

## Фронтенд (`public/`)
Ванильный JS без сборки, ES-модули. Точка входа `public/js/main.js`: инициализация, подписка на SSE, регистрация `hooks`.

| Модуль | Назначение |
| --- | --- |
| `state.js`, `hooks.js` | общее состояние, ссылки на DOM, обратные вызовы между модулями без циклических импортов |
| `util.js`, `project-model.js`, `api.js` | чистые функции, чтение проекта, запросы к API |
| `selection.js`, `editing.js` | выделение клипов, разрез и удаление |
| `timeline*.js` | отрисовка таймлайна, перетаскивание, подрезка, перенос, snap |
| `preview-*.js`, `playback.js` | холст превью, пул видеоэлементов (по одному на дорожку), воспроизведение |
| `crop-math.js`, `canvas-edit.js` | геометрия кадра и правка области мышью на превью |
| `inspector.js`, `texts.js`, `library.js`, `projects.js`, `export.js` | панели и диалоги |
| `shortcuts.js` | горячие клавиши |

Правило: модуль не импортирует тех, кто импортирует его. Нужен вызов «вверх» — через `hooks`.

## Тесты
`node:test`, каталог `test/`. Все тесты используют временную папку данных (`MINICUT_DATA`), реальные проекты не затрагиваются.

## Планы
- Разбить `public/styles.css` по компонентам.
- Транскрипция речи (ASR) и монтаж по тексту.
