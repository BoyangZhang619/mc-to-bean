#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
entry.py — MC 拼豆图纸生成器 (交互式入口)

将 texture_to_pattern.py 的全部参数改为菜单式引导:
- 有限选项用 1/2/3 编号选择
- 二选一用 y/n
- 数值直接输入, 回车用默认值

用法:
    python entry.py
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

from palette import BRANDS, match_all
from render import (BG_PRESETS, RenderOptions, build_page, hex_of,
                    load_texture, resolve_palette)
from texture_to_pattern import build_json as _build_contract_json

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


# ---------------------------------------------------------------- 交互工具

def ask_choice(prompt: str, options: list, default: int = 1) -> int:
    """有限选项: 打印 1/2/3..., 用户输入编号 (回车用默认)。"""
    print(f"\n{'-' * 52}\n{prompt}")
    for i, opt in enumerate(options, 1):
        mark = " (默认)" if i == default else ""
        print(f"  [{i}] {opt}{mark}")
    while True:
        raw = input(f"请选择 1-{len(options)} [回车={default}]: ").strip()
        if raw == "":
            return default
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw)
        print(f"  输入无效, 请输入 1-{len(options)} 之间的数字")


def ask_yes_no(prompt: str, default: bool = True) -> bool:
    """二选一: y/n, 回车用默认。"""
    d = "y" if default else "n"
    while True:
        raw = input(f"{prompt} [y/n, 回车={d}]: ").strip().lower()
        if raw == "":
            return default
        if raw in ("y", "yes", "是"):
            return True
        if raw in ("n", "no", "否"):
            return False
        print("  输入无效, 请输入 y 或 n")


def ask_value(prompt: str, default: int, vmin: int = 1, vmax: int = 256) -> int:
    """数值输入, 回车用默认。"""
    while True:
        raw = input(f"{prompt} [回车={default}]: ").strip()
        if raw == "":
            return default
        if raw.isdigit() and vmin <= int(raw) <= vmax:
            return int(raw)
        print(f"  输入无效, 请输入 {vmin}-{vmax} 之间的整数")


# ---------------------------------------------------------------- 各步骤

def ask_textures() -> list:
    print(f"\n{'=' * 52}\n  MC 拼豆图纸生成器 (纹理 → 图纸)\n{'=' * 52}")
    print("\n纹理来源选择:")
    print("  [1] 手动输入一个或多个纹理路径 (逗号分隔)")
    print("  [2] 从 block/ 目录挑选")
    print("  [3] 从 item/ 目录挑选")
    while True:
        raw = input("请选择 1-3 [回车=1]: ").strip()
        if raw == "" or raw == "1":
            paths = input("输入纹理路径 (逗号分隔, 如 block/a.png, block/b.png): ").strip()
            parts = [p.strip() for p in paths.split(",") if p.strip()]
            if parts:
                return parts
            print("  未输入路径")
        elif raw == "2" or raw == "3":
            base = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "assets", "minecraft", "textures",
                                "block" if raw == "2" else "item")
            base = os.path.normpath(base)
            pngs = sorted(f for f in os.listdir(base) if f.endswith(".png"))
            print(f"  {os.path.basename(os.path.dirname(base))} 目录共 {len(pngs)} 个纹理, 例如:")
            for f in pngs[:10]:
                print(f"    {f}")
            while True:
                kw = input("输入关键字过滤 (如 'crafting', 回车列出更多): ").strip()
                hits = [f for f in pngs if kw.lower() in f.lower()]
                print(f"  匹配 {len(hits)} 个:")
                for f in hits[:20]:
                    print(f"    {f}")
                if len(hits) <= 20:
                    sel = input("输入要选择的文件名 (多个逗号分隔, 空=重新过滤): ").strip()
                    if sel:
                        chosen = [os.path.join(base, s.strip()) for s in sel.split(",")
                                  if s.strip() in hits]
                        if chosen:
                            return chosen
                    continue
                else:
                    print("  命中过多, 请缩小关键字")
        else:
            print("  输入无效")


def ask_style() -> str:
    idx = ask_choice("渲染风格:", ["方形网格 (经典图纸)", "环形豆子 (还原真实拼豆)"], default=1)
    return "square" if idx == 1 else "bead"


def ask_bg() -> tuple:
    keys = list(BG_PRESETS)
    idx = ask_choice("面板背景配色 (优雅预设):",
                     [f"{BG_PRESETS[k][0]} ({BG_PRESETS[k][1][0]},{BG_PRESETS[k][1][1]},{BG_PRESETS[k][1][2]})"
                      for k in keys], default=2)
    if keys[idx - 1] != "white":
        return BG_PRESETS[keys[idx - 1]][1]
    # white 时问是否自定义? 简化: 全部用预设
    return BG_PRESETS[keys[idx - 1]][1]


def ask_palette():
    idx = ask_choice("豆号色卡 (每颜色匹配为 [字母+数字] 豆号, 如 A1 / B7 / H3):",
                     ["不使用 (显示 HEX 色号)", *[f"{v[1]}" for v in BRANDS.values()]],
                     default=2)
    if idx == 1:
        return None
    return list(BRANDS)[idx - 2]


def ask_out_path(first_name: str) -> str:
    default = os.path.join(OUT_DIR, f"{first_name}_pattern.png")
    raw = input(f"\n输出图纸路径 [回车={default}]: ").strip()
    return raw or default


# ---------------------------------------------------------------- 主流程

def main() -> int:
    if sys.platform == "win32":
        os.system("")  # 启用 Windows 终端 ANSI 颜色

    paths = ask_textures()

    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        print(f"[错误] 找不到文件: {', '.join(missing)}", file=sys.stderr)
        return 1

    mode = ask_style()
    bg = ask_bg()
    palette = ask_palette()
    numbers = ask_yes_no("每颗豆上叠加显示半透明颜色序号?", default=True)
    grid = ask_yes_no("画网格线? (环形豆子风格下自动关闭)", default=True)
    legend = ask_yes_no("右侧显示豆色图例?", default=True)
    legend_style_idx = ask_choice(
        "图例样式:",
        ["[序号][圆角矩形豆色内嵌豆号][数量] (默认)",
         "详细版 (加 HEX)",
         "纯豆色版 (无序号, 格子显示豆色)"],
        default=1)
    legend_style = {1: "simple", 2: "detail", 3: "pure"}[legend_style_idx]
    scale = ask_value("单格边长/每颗豆的像素大小", default=64)
    color_mode_idx = ask_choice(
        "网格颜色显示模式:",
        ["豆色版 (每格显示映射后的豆号色)",
         "原版色 (默认)",
         "双版并排 (左原版 + 右豆色 + 独立图例)"],
        default=2)
    color_mode = {1: 1, 2: 2, 3: 3}[color_mode_idx]

    opts = RenderOptions(
        mode=mode, scale=scale, bg=bg,
        grid=grid, legend=legend,
        legend_style=legend_style,
        numbers=numbers,
        palette=resolve_palette(palette),
        color_mode=color_mode,
    )

    # 预匹配一次, 打印匹配结果摘要
    if opts.palette:
        print(f"\n--- 豆号色卡匹配摘要 ({len(opts.palette)} 色) ---")
        opts.bead_map = {}
        for path in paths:
            img = load_texture(path)
            colors = sorted(set(img.getpixel((x, y)) for y in range(img.height)
                                for x in range(img.width)))
            match_all(colors, opts.palette, opts.bead_map)
            for rgb in colors[:8]:
                bead = opts.bead_map[rgb]
                print(f"  #{hex_of(rgb)}  →  {bead.code} {bead.name}")
            if len(colors) > 8:
                print(f"  ... 共 {len(colors)} 色")

    images, names = [], []
    for path in paths:
        name = os.path.splitext(os.path.basename(path))[0]
        images.append(load_texture(path))
        names.append(name)

    page = build_page(images, [f"{n}  ({img.width}x{img.height} 豆)"
                               for n, img in zip(names, images)], opts)

    want_json = ask_yes_no("同时导出契约图纸 JSON? (Web 平台/模组可读取)", default=True)
    out_path = ask_out_path(names[0])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    page.save(out_path)
    print(f"\n[OK] 图纸已保存: {out_path}")

    if want_json:
        json_path = os.path.splitext(out_path)[0] + ".json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(_build_contract_json(names[0], images[0], opts), f,
                      ensure_ascii=False, indent=2)
        print(f"[OK] 图纸 JSON 已保存: {json_path}")

    print(f"[OK] 豆数: {sum(i.width * i.height for i in images)} 颗, 面板背景: {bg}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
