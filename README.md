# gov-strategy-ai

MVP web miniapp “Стратегический ИИ-штаб госсектора”: стратегическая рабочая среда с сессиями, ролями, интерактивными карточками результата, action-кнопками, MemPalace memory и evolution через реальный Ouroboros Desktop.

## Запуск

```bash
npm install
npm run dev
```

Откройте `http://localhost:3000`.

## Env variables

Скопируйте `.env.example` в `.env.local`:

```bash
CLOUD_RU_API_KEY=
CLOUD_RU_BASE_URL=https://foundation-models.api.cloud.ru/v1
CLOUD_RU_MODEL=ai-sage/GigaChat3-10B-A1.8B
SEARXNG_URL=http://localhost:8888
MEMPALACE_MCP_URL=
MEMPALACE_COMMAND=PYTHONPATH=/Users/sergey/Downloads/mempalace-main python3 -m mempalace.mcp_server
OUROBOROS_DESKTOP_URL=http://127.0.0.1:8765
OUROBOROS_DESKTOP_FALLBACK=true
```

## Веб-поиск (SearXNG)

Для точных данных в анализе региона используется реальный веб-поиск. Приоритетный
провайдер — бесплатный self-hosted **SearXNG** (метапоисковик-агрегатор Google/Bing/DDG,
без ключей и лимитов). Он находит первоисточники: законы о бюджете, стратегии СЭР,
открытый бюджет региона.

Поднять локально:

```bash
docker run -d --name searxng -p 8888:8080 \
  -e SEARXNG_SECRET=$(openssl rand -hex 16) \
  searxng/searxng:latest
# затем включить JSON в /etc/searxng/settings.yml:  search.formats: [html, json]
docker restart searxng
```

Затем задайте `SEARXNG_URL=http://localhost:8888` в `.env.local`.

Если `SEARXNG_URL` не задан, поиск откатывается на Tavily/Serper (по ключу) или
скрейпинг DuckDuckGo/Bing. Без числовых данных в источниках система пишет
«нужно снять baseline» и не рисует инфографику — вместо выдуманных цифр.

## Runtime policy

Mock-ответы и локальная имитация эволюции отключены. Для рабочего сценария нужны реальные подключения:

1. `CLOUD_RU_API_KEY` для генерации.
2. `MEMPALACE_MCP_URL` или `MEMPALACE_COMMAND` для памяти и retrieval.
3. Ouroboros Desktop через локальный Desktop API.

## Cloud.ru Foundation Models

LLM client использует OpenAI-compatible endpoint:

```http
POST {CLOUD_RU_BASE_URL}/chat/completions
Authorization: Bearer {CLOUD_RU_API_KEY}
```

Модель по умолчанию: `ai-sage/GigaChat3-10B-A1.8B`.

## Как работает сессия

Пользователь создает `SessionProfile` через wizard: роль, тип результата, аудитория, горизонт, регион, фокус, глубина и ограничения. Эти данные попадают в prompt builder, выбирают mode prompt и релевантные playbook rules.

## Как работает интерактив

Кнопки в workspace отправляют в `/api/action` объект:

```json
{
  "sessionId": "...",
  "outputId": "...",
  "actionType": "add_economic_effect",
  "currentContent": "...",
  "sessionProfile": {}
}
```

Backend собирает новый prompt, вызывает Cloud.ru LLM, сохраняет новый `AgentOutput` и пишет результат в MemPalace.

## Evolution agent и Ouroboros

Feedback сохраняется, затем `/api/feedback` запускает быстрый контур эволюции:

1. Ouroboros Desktop должен быть запущен локально.
2. Desktop state проверяется через `http://127.0.0.1:8765/api/state`.
3. Длинный prompt не отправляется в обычный чат Desktop, потому что это запускает автономную задачу и может блокировать UI.
4. Переписывание ответа делает реальная Cloud.ru-модель, а память и правила сохраняются в MemPalace и playbook storage.
5. Результат evolution сохраняется в `outputs`, `evolution`, playbook history и MemPalace.

Если Cloud.ru или MemPalace не подключены, feedback evolution не имитируется и вернет понятную ошибку подключения.

## Playbook library

Playbook’и доступны в `/playbooks`, редактируются вручную и автоматически через feedback loop. Seed-набор включает executive, strategy, sales region, analyst и отраслевые playbook’и.

## Storage

Сейчас используется local JSON adapter в `data/store.json`. Интерфейс `StorageAdapter` подготовлен для замены на PostgreSQL + PGVector + Redis.

План миграции:

1. Перенести `sessions`, `outputs`, `feedback`, `playbooks`, `evolution` в PostgreSQL.
2. Добавить PGVector embeddings для playbook rules, outputs и feedback.
3. Использовать Redis для кэша активных playbook’ов и runtime-состояния сессий.
4. Реализовать `PostgresStorageAdapter`, не меняя API routes и UI.

## Интеграция с настоящим Ouroboros Desktop

Интеграция в MVP сделана через локальный Desktop API:

1. `GET /api/health` проверяет, что Desktop жив.
2. `GET /api/state` показывает runtime state, бюджет, воркеры и состояние evolution/background процессов.
3. UI отображает Desktop как внешний runtime-наблюдатель.
4. Playbook update применяется через текущий `StorageAdapter`, а память пишется в MemPalace.

## Проверка

```bash
npm run lint
npm run build
```
