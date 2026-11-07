# Деплой и публикация

Сервер ходит только в публичный API normot.co.il, своих данных и секретов у него нет. Переменные окружения не нужны.

## 1. Проект на Vercel

Проект `normot-mcp` в команде «Dan's projects» создан 05.11.2026 (Framework: Other, Node.js 22). 06.11.2026 к нему подключён репозиторий `danvolsky-source/normot-mcp`: каждый push в `main` деплоится в production, каждый PR получает preview-деплой.

Адрес `*.vercel.app` закрыт Vercel Authentication (так в команде по умолчанию); открыт только свой домен.

## 2. Поддомен mcp.normot.co.il

Домен уже добавлен в проект. DNS normot.co.il обслуживает sitesdepot (ns1/ns2.sitesdepot.com), поэтому запись добавляется там:

```
mcp   CNAME   816402a1d68947c1.vercel-dns-016.com.
```

(запасной вариант от Vercel: `cname.vercel-dns.com.`). Сертификат Vercel выпустит сам. Проверить: `MCP_URL=https://mcp.normot.co.il/mcp npm run smoke`.

## 3. Проверка в Claude

claude.ai → Settings → Connectors → Add custom connector → `https://mcp.normot.co.il/mcp`. Спросить, например: «Какие требования к ממ"ד в жилом доме в Тель-Авиве на этапе היתר? Дай ссылки на нормы».

## 4. Официальный реестр MCP

Имя в `server.json`: `io.github.danvolsky-source/normot`. Публикация идёт из GitHub Actions через OIDC, без паролей и токенов: Actions → **Publish to MCP Registry** → Run workflow. Workflow сначала проверяет, что https://mcp.normot.co.il/mcp отвечает, потом валидирует и публикует `server.json`.

При каждом новом релизе поднимать `version` в `server.json` и `package.json`, затем снова запускать workflow.

Позже можно перейти на имя `il.co.normot/normot`: для этого нужно подтвердить домен (TXT-запись в DNS normot.co.il), порядок описан в документации реестра.

## 5. Каталоги

Отправить ссылку на репозиторий в glama.ai, mcpmarket.com, smithery.ai, pulsemcp.com (у каждого своя форма «Add server»). Там же лежат israel-law-mcp и com.judaro/israeli-law.

## 6. Сайт

Добавить в https://normot.co.il/llms.txt и в /api строку с адресом MCP:

```
- MCP server (for AI assistants): https://mcp.normot.co.il/mcp — https://github.com/danvolsky-source/normot-mcp
```

## 7. Статистика

Логи Vercel на бесплатном тарифе живут недолго, поэтому сервер пишет дневные счётчики в базу NORMOT (Supabase, проект Tokef). Схема и функция записи: `db/mcp_stats.sql`.

- `core.mcp_hits`: день, метод, инструмент, клиент (из `initialize`), User-Agent, число.
- `core.mcp_search_hits`: текст запросов `search_norms` по дням. Другие аргументы не пишутся.
- `core.mcp_bot_patterns`: шаблоны ботов-проверялок каталогов. Флаг `is_bot` считается при чтении во `core.v_mcp_hits`, список можно пополнять без деплоя.

Переменные окружения в Vercel (без них статистика выключена): `NORMOT_STATS_URL` (адрес проекта Supabase), `NORMOT_STATS_ANON_KEY` (publishable key), `NORMOT_STATS_INGEST_KEY` (секрет; его sha256 лежит в `core.report_keys` под именем `mcp-ingest`).

Главная метрика: вызовы инструментов не от ботов.

```sql
select day, tool, sum(n) from core.v_mcp_hits
 where method = 'tools/call' and not is_bot group by 1, 2 order by 1 desc, 3 desc;
```

## Поддержка

- CI каждый день вызывает все инструменты против живого API. Если упал, значит изменился контракт API, и сервер нужно поправить.
- Раз в квартал обновлять `@modelcontextprotocol/sdk` и проверять `npm audit`.
