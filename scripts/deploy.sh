#!/usr/bin/env bash
# Безопасный прод-деплой gov-strategy-ai.
# Запускается НА сервере (CI вызывает его по SSH). Катит ТОЛЬКО код.
# Никогда не трогает боевые данные (data/) и секреты (.env*.local) — они gitignored.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gov-strategy-ai}"
SERVICE="${SERVICE:-gov-strategy-ai}"
PORT="${PORT:-3001}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/runtime/status"

cd "$APP_DIR"

# Runtime использует системный Chrome (PUPPETEER_EXECUTABLE_PATH) — бандл Chromium при npm ci не качаем.
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# --- ЗАЩИТА: не деплоим, если боевые данные всё ещё трекаются в git ---
# Иначе git reset --hard затрёт свежие сессии на сервере.
if git ls-files --error-unmatch data/store.json >/dev/null 2>&1; then
  echo "ABORT: data/ всё ещё в git. Сначала: git rm -r --cached data && commit && push."
  exit 1
fi

PREV="$(git rev-parse HEAD)"
echo "Текущий коммит: $PREV"

git fetch --all --prune
git reset --hard origin/main   # только код; data/ и .env*.local не трекаются -> сохраняются

# Сборка + надёжный перезапуск. Ключевые уроки инцидента:
#  - rm -rf .next: без него на диске остаётся устаревший prerender, ссылающийся на
#    старые имена чанков (Turbopack меняет их при каждой правке стилей) -> 500 на CSS.
#  - освобождение порта: осиротевший процесс на PORT (EADDRINUSE) не даёт новому
#    процессу подняться, systemctl уходит в крэш-цикл, а старый билд продолжает жить.
build_and_restart() {
  rm -rf .next
  npm ci
  npm run build
  sudo systemctl stop "$SERVICE" 2>/dev/null || true
  sudo fuser -k "${PORT}/tcp" 2>/dev/null || true   # добить любой сторонний процесс на порту
  sleep 2
  sudo systemctl start "$SERVICE"
}

build_and_restart

# --- health-check: и API, и РЕАЛЬНАЯ отдача CSS свежего билда ---
# Только /api недостаточно: при рассинхроне чанков API отвечает 200, а сайт без стилей.
health_ok() {
  local api css_path css_code
  api="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  [ "$api" = "200" ] || { echo "  api=$api (не готов)"; return 1; }
  css_path="$(curl -s "http://127.0.0.1:${PORT}/" | grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.css' | head -1 || true)"
  if [ -n "$css_path" ]; then
    css_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${css_path}" || true)"
    echo "  api=$api css=$css_code ($css_path)"
    [ "$css_code" = "200" ] || return 1
  else
    echo "  api=$api css=ссылка-не-найдена"
  fi
  return 0
}

ok=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  if health_ok; then ok=1; echo "health OK (попытка $i)"; break; fi
  echo "health попытка $i: ещё не готов"
done

# --- авто-откат при неудаче ---
if [ -z "$ok" ]; then
  echo "Health-check провален -> откат на $PREV"
  git reset --hard "$PREV"
  build_and_restart
  echo "Откат выполнен."
  exit 1
fi

echo "Деплой OK: $(git rev-parse HEAD)"
