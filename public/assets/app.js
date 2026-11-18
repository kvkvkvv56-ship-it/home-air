/* home.kvkvkvv.site — 数据获取与渲染
   无依赖。图表用原生 SVG 绘制。 */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const TZ = "Asia/Shanghai";
  const PM25_LIMIT = 35; // GB 3095-2012 一级限值
  const STALE_MS = 20 * 60 * 1000; // 超过 20 分钟未更新视为陈旧

  /* ---------------- 工具 ---------------- */

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  function fmt(v, digits = 0) {
    return isNum(v) ? v.toFixed(digits) : "—";
  }

  function timeStr(ts) {
    if (!isNum(ts)) return "—";
    return new Date(ts * 1000).toLocaleTimeString("zh-CN", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function dateStr(ts) {
    if (!isNum(ts)) return "—";
    return new Date(ts * 1000).toLocaleDateString("zh-CN", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function relTime(ts) {
    if (!isNum(ts)) return "—";
    const diff = Date.now() / 1000 - ts;
    if (diff < 90) return "刚刚";
    if (diff < 3600) return `${Math.round(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.round(diff / 3600)} 小时前`;
    return dateStr(ts);
  }

  /* 与中国 PM2.5 分级对应 */
  function levelOf(pm25) {
    if (!isNum(pm25)) return { label: "—", color: "#707070" };
    if (pm25 < 35) return { label: "优", color: "#00A05A" };
    if (pm25 < 75) return { label: "良", color: "#B8A300" };
    if (pm25 < 115) return { label: "轻度污染", color: "#D2691E" };
    if (pm25 < 150) return { label: "中度污染", color: "#C0392B" };
    if (pm25 < 250) return { label: "重度污染", color: "#8E1B4F" };
    return { label: "严重污染", color: "#4A0E1F" };
  }

  async function fetchJSON(paths) {
    for (const url of paths) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) continue;
        const data = await res.json();
        clearTimeout(timer);
        return data;
      } catch (_) {
        /* 超时或失败：试下一个来源 */
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  /* ---------------- SVG 折线图 ---------------- */

  const W = 1000;
  const H = 260;
  const PAD = { top: 14, right: 12, bottom: 26, left: 34 };

  function drawChart(svg, series, opts = {}) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const pts = (series || []).filter((p) => isNum(p.v) && isNum(p.t));
    if (pts.length < 2) {
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", W / 2);
      t.setAttribute("y", H / 2);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "tick");
      t.textContent = "数据不足";
      svg.appendChild(t);
      return;
    }

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const threshold = opts.threshold ?? PM25_LIMIT;
    const values = pts.map((p) => p.v);
    const vMax = Math.max(...values, threshold + 5, 40);
    const vMin = 0;

    const x0 = PAD.left;
    const x1 = W - PAD.right;
    const y0 = PAD.top;
    const y1 = H - PAD.bottom;

    const tMin = pts[0].t;
    const tMax = pts[pts.length - 1].t;
    const tSpan = Math.max(1, tMax - tMin);

    const sx = (t) => x0 + ((t - tMin) / tSpan) * (x1 - x0);
    const sy = (v) => y1 - ((v - vMin) / (vMax - vMin)) * (y1 - y0);

    const NS = "http://www.w3.org/2000/svg";
    const el = (name, attrs) => {
      const n = document.createElementNS(NS, name);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };

    // 水平网格 + y 轴刻度
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const v = vMin + ((vMax - vMin) * i) / yTicks;
      const y = sy(v);
      svg.appendChild(
        el("line", {
          x1: x0,
          y1: y,
          x2: x1,
          y2: y,
          class: i === 0 ? "axis" : "grid-line",
          "vector-effect": "non-scaling-stroke",
        })
      );
      const label = el("text", {
        x: x0 - 8,
        y: y + 3,
        "text-anchor": "end",
        class: "tick",
      });
      label.textContent = Math.round(v);
      svg.appendChild(label);
    }

    // 限值线
    if (threshold <= vMax) {
      const ty = sy(threshold);
      svg.appendChild(
        el("line", {
          x1: x0,
          y1: ty,
          x2: x1,
          y2: ty,
          class: "threshold",
          "vector-effect": "non-scaling-stroke",
        })
      );
    }

    // 折线 + 面积
    const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
    const area = `${line}L${sx(tMax).toFixed(1)},${y1}L${sx(tMin).toFixed(1)},${y1}Z`;

    svg.appendChild(
      el("path", { d: area, class: "series-area", "vector-effect": "non-scaling-stroke" })
    );
    svg.appendChild(
      el("path", {
        d: line,
        class: "series-line",
        "vector-effect": "non-scaling-stroke",
      })
    );

    // x 轴时间刻度（4 个）
    for (let i = 0; i <= 3; i++) {
      const t = tMin + (tSpan * i) / 3;
      const label = el("text", {
        x: sx(t),
        y: H - 8,
        "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle",
        class: "tick",
      });
      label.textContent = opts.long ? dateStr(t).slice(5) : timeStr(t);
      svg.appendChild(label);
    }

    // 最后一个点
    const last = pts[pts.length - 1];
    svg.appendChild(
      el("circle", {
        cx: sx(last.t),
        cy: sy(last.v),
        r: 3,
        class: "marker",
        "vector-effect": "non-scaling-stroke",
      })
    );
  }

  /* ---------------- 室内数据 ---------------- */

  function setBadge(color, text) {
    const badge = $("#hero-level");
    if (!badge) return;
    badge.style.color = color;
    badge.style.borderColor = color;
    badge.querySelector("span").textContent = text;
  }

  function renderIndoor(latest) {
    if (!latest) return;

    const ind = latest.indoor || {};
    const pm = ind.pm25;
    const lvl = levelOf(pm);
    const label = ind.level || lvl.label;

    // Hero
    $("#hero-pm25").textContent = fmt(pm, pm < 10 ? 1 : 0);
    $("#hero-temp").textContent = isNum(ind.temperature_c)
      ? `${fmt(ind.temperature_c, 1)}°C`
      : "—";
    $("#hero-humid").textContent = isNum(ind.humidity)
      ? `${fmt(ind.humidity, 0)}%`
      : "—";
    const s24 = latest.stats_24h || {};
    $("#hero-avg").textContent = isNum(s24.avg) ? `${fmt(s24.avg, 1)}` : "—";
    $("#hero-updated").textContent = relTime(latest.updated_ts);
    setBadge(lvl.color, label.replace(/^空气/, ""));

    // 统计卡
    $("#stat-pm25").textContent = fmt(pm, pm < 10 ? 1 : 0);
    $("#stat-level").textContent = label.replace(/^空气/, "");
    $("#stat-level").style.color = lvl.color;
    $("#stat-temp").textContent = fmt(ind.temperature_c, 1);
    $("#stat-humid").textContent = fmt(ind.humidity, 0);

    $("#stat-pm25-note").textContent = isNum(s24.min)
      ? `24h 区间 ${fmt(s24.min, 1)} – ${fmt(s24.max, 1)}`
      : "—";
    $("#stat-level-note").textContent =
      pm === null || pm === undefined
        ? "—"
        : pm < 35
        ? "低于一级限值 35"
        : `超出限值 ${fmt(pm - 35, 1)}`;
    $("#stat-temp-note").textContent = isNum(ind.temperature_f)
      ? `${fmt(ind.temperature_f, 1)} °F`
      : "—";
    $("#stat-humid-note").textContent =
      isNum(ind.humidity) && ind.humidity < 35
        ? "偏干燥（< 35%）"
        : isNum(ind.humidity) && ind.humidity > 60
        ? "偏潮湿（> 60%）"
        : "舒适区间";

    // 陈旧提示
    const stale = isNum(latest.updated_ts)
      ? Date.now() / 1000 - latest.updated_ts > STALE_MS / 1000
      : true;
    const dot = $("#tz-dot");
    if (dot) {
      dot.className = "dot " + (stale ? "stale" : "");
      const s = $("#tz-status");
      if (s) s.textContent = stale ? "室内数据可能延迟" : "室内数据正常";
    }

    document.body.dataset.loading = "false";
  }

  function renderHistory(history, latest) {
    if (!history) return;
    drawChart($("#chart-24h"), (latest && latest.series_24h) || [], {
      threshold: PM25_LIMIT,
    });
    drawChart($("#chart-7d"), history.pm25_7d || [], {
      threshold: PM25_LIMIT,
      long: true,
    });

    const arch = history.archive || {};
    $("#m-rows").textContent = isNum(arch.total_rows)
      ? arch.total_rows.toLocaleString("zh-CN")
      : "—";
    $("#m-since").textContent = arch.since ? arch.since.slice(0, 10) : "—";

    const s7 = history.stats_7d || {};
    if (isNum(s7.avg)) {
      $("#legend-7d").innerHTML = `<i></i>7d 均值 ${fmt(s7.avg, 1)}`;
    }
  }

  /* ---------------- 通州（Open-Meteo） ---------------- */

  const TZ_URL =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    "?latitude=39.9097&longitude=116.6564" +
    "&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide," +
    "sulphur_dioxide,ozone,us_aqi,european_aqi" +
    "&timezone=Asia%2FShanghai";

  function outdoorLevel(pm25) {
    if (isNum(pm25) && pm25 >= 250) return "严重污染";
    return levelOf(pm25).label;
  }

  async function loadTongzhou(indoorPm) {
    try {
      const res = await fetch(TZ_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const c = json.current || {};

      $("#tz-pm25").textContent = fmt(c.pm2_5, 1);
      $("#tz-pm10").textContent = fmt(c.pm10, 1);
      $("#tz-o3").textContent = fmt(c.ozone, 1);
      $("#tz-no2").textContent = fmt(c.nitrogen_dioxide, 1);
      $("#tz-so2").textContent = fmt(c.sulphur_dioxide, 1);
      $("#tz-co").textContent = fmt(c.carbon_monoxide, 0);
      $("#tz-aqi").textContent = fmt(c.us_aqi, 0);
      $("#tz-eaqi").textContent = fmt(c.european_aqi, 0);
      $("#tz-time").textContent = c.time ? c.time.replace("T", " ") : "—";

      const dot = $("#tz-dot");
      if (dot) dot.className = "dot live";
      const st = $("#tz-status");
      if (st) st.textContent = "室外数据正常";

      // 对照区
      const oPm = c.pm2_5;
      $("#cmp-outdoor").textContent = fmt(oPm, oPm < 10 ? 1 : 0);
      $("#cmp-indoor").textContent = fmt(indoorPm, indoorPm < 10 ? 1 : 0);
      $("#cmp-outdoor-level").textContent = outdoorLevel(oPm);
      $("#cmp-outdoor-level").style.color = levelOf(oPm).color;
      $("#cmp-indoor-level").textContent = levelOf(indoorPm).label;

      const peak = Math.max(oPm || 0, indoorPm || 0, 1);
      const barIn = $("#cmp-indoor-bar");
      const barOut = $("#cmp-outdoor-bar");
      if (barIn) barIn.style.width = `${((indoorPm || 0) / peak) * 100}%`;
      if (barOut) barOut.style.width = `${((oPm || 0) / peak) * 100}%`;

      if (isNum(oPm) && isNum(indoorPm) && indoorPm > 0 && oPm > indoorPm) {
        $("#compare-lede").textContent =
          `同一时刻，室外 PM2.5 约为室内的 ${(oPm / indoorPm).toFixed(1)} 倍。`;
      }
    } catch (err) {
      const dot = $("#tz-dot");
      if (dot) dot.className = "dot down";
      const st = $("#tz-status");
      if (st) st.textContent = `室外数据不可用（${err.message}）`;
      ["#tz-pm25", "#tz-pm10", "#tz-o3", "#tz-no2", "#tz-so2", "#tz-co", "#tz-aqi", "#tz-eaqi"].forEach(
        (s) => {
          const n = $(s);
          if (n) n.textContent = "—";
        }
      );
    }
  }

  /* ---------------- 交互 ---------------- */

  function initInteractions() {
    // G 键切换网格辅助线（与主站一致的调试层）
    document.addEventListener("keydown", (e) => {
      if (e.key === "g" || e.key === "G") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        document.body.classList.toggle("show-grid");
      }
    });

    // 年号
    const y = $("#year");
    if (y) y.textContent = String(new Date().getFullYear());

    // 导航高亮
    const sections = $$("main section[id]");
    if ("IntersectionObserver" in window && sections.length) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            const id = en.target.id;
            $$(".site-nav a").forEach((a) => {
              if (a.getAttribute("href") === `#${id}`) {
                a.setAttribute("aria-current", "page");
              } else {
                a.removeAttribute("aria-current");
              }
            });
          });
        },
        { rootMargin: "-30% 0px -60% 0px" }
      );
      sections.forEach((s) => io.observe(s));
    }
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    initInteractions();

    // 数据来源优先级：
    //   1. Cloudflare KV（实时，已开 CORS）—— 任何地方部署都能读到最新
    //   2. 同源静态文件 —— 本地开发 / Cloudflare 自托管时直接用
    //   3. GitHub raw —— 最后的兜底
    const LIVE = "https://home.kvkvkvv.site/data";
    const GH =
      "https://raw.githubusercontent.com/kvkvkvv56-ship-it/home-air/main/public/data";

    const latest = await fetchJSON([
      `${LIVE}/latest.json`,
      "./data/latest.json",
      `${GH}/latest.json`,
    ]);
    const history = await fetchJSON([
      `${LIVE}/history.json`,
      "./data/history.json",
      `${GH}/history.json`,
    ]);

    if (latest) {
      renderIndoor(latest);
      renderHistory(history, latest);
      loadTongzhou(latest.indoor ? latest.indoor.pm25 : null);
    } else {
      document.body.dataset.loading = "false";
      const h = $("#hero-pm25");
      if (h) h.textContent = "—";
      setBadge("#707070", "数据不可用");
      loadTongzhou(null);
    }

    // 每 5 分钟刷新一次
    setTimeout(boot, 5 * 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
