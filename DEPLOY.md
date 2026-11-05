# Деплой и публикация

Сервер ходит только в публичный API normot.co.il, своих данных и секретов у него нет. Переменные окружения не нужны.

## 1. Проект на Vercel

1. Vercel → Add New → Project → импортировать репозиторий `danvolsky-source/normot-mcp`.
2. Framework Preset: **Other**. Build Command и Output Directory оставить пустыми. Node.js 22.
3. Deploy. После деплоя проверить:
   - `https://<проект>.vercel.app/` отдаёт JSON с описанием сервера;
   - `MCP_URL=https://<проект>.vercel.app/mcp npm run smoke` проходит все вызовы.

## 2. Поддомен mcp.normot.co.il

1. Vercel → проект → Settings → Domains → добавить `mcp.normot.co.il`.
2. У регистратора/в DNS normot.co.il добавить запись, которую покажет Vercel (обычно `CNAME mcp → cname.vercel-dns.com`).
3. Проверить: `MCP_URL=https://mcp.normot.co.il/mcp npm run smoke`.

## 3. Проверка в Claude

claude.ai → Settings → Connectors → Add custom connector → `https://mcp.normot.co.il/mcp`. Спросить, например: «Какие требования к ממ"ד в жилом доме в Тель-Авиве на этапе היתר? Дай ссылки на нормы».

## 4. Официальный реестр MCP

Имя в `server.json`: `io.github.danvolsky-source/normot` (вход через GitHub, без DNS).

```sh
# установить mcp-publisher: https://github.com/modelcontextprotocol/registry (раздел Releases)
mcp-publisher validate          # проверить server.json
mcp-publisher login github      # вход через браузер, аккаунт danvolsky-source
mcp-publisher publish
```

Перед публикацией сверить шаги с актуальной документацией реестра: он пока в режиме preview. При каждом новом релизе поднимать `version` в `server.json` и `package.json`.

Позже можно перейти на имя `il.co.normot/normot`: для этого нужно подтвердить домен (TXT-запись в DNS normot.co.il), порядок описан в документации реестра.

## 5. Каталоги

Отправить ссылку на репозиторий в glama.ai, mcpmarket.com, smithery.ai, pulsemcp.com (у каждого своя форма «Add server»). Там же лежат israel-law-mcp и com.judaro/israeli-law.

## 6. Сайт

Добавить в https://normot.co.il/llms.txt и в /api строку с адресом MCP:

```
- MCP server (for AI assistants): https://mcp.normot.co.il/mcp — https://github.com/danvolsky-source/normot-mcp
```

## 7. Замер через 30 дней

Vercel → проект → Logs, фильтр `"evt":"mcp"`. Смотреть число `tools/call` в день и поле `client` у `initialize` (какие ИИ подключаются). Аргументы запросов не логируются.

## Поддержка

- CI каждый день вызывает все инструменты против живого API. Если упал, значит изменился контракт API, и сервер нужно поправить.
- Раз в квартал обновлять `@modelcontextprotocol/sdk` и проверять `npm audit`.
