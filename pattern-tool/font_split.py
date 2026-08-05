#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
font_split.py — 字体贴图按字符切分为拼豆图纸契约 JSON (Web 官方图纸区·花体字母分区)

解析 assets/minecraft/font/*.json 的 bitmap providers, 按标准 MC 字体网格规则
(每行 16 字符, 行数 = chars 行数) 把字体贴图切成单字符, 每个字符生成一张
契约图纸 JSON (单行压缩, MARD 豆号匹配), 输出到 patterns/fonts/<字体名>/。

用法:
    python font_split.py            # 切分全部含 bitmap 的字体
    python font_split.py --force    # 重新生成
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool

from PIL import Image

from palette import load_palette, match_all
from render import RenderOptions

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.normpath(os.path.join(TOOL_DIR, "..", "assets"))
OUT_ROOT = os.path.normpath(os.path.join(TOOL_DIR, "..", "patterns"))
FONT_DIR = os.path.join(ASSETS_DIR, "minecraft", "font")
BRAND = "mard"

CHARS_PER_ROW = 16   # MC 字体 bitmap 每行固定 16 字符


def collect_providers() -> list:
    """扫描 font/*.json 的 bitmap providers。返回 [(font_name, file_id, chars_rows)]"""
    out = []
    for f in sorted(os.listdir(FONT_DIR)):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(FONT_DIR, f), encoding="utf-8"))
        except Exception:
            continue
        for p in d.get("providers", []):
            if p.get("type") != "bitmap":
                continue
            file_id = p.get("file", "")
            if not file_id.startswith("minecraft:"):
                continue
            out.append((os.path.splitext(f)[0], file_id[len("minecraft:"):],
                        p.get("chars", [])))
    return out


def _char_name(ch: str) -> str:
    """字符 → 文件名安全命名: U+XXXX + 可打印字符(特殊字符替换)。"""
    safe = ch if (ch.isprintable() and ch not in '/\\:*?"<>|') else "_"
    return f"U+{ord(ch):04X}_{safe}"


def _split_one(args: tuple) -> tuple:
    font_name, file_path, chars, dst_dir, force = args
    try:
        img_path = os.path.join(ASSETS_DIR, "minecraft", "textures", file_path)
        if not os.path.exists(img_path):
            return (font_name, False, f"贴图不存在: {file_path}")
        # 字体贴图是透明底+白色字形: 合成深色底 (白底会让字形不可见)
        raw = Image.open(img_path).convert("RGBA")
        dark = Image.new("RGBA", raw.size, (24, 24, 24, 255))
        img = Image.alpha_composite(dark, raw).convert("RGB")
        n_rows = len(chars)
        char_w = img.width // CHARS_PER_ROW
        char_h = img.height // n_rows
        if char_w <= 0 or char_h <= 0:
            return (font_name, False, f"字符尺寸异常: {char_w}x{char_h}")

        opts = RenderOptions(palette=load_palette(BRAND))
        opts.bead_map = {}
        written = 0
        for row_i, row in enumerate(chars):
            for col_i, ch in enumerate(row):
                name = _char_name(ch)
                dst = os.path.join(dst_dir, f"{name}.json")
                if os.path.exists(dst) and not force:
                    continue
                crop = img.crop((col_i * char_w, row_i * char_h,
                                 (col_i + 1) * char_w, (row_i + 1) * char_h))
                if crop.width != char_w or crop.height != char_h:
                    continue
                colors = sorted(set(crop.getpixel((x, y)) for y in range(crop.height)
                                    for x in range(crop.width)))
                match_all(colors, opts.palette, opts.bead_map)
                from texture_to_pattern import build_json
                data = build_json(name, crop, opts)
                with open(dst, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
                written += 1
        return (font_name, True, f"{written} 字符")
    except Exception as e:
        return (font_name, False, f"{type(e).__name__}: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(description="字体贴图按字符切分为图纸 JSON")
    parser.add_argument("--force", action="store_true", help="重新生成已存在的输出")
    parser.add_argument("-j", "--jobs", type=int, default=max(2, os.cpu_count() // 2),
                        help="并行进程数")
    args = parser.parse_args()

    providers = collect_providers()
    if not providers:
        print("[错误] 未找到 bitmap 字体 provider", file=sys.stderr)
        return 1

    tasks = []
    for font_name, file_id, chars in providers:
        dst_dir = os.path.join(OUT_ROOT, "fonts", font_name)
        os.makedirs(dst_dir, exist_ok=True)
        tasks.append((font_name, file_id, chars, dst_dir, args.force))

    t0 = time.time()
    ok = fail = 0
    with Pool(args.jobs) as pool:
        for name, success, msg in pool.imap_unordered(_split_one, tasks, chunksize=1):
            if success:
                ok += 1
                print(f"[OK] {name}: {msg}")
            else:
                fail += 1
                print(f"[失败] {name}: {msg}", file=sys.stderr)

    print(f"\n[完成] 成功 {ok} 个字体, 失败 {fail}, 耗时 {(time.time() - t0):.1f}s")
    print(f"[信息] 输出目录: {os.path.join(OUT_ROOT, 'fonts')}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
