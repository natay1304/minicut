# minicut

[English](README.md) · **Русский**

Локальный веб-редактор для монтажа вертикальных видео (рилсы, 1080×1920). Нарезка на таймлайне руками, а то же самое можно поручить агенту через HTTP API или MCP.

![minicut](docs/screenshot.jpg)

[![CI](https://github.com/natay1304/minicut/actions/workflows/ci.yml/badge.svg)](https://github.com/natay1304/minicut/actions/workflows/ci.yml)

## Возможности
- Основная дорожка (ripple) и до 10 оверлей-дорожек
- Масштаб, позиция, громкость, mute и fade у каждого клипа; мультивыделение, snap, undo/redo (100 шагов)
- Текст и субтитры: стили, импорт `.srt` и `.ass`
- Удаление пауз по тишине, несколько проектов
- Экспорт через ffmpeg с прогрессом, отменой и быстрым предпросмотром
- MCP-сервер (stdio): те же операции доступны из Claude

## Требования
- Node.js 20+
- ffmpeg и ffprobe в `PATH` (`brew install ffmpeg`)

## Быстрый старт
```bash
npm install
npm start    # http://127.0.0.1:4317
```
На macOS можно запустить `scripts/start.command` двойным кликом. Проект проверялся на macOS; на Linux и Windows должен работать (Node + ffmpeg), но там его не проверяли.

## Подключение к Claude (MCP)
```bash
npm run mcp:install                # покажет конфиг с твоими путями
npm run mcp:install -- --code      # Claude Code
npm run mcp:install -- --desktop   # Claude Desktop и Cowork
```
MCP сам поднимает редактор, если он не запущен. Подробная инструкция, примеры запросов и разбор проблем: [docs/MCP.md](docs/MCP.md). Список операций: [docs/API.md](docs/API.md).

## Ограничения
- Встроенной расшифровки речи нет: монтаж по тексту не работает. Субтитры импортируются из `.srt`/`.ass`, слова транскрипции можно передать через `import_transcript`.
- У API нет авторизации. Он слушает только `127.0.0.1`, не открывай его наружу.
- ffmpeg из Homebrew собран без libass и drawtext, поэтому подписи рисуются в PNG-дорожку (шрифты лежат в `public/fonts`).
- Интерфейс рассчитан на десктоп и мышь; автотестов на UI нет.

## Настройки (переменные окружения)
| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `4317` | порт сервера (слушает только `127.0.0.1`) |
| `MINICUT_DATA` | `./data` | где лежат проекты, превью и временные файлы |
| `MINICUT_ROOTS` | домашняя и временная папки | папки, из которых можно импортировать и в которые можно экспортировать (список через `:`) |
| `MINICUT_LOG` | `info` | уровень логов: `debug`, `info`, `warn`, `error` |

## Безопасность
API доступен только с `127.0.0.1`/`localhost`. Запросы с чужими `Host` и `Origin` отклоняются, `POST` принимает только JSON, импорт и экспорт ограничены `MINICUT_ROOTS`, скрытые папки (`~/.ssh` и т. п.) недоступны, расширения файлов проверяются.

## Разработка
```bash
npm test           # тесты (node:test), данные изолированы во временной папке
npm run lint       # ESLint
npm run format     # Prettier
```
Подробнее: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Лицензия
MIT
