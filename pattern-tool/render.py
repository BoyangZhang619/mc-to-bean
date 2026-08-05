# -*- coding: utf-8 -*-
"""
render.py — 拼豆图纸渲染核心

布局:
- 顶部: 标题 + 列号格区 (格子化, 与网格对齐)
- 左侧: 行号格区 (格子化)
- 中部: 网格 (方形格 / 环形豆子 两种风格)
- 右侧: 豆色图例, 每列最多 10 项, 多了向右扩展; 图例项尺寸跟随单格边长

样式:
- 每颜色一个序号 (按首次出现顺序 01, 02, ...), 每颗豆上半透明叠加显示
- 图例项: [序号徽章][对应颜色环][数量], 序号/数量带装饰; 详细版(豆号+HEX)可参数切换
- 页面/面板背景均使用设置的背景色 (修复: 边缘背景固定浅灰的问题)
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import math
import os
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from palette import BeadColor, load_palette, match_all, srgb_to_lab

# ---------------------------------------------------------------- 常量

TEXT_COLOR = (60, 60, 60)
GRID_ALPHA = 90                # 网格线透明度
FRAME_COLOR = (30, 30, 30, 210)
LEGEND_MAX_ROWS = 10           # 图例每列最多项数
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",     # 微软雅黑
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
]

# 背景配色预设: key -> (展示名, RGB)
BG_PRESETS = {
    "white": ("纯白",     (255, 255, 255)),
    "paper": ("米白纸纹", (250, 247, 240)),
    "cream": ("奶油",     (253, 250, 240)),
    "mist":  ("雾蓝灰",   (240, 243, 247)),
    "fog":   ("浅灰",     (244, 244, 246)),
    "slate": ("灰蓝",     (235, 237, 242)),
}

_font_cache = {}


def load_font(size: int) -> ImageFont.FreeTypeFont:
    if size in _font_cache:
        return _font_cache[size]
    font = None
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def hex_of(rgb: Tuple[int, int, int]) -> str:
    return "%02X%02X%02X" % rgb


def luma(rgb: Tuple[int, int, int]) -> float:
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


def load_texture(path: str) -> Image.Image:
    """读取纹理, 透明像素合成到白色背景 (模拟实体豆盘)。"""
    img = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


# ---------------------------------------------------------------- 选项

@dataclass
class RenderOptions:
    mode: str = "square"                       # "square" 方形格 | "bead" 环形豆
    scale: int = 64                            # 单格边长 (每颗豆的像素大小)
    bg: Tuple[int, int, int] = (255, 255, 255)  # 背景色 (页面+面板)
    grid: bool = True                          # 网格线 (环形模式自动关闭)
    legend: bool = True                        # 右侧豆色图例
    legend_style: str = "simple"               # "simple" [序号][环][数量] | "detail" 加豆号/HEX
    numbers: bool = True                       # 每颗豆上叠加半透明颜色序号
    palette: Optional[List[BeadColor]] = None  # 豆号色卡 (None = 不匹配)
    bead_map: Dict[Tuple[int, int, int], BeadColor] = None  # 匹配缓存
    max_color_delta: Optional[float] = 20.0   # Lab 距离阈值: 超过则图例添加 "!" 提示 (None=关闭)
    color_mode: int = 2                       # 1=豆色版 2=原版色(默认) 3=双版并排


# ---------------------------------------------------------------- 面板渲染

def _draw_bead(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int,
               color: Tuple[int, int, int], bg: Tuple[int, int, int]):
    """画一颗环形豆: 外环填充豆色, 中心孔露出背景色。"""
    ring_w = max(2, r // 2)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    hole = r - ring_w
    if hole > 1:
        draw.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=bg)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(165, 165, 170), width=1)


def _draw_swatch(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int,
                 color: Tuple[int, int, int], text: str, font_size: int):
    """画一个圆角矩形豆色块, 豆号文字内嵌居中 (深色块白字, 浅色块黑字)。

    图例样式: [序号徽章][圆角矩形豆色(内嵌豆号)][数量]
    """
    draw.rounded_rectangle([x, y, x + w, y + h], radius=max(3, h // 4),
                           fill=color, outline=(120, 120, 125), width=1)
    t_color = (255, 255, 255) if luma(color) < 150 else (40, 40, 40)
    draw.text((x + w / 2, y + h / 2), text, font=load_font(font_size),
              fill=t_color, anchor="mm")


# ---------------------------------------------------------------- 豆号分组

@dataclass
class BeadGroup:
    """一组映射到同一豆号的纹理颜色。"""
    num: int                         # 1-based 分组序号 (按组首次出现顺序)
    bead: BeadColor                  # 匹配到的豆子
    rep_rgb: Tuple[int, int, int]    # 代表色 (组内像素数最多的原始颜色, 并列取先出现)
    count: int                       # 组内所有颜色像素数合计
    delta: float                     # 代表色 → 豆子 Lab 欧氏距离
    warn: bool                       # delta 是否超过阈值
    split: bool                      # True = 从合并组中拆出的独立条目
    member_rgbs: List[Tuple[int, int, int]]  # 组内所有原始颜色


def _lab_dist(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    """两个 Lab 颜色之间的欧氏距离。"""
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def group_by_bead(
    colors: List[Tuple[int, int, int]],
    pixel_counter: Dict[Tuple[int, int, int], int],
    bead_map: Dict[Tuple[int, int, int], BeadColor],
    palette: Optional[List[BeadColor]],
    max_delta: Optional[float],
) -> List[BeadGroup]:
    """按豆号分组合并纹理颜色。

    保留 colors 中的首次出现顺序作为组顺序。组内代表色取像素数最多的颜色
    (并列取 colors 中先出现的)。为每个组计算代表色到豆子色的 Lab 欧氏距离。

    组内一致性检查: 成员颜色与代表色的 Lab 距离超过 max_delta 时,
    该成员拆出为独立条目 (warn=True, split=True)。
    """
    # 按豆号分组, 保留首次出现顺序
    code_order: List[str] = []
    code_rgbs: Dict[str, List[Tuple[int, int, int]]] = {}
    for rgb in colors:
        bead = bead_map.get(rgb)
        if bead is None:
            continue
        if bead.code not in code_rgbs:
            code_rgbs[bead.code] = []
            code_order.append(bead.code)
        code_rgbs[bead.code].append(rgb)

    raw_groups: List[BeadGroup] = []
    for code in code_order:
        rgbs = code_rgbs[code]
        bead = bead_map[rgbs[0]]  # all rgbs in this group map to same bead code

        # 代表色: 像素数最多, 并列取先出现
        rep_rgb = max(rgbs, key=lambda r: (pixel_counter[r], -colors.index(r)))
        rep_lab = srgb_to_lab(rep_rgb)

        # 组内一致性检查: 拆分与代表色视觉差异过大的颜色
        stay_rgbs: List[Tuple[int, int, int]] = []
        split_members: List[Tuple[int, int, int]] = []
        for r in rgbs:
            if r == rep_rgb:
                stay_rgbs.append(r)
                continue
            d_rep = _lab_dist(srgb_to_lab(r), rep_lab)
            if max_delta is not None and d_rep > max_delta:
                split_members.append(r)
            else:
                stay_rgbs.append(r)

        # 合并组 (保留与代表色相近的成员)
        if stay_rgbs:
            total_count = sum(pixel_counter[r] for r in stay_rgbs)
            bead_lab = srgb_to_lab(bead.rgb)
            delta = _lab_dist(rep_lab, bead_lab)
            warn = (max_delta is not None) and (delta > max_delta)
            raw_groups.append(BeadGroup(
                num=0, bead=bead, rep_rgb=rep_rgb,
                count=total_count, delta=delta, warn=warn,
                split=False, member_rgbs=stay_rgbs,
            ))

        # 独立条目 (拆出的颜色, 每个各一条)
        for r in split_members:
            r_lab = srgb_to_lab(r)
            bead_lab = srgb_to_lab(bead.rgb)
            delta = _lab_dist(r_lab, bead_lab)
            raw_groups.append(BeadGroup(
                num=0, bead=bead, rep_rgb=r,
                count=pixel_counter[r], delta=delta, warn=True,
                split=True, member_rgbs=[r],
            ))

    # 序号顺延重排
    for i, g in enumerate(raw_groups, 1):
        g.num = i

    return raw_groups


# ---------------------------------------------------------------- 面板数据准备

@dataclass
class PanelData:
    """build_panel 所需的预计算数据, 供 mode 3 多面板共用。"""
    colors: List[Tuple[int, int, int]]
    pixel_counter: "Counter"
    groups: Optional[List[BeadGroup]]
    num_of: Dict[Tuple[int, int, int], int]
    legend_entries: list   # BeadGroup list or RGB list
    is_grouped: bool
    n_legend_entries: int
    grid_h: int
    gy: int
    title_h: int


def _prepare_panel_data(img: Image.Image, opts: RenderOptions) -> PanelData:
    """预计算 build_panel 所需的分组、计数和布局参数。"""
    w, h = img.size
    scale = opts.scale
    title_h = max(34, scale // 2)
    gy = title_h + scale
    grid_h = h * scale

    pixel_list = [img.getpixel((x, y)) for y in range(h) for x in range(w)]
    pixel_counter = Counter(pixel_list)

    colors: List[Tuple[int, int, int]] = []
    for y in range(h):
        for x in range(w):
            rgb = img.getpixel((x, y))
            if rgb not in colors:
                colors.append(rgb)

    if opts.palette:
        if opts.bead_map is None:
            opts.bead_map = {}
        match_all(colors, opts.palette, opts.bead_map)

    groups: Optional[List[BeadGroup]] = None
    if opts.palette:
        groups = group_by_bead(colors, pixel_counter, opts.bead_map,
                               opts.palette, opts.max_color_delta)
        num_of: Dict[Tuple[int, int, int], int] = {}
        for g in groups:
            for member_rgb in g.member_rgbs:
                num_of[member_rgb] = g.num
    else:
        num_of = {rgb: i + 1 for i, rgb in enumerate(colors)}

    legend_entries = groups if groups else colors
    is_grouped = groups is not None

    return PanelData(
        colors=colors, pixel_counter=pixel_counter,
        groups=groups, num_of=num_of,
        legend_entries=legend_entries,
        is_grouped=is_grouped,
        n_legend_entries=len(legend_entries),
        grid_h=grid_h, gy=gy, title_h=title_h,
    )


# ---------------------------------------------------------------- 图例独立面板

def _calc_legend_meta(n_legend_entries: int, grid_h: int, scale: int,
                      legend_style: str) -> tuple:
    """计算图例的列宽/字体等尺寸参数。返回 (col_metas, legend_w, col_gap)。

    图例项样式: [序号徽章][圆角矩形豆色(内嵌豆号)][数量]
    pure 模式: 只保留 [圆角矩形豆色(内嵌豆号)], 无序号/无数量。
    """
    ncols = math.ceil(n_legend_entries / LEGEND_MAX_ROWS)
    n_first = min(LEGEND_MAX_ROWS, n_legend_entries)
    item_h = grid_h / n_first
    f_b = max(10, round(item_h * 0.22))
    f_l = max(11, round(item_h * 0.24))
    bdg = round(item_h * 0.5)
    sw_w = round(f_l * 2.8) + 12          # 圆角矩形豆色块宽 (容纳 3-4 字符豆号)
    if legend_style == "pure":
        cw = sw_w + 16                    # 只有色块
    else:
        if legend_style == "detail":
            t_w = round(f_l * 6.2)        # "(×N) #RRGGBB"
        else:
            t_w = round(f_l * 3.4)        # "(×N)"
        cw = bdg + 6 + sw_w + 6 + t_w + 10
    col_gap = round(scale * 0.45)
    col_metas = []
    legend_w = 0
    for col in range(ncols):
        n_items = min(LEGEND_MAX_ROWS, n_legend_entries - col * LEGEND_MAX_ROWS)
        col_metas.append((n_items, item_h, f_b, f_l, bdg, sw_w, cw))
        legend_w += cw
    legend_w += (ncols - 1) * col_gap + round(scale * 0.5)
    return col_metas, legend_w, col_gap


def build_legend_panel(pdata: PanelData, opts: RenderOptions) -> Image.Image:
    """生成独立的图例面板 (供 mode 3 使用)。

    面板高度与网格面板一致 (gy + grid_h + 12), 只含图例条目, 无标题/网格/序号。
    """
    scale = opts.scale
    col_metas, legend_w, col_gap = _calc_legend_meta(
        pdata.n_legend_entries, pdata.grid_h, scale, opts.legend_style)

    pw = legend_w + 12
    ph = pdata.gy + pdata.grid_h + 12
    panel = Image.new("RGBA", (pw, ph), opts.bg)
    draw = ImageDraw.Draw(panel)

    # 面板圆角边框
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=10,
                         outline=(0, 0, 0, 60), width=1)
    panel = Image.alpha_composite(panel, overlay)
    draw = ImageDraw.Draw(panel)

    cx = 6  # left padding inside legend panel
    for col_i, (n_items, item_h, f_b, f_l, bdg, sw_w, cw) in enumerate(col_metas):
        for row in range(n_items):
            idx = col_i * LEGEND_MAX_ROWS + row
            if idx >= len(pdata.legend_entries):
                break
            _draw_one_legend_entry(
                draw, pdata, opts, idx, row, item_h, f_b, f_l, bdg, sw_w,
                cx=cx, cy0=pdata.gy + (row + 0.5) * item_h)
        cx += cw + col_gap

    return panel


def _draw_one_legend_entry(
    draw: ImageDraw.ImageDraw,
    pdata: PanelData,
    opts: RenderOptions,
    idx: int, row: int, item_h: int,
    f_b: int, f_l: int, bdg: int, sw_w: int,
    cx: int, cy0: int,
):
    """绘制单条图例, 供 build_panel 和 build_legend_panel 共用。

    样式: [序号徽章][圆角矩形豆色(内嵌豆号)][数量]
    pure 模式: 只保留 [圆角矩形豆色(内嵌豆号)], 无序号/无数量。
    """
    if pdata.is_grouped:
        g = pdata.legend_entries[idx]  # type: BeadGroup
        by = cy0 - bdg / 2
        bx = cx
        if opts.legend_style != "pure":
            # 序号徽章
            draw.rounded_rectangle(
                [cx, by, cx + bdg, by + bdg],
                radius=round(bdg * 0.28), fill=(235, 235, 238),
                outline=(150, 150, 155), width=1)
            draw.text((cx + bdg / 2, cy0), "%02d" % g.num,
                      font=load_font(f_b), fill=TEXT_COLOR, anchor="mm")
            bx = cx + bdg + 6
        # 圆角矩形豆色块 (内嵌豆号), 色 = 豆号色
        _draw_swatch(draw, bx, by, sw_w, bdg, g.bead.rgb, g.bead.code, f_l)
        if opts.legend_style != "pure":
            # 文本: 数量 (detail 加 HEX); 警告标记用 ASCII "!" (⚠️ 部分字体无字形)
            tx = bx + sw_w + 6
            prefix = "!" if g.warn else ""
            if opts.legend_style == "detail":
                text = f"{prefix}(×{g.count}) {hex_of(g.rep_rgb)}"
            else:
                text = f"{prefix}(×{g.count})"
            draw.text((tx, cy0), text, font=load_font(f_l),
                      fill=TEXT_COLOR, anchor="lm")
    else:
        rgb = pdata.legend_entries[idx]  # type: tuple
        bead_c = opts.bead_map.get(rgb) if opts.palette else None
        swatch_color = bead_c.rgb if bead_c else rgb
        # 色块内文字: 有豆号用豆号, 否则用 HEX
        swatch_text = bead_c.code if bead_c else hex_of(rgb)
        by = cy0 - bdg / 2
        bx = cx
        if opts.legend_style != "pure":
            # 序号徽章
            draw.rounded_rectangle(
                [cx, by, cx + bdg, by + bdg],
                radius=round(bdg * 0.28), fill=(235, 235, 238),
                outline=(150, 150, 155), width=1)
            draw.text((cx + bdg / 2, cy0), "%02d" % pdata.num_of[rgb],
                      font=load_font(f_b), fill=TEXT_COLOR, anchor="mm")
            bx = cx + bdg + 6
        _draw_swatch(draw, bx, by, sw_w, bdg, swatch_color, swatch_text, f_l)
        if opts.legend_style != "pure":
            tx = bx + sw_w + 6
            cnt = pdata.pixel_counter[rgb]
            if opts.legend_style == "detail":
                text = f"(×{cnt}) {hex_of(rgb)}"
            else:
                text = f"(×{cnt})"
            draw.text((tx, cy0), text, font=load_font(f_l),
                      fill=TEXT_COLOR, anchor="lm")


# ---------------------------------------------------------------- 面板渲染

def build_panel(img: Image.Image, title: str, opts: RenderOptions,
                pdata: Optional[PanelData] = None,
                _display_rgb_map: Optional[Dict[Tuple[int, int, int],
                                         Tuple[int, int, int]]] = None,
                _force_no_legend: bool = False) -> Image.Image:
    """把一个纹理渲染成图纸面板。

    _display_rgb_map: 如果提供, 网格每格用此映射的颜色填充 (mode 1/3 豆色版)。
    _force_no_legend: True 时即使 opts.legend 也不画图例 (mode 3 两子面板)。
    """
    w, h = img.size
    scale = opts.scale

    # ---- 预计算或复用 PanelData
    if pdata is None:
        pdata = _prepare_panel_data(img, opts)

    title_h = pdata.title_h
    gx = scale
    gy = pdata.gy
    grid_w, grid_h = w * scale, pdata.grid_h

    # ---- 右侧图例区尺寸
    legend_w = 0
    col_metas = []
    col_gap = round(scale * 0.45)
    draw_legend = opts.legend and not _force_no_legend
    if draw_legend:
        col_metas, legend_w, __col_gap = _calc_legend_meta(
            pdata.n_legend_entries, grid_h, scale, opts.legend_style)
        col_gap = __col_gap

    pw = gx + grid_w + legend_w + 14
    ph = gy + grid_h + 12
    panel = Image.new("RGBA", (pw, ph), opts.bg)
    draw = ImageDraw.Draw(panel)

    # ---- 标题
    draw.text((pw / 2, title_h / 2), title,
              font=load_font(max(15, scale // 4)), fill=TEXT_COLOR, anchor="mm")

    bead = opts.mode == "bead"
    r_bead = scale // 2 - 1

    # ---- 网格像素填充
    # pure 模式: 格子强制显示豆号色 (等同 color_mode=1)
    pure = opts.legend_style == "pure"
    for y in range(h):
        for x in range(w):
            orig_rgb = img.getpixel((x, y))
            # 显示色: 优先 _display_rgb_map, 其次 color_mode==1/pure 豆色, 最后原色
            if _display_rgb_map is not None:
                fill_rgb = _display_rgb_map.get(orig_rgb, orig_rgb)
            elif (opts.color_mode == 1 or pure) and opts.palette and opts.bead_map:
                bead_c = opts.bead_map.get(orig_rgb)
                fill_rgb = bead_c.rgb if bead_c else orig_rgb
            else:
                fill_rgb = orig_rgb

            cx = gx + x * scale + scale / 2
            cy = gy + y * scale + scale / 2
            if bead:
                _draw_bead(draw, cx, cy, r_bead, fill_rgb, opts.bg)
            else:
                draw.rectangle(
                    [gx + x * scale, gy + y * scale,
                     gx + (x + 1) * scale - 1, gy + (y + 1) * scale - 1],
                    fill=fill_rgb)

    # ---- 半透明线条 (网格线/格子边框/外框/面板边框)
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    if opts.grid and not bead:
        for i in range(w + 1):
            x0 = gx + i * scale
            od.line([(x0, gy), (x0, gy + grid_h)], fill=(0, 0, 0, GRID_ALPHA), width=1)
        for j in range(h + 1):
            y0 = gy + j * scale
            od.line([(gx, y0), (gx + grid_w, y0)], fill=(0, 0, 0, GRID_ALPHA), width=1)
    for x in range(w):
        x0 = gx + x * scale
        od.rectangle([x0, title_h, x0 + scale, title_h + scale],
                     outline=(0, 0, 0, 70), width=1)
    for y in range(h):
        y0 = gy + y * scale
        od.rectangle([0, y0, scale, y0 + scale],
                     outline=(0, 0, 0, 70), width=1)
    od.rectangle([gx - 1, gy - 1, gx + grid_w, gy + grid_h],
                 outline=FRAME_COLOR, width=2)
    od.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=10,
                         outline=(0, 0, 0, 60), width=1)
    panel = Image.alpha_composite(panel, overlay)
    draw = ImageDraw.Draw(panel)

    # ---- 行号/列号数字
    f_num = load_font(max(12, scale // 3))
    for x in range(w):
        x0 = gx + x * scale
        draw.text((x0 + scale / 2, title_h + scale / 2), str(x + 1),
                  font=f_num, fill=TEXT_COLOR, anchor="mm")
    for y in range(h):
        y0 = gy + y * scale
        draw.text((scale / 2, y0 + scale / 2), str(y + 1),
                  font=f_num, fill=TEXT_COLOR, anchor="mm")

    # ---- 每颗豆上叠加半透明颜色序号
    if opts.numbers and scale >= 12 and opts.legend_style != "pure":
        overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        f_num_o = load_font(max(7, round(scale * (0.34 if bead else 0.40))))
        for y in range(h):
            for x in range(w):
                orig_rgb = img.getpixel((x, y))
                # luma 基于显示色判断文字颜色
                if _display_rgb_map is not None:
                    lum_rgb = _display_rgb_map.get(orig_rgb, orig_rgb)
                elif opts.color_mode == 1 and opts.palette and opts.bead_map:
                    bc = opts.bead_map.get(orig_rgb)
                    lum_rgb = bc.rgb if bc else orig_rgb
                else:
                    lum_rgb = orig_rgb

                cx = gx + x * scale + scale / 2
                cy = gy + y * scale + scale / 2
                if bead:
                    fill = (70, 70, 70, 150)
                else:
                    fill = (30, 30, 30, 120) if luma(lum_rgb) > 150 else (255, 255, 255, 150)
                od.text((cx, cy), "%02d" % pdata.num_of[orig_rgb], font=f_num_o,
                        fill=fill, anchor="mm")
        panel = Image.alpha_composite(panel, overlay)
        draw = ImageDraw.Draw(panel)

    # ---- 右侧图例
    if draw_legend:
        legend_x = gx + grid_w + round(scale * 0.5)
        cx = legend_x
        for col_i, (n_items, item_h, f_b, f_l, bdg, sw_w, cw) in enumerate(col_metas):
            for row in range(n_items):
                idx = col_i * LEGEND_MAX_ROWS + row
                if idx >= len(pdata.legend_entries):
                    break
                _draw_one_legend_entry(
                    draw, pdata, opts, idx, row, item_h, f_b, f_l, bdg, sw_w,
                    cx=cx, cy0=gy + (row + 0.5) * item_h)
            cx += cw + col_gap

    return panel


# ---------------------------------------------------------------- 页面组装

def build_page(images: List[Image.Image], titles: List[str],
               opts: RenderOptions) -> Image.Image:
    """多张纹理 → 一张图纸页 (面板水平排列)。

    页面背景使用 opts.bg (与面板背景一致), 边缘不再受固定常量影响。
    color_mode=3 时: 每纹理生成原版面板 + 豆色面板 + 独立图例面板的三块横向布局。
    """
    pad = max(20, opts.scale // 2)
    gap = max(32, opts.scale // 2)

    if opts.color_mode != 3:
        # ---- 模式 1/2: 原行为
        panels = [build_panel(img, t, opts) for img, t in zip(images, titles)]
        page_w = pad * 2 + sum(p.width for p in panels) + gap * (len(panels) - 1)
        page_h = pad * 2 + max(p.height for p in panels)
        page = Image.new("RGB", (page_w, page_h), opts.bg)
        cx = pad
        for p in panels:
            page.paste(p, (cx, pad))
            cx += p.width + gap
        return page

    # ---- 模式 3: 双版并排 + 独立图例
    triplets = []  # list of (left_panel, right_panel, legend_panel)
    for img, title_base in zip(images, titles):
        # 同一个 pdata 供两面板 + 图例共用
        pdata = _prepare_panel_data(img, opts)

        # 构建豆色映射 (原色 → 豆号色)
        bead_rgb_map: Optional[Dict[Tuple[int, int, int], Tuple[int, int, int]]] = None
        if opts.palette and opts.bead_map:
            bead_rgb_map = {}
            for y in range(img.height):
                for x in range(img.width):
                    rgb = img.getpixel((x, y))
                    if rgb not in bead_rgb_map:
                        bead = opts.bead_map.get(rgb)
                        bead_rgb_map[rgb] = bead.rgb if bead else rgb

        # 左: 原版色面板 (无图例)
        left = build_panel(img, title_base, opts,
                           pdata=pdata, _force_no_legend=True)

        # 右: 豆色面板 (无图例); 无 palette 时回退原色
        right_title = title_base.split("  (")[0] + " 豆色版"
        right = build_panel(img, right_title, opts,
                            pdata=pdata, _display_rgb_map=bead_rgb_map,
                            _force_no_legend=True)

        # 图例面板
        legend_p = build_legend_panel(pdata, opts)

        triplets.append((left, right, legend_p))

    # 布局: left | right | legend (各纹理之间用 gap 分隔)
    all_panels = []
    for t in triplets:
        all_panels.extend(t)
    page_w = pad * 2 + sum(p.width for p in all_panels) + gap * (len(all_panels) - 1)
    page_h = pad * 2 + max(p.height for p in all_panels)
    page = Image.new("RGB", (page_w, page_h), opts.bg)
    cx = pad
    for p in all_panels:
        page.paste(p, (cx, pad))
        cx += p.width + gap
    return page


def resolve_bg(name: str) -> Tuple[int, int, int]:
    """背景预设名 → RGB (未知名字回退纯白)。"""
    if name in BG_PRESETS:
        return BG_PRESETS[name][1]
    return (255, 255, 255)


def resolve_palette(name: Optional[str]) -> Optional[List[BeadColor]]:
    """品牌名 → 色卡 (None 表示不匹配)。"""
    if name:
        return load_palette(name)
    return None
