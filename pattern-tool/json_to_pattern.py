#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
json_to_pattern.py — 将契约图纸 JSON (技术架构.md 第 3 节) 渲染为拼豆图纸 PNG

模组 (/perler section|view) 导出的 JSON 是数据层, 本脚本负责渲染层:
网格 + 行号列号格 + 半透明序号 + 右侧豆色图例 (与 texture_to_pattern.py 同一渲染核心)。

用法:
    python json_to_pattern.py <图纸.json> [选项]

参数:
    json...                 一个或多个契约 JSON 路径
    --scale N               单格边长/每颗豆像素 (默认 64)
    --bg NAME               背景配色: white/paper/cream/mist/fog/slate (默认 paper)
    --legend-style simple|detail   图例: simple=[序号][环][豆号][数量] | detail 加 HEX
    --no-grid / --no-legend / --no-numbers   关闭项
    --color-mode 1|2|3      1=豆色 2=原色 3=双版并排 (默认 2; 模组 JSON 已是豆色数据)
    --out PATH              输出路径 (默认与 JSON 同目录同名 .png)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image

from palette import BeadColor
from render import (BG_PRESETS, RenderOptions, build_page, resolve_bg)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def load_pattern(path: str) -> tuple:
    """读取契约 JSON, 返回 (虚拟纹理 Image, 豆号色卡, 名称)。"""
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    w, h = d["width"], d["height"]
    palette = d["palette"]

    # 调色板索引 → RGB
    rgb_of = {p["index"]: tuple(p["rgb"]) for p in palette}

    # 构建虚拟纹理 (每格 = 对应颜色), 供统一渲染管线使用
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y, row in enumerate(d["grid"]):
        for x, idx in enumerate(row):
            px[x, y] = rgb_of.get(idx, (255, 255, 255))

    # 由 palette 构建豆号色卡 (code/name 可能为 null → 不匹配)
    # 模组端新 JSON 带 bead_rgb (豆号色): 用它作为 BeadColor.rgb —
    #   图例环 / color-mode 1·3 (豆版) 显示的就是豆号实际颜色
    beads = []
    for p in palette:
        # bead_rgb 存在(模组新 JSON)时用它; 旧 JSON 无此字段则回退代表色
        bead_rgb = tuple(p["bead_rgb"]) if p.get("bead_rgb") else tuple(p["rgb"])
        beads.append(BeadColor(code=p.get("code"), name=p.get("name"),
                               rgb=bead_rgb))
    name = d.get("name", os.path.splitext(os.path.basename(path))[0])
    return img, beads, name


def main() -> int:
    parser = argparse.ArgumentParser(description="将契约图纸 JSON 渲染为拼豆图纸 PNG")
    parser.add_argument("jsons", nargs="+", help="契约 JSON 路径 (可多个)")
    parser.add_argument("--scale", type=int, default=64, help="单格边长/每颗豆像素 (默认 64)")
    parser.add_argument("--bg", default="paper", help="背景配色 (默认 paper)")
    parser.add_argument("--legend-style", choices=["simple", "detail"], default="simple",
                        help="图例样式 (默认 simple)")
    parser.add_argument("--no-grid", action="store_true", help="不画网格线")
    parser.add_argument("--no-legend", action="store_true", help="不画颜色图例")
    parser.add_argument("--no-numbers", action="store_true", help="不叠加颜色序号")
    parser.add_argument("--color-mode", type=int, choices=[1, 2, 3], default=2,
                        help="网格颜色显示模式 (默认 2)")
    parser.add_argument("--out", default=None, help="输出路径 (默认与 JSON 同目录)")
    args = parser.parse_args()

    images, titles, beads_list, names = [], [], [], []
    for path in args.jsons:
        if not os.path.exists(path):
            print(f"[错误] 找不到文件: {path}", file=sys.stderr)
            return 1
        img, beads, name = load_pattern(path)
        images.append(img)
        beads_list.append(beads)
        names.append(name)
        titles.append(f"{name}  ({img.width}x{img.height} 豆)")
        print(f"[OK] {name}: {img.width}x{img.height} 豆, {len(beads)} 种颜色")

    for i, (img, beads, name) in enumerate(zip(images, beads_list, names)):
        opts = RenderOptions(
            mode="square", scale=args.scale, bg=resolve_bg(args.bg),
            grid=not args.no_grid, legend=not args.no_legend,
            legend_style=args.legend_style, numbers=not args.no_numbers,
            color_mode=args.color_mode,
            # 豆号色卡: 契约 palette 本身即"合并后"的豆号条目
            palette=beads if any(b.code for b in beads) else None,
        )
        if opts.palette:
            opts.bead_map = {b.rgb: b for b in beads}
        page = build_page([img], [titles[i]], opts)
        if args.out:
            out_path = args.out
        else:
            out_path = os.path.join(os.path.dirname(os.path.abspath(path)),
                                    f"{name}_pattern.png")
        page.save(out_path)
        print(f"[OK] 图纸已保存: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
