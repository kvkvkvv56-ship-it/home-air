/**
 * home.kvkvkvv.site — Cloudflare Worker
 *
 * 职责：
 *   1. 静态资源由 Workers Assets 提供（public/ 目录）
 *   2. 数据从 KV 读取（data:latest.json / data:history.json），
 *      始终优先于构建时的静态副本 —— 这样数据更新不需要重新部署
 *   3. POST /api/ingest 接收本机推送的最新数据写入 KV（Bearer 校验）
 *   4. GET  /api/health 返回健康状态与数据年龄
 */

const DATA_KEYS = ["latest", "history"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ---- CORS 预检（Vercel 部署会跨域读这里的数据）----
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ---- 写入接口 ----
    if (pathname === "/api/ingest") {
      return handleIngest(request, env);
    }

    // ---- 健康检查 ----
    if (pathname === "/api/health") {
      const latest = await env.HOME_AIR.get("data:latest.json", "json");
      const age = latest?.updated_ts
        ? Math.round(Date.now() / 1000 - latest.updated_ts)
        : null;
      return json(
        {
          ok: true,
          has_kv_data: Boolean(latest),
          updated: latest?.updated ?? null,
          age_seconds: age,
          commit: env.CF_VERSION_METADATA?.id ?? null,
        },
        200,
        { "cache-control": "no-store" }
      );
    }

    // ---- 数据：KV 优先 ----
    const dataMatch = pathname.match(/^\/data\/(latest|history)\.json$/);
    if (dataMatch) {
      const key = `data:${dataMatch[1]}.json`;
      const body = await env.HOME_AIR.get(key, "text");
      if (body) {
        return new Response(body, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=60",
            ...corsHeaders(),
          },
        });
      }
      // KV 里还没有 -> 回落到静态文件
      return env.ASSETS.fetch(request);
    }

    // ---- 其余交给静态资源 ----
    return env.ASSETS.fetch(request);
  },
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
  };
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extra,
    },
  });
}

async function handleIngest(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const written = [];
  for (const name of DATA_KEYS) {
    const value = payload[name];
    if (value === undefined || value === null) continue;
    await env.HOME_AIR.put(
      `data:${name}.json`,
      typeof value === "string" ? value : JSON.stringify(value)
    );
    written.push(name);
  }

  if (!written.length) {
    return json({ ok: false, error: "no data keys" }, 400);
  }

  return json({ ok: true, written, at: new Date().toISOString() });
}
