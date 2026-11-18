#!/usr/bin/env python3
"""把本地空气质量归档库导出成站点用的 JSON。

输出:
  public/data/latest.json     — 当前值 + 近 24h 逐小时序列（首屏用，要小）
  public/data/history.json    — 近 7 天逐小时序列 + 统计

温度源数据是华氏度（HA 实体 unit=°F），这里统一换算成摄氏度。
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB = Path.home() / ".hermes/data/air-quality/archive.db"
OUT = Path(__file__).resolve().parent.parent / "public" / "data"
TZ = timezone(timedelta(hours=8))  # Asia/Shanghai

# PM2.5 分级（中国 HJ 633-2012 / 常见展示口径）
LEVELS = [
    (0, 35, "优", "#00A05A"),
    (35, 75, "良", "#B8A300"),
    (75, 115, "轻度污染", "#D2691E"),
    (115, 150, "中度污染", "#C0392B"),
    (150, 250, "重度污染", "#8E1B4F"),
    (250, 10**9, "严重污染", "#4A0E1F"),
]


def level_of(pm25: float | None) -> dict:
    if pm25 is None:
        return {"label": "—", "color": "#707070"}
    for lo, hi, label, color in LEVELS:
        if lo <= pm25 < hi:
            return {"label": label, "color": color}
    return {"label": "—", "color": "#707070"}


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, TZ).strftime("%Y-%m-%dT%H:%M:%S%z")


def hourly_series(cur: sqlite3.Cursor, metric: str, hours: int) -> list[dict]:
    """按小时聚合（取该小时平均值）。"""
    since = time.time() - hours * 3600
    rows = cur.execute(
        """
        SELECT CAST(ts / 3600 AS INTEGER) AS h, AVG(value), COUNT(*)
        FROM readings
        WHERE metric = ? AND ts >= ? AND value IS NOT NULL
        GROUP BY h ORDER BY h
        """,
        (metric, since),
    ).fetchall()
    out = []
    for h, avg, n in rows:
        out.append({"t": int(h) * 3600, "v": round(avg, 1), "n": n})
    return out


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"归档库不存在: {DB}")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    cur = conn.cursor()

    # 每个指标的最新值
    latest: dict[str, dict] = {}
    for metric in ("pm25", "temperature", "humidity", "air_quality"):
        row = cur.execute(
            "SELECT ts, value, text_value FROM readings WHERE metric = ? "
            "ORDER BY ts DESC LIMIT 1",
            (metric,),
        ).fetchone()
        if row:
            latest[metric] = {"ts": row[0], "value": row[1], "text": row[2]}

    pm = latest.get("pm25", {})
    temp_f = latest.get("temperature", {}).get("value")
    hum = latest.get("humidity", {}).get("value")
    aq_text = latest.get("air_quality", {}).get("text")

    pm25_now = pm.get("value")
    temp_c = round((temp_f - 32) * 5 / 9, 1) if temp_f is not None else None

    updated_ts = pm.get("ts") or time.time()

    # 近 24h / 7d 序列
    s24 = hourly_series(cur, "pm25", 24)
    s7d = hourly_series(cur, "pm25", 24 * 7)
    t24 = hourly_series(cur, "temperature", 24)
    h24 = hourly_series(cur, "humidity", 24)

    def stats(series: list[dict]) -> dict:
        vals = [p["v"] for p in series if p["v"] is not None]
        if not vals:
            return {"min": None, "max": None, "avg": None, "n": 0}
        return {
            "min": round(min(vals), 1),
            "max": round(max(vals), 1),
            "avg": round(sum(vals) / len(vals), 1),
            "n": len(vals),
        }

    # 总记录数
    total = cur.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
    first_ts = cur.execute("SELECT MIN(ts) FROM readings").fetchone()[0]

    latest_out = {
        "updated": iso(updated_ts),
        "updated_ts": int(updated_ts),
        "generated_at": iso(time.time()),
        "indoor": {
            "pm25": pm25_now,
            "level": aq_text or level_of(pm25_now)["label"],
            "level_color": level_of(pm25_now)["color"],
            "temperature_c": temp_c,
            "temperature_f": temp_f,
            "humidity": hum,
        },
        "series_24h": s24,
        "stats_24h": stats(s24),
    }

    history_out = {
        "generated_at": iso(time.time()),
        "archive": {
            "total_rows": total,
            "since": iso(first_ts) if first_ts else None,
            "db": DB.name,
        },
        "pm25_7d": s7d,
        "stats_7d": stats(s7d),
        "temperature_24h": t24,
        "humidity_24h": h24,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latest.json").write_text(
        json.dumps(latest_out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (OUT / "history.json").write_text(
        json.dumps(history_out, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    conn.close()

    print(f"✅ 已导出")
    print(f"   PM2.5={pm25_now} ({latest_out['indoor']['level']}) "
          f"温度={temp_c}°C 湿度={hum}%")
    print(f"   24h 序列 {len(s24)} 点 / 7d 序列 {len(s7d)} 点")
    print(f"   累计 {total} 条记录，始于 {iso(first_ts) if first_ts else '?'}")
    print(f"   → {(OUT / 'latest.json')}")
    print(f"   → {(OUT / 'history.json')}")


if __name__ == "__main__":
    main()
