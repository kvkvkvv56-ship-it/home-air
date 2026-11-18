#!/usr/bin/env python3
"""下载 Open Sans 自托管字体：只取 latin 子集，并核对内部版本号。

Google Fonts 现在的 Open Sans 是 v44（内部 Version 4.0xx），
每个字重返回多个 unicode-range 子集，必须只保留 basic-latin 那个，
否则文件名互相覆盖、页面缺字。
"""
import re
import struct
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "fonts"
OUT.mkdir(parents=True, exist_ok=True)

UA_WOFF2 = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
UA_TTF = "Mozilla/5.0"

WEIGHTS = [300, 400, 500, 600, 700]
FAMILY = "Open+Sans:wght@300;400;500;600;700"


def get_css(ua: str) -> str:
    url = f"https://fonts.googleapis.com/css2?family={FAMILY}&display=swap"
    return subprocess.run(["curl", "-s", "--max-time", "40", "-A", ua, url],
                          capture_output=True, text=True).stdout


def pick_latin(css: str) -> dict[int, str]:
    """返回 {weight: url}，只取 basic-latin 子集（unicode-range 含 U+0000-00FF）。"""
    out = {}
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
        w = re.search(r"font-weight:\s*(\d+)", block)
        u = re.search(r"src:\s*url\((https://[^)]+)\)", block)
        ur = re.search(r"unicode-range:\s*([^;]+);", block)
        if not (w and u):
            continue
        weight = int(w.group(1))
        rng = (ur.group(1) if ur else "").replace(" ", "")
        # basic latin 块
        if "U+0000-00FF" in rng or rng == "":
            out.setdefault(weight, u.group(1))
    return out


def font_version(path: Path) -> str:
    data = path.read_bytes()
    num = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(num):
        off = 12 + i * 16
        tag = data[off:off + 4].decode("latin1")
        toff, tlen = struct.unpack(">II", data[off + 8:off + 16])
        tables[tag] = (toff, tlen)
    toff, _ = tables["name"]
    _, count, str_off = struct.unpack(">HHH", data[toff:toff + 6])
    for i in range(count):
        r = toff + 6 + i * 12
        pid, eid, lid, nid, ln, so = struct.unpack(">HHHHHH", data[r:r + 12])
        if nid == 5:
            s = data[toff + str_off + so: toff + str_off + so + ln]
            return s.decode("utf-16-be") if pid == 3 else s.decode("latin1")
    return "?"


def main():
    for old in OUT.glob("OpenSans-*"):
        old.unlink()

    # 1) 用 TTF 版核对版本号
    ttf_map = pick_latin(get_css(UA_TTF))
    print("=== 版本核对（TTF）===")
    if not ttf_map:
        print("TTF 子集解析失败"); sys.exit(1)
    probe = OUT / "_probe.ttf"
    subprocess.run(["curl", "-sL", "--max-time", "90", "-o", str(probe),
                    ttf_map[sorted(ttf_map)[0]]], check=False)
    print(f"  内部版本: {font_version(probe)}")
    probe.unlink(missing_ok=True)

    # 2) 下载 woff2 latin 子集
    woff_map = pick_latin(get_css(UA_WOFF2))
    print("=== 下载 woff2（latin 子集）===")
    total = 0
    for weight in WEIGHTS:
        url = woff_map.get(weight)
        if not url:
            print(f"  ⚠️  {weight} 未取到 URL"); continue
        dest = OUT / f"OpenSans-{weight}.woff2"
        subprocess.run(["curl", "-sL", "--max-time", "90", "-o", str(dest), url],
                       check=False)
        size = dest.stat().st_size if dest.exists() else 0
        total += size
        print(f"  {weight:>3}  {size:>7,} bytes  {dest.name}")
    print(f"合计 {total:,} bytes")

    # 3) 计算每个文件的 sha 便于缓存失效
    print("\n=== 校验 ===")
    for f in sorted(OUT.glob("*.woff2")):
        print(f"  {f.name:22s} {f.stat().st_size:>7,} bytes")


if __name__ == "__main__":
    main()
