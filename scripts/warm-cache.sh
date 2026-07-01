#!/bin/bash
REGION="$1"
KIND="$2"
OUTPUT="$3"
BASE="${SEARXNG_URL:-http://127.0.0.1:8888}"

case "$KIND" in
  summary) QUERIES=("$REGION бюджет 2026 доходы расходы" "$REGION социально-экономическое положение" "$REGION население ВРП экономика") ;;
  industries) QUERIES=("$REGION структура экономики ВРП отрасли" "$REGION промышленность сельское хозяйство строительство торговля статистика") ;;
  budget) QUERIES=("$REGION бюджет 2026 доходы расходы млрд" "$REGION закон о бюджете 2026" "$REGION бюджет для граждан 2026") ;;
  scenarios) QUERIES=("$REGION стратегия социально-экономического развития до 2030" "$REGION приоритеты развития на 5 лет губернатор") ;;
  competition) QUERIES=("$REGION цифровые проекты поставщик информационная система" "$REGION закупки ИТ услуги информационная система") ;;
  entry_points) QUERIES=("$REGION правительство министерство цифрового развития минфин минэкономики" "$REGION государственные программы цифровизация") ;;
  closing) QUERIES=("$REGION стратегические приоритеты развитие бюджет госпрограммы" "$REGION риски социально-экономического развития") ;;
  *) QUERIES=("$REGION $KIND") ;;
esac

echo "[" > "$OUTPUT"
FIRST=1
for QUERY in "${QUERIES[@]}"; do
  [ $FIRST -eq 0 ] && sleep 3
  ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY" 2>/dev/null)
  [ -z "$ENCODED" ] && continue
  URL="${BASE}/search?q=${ENCODED}&format=json&language=ru&safesearch=2"
  RAW=$(curl -sS --max-time 10 -H "Accept: application/json" -H "Accept-Language: ru-RU,ru;q=0.9" "$URL" 2>/dev/null)
  [ -z "$RAW" ] && continue
  RESULTS=$(echo "$RAW" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for r in d.get('results',[]):
    url=r.get('url','')
    if not url.startswith('http'): continue
    print(json.dumps({'url':url,'title':r.get('title',''),'snippet':r.get('content','')[:700],'source':url.split('/')[2],'query':sys.argv[1],'fetchedAt':'$(date -Iseconds)'}))
" "$QUERY" 2>/dev/null)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [ $FIRST -eq 0 ] && echo "," >> "$OUTPUT"
    echo "$line" >> "$OUTPUT"
    FIRST=0
  done <<< "$RESULTS"
done
echo "]" >> "$OUTPUT"
