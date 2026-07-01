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

npm ci
npm run build

sudo systemctl restart "$SERVICE"

# --- health-check с ретраями ---
ok=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  echo "health попытка $i: $code"
  if [ "$code" = "200" ]; then ok=1; break; fi
done

# --- авто-откат при неудаче ---
if [ -z "$ok" ]; then
  echo "Health-check провален -> откат на $PREV"
  git reset --hard "$PREV"
  npm ci
  npm run build
  sudo systemctl restart "$SERVICE"
  echo "Откат выполнен."
  exit 1
fi

echo "Деплой OK: $(git rev-parse HEAD)"
