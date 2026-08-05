/**
 * Canvas 渲染器 -- 离屏 canvas + 脏矩形局部重绘架构
 *
 * 离屏 canvas: 保存完整静态图纸 (格子 + 背景 + 网格线), 尺寸 = w*cellPx x h*cellPx
 * 格子修改时只 fillRect 该格到离屏, 不重绘全图
 * 主 canvas: 每帧 drawImage 离屏 -> 主 canvas (带缩放/平移变换)
 * Overlay: 悬停十字 + rect/line 预览直接画主 canvas 上 (每帧)
 *
 * 导出: exportPatternPanelPng 渲染完整图纸面板 (标题 + 网格 + 行列号 + 图例)
 * 图例合并: groupByBeadCode 按豆号 code 合并多个 palette 条目 (对齐 Python group_by_bead)
 */
import type { Pattern, PaletteEntry, ViewportState } from '@/types'
import { matchMardColor } from '@/utils/mard'

const CELL_PX = 16

/** 图例样式类型, 对齐 Python render.py 的 legend_style */
export type LegendStyle = 'simple' | 'detail' | 'pure'

/** 网格标注模式 */
export type GridLabelMode = 'none' | 'serial' | 'code'

export interface RenderOptions {
  showGrid: boolean
  gridColor: string
  backgroundColor: string
  hoverCell: { x: number; y: number } | null
  tool: string
  rectStart?: { x: number; y: number } | null
  lineStart?: { x: number; y: number } | null
}

export interface OffscreenData {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  colorMap: Map<number, [number, number, number]>
}

/** 计算亮度 (0.299R + 0.587G + 0.114B), 对齐 Python render.py luma() */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** RGB tuple -> "RRGGBB" 大写 hex */
function hexOf(rgb: [number, number, number]): string {
  return rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ----------------------------------------------------------------
// 豆号分组 (对齐 Python group_by_bead)
// ----------------------------------------------------------------

/** 合并后的图例条目: 按 code 分组, 同豆号合并 */
export interface BeadGroup {
  /** 组内所有 palette 条目 */
  entries: PaletteEntry[]
  /** 豆号 (null = 未匹配, 不合并) */
  code: string | null
  /** 豆号色 (beadRgb, 用于色块填充) */
  swatchColor: [number, number, number]
  /** 豆号名 */
  name: string | null
  /** 代表色条目 (组内像素数最多的原始条目) */
  representative: PaletteEntry
  /** 组内合计像素数 */
  count: number
  /** 分组序号 (从 1 开始, 按首次出现顺序) */
  serial: number
}

/**
 * 按豆号 code 合并 palette 条目为图例分组
 *
 * 对齐 Python group_by_bead:
 * - 按 palette 中的首次出现顺序作为组顺序
 * - 同 code 合并为一个组; code 为 null 的各自独立
 * - 代表色 = 组内像素数最多的条目 (并列取先出现者)
 * - 数量 = 组内所有条目像素数合计
 * - Web 简化: 不做组内一致性拆分 (split), 不做 warn 标记
 */
export function groupByBeadCode(
  palette: PaletteEntry[],
  grid: number[][],
): BeadGroup[] {
  // 统计每个 palette index 的像素数
  const counts = new Map<number, number>()
  for (const row of grid) {
    for (const idx of row) {
      counts.set(idx, (counts.get(idx) ?? 0) + 1)
    }
  }

  // 按 palette 顺序构造分组: 同 code 合并到第一个出现的组
  const result: BeadGroup[] = []
  const codeIndexMap = new Map<string, number>() // code -> result index

  for (const entry of palette) {
    const pixelCount = counts.get(entry.index) ?? 0
    const code = entry.code ?? null

    if (code) {
      const existingIdx = codeIndexMap.get(code)
      if (existingIdx !== undefined) {
        // 合并到已有组
        const grp = result[existingIdx]
        grp.entries.push(entry)
        grp.count += pixelCount
        // 代表色: 像素数更多者胜; 并列保留先出现者 (即不变)
        const repCount = counts.get(grp.representative.index) ?? 0
        if (pixelCount > repCount) {
          grp.representative = entry
        }
      } else {
        // 新建组
        codeIndexMap.set(code, result.length)
        result.push({
          entries: [entry],
          code,
          swatchColor: (entry.beadRgb ?? entry.rgb) as [number, number, number],
          name: entry.name ?? null,
          representative: entry,
          count: pixelCount,
          serial: 0,
        })
      }
    } else {
      // code 为 null, 不合并, 独立条目
      result.push({
        entries: [entry],
        code: null,
        swatchColor: (entry.beadRgb ?? entry.rgb) as [number, number, number],
        name: entry.name ?? null,
        representative: entry,
        count: pixelCount,
        serial: 0,
      })
    }
  }

  // 分配序号
  result.forEach((g, i) => { g.serial = i + 1 })

  return result
}

// ----------------------------------------------------------------
// 离屏 canvas 渲染
// ----------------------------------------------------------------

/** 构建 index -> 序号 映射 (按 palette 出现顺序) */
function buildSerialMap(palette: PaletteEntry[]): Map<number, number> {
  const m = new Map<number, number>()
  palette.forEach((p, i) => m.set(p.index, i + 1))
  return m
}

/** 绘制网格标注 (序列号或豆号) */
function drawGridLabels(
  ctx: CanvasRenderingContext2D,
  grid: number[][],
  width: number,
  height: number,
  cellSize: number,
  gx: number,
  gy: number,
  colorMap: Map<number, [number, number, number]>,
  palette: PaletteEntry[],
  mode: GridLabelMode,
) {
  if (mode === 'none' || cellSize < 12) return

  const idxCodeMap = new Map<number, string>()
  if (mode === 'code') {
    for (const p of palette) {
      if (p.code) idxCodeMap.set(p.index, p.code)
    }
  }

  const serialMap = mode === 'serial' ? buildSerialMap(palette) : null

  const minCellSize = mode === 'code' ? 18 : 12
  if (cellSize < minCellSize) return

  // 豆号 3-4 字符, 字号稍小于序列号
  const fSize = mode === 'code'
    ? Math.max(6, Math.round(cellSize * 0.28))
    : Math.max(7, Math.round(cellSize * 0.4))

  ctx.font = `bold ${fSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid[y][x]
      const rgb = colorMap.get(idx)
      if (!rgb) continue

      let label: string | null = null
      if (mode === 'serial') {
        const s = serialMap?.get(idx)
        if (s !== undefined) label = String(s).padStart(2, '0')
      } else if (mode === 'code') {
        label = idxCodeMap.get(idx) ?? null
      }
      if (!label) continue

      const cx = gx + x * cellSize + cellSize / 2
      const cy = gy + y * cellSize + cellSize / 2
      if (luma(rgb[0], rgb[1], rgb[2]) > 150) {
        ctx.fillStyle = 'rgba(30,30,30,0.55)'
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.65)'
      }
      ctx.fillText(label, cx, cy)
    }
  }
}

/** 创建离屏 canvas 并全量渲染 */
export function createOffscreen(
  pattern: Pattern,
  opts: {
    showGrid: boolean
    gridColor: string
    backgroundColor: string
    gridLabelMode?: GridLabelMode
  },
): OffscreenData {
  const w = pattern.width * CELL_PX
  const h = pattern.height * CELL_PX
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const colorMap = new Map<number, [number, number, number]>()
  for (const p of pattern.palette) {
    colorMap.set(p.index, p.rgb)
  }

  // 背景
  ctx.fillStyle = opts.backgroundColor
  ctx.fillRect(0, 0, w, h)

  // 绘制全部格子
  const { grid } = pattern
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const idx = grid[y][x]
      const rgb = colorMap.get(idx)
      ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : opts.backgroundColor
      ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX + 0.5, CELL_PX + 0.5)
    }
  }

  // 网格线
  if (opts.showGrid) {
    ctx.strokeStyle = opts.gridColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = 0; x <= pattern.width; x++) {
      const px = x * CELL_PX + 0.5
      ctx.moveTo(px, 0); ctx.lineTo(px, h)
    }
    for (let y = 0; y <= pattern.height; y++) {
      const py = y * CELL_PX + 0.5
      ctx.moveTo(0, py); ctx.lineTo(w, py)
    }
    ctx.stroke()
  }

  // 网格标注
  drawGridLabels(ctx, grid, pattern.width, pattern.height, CELL_PX, 0, 0,
    colorMap, pattern.palette, opts.gridLabelMode ?? 'none')

  return { canvas, ctx, colorMap }
}

/** 更新离屏上单个格子 */
export function updateOffscreenCell(
  off: OffscreenData,
  x: number, y: number, paletteIndex: number,
  backgroundColor: string,
) {
  const rgb = off.colorMap.get(paletteIndex)
  off.ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : backgroundColor
  off.ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX + 0.5, CELL_PX + 0.5)
}

/** 更新离屏上多个格子 */
export function updateOffscreenCells(
  off: OffscreenData,
  cells: { x: number; y: number; idx: number }[],
  backgroundColor: string,
) {
  for (const c of cells) {
    const rgb = off.colorMap.get(c.idx)
    off.ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : backgroundColor
    off.ctx.fillRect(c.x * CELL_PX, c.y * CELL_PX, CELL_PX + 0.5, CELL_PX + 0.5)
  }
}

/** 更新离屏调色板颜色 (编辑颜色后重建离屏) */
export function rebuildOffscreenColors(
  off: OffscreenData,
  pattern: Pattern,
  backgroundColor: string,
  showGrid: boolean,
  gridColor: string,
  gridLabelMode: GridLabelMode = 'none',
) {
  const { ctx, canvas } = off
  const w = canvas.width; const h = canvas.height
  off.colorMap.clear()
  for (const p of pattern.palette) {
    off.colorMap.set(p.index, p.rgb)
  }
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, w, h)
  const { grid } = pattern
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const idx = grid[y][x]
      const rgb = off.colorMap.get(idx)
      ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : backgroundColor
      ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX + 0.5, CELL_PX + 0.5)
    }
  }
  if (showGrid) {
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = 0; x <= pattern.width; x++) {
      const px = x * CELL_PX + 0.5
      ctx.moveTo(px, 0); ctx.lineTo(px, h)
    }
    for (let y = 0; y <= pattern.height; y++) {
      const py = y * CELL_PX + 0.5
      ctx.moveTo(0, py); ctx.lineTo(w, py)
    }
    ctx.stroke()
  }
  drawGridLabels(ctx, grid, pattern.width, pattern.height, CELL_PX, 0, 0,
    off.colorMap, pattern.palette, gridLabelMode)
}

/** 将离屏渲染到主 canvas (带缩放平移变换) */
export function paintFromOffscreen(
  mainCtx: CanvasRenderingContext2D,
  off: OffscreenData,
  viewport: ViewportState,
  canvasW: number,
  canvasH: number,
  dpr: number,
  backgroundColor: string,
) {
  const { offsetX, offsetY, zoom } = viewport
  mainCtx.save()
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  mainCtx.fillStyle = backgroundColor
  mainCtx.fillRect(0, 0, canvasW / dpr, canvasH / dpr)
  mainCtx.setTransform(
    zoom * dpr, 0,
    0, zoom * dpr,
    offsetX * dpr,
    offsetY * dpr,
  )
  mainCtx.imageSmoothingEnabled = zoom < 2
  mainCtx.drawImage(off.canvas, 0, 0)
  mainCtx.restore()
}

/** 绘制 overlay (悬停十字、rect/line 预览) */
export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: ViewportState,
  options: RenderOptions,
  dpr: number,
) {
  const { hoverCell, tool, rectStart, lineStart } = options
  const { offsetX, offsetY, zoom } = viewport
  const cellSize = CELL_PX * zoom
  if (!hoverCell) return
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (cellSize >= 8) {
    const hx = offsetX + hoverCell.x * cellSize + cellSize / 2
    const hy = offsetY + hoverCell.y * cellSize + cellSize / 2
    const cl = cellSize * 0.35
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(hx - cl, hy); ctx.lineTo(hx + cl, hy); ctx.moveTo(hx, hy - cl); ctx.lineTo(hx, hy + cl); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(hx - cl, hy); ctx.lineTo(hx + cl, hy); ctx.moveTo(hx, hy - cl); ctx.lineTo(hx, hy + cl); ctx.stroke()
  }
  if (rectStart && tool === 'rect' && cellSize >= 4) {
    const rx1 = Math.min(rectStart.x, hoverCell.x)
    const ry1 = Math.min(rectStart.y, hoverCell.y)
    const rx2 = Math.max(rectStart.x, hoverCell.x)
    const ry2 = Math.max(rectStart.y, hoverCell.y)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(offsetX + rx1 * cellSize, offsetY + ry1 * cellSize, (rx2 - rx1 + 1) * cellSize, (ry2 - ry1 + 1) * cellSize)
    ctx.setLineDash([])
  }
  if (lineStart && tool === 'line' && cellSize >= 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(offsetX + lineStart.x * cellSize + cellSize / 2, offsetY + lineStart.y * cellSize + cellSize / 2)
    ctx.lineTo(offsetX + hoverCell.x * cellSize + cellSize / 2, offsetY + hoverCell.y * cellSize + cellSize / 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

/** 生成缩略图 (用于画廊列表) */
export function renderThumbnail(pattern: Pattern, size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const { width, height, grid, palette } = pattern
  const cellW = size / width; const cellH = size / height
  const cellSize = Math.min(cellW, cellH)
  const ox = (size - cellSize * width) / 2; const oy = (size - cellSize * height) / 2
  ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, size, size)
  const cm = new Map<number, [number, number, number]>()
  for (const p of palette) cm.set(p.index, p.rgb)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid[y]?.[x] ?? -1
      const rgb = cm.get(idx)
      ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : '#fff'
      ctx.fillRect(ox + x * cellSize, oy + y * cellSize, cellSize + 1, cellSize + 1)
    }
  }
  return canvas.toDataURL('image/png')
}

/** 导出完整图纸为 PNG (仅网格, 无图例/标题) -- 保留向后兼容 */
export function exportFullPng(
  pattern: Pattern, cellSize: number = 16,
  showGrid: boolean = true, backgroundColor: string = '#ffffff',
): string {
  const off = createOffscreen(pattern, { showGrid, gridColor: 'rgba(0,0,0,0.15)', backgroundColor })
  return off.canvas.toDataURL('image/png')
}

// ----------------------------------------------------------------
// 完整图纸面板导出 (对齐 Python render.py build_panel)
// ----------------------------------------------------------------

interface LegendColMeta {
  nItems: number
  itemH: number
  fBadge: number
  fLabel: number
  badgeSize: number
  swW: number
  cw: number
}

const LEGEND_MAX_ROWS = 10

/** 计算图例列布局。simple 无序号徽章, detail 有序号徽章, pure 只有色块。 */
function calcLegendMeta(
  nLegend: number,
  gridH: number,
  cellSize: number,
  legendStyle: LegendStyle,
): { cols: LegendColMeta[]; legendW: number; colGap: number } {
  const nCols = Math.ceil(nLegend / LEGEND_MAX_ROWS)
  const nFirst = Math.min(LEGEND_MAX_ROWS, nLegend)
  const itemH = gridH / nFirst
  const fBadge = Math.max(10, Math.round(itemH * 0.22))
  const fLabel = Math.max(11, Math.round(itemH * 0.24))
  const badgeSize = Math.round(itemH * 0.5)
  const swW = Math.round(fLabel * 2.8) + 12

  let cw: number
  if (legendStyle === 'pure') {
    cw = swW + 16
  } else if (legendStyle === 'detail') {
    // badge + swatch + count + HEX
    cw = badgeSize + 6 + swW + 6 + Math.round(fLabel * 6.2) + 10
  } else {
    // simple: swatch + count (无 badge)
    cw = swW + 6 + Math.round(fLabel * 3.4) + 10
  }

  const colGap = Math.round(cellSize * 0.45)
  const cols: LegendColMeta[] = []
  let legendW = 0
  for (let col = 0; col < nCols; col++) {
    const nItems = Math.min(LEGEND_MAX_ROWS, nLegend - col * LEGEND_MAX_ROWS)
    cols.push({ nItems, itemH, fBadge, fLabel, badgeSize, swW, cw })
    legendW += cw
  }
  legendW += (nCols - 1) * colGap + Math.round(cellSize * 0.5)
  return { cols, legendW, colGap }
}

/**
 * 绘制单个图例条目
 *
 * simple:  [圆角矩形色块(内嵌豆号)][数量]  (无序号徽章)
 * detail:  [序号徽章][圆角矩形色块(内嵌豆号)][数量 #RRGGBB]
 * pure:    [圆角矩形色块(内嵌豆号)]  无其他
 */
function drawLegendEntry(
  ctx: CanvasRenderingContext2D,
  group: BeadGroup,
  cx: number,
  cy0: number,
  meta: LegendColMeta,
  legendStyle: LegendStyle,
) {
  const { badgeSize, swW, fBadge, fLabel } = meta
  const by = cy0 - badgeSize / 2

  // 序号徽章 (仅 detail 模式)
  if (legendStyle === 'detail') {
    ctx.beginPath()
    ctx.roundRect(cx, by, badgeSize, badgeSize, Math.round(badgeSize * 0.28))
    ctx.fillStyle = '#ebebee'
    ctx.fill()
    ctx.strokeStyle = 'rgba(150,150,155,1)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = '#3c3c3c'
    ctx.font = `bold ${fBadge}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(group.serial).padStart(2, '0'), cx + badgeSize / 2, cy0)
  }

  const bx = legendStyle === 'detail' ? cx + badgeSize + 6 : cx

  // 圆角矩形豆色块
  const swColor = group.swatchColor
  ctx.beginPath()
  ctx.roundRect(bx, by, swW, badgeSize, Math.max(3, Math.floor(badgeSize / 4)))
  ctx.fillStyle = `rgb(${swColor[0]},${swColor[1]},${swColor[2]})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(120,120,125,1)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 内嵌豆号文字 (颜色按 luma 自适应)
  // 兜底: code 为 null 时尝试 MARD 匹配; 匹配不到才显示短 HEX
  let swText = group.code
  if (!swText) {
    const match = matchMardColor(group.representative.rgb[0], group.representative.rgb[1], group.representative.rgb[2])
    swText = match ? match.code : hexOf(group.representative.rgb).slice(0, 4)
  }
  const lum = luma(swColor[0], swColor[1], swColor[2])
  ctx.fillStyle = lum < 150 ? '#ffffff' : '#282828'
  ctx.font = `bold ${Math.max(9, fLabel)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(swText, bx + swW / 2, cy0)

  // 数量文本 (simple/detail 模式)
  if (legendStyle !== 'pure') {
    const tx = bx + swW + 6
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#3c3c3c'
    ctx.font = `${fLabel}px sans-serif`

    let text: string
    if (legendStyle === 'detail') {
      text = `(\xd7${group.count}) ${hexOf(group.representative.rgb)}`
    } else {
      text = `(\xd7${group.count})`
    }
    ctx.fillText(text, tx, cy0)
  }
}

export interface PanelExportOptions {
  cellSize: number
  showGrid: boolean
  backgroundColor: string
  legendStyle: LegendStyle
}

/**
 * 导出完整图纸面板 PNG (对齐 Python render.py build_panel)
 *
 * 布局: 顶部标题 + 左侧行号 + 上方列号 + 中部网格 + 右侧图例
 *
 * 模式:
 *   simple: 网格豆色填充 + 豆号文字叠加, 图例=[圆角矩形色块(内嵌豆号)][数量] (无序号)
 *   detail: 网格原色填充 + 序号文字叠加, 图例=[序号徽章][圆角矩形色块(内嵌豆号)][数量 #RRGGBB]
 *   pure:   网格豆色填充 + 无叠加,     图例=[圆角矩形色块(内嵌豆号)] 无其他
 */
export function exportPatternPanelPng(
  pattern: Pattern,
  opts: PanelExportOptions,
): string {
  const { cellSize, showGrid, backgroundColor, legendStyle } = opts
  const pure = legendStyle === 'pure'
  const simple = legendStyle === 'simple'
  const { width, height, grid, palette } = pattern

  // 构建颜色查找表
  const cm = new Map<number, PaletteEntry>()
  for (const p of palette) cm.set(p.index, p)

  // 图例条目: 按豆号合并 (对齐 Python group_by_bead)
  const beadGroups = groupByBeadCode(palette, grid)

  // 布局计算
  const titleH = Math.max(34, Math.floor(cellSize / 2))
  const numArea = cellSize
  const gx = numArea
  const gy = titleH + numArea
  const gridW = width * cellSize
  const gridH = height * cellSize

  // 图例区布局 (已按合并后组数计算)
  const nLegend = beadGroups.length
  let legMeta: { cols: LegendColMeta[]; legendW: number; colGap: number } | null = null
  let legendW = 0
  if (nLegend > 0) {
    legMeta = calcLegendMeta(nLegend, gridH, cellSize, legendStyle)
    legendW = legMeta.legendW
  }

  const pw = gx + gridW + legendW + 14
  const ph = gy + gridH + 12
  const dpr = window.devicePixelRatio || 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(pw * dpr)
  canvas.height = Math.ceil(ph * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  // 背景
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, pw, ph)

  // 标题
  ctx.fillStyle = '#3c3c3c'
  ctx.font = `bold ${Math.max(15, Math.floor(cellSize / 4))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(pattern.name, pw / 2, titleH / 2)

  // 网格像素填充
  // detail → 原色, simple/pure → 豆号色
  const useBeadColor = pure || simple
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid[y][x]
      const entry = cm.get(idx)
      let fillRgb: [number, number, number]
      if (useBeadColor) {
        fillRgb = (entry?.beadRgb ?? entry?.rgb ?? [255, 255, 255]) as [number, number, number]
      } else {
        fillRgb = (entry?.rgb ?? [255, 255, 255]) as [number, number, number]
      }
      ctx.fillStyle = `rgb(${fillRgb[0]},${fillRgb[1]},${fillRgb[2]})`
      ctx.fillRect(
        gx + x * cellSize,
        gy + y * cellSize,
        cellSize + 0.5,
        cellSize + 0.5,
      )
    }
  }

  // 网格线
  if (showGrid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.09)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = 0; x <= width; x++) {
      const px = gx + x * cellSize + 0.5
      ctx.moveTo(px, gy); ctx.lineTo(px, gy + gridH)
    }
    for (let y = 0; y <= height; y++) {
      const py = gy + y * cellSize + 0.5
      ctx.moveTo(gx, py); ctx.lineTo(gx + gridW, py)
    }
    ctx.stroke()
  }

  // 列号格区边框
  ctx.strokeStyle = 'rgba(0,0,0,0.27)'
  ctx.lineWidth = 1
  for (let x = 0; x < width; x++) {
    const x0 = gx + x * cellSize
    ctx.strokeRect(x0, titleH, cellSize, cellSize)
  }
  for (let y = 0; y < height; y++) {
    const y0 = gy + y * cellSize
    ctx.strokeRect(0, y0, cellSize, cellSize)
  }

  // 网格外框
  ctx.strokeStyle = 'rgba(30,30,30,0.82)'
  ctx.lineWidth = 2
  ctx.strokeRect(gx - 1, gy - 1, gridW + 1, gridH + 1)

  // 列号数字
  const fNum = Math.max(12, Math.floor(cellSize / 3))
  ctx.font = `${fNum}px sans-serif`
  ctx.fillStyle = '#3c3c3c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let x = 0; x < width; x++) {
    const x0 = gx + x * cellSize
    ctx.fillText(String(x + 1), x0 + cellSize / 2, titleH + cellSize / 2)
  }
  for (let y = 0; y < height; y++) {
    const y0 = gy + y * cellSize
    ctx.fillText(String(y + 1), cellSize / 2, y0 + cellSize / 2)
  }

  // 网格标注: detail → 序号, simple → 豆号, pure → 无
  let gridLabelMode: GridLabelMode = 'none'
  if (legendStyle === 'detail') gridLabelMode = 'serial'
  else if (legendStyle === 'simple') gridLabelMode = 'code'

  // 构建网格标注用的 colorMap (detail 模式用原色算 luma, simple 用豆色)
  const labelColorMap = new Map<number, [number, number, number]>()
  for (const p of palette) {
    if (gridLabelMode === 'code') {
      labelColorMap.set(p.index, (p.beadRgb ?? p.rgb) as [number, number, number])
    } else {
      labelColorMap.set(p.index, p.rgb)
    }
  }

  drawGridLabels(ctx, grid, width, height, cellSize, gx, gy, labelColorMap, palette, gridLabelMode)

  // 右侧图例 (按合并后分组绘制)
  if (legMeta && nLegend > 0) {
    const legendX = gx + gridW + Math.round(cellSize * 0.5)
    let colCx = legendX
    for (let colI = 0; colI < legMeta.cols.length; colI++) {
      const c = legMeta.cols[colI]
      for (let row = 0; row < c.nItems; row++) {
        const idx = colI * LEGEND_MAX_ROWS + row
        if (idx >= nLegend) break
        drawLegendEntry(
          ctx, beadGroups[idx],
          colCx, gy + (row + 0.5) * c.itemH, c, legendStyle,
        )
      }
      colCx += c.cw + legMeta.colGap
    }
  }

  // 面板圆角边框
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, pw - 1, ph - 1, 10)
  ctx.strokeStyle = 'rgba(0,0,0,0.24)'
  ctx.lineWidth = 1
  ctx.stroke()

  return canvas.toDataURL('image/png')
}
