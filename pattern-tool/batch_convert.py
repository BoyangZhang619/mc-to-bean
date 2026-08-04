#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
batch_convert.py — 递归转换 assets 中全部纹理为拼豆图纸 (默认设置)

- 默认配置 (与 entry.py 交互默认一致):
  mode=square, scale=64, bg=paper(米白纸纹), grid=on, legend=on,
  legend_style=simple([序号][环][豆号][数量]), numbers=on, palette=mard
- 输出: 项目根目录 patterns/ 下, 保持源文件相对结构
  (assets/minecraft/textures/block/xxx.png → patterns/minecraft/textures/block/xxx.png)
- 跳过: 动画纹理 (存在同名 .mcmeta, 多帧堆叠无法直接转) 和 宽/高 >128px 的超限纹理
- 支持并行 (-j) 与断点续跑 (输出已存在则跳过, --force 强制重转)

用法:
    python batch_convert.py            # 全量转换
    python batch_convert.py -j 4       # 4 进程并行
    python batch_convert.py --force    # 重新转换所有 (含已存在输出)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool

from PIL import Image

from palette import load_palette
from render import RenderOptions, build_page, load_texture, resolve_bg

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.normpath(os.path.join(TOOL_DIR, "..", "assets"))
OUT_ROOT = os.path.normpath(os.path.join(TOOL_DIR, "..", "patterns"))

MAX_EDGE = 128       # 宽或高超过该值的纹理跳过
BRAND = "mard"       # 默认豆号色卡
BG = resolve_bg("paper")  # 默认背景: 米白纸纹


def _is_animated(mcmeta_path: str) -> bool:
    """读取 mcmeta JSON, 仅当存在 "animation" 键时才判定为动画纹理。"""
    try:
        with open(mcmeta_path, encoding="utf-8") as f:
            data = json.load(f)
        return "animation" in data
    except Exception:
        return False


def collect_tasks() -> tuple:
    """递归扫描 assets, 返回 (任务列表, 跳过清单)。"""
    tasks, skipped = [], []
    for dirpath, _, files in os.walk(ASSETS_DIR):
        for f in sorted(files):
            if not f.endswith(".png"):
                continue
            src = os.path.join(dirpath, f)
            mcmeta = src + ".mcmeta"
            if os.path.exists(mcmeta) and _is_animated(mcmeta):
                skipped.append((src, "动画纹理 (多帧堆叠, 请按帧拆分后单独转换)"))
                continue
            try:
                with Image.open(src) as im:
                    w, h = im.size
            except Exception as e:
                skipped.append((src, f"无法读取: {e}"))
                continue
            if max(w, h) > MAX_EDGE:
                skipped.append((src, f"超限 {w}x{h} (> {MAX_EDGE})"))
                continue
            rel = os.path.relpath(src, ASSETS_DIR)  # minecraft/textures/...
            tasks.append((src, os.path.join(OUT_ROOT, rel), w, h))
    return tasks, skipped


def _convert_one(args: tuple) -> tuple:
    """单张纹理 → 图纸 (worker 进程执行)。"""
    src, dst, w, h = args
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        img = load_texture(src)
        opts = RenderOptions(
            mode="square", scale=64, bg=BG,
            grid=True, legend=True, legend_style="simple", numbers=True,
            palette=load_palette(BRAND),
        )
        title = f"{os.path.basename(src)}  ({w}x{h} 豆)"
        page = build_page([img], [title], opts)
        page.save(dst)
        return (dst, True, None)
    except Exception as e:
        return (dst, False, f"{type(e).__name__}: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(description="批量转换 assets 全部纹理为拼豆图纸 (默认设置)")
    parser.add_argument("-j", "--jobs", type=int, default=max(2, os.cpu_count() // 2),
                        help="并行进程数 (默认 CPU/2)")
    parser.add_argument("--force", action="store_true", help="强制重新转换已存在的输出")
    parser.add_argument("--limit", type=int, default=0,
                        help="只转换前 N 张 (调试用, 0=全部)")
    args = parser.parse_args()

    if not os.path.isdir(ASSETS_DIR):
        print(f"[错误] 找不到 assets 目录: {ASSETS_DIR}", file=sys.stderr)
        return 1

    tasks, skipped = collect_tasks()
    if args.limit:
        tasks = tasks[: args.limit]

    pending = tasks
    if not args.force:
        pending = [t for t in tasks if not os.path.exists(t[1])]
    print(f"[信息] 扫描完成: 共 {len(tasks)} 张, 跳过 {len(skipped)} 张, "
          f"待转换 {len(pending)} 张 (并行 {args.jobs})")

    t0 = time.time()
    ok = fail = 0
    done = 0
    with Pool(args.jobs) as pool:
        for dst, success, err in pool.imap_unordered(_convert_one, pending, chunksize=4):
            done += 1
            if success:
                ok += 1
            else:
                fail += 1
                print(f"[失败] {os.path.relpath(dst, OUT_ROOT)}: {err}", file=sys.stderr)
            if done % 25 == 0:
                el = time.time() - t0
                rate = done / el if el > 0 else 0
                eta = (len(pending) - done) / rate / 60 if rate > 0 else 0
                print(f"  ... {done}/{len(pending)}  ({rate:.1f} 张/秒, 预计剩余 {eta:.1f} 分钟)")

    print(f"\n[完成] 成功 {ok} 张, 失败 {fail} 张, 耗时 {(time.time() - t0) / 60:.1f} 分钟")
    print(f"[信息] 输出目录: {OUT_ROOT}")

    if skipped:
        print(f"\n[跳过] 共 {len(skipped)} 张 (未转换):")
        for src, reason in skipped:
            print(f"  [{reason}] {os.path.relpath(src, ASSETS_DIR)}")

    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
