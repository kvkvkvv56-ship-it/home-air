# home-air

家庭空气质量仪表盘。室内 PM2.5 / 温湿度实时读数与长期归档，并对照北京通州实时空气质量。

**线上地址**：<https://home.kvkvkvv.site>

---

## 结构

```
home-air/
├── public/                   静态站点（Vercel & Cloudflare 共用同一份）
│   ├── index.html
│   ├── assets/style.css      Swiss 4 列网格设计系统
│   ├── assets/app.js         数据获取 + 原生 SVG 图表
│   └── data/                 导出后的数据（由 sync 脚本更新）
│       ├── latest.json       当前值 + 近 24h 逐小时
│       └── history.json      近 7d 逐小时 + 归档统计
├── src/worker.js             Cloudflare Worker（静态资源 + KV 数据 + ingest）
├── wrangler.jsonc            Cloudflare 配置（KV 绑定、自定义域）
├── vercel.json               Vercel 配置（静态输出 public/）
└── scripts/
    ├── export_data.py        SQLite 归档 → JSON
    ├── push_kv.sh            JSON → Cloudflare KV（经 ingest 接口）
    └── sync.sh               导出 + 推 KV + 提交 GitHub（定时任务入口）
```

## 数据链路

```
小米空气净化器
   → Home Assistant（xiaomi_home 集成）
   → 本地 SQLite 归档 ~/.hermes/data/air-quality/archive.db（只追加）
   → export_data.py（按小时聚合）
   → public/data/*.json
        ├→ Cloudflare KV  ← 前端优先读取这里（实时，无需重新部署）
        └→ GitHub          ← 长期归档副本（前端兜底走 jsDelivr）
```

室外数据由浏览器直接向
[Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
请求，取通州区坐标 `39.9097, 116.6564`，每小时更新，无需 API key。

## 设计

设计语汇严格对齐 [kvkvkvv.site](https://kvkvkvv.site)：

| 令牌 | 值 |
|---|---|
| 网格 | 4 列，`gap: clamp(18px, 1.8vw, 36px)` |
| 版心 | `padding-inline: clamp(20px, 3.75vw, 72px)` |
| 基线 | 8px |
| 墨色 | `#050505` |
| 纸色 | `#fff` |
| 次级文字 | `#707070` |
| 分隔线 | `rgba(5, 5, 5, 0.16)` |
| 强调色 | `#0042FF`（仅用于网格辅助线与交互态） |
| 无衬线 | OPPO Sans 4.0（自托管子集 109KB）/ Helvetica |

按 **G** 键可切换网格辅助线。

## 本地开发

```bash
npm run export     # 从 SQLite 导出 JSON
npm run serve      # http://127.0.0.1:8788
```

## 部署

线上地址：

| 平台 | 地址 | 说明 |
|---|---|---|
| Cloudflare Workers | https://home.kvkvkvv.site | 主站，KV 实时数据 |
| Vercel | https://home-air.vercel.app | 镜像，GitHub 自动部署 |

```bash
# Cloudflare（主站，KV + Workers Assets）
npx wrangler deploy

# Vercel（镜像）
npx vercel deploy --prod
```

首次部署后创建摄入令牌并写入本机：

```bash
npx wrangler secret put INGEST_TOKEN
# 把同一个值写入 ~/.hermes/secrets/home_air_ingest_token（chmod 600）
```

## 定时同步

`scripts/sync.sh` 是定时任务入口：导出 → 推 KV → 提交 GitHub。
已通过 launchd 每 5 分钟运行：

```
~/Library/LaunchAgents/com.hermes.homeair.sync.plist
日志：sync.out.log / sync.err.log
```

`push_kv.sh` 优先用 `wrangler kv key put` 直写 KV（不依赖自定义域 DNS），
失败才回退到 `/api/ingest` HTTP 接口。

Vercel 配了 `ignoreCommand`：只改 `public/data/` 的提交不会触发重新构建
（数据走 KV 实时读取），避免每天几百次无谓部署。

## 数据说明

- 室内温度由传感器以**华氏度**上报，导出时换算为摄氏度。
- 原始归档只追加、不清洗，包含极端值（PM2.5 上限 600 为设备量程）。
- 分级口径：GB 3095-2012，一级限值 35 μg/m³。
