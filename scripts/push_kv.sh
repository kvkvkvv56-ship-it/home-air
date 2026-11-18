#!/bin/bash
# 把导出的 JSON 推送到 Cloudflare KV（经 Worker 的 /api/ingest）。
# token 存在 ~/.hermes/secrets/home_air_ingest_token，不进仓库。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="${HOME_AIR_ENDPOINT:-https://home.kvkvkvv.site/api/ingest}"
TOKEN_FILE="${HOME_AIR_TOKEN_FILE:-$HOME/.hermes/secrets/home_air_ingest_token}"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "缺少 ingest token: $TOKEN_FILE" >&2
  exit 1
fi

TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
LATEST="$ROOT/public/data/latest.json"
HISTORY="$ROOT/public/data/history.json"

for f in "$LATEST" "$HISTORY"; do
  [ -f "$f" ] || { echo "缺少文件: $f" >&2; exit 1; }
done

# 两个 JSON 合成一个请求体（用 python 保证转义正确）
BODY="$(python3 - "$LATEST" "$HISTORY" <<'PY'
import json, sys
latest = json.load(open(sys.argv[1], encoding="utf-8"))
history = json.load(open(sys.argv[2], encoding="utf-8"))
print(json.dumps({"latest": latest, "history": history}, ensure_ascii=False))
PY
)"

HTTP_CODE="$(curl -s -o /tmp/home_air_ingest.out -w '%{http_code}' \
  -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "$BODY" --max-time 20)"

if [ "$HTTP_CODE" = "200" ]; then
  echo "  KV 已更新: $(cat /tmp/home_air_ingest.out)"
else
  echo "  KV 推送失败 HTTP $HTTP_CODE: $(cat /tmp/home_air_ingest.out)" >&2
  exit 1
fi
