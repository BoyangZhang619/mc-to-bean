#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split_animations.py — 拆分 Minecraft 动画纹理, 逐帧转为拼豆图纸

- 扫描 assets 中所有真动画纹理 (.mcmeta 含 "animation" 键)
- 按 mcmeta 定义的帧布局 (width/height/frames) 逐帧拆分
- 每帧输出一张独立的拼豆图纸, 后缀 _a, _b, _c, ...
- 渲染配置与 batch_convert.py 完全一致 (square/scale=64/paper/mard/...)
- 输出: patterns/ 下, 保持源文件相对结构
  (assets/minecraft/textures/block/fire_0.png → patterns/minecraft/textures/block/fire_0_a.png)
- 并行 multiprocessing, 断点续跑 (--force 重转), --limit 调试

用法:
    python split_animations.py              # 拆分所有动画
    python split_animations.py --limit 5    # 只拆分前 5 个动画文件
    python split_animations.py --force      # 强制重新转换已存在的帧
    python split_animations.py -j 4         # 4 进程并行
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

BRAND = "mard"
BG = resolve_bg("paper")


# ---------------------------------------------------------------- 工具函数

def _frame_suffix(index: int) -> str:
    """0 -> 'a', 1 -> 'b', ..., 25 -> 'z', 26 -> 'aa', 27 -> 'ab', ..."""
    if index < 0:
        raise ValueError("index must be >= 0")
    result = []
    n = index
    while True:
        result.append(chr(ord('a') + n % 26))
        n = n // 26 - 1
        if n < 0:
            break
    return ''.join(reversed(result))


def _is_animated(mcmeta_path: str) -> bool:
    """读取 mcmeta JSON, 仅当存在 "animation" 键时才判定为动画纹理。"""
    try:
        with open(mcmeta_path, encoding="utf-8") as f:
            data = json.load(f)
        return "animation" in data
    except Exception:
        return False


def _parse_animation(mcmeta_path: str, texture_w: int, texture_h: int) -> tuple:
    """
    解析动画 mcmeta, 返回 (tile_w, tile_h, frame_indices, total_tiles).

    - tile_w: 瓦片宽 = animation.width (缺省=纹理宽)
    - tile_h: 瓦片高 = animation.height (缺省=width)
    - total_tiles: 纹理中瓦片总数 = texture_h // tile_h
    - frame_indices: 播放顺序列表 (已摊平, 如遇 dict 格式则取 index 字段)
    """
    with open(mcmeta_path, encoding="utf-8") as f:
        data = json.load(f)
    anim = data["animation"]

    tile_w = anim.get("width", texture_w)
    tile_h = anim.get("height", tile_w)  # mcmeta 缺省 height = width

    n = texture_h // tile_h
    raw_frames = anim.get("frames")
    if raw_frames is None:
        frame_indices = list(range(n))
    elif raw_frames and isinstance(raw_frames[0], dict):
        # 格式: [{"index": 0, "time": 2}, ...] — 只取 index, 忽略 time
        frame_indices = [f["index"] for f in raw_frames]
    else:
        frame_indices = list(raw_frames)

    return tile_w, tile_h, frame_indices, n


# ---------------------------------------------------------------- 任务收集

def collect_animation_tasks() -> list:
    """
    扫描 assets, 收集所有动画纹理的逐帧转换任务。

    返回: [(src, tile_idx, tile_w, tile_h, total_frames, dst, frame_num), ...]
    """
    tasks = []
    for dirpath, _, files in os.walk(ASSETS_DIR):
        for f in sorted(files):
            if not f.endswith(".png"):
                continue
            src = os.path.join(dirpath, f)
            mcmeta = src + ".mcmeta"
            if not os.path.exists(mcmeta) or not _is_animated(mcmeta):
                continue

            try:
                with Image.open(src) as im:
                    tw, th = im.size
            except Exception as e:
                print(f"[警告] 无法读取动画纹理 {os.path.relpath(src, ASSETS_DIR)}: {e}",
                      file=sys.stderr)
                continue

            tile_w, tile_h, frame_indices, total_tiles = _parse_animation(mcmeta, tw, th)

            rel = os.path.relpath(src, ASSETS_DIR)  # e.g. minecraft/textures/block/fire_0.png
            base = os.path.splitext(rel)[0]          # e.g. minecraft/textures/block/fire_0
            total_frames = len(frame_indices)

            for step, tile_idx in enumerate(frame_indices):
                suffix = _frame_suffix(step)
                dst = os.path.join(OUT_ROOT, f"{base}_{suffix}.png")
                tasks.append((src, tile_idx, tile_w, tile_h, total_frames, dst, step + 1))

    return tasks


# ---------------------------------------------------------------- 单帧转换 (worker)

def _convert_frame(args: tuple) -> tuple:
    """在 worker 进程中提取一帧并渲染为拼豆图纸。"""
    src, tile_idx, tile_w, tile_h, total_frames, dst, frame_num = args
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)

        # 整张纹理 → 合成白底 → 裁剪目标帧
        full = load_texture(src)
        y0 = tile_idx * tile_h
        frame_img = full.crop((0, y0, tile_w, y0 + tile_h))

        opts = RenderOptions(
            mode="square", scale=64, bg=BG,
            grid=True, legend=True, legend_style="simple", numbers=True,
            palette=load_palette(BRAND),
        )
        basename = os.path.splitext(os.path.basename(src))[0]
        title = f"{basename} (帧 {frame_num}/{total_frames})"
        page = build_page([frame_img], [title], opts)
        page.save(dst)
        return (dst, True, None)
    except Exception as e:
        return (dst, False, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------- 主入口

def main() -> int:
    parser = argparse.ArgumentParser(
        description="拆分 Minecraft 动画纹理, 逐帧转为拼豆图纸")
    parser.add_argument("-j", "--jobs", type=int, default=max(2, os.cpu_count() // 2),
                        help="并行进程数 (默认 CPU/2)")
    parser.add_argument("--force", action="store_true", help="强制重新转换已存在的帧")
    parser.add_argument("--limit", type=int, default=0,
                        help="只处理前 N 个动画文件 (调试用, 0=全部)")
    args = parser.parse_args()

    if not os.path.isdir(ASSETS_DIR):
        print(f"[错误] 找不到 assets 目录: {ASSETS_DIR}", file=sys.stderr)
        return 1

    all_tasks = collect_animation_tasks()

    # 按源文件去重计数: --limit 限制的是动画文件数, 不是帧数
    if args.limit:
        seen = set()
        limited = []
        for t in all_tasks:
            src = t[0]
            if src not in seen:
                seen.add(src)
                if len(seen) > args.limit:
                    break
            limited.append(t)
        all_tasks = limited

    pending = all_tasks
    if not args.force:
        pending = [t for t in all_tasks if not os.path.exists(t[5])]

    # 统计动画文件数
    src_set = {t[0] for t in all_tasks}
    src_pending = {t[0] for t in pending}

    print(f"[信息] 扫描完成: {len(src_set)} 个动画, 共 {len(all_tasks)} 帧, "
          f"待转换 {len(pending)} 帧 (并行 {args.jobs})")

    t0 = time.time()
    ok = fail = 0
    done = 0

    with Pool(args.jobs) as pool:
        for dst, success, err in pool.imap_unordered(_convert_frame, pending,
                                                     chunksize=4):
            done += 1
            if success:
                ok += 1
            else:
                fail += 1
                print(f"[失败] {os.path.relpath(dst, OUT_ROOT)}: {err}", file=sys.stderr)
            if done % 50 == 0:
                el = time.time() - t0
                rate = done / el if el > 0 else 0
                eta = (len(pending) - done) / rate / 60 if rate > 0 else 0
                print(f"  ... {done}/{len(pending)} 帧 "
                      f"({rate:.1f} 帧/秒, 预计剩余 {eta:.1f} 分钟)")

    elapsed = (time.time() - t0) / 60
    print(f"\n[完成] 成功 {ok} 帧, 失败 {fail} 帧, 耗时 {elapsed:.1f} 分钟")
    print(f"[信息] {len(src_pending)} 个动画 → 输出到: {OUT_ROOT}")

    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
