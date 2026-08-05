#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
texture_to_pattern.py — 将 Minecraft 纹理 PNG 转换为拼豆图纸 (非交互 CLI)

渲染核心在 render.py, 交互式入口是 entry.py。本脚本保留全部参数化能力,
供脚本化/批量调用。

用法示例:
    python texture_to_pattern.py assets/minecraft/textures/block/crafting_table_front.png
    python texture_to_pattern.py block/*.png --mode bead --palette artkal_s --bg paper

参数:
    textures...            一个或多个纹理 PNG 路径
    --mode square|bead     方形格 | 环形豆子 (默认 square)
    --scale S              每颗豆渲染像素大小 (默认 20)
    --bg NAME              背景配色: white/paper/cream/mist/fog/slate (默认 white)
    --palette BRAND        豆号色卡: artkal_s/hama/perler (默认不匹配)
    --no-grid              不画网格线
    --no-legend            不画颜色图例
    --no-numbers           不在每颗豆上叠加半透明颜色序号
    --out PATH             输出图纸路径 (默认 output/<首个纹理名>_pattern.png)
    --json                 额外导出图纸 JSON (共享格式, 见技术架构.md 第 3 节)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter

from PIL import Image

from palette import BRANDS, srgb_to_lab
from render import (BG_PRESETS, RenderOptions, build_page, load_texture,
                    resolve_bg, resolve_palette)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def build_json(name: str, img: Image.Image, opts: RenderOptions) -> dict:
    """导出符合共享图纸格式 (技术架构.md 第 3 节) 的 JSON 数据。

    当使用调色板时, 按豆号分组合并, 并做组内一致性检查:
    - 合并组: code/name 同组, rgb=代表色, warn=false (除非代表色 delta 超阈值)
    - 拆出条目: 保留 code (用户仍需买该豆号) + delta + warn=true
    - palette 允许重复 code (不同施工色指向同一豆号)
    """
    w, h = img.size

    def _lab_dist(a, b) -> float:
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

    if opts.bead_map:
        # ---- 有调色板: 按豆号分组合并, 含组内一致性检查
        threshold: Optional[float] = opts.max_color_delta  # None = 不拆分

        # 统计各 rgb 像素数
        pixel_counter: Counter = Counter()
        for y in range(h):
            for x in range(w):
                pixel_counter[img.getpixel((x, y))] += 1

        # 按首次出现顺序收集豆号分组
        code_order: list = []
        code_rgbs: dict = {}
        for y in range(h):
            for x in range(w):
                rgb = img.getpixel((x, y))
                bead = opts.bead_map.get(rgb)
                if bead is None:
                    continue
                if bead.code not in code_rgbs:
                    code_rgbs[bead.code] = set()
                    code_order.append(bead.code)
                code_rgbs[bead.code].add(rgb)

        # 构建 palette (含拆分), rgb_to_index 映射每个原始色到 palette 索引
        palette: list = []
        rgb_to_index: dict = {}
        palette_idx = 0

        for code in code_order:
            rgbs = code_rgbs[code]
            bead = opts.bead_map[next(iter(rgbs))]

            # 代表色
            rep_rgb = max(rgbs, key=lambda r: pixel_counter[r])
            rep_lab = srgb_to_lab(rep_rgb)

            # 组内一致性检查
            stay_rgbs = []
            split_rgbs = []
            for r in rgbs:
                if r == rep_rgb:
                    stay_rgbs.append(r)
                    continue
                d_rep = _lab_dist(srgb_to_lab(r), rep_lab)
                if threshold is not None and d_rep > threshold:
                    split_rgbs.append(r)
                else:
                    stay_rgbs.append(r)

            # 拆出条目 (每个独立)
            for r in split_rgbs:
                r_lab = srgb_to_lab(r)
                bead_lab = srgb_to_lab(bead.rgb)
                delta = _lab_dist(r_lab, bead_lab)
                rgb_to_index[r] = palette_idx
                palette.append({
                    "index": palette_idx,
                    "rgb": list(r),
                    "name": bead.name,
                    "code": bead.code,
                    "delta": round(delta, 2),
                    "warn": True,
                })
                palette_idx += 1

            # 合并组
            if stay_rgbs:
                bead_lab = srgb_to_lab(bead.rgb)
                delta = _lab_dist(rep_lab, bead_lab)
                entry_warn = (threshold is not None) and (delta > threshold)
                for r in stay_rgbs:
                    rgb_to_index[r] = palette_idx
                palette.append({
                    "index": palette_idx,
                    "rgb": list(rep_rgb),
                    "name": bead.name,
                    "code": bead.code,
                    "delta": round(delta, 2),
                    "warn": entry_warn,
                })
                palette_idx += 1

        # 构建 grid (通过 rgb_to_index 查找)
        grid = []
        for y in range(h):
            row = []
            for x in range(w):
                rgb = img.getpixel((x, y))
                row.append(rgb_to_index.get(rgb, 0))
            grid.append(row)
    else:
        # ---- 无调色板: 按颜色独立 (原行为)
        palette, index = [], {}
        grid = []
        for y in range(h):
            row = []
            for x in range(w):
                rgb = img.getpixel((x, y))
                if rgb not in index:
                    index[rgb] = len(palette)
                    palette.append({
                        "index": index[rgb],
                        "rgb": list(rgb),
                        "name": None,
                        "code": None,
                    })
                row.append(index[rgb])
            grid.append(row)

    return {
        "name": name,
        "width": w,
        "height": h,
        "cell_size_mm": 5,
        "palette": palette,
        "grid": grid,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="将 Minecraft 纹理 PNG 转换为拼豆图纸")
    parser.add_argument("textures", nargs="+", help="纹理 PNG 路径 (可多个)")
    parser.add_argument("--mode", choices=["square", "bead"], default="square",
                        help="渲染风格: 方形格/环形豆子")
    parser.add_argument("--scale", type=int, default=64, help="单格边长/每颗豆像素 (默认 64)")
    parser.add_argument("--bg", default="white",
                        help="背景配色: %s (默认 white)" % "/".join(
                            k for k in sorted(BG_PRESETS)))
    parser.add_argument("--palette", choices=list(BRANDS), default=None,
                        help="豆号色卡品牌 (默认不匹配)")
    parser.add_argument("--legend-style", choices=["simple", "detail", "pure"], default="simple",
                        help="图例样式: simple=[序号][圆角矩形豆色内嵌豆号][数量] (默认), "
                             "detail=加 HEX, pure=只保留豆色块(无序号,格子显示豆色)")
    parser.add_argument("--no-grid", action="store_true", help="不画网格线")
    parser.add_argument("--no-legend", action="store_true", help="不画颜色图例")
    parser.add_argument("--no-numbers", action="store_true", help="不叠加颜色序号")
    parser.add_argument("--out", default=None, help="输出路径 (默认 output/ 目录)")
    parser.add_argument("--json", dest="want_json", action="store_true",
                        help="额外导出图纸 JSON")
    parser.add_argument("--color-mode", type=int, choices=[1, 2, 3], default=2,
                        help="网格颜色显示: 1=豆色版 2=原版色(默认) 3=双版并排")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)

    opts = RenderOptions(
        mode=args.mode,
        scale=args.scale,
        bg=resolve_bg(args.bg),
        grid=not args.no_grid,
        legend=not args.no_legend,
        legend_style=args.legend_style,
        numbers=not args.no_numbers,
        palette=resolve_palette(args.palette),
        color_mode=args.color_mode,
    )

    images, names = [], []
    for path in args.textures:
        if not os.path.exists(path):
            print(f"[错误] 找不到文件: {path}", file=sys.stderr)
            return 1
        name = os.path.splitext(os.path.basename(path))[0]
        img = load_texture(path)
        images.append(img)
        names.append(name)
        n_colors = len(set(img.getpixel((x, y)) for y in range(img.height)
                           for x in range(img.width)))
        print(f"[OK] {name}: {img.width}x{img.height} = {img.width * img.height} 豆, "
              f"{n_colors} 种颜色")

    page = build_page(images, [f"{n}  ({img.width}x{img.height} 豆)"
                               for n, img in zip(names, images)], opts)

    out_path = args.out or os.path.join(OUT_DIR, f"{names[0]}_pattern.png")
    page.save(out_path)
    print(f"[OK] 图纸已保存: {out_path}")

    if args.want_json:
        json_path = os.path.join(OUT_DIR, f"{names[0]}_pattern.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(build_json(names[0], images[0], opts), f,
                      ensure_ascii=False, indent=2)
        print(f"[OK] 图纸 JSON 已保存: {json_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
