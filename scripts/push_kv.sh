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

BEARER="$(tr -d '\n' < "$TOKEN_FILE")"
AUTH_HEADER="Authorization: Bearer ${BEARER}"
LATEST="$ROOT/public/data/latest.json"
HISTORY="$ROOT/public/data/history.json"

for f in "$LATEST" "$HISTORY"; do
  [ -f "$f" ] || { echo "缺少文件: $f" >&2; exit 1; }
done

# ---------- 主路径：wrangler 直写 KV（不依赖自定义域 DNS） ----------
NS_ID="${HOME_AIR_KV_NS:-bdeaaa381c5d4a11918eb6ecc28489e6}"
if command -v wrangler >/dev/null 2>&1; then
  ok=0
  for spec in "data:latest.json|$LATEST" "data:history.json|$HISTORY"; do
    k="${spec%%|*}"; p="${spec##*|}"
    if wrangler kv key put "$k" --path "$p" --namespace-id="$NS_ID" --remote \
         >/tmp/home_air_kv.log 2>&1; then
      echo "  ✓ $k"
      ok=$((ok+1))
    else
      echo "  ✗ $k: $(tail -2 /tmp/home_air_kv.log | tr '\n' ' ')" >&2
    fi
  done
  if [ "$ok" -eq 2 ]; then exit 0; fi
  echo "wrangler 写入不完整，改用 HTTP 回退…" >&2
fi

# 两个 JSON 合成一个请求体（用 python 保证转义正确）
BODY="$(python3 - "$LATEST" "$HISTORY" <<'PY'
import json, sys
latest = json.load(open(sys.argv[1], encoding="utf-8"))
history = json.load(open(sys.argv[2], encoding="utf-8"))
print(json.dumps({"latest": latest, "history": history}, ensure_ascii=False))
PY
)"

HTTP_CODE="$(curl -sS -o /tmp/home_air_ingest.out -w '%{http_code}' \
  -X POST "$ENDPOINT" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  --data-binary "$BODY" --max-time 25 2>/tmp/home_air_ingest.err)" || HTTP_CODE="000"

if [ "$HTTP_CODE" = "200" ]; then
  echo "  KV 已更新: $(cat /tmp/home_air_ingest.out)"
else
  echo "  KV 推送失败 HTTP $HTTP_CODE: $(cat /tmp/home_air_ingest.out)" >&2
  exit 1
fi
