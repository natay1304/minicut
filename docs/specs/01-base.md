# minicut — мини-редактор для монтажа

Локальный веб-редактор: ручная нарезка видео на таймлайне + тот же набор операций доступен агенту (HTTP API и MCP), как «DaVinci MCP», только свой и маленький.

## Стек
- Node 20, ESM, минимум зависимостей (`express` допустим, `@modelcontextprotocol/sdk` + `zod` для MCP). Без сборщиков.
- ffmpeg / ffprobe из PATH (`/opt/homebrew/bin`).
- UI: vanilla JS + CSS в `public/`, без фреймворков.

## Модель данных (`project.json`, лежит в `data/`)
```json
{
  "version": 1,
  "media": [{ "id": "m1", "path": "/abs/file.mp4", "name": "file.mp4", "duration": 12.5, "width": 1080, "height": 1920, "fps": 30, "hasAudio": true }],
  "clips": [{ "id": "c1", "mediaId": "m1", "in": 0.0, "out": 4.2 }]
}
```
- Одна дорожка, клипы идут подряд (ripple): позиция клипа на таймлайне = сумма длительностей предыдущих.
- `in`/`out` — секунды внутри исходного файла.
- Время везде в секундах (float), округление до 3 знаков.

## Операции (одна реализация в `src/ops.js`, используют и UI, и MCP)
- `importMedia(path)` — ffprobe, добавляет в `media`, возвращает объект.
- `addClip(mediaId, in?, out?, index?)` — по умолчанию весь файл, в конец.
- `split(clipId, t)` — t в **таймлайн-времени** клипа или `splitAt(timelineTime)`; режет клип на два.
- `trim(clipId, {in?, out?})` — менять границы внутри исходника.
- `remove(clipId)` — удалить со сдвигом (ripple).
- `move(clipId, newIndex)` — поменять порядок.
- `getProject()`, `undo()`, `redo()` (стек минимум 100 шагов).
- `detectSilence(mediaId, {noiseDb=-30, minDur=0.4})` — ffmpeg `silencedetect`, возвращает интервалы тишины.
- `render({output, width?, height?, fps?})` — собирает клипы ffmpeg'ом (trim/atrim + concat, re-encode h264+aac, `-movflags +faststart`), прогресс через событие.
- Каждая мутация валидирует вход, бросает понятную ошибку и после успеха шлёт SSE-событие, чтобы UI обновился, когда монтирует агент.

## HTTP API (`src/server.js`, порт 4317)
- `GET /api/project`, `POST /api/op` с `{ op, args }` → обновлённый проект.
- `POST /api/import { path }`, `GET /api/browse?dir=` (список видеофайлов в папке для импорта).
- `GET /api/events` — SSE (`project`, `render-progress`).
- `GET /media/:id` — стрим исходника с поддержкой Range.
- `POST /api/render { output }`.
- Слушать только `127.0.0.1`.

## UI (`public/`)
- Слева: библиотека (импорт по пути / выбор из папки), клик добавляет на таймлайн.
- По центру: `<video>` превью. Воспроизведение таймлайна целиком (клип за клипом по границам `in/out`, без перерендера).
- Снизу: таймлайн. Клипы блоками, ширина = длительность, зум колесом/слайдером, плейхед, клик по линейке = перемотка.
- Ручная нарезка: `S` — разрезать под плейхедом, `Delete`/`Backspace` — удалить выбранный клип, перетаскивание краёв клипа = trim, перетаскивание блока = смена порядка, `Space` — play/pause, `←/→` — кадр, `Cmd+Z` / `Cmd+Shift+Z` — undo/redo, `J/K/L` — как в Resolve.
- Кнопка «Экспорт» + прогресс.
- Подписка на SSE: если проект изменил агент, UI обновляется сразу, выбранный клип и плейхед не теряются.
- Тёмная тема, аккуратный минимальный дизайн.

## MCP (`src/mcp.js`, stdio)
Тонкая обёртка над HTTP API (сервер должен быть запущен; если нет, MCP сам его стартует). Тулы: `get_project`, `import_media`, `add_clip`, `split`, `trim`, `remove_clip`, `move_clip`, `detect_silence`, `undo`, `redo`, `render`. Описания тулов на английском, ответы короткие и структурные.

## Структура
```
minicut/
  package.json
  src/{server.js, ops.js, ffmpeg.js, mcp.js}
  public/{index.html, app.js, styles.css}
  data/            # project.json, прокси, рендеры (в .gitignore)
```

## Правила для кода
- Простой читаемый код, комментарии только там, где неочевидно.
- Никаких сетевых вызовов наружу.
- Пути пользователя не хардкодить.
