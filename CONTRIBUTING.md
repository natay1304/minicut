# Участие в разработке

1. Node 20+ (`nvm use`), ffmpeg в `PATH`, `npm install`.
2. Перед коммитом: `npm run lint && npm run format:check && npm test`.
3. Тесты используют временную папку данных (`MINICUT_DATA`). Не запускай сервер и тесты с настоящей папкой `data/`: они меняют проекты.
4. Коммиты в формате Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
5. Новая операция: логика в `src/ops`, маршрут в `src/routes/api.js`, MCP-тул в `src/mcp.js`, тест в `test/`, строка в `docs/API.md`.
