#!/bin/bash
# 导出数据 → 推送到 Cloudflare KV → 提交到 GitHub
# 由定时任务每 5 分钟调用一次。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[$(date '+%H:%M:%S')] 导出数据…"
python3 scripts/export_data.py

echo "[$(date '+%H:%M:%S')] 推送到 Cloudflare KV…"
bash scripts/push_kv.sh || echo "  ⚠️  KV 推送失败（不阻断 git）"

echo "[$(date '+%H:%M:%S')] 提交到 GitHub…"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add public/data/latest.json public/data/history.json
  if git diff --cached --quiet; then
    echo "  数据无变化，跳过提交"
  else
    git -c user.name="home-air bot" -c user.email="bot@kvkvkvv.site" \
      commit -q -m "data: $(date '+%Y-%m-%d %H:%M') 空气质量快照"
    git push -q origin HEAD 2>/dev/null || git push -q origin main 2>/dev/null \
      || echo "  ⚠️  推送失败（稍后重试）"
    echo "  已提交"
  fi
else
  echo "  非 git 目录，跳过"
fi

echo "[$(date '+%H:%M:%S')] 完成"
