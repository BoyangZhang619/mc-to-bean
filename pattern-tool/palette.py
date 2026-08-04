# -*- coding: utf-8 -*-
"""
palette.py — 拼豆品牌色卡加载与颜色匹配

- 色卡数据: pattern-tool/data/*.csv, 格式 `code,name,r,g,b,source`
  (数据来源: https://github.com/maxcleme/beadcolors 仓库 CSV)
- 匹配算法: sRGB → CIE Lab(D65) 欧氏距离最近邻, 比 RGB 距离更符合人眼感知
- 豆号格式: [A-Z][number] (如 Artkal S01, Hama H03)
"""

from __future__ import annotations

import csv
import math
import os
from dataclasses import dataclass
from typing import Dict, List, Tuple

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# 品牌注册表: key -> (CSV 文件名, 展示名)
# MARD: 字母前缀=主题色系 (A黄橙/B绿/C蓝/D紫/E粉/F红/G棕肤/H黑白灰/M混/P珠光/R透明),
#       豆号 A1..A26, B1..B32, ... 与用户实际购买的国产拼豆色号体系一致
BRANDS = {
    "mard":     ("mard.csv",     "MARD 通用色 (A1-A26 黄橙/B1-B32 绿/... 主题色系, 推荐)"),
    "artkal_s": ("artkal_s.csv", "Artkal S 系列 (S01-S159+, 单一前缀)"),
    "hama":     ("hama.csv",     "Hama (H01+, 丹麦, 单一前缀)"),
    "perler":   ("perler.csv",   "Perler (80-xxxxx 商品号, 非字母格式)"),
}


@dataclass(frozen=True)
class BeadColor:
    """一颗豆子: 豆号 + 颜色名 + RGB。"""
    code: str
    name: str
    rgb: Tuple[int, int, int]


def load_palette(brand: str) -> List[BeadColor]:
    """加载指定品牌的色卡。"""
    if brand not in BRANDS:
        raise ValueError(f"未知品牌: {brand}, 可选: {list(BRANDS)}")
    fname, _ = BRANDS[brand]
    path = os.path.join(DATA_DIR, fname)
    palette = []
    with open(path, encoding="utf-8") as fp:
        for row in csv.reader(fp):
            if len(row) < 5:
                continue
            code, name = row[0], row[1]
            r, g, b = int(row[2]), int(row[3]), int(row[4])
            if (r, g, b) not in (c.rgb for c in palette):
                palette.append(BeadColor(code, name, (r, g, b)))
    return palette


# ---------------------------------------------------------------- sRGB → CIE Lab

def _srgb_to_linear(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb_to_lab(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    """sRGB(D65, 2° 观察者) → CIE L*a*b*。"""
    r, g, b = (_srgb_to_linear(c) for c in rgb)
    # sRGB → XYZ (D65)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    x, y, z = x / 0.95047, y / 1.0, z / 1.08883

    def f(t: float) -> float:
        d = 6 / 29
        return t ** (1 / 3) if t > d ** 3 else t / (3 * d * d) + 4 / 29

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def match_color(rgb: Tuple[int, int, int], palette: List[BeadColor]) -> BeadColor:
    """在色卡中找 Lab 距离最近的豆子。"""
    target = srgb_to_lab(rgb)
    best, best_d = None, float("inf")
    for bead in palette:
        lab = srgb_to_lab(bead.rgb)
        d = (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2
        if d < best_d:
            best, best_d = bead, d
    return best


def match_all(colors: List[Tuple[int, int, int]], palette: List[BeadColor],
              cache: Dict[Tuple[int, int, int], BeadColor] | None = None
              ) -> Dict[Tuple[int, int, int], BeadColor]:
    """批量匹配 (带缓存, 供多次渲染复用)。"""
    if cache is None:
        cache = {}
    for rgb in colors:
        if rgb not in cache:
            cache[rgb] = match_color(rgb, palette)
    return cache
