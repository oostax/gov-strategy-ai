#!/bin/bash
QUERY="$1"
BASE="${SEARXNG_URL:-http://127.0.0.1:8888}"
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY" 2>/dev/null)
if [ -z "$ENCODED" ]; then
  echo '{"results":[]}'
  exit 0
fi
URL="${BASE}/search?q=${ENCODED}&format=json&language=ru&safesearch=2"
curl -sS --max-time 10 -H "Accept: application/json" -H "Accept-Language: ru-RU,ru;q=0.9" "$URL" 2>/dev/null || echo '{"results":[]}'
