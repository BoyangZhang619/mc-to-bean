/**
 * Canvas 渲染器 -- 离屏 canvas + 脏矩形局部重绘架构
 *
 * 离屏 canvas: 保存完整静态图纸 (格子 + 背景 + 网格线), 尺寸 = w*cellPx x h*cellPx
 * 格子修改时只 fillRect 该格到离屏, 不重绘全图
 * 主 canvas: 每帧 drawImage 离屏 - 主 canvas (带缩放/平移变换)
 * Overlay: 悬停十字 + rect/line 预览直接画主 canvas 上 (每帧)
 *
 * 导出: exportPatternPanelPng 渲染完整图纸面板 (标题 + 网格 + 行列号 + 图例)
 */
import type { Pattern, PaletteEntry, ViewportState } from '@/types'

const CELL_PX = 16

/** 图例样式类型, 对齐 Python render.py 的 legend_style */
export type LegendStyle = 'simple' | 'detail' | 'pure'

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

/** 构建 index -> serial 映射 (按 palette 出现顺序, 对齐 Python group_by_bead 序号) */
function buildSerialMap(palette: PaletteEntry[]): Map<number, number> {
  const m = new Map<number, number>()
  palette.forEach((p, i) => m.set(p.index, i + 1))
  return m
}

/** 图例条目类型 */
interface LegendEntry {
  entry: PaletteEntry
  serial: number
  count: number
}

/** 将颜色统计按调色板顺序排列, 对齐 Python legend_entries */
function buildLegendEntries(
  palette: PaletteEntry[],
  grid: number[][],
): LegendEntry[] {
  const counts = new Map<number, number>()
  for (const row of grid) {
    for (const idx of row) {
      counts.set(idx, (counts.get(idx) ?? 0) + 1)
    }
  }
  // 按 palette 顺序, 已用的在前, 未用的在后
  const used: LegendEntry[] = []
  const unused: LegendEntry[] = []
  palette.forEach((p, i) => {
    const count = counts.get(p.index) ?? 0
    const item = { entry: p, serial: i + 1, count }
    if (count > 0) used.push(item)
    else unused.push(item)
  })
  return [...used, ...unused]
}

// ----------------------------------------------------------------
// 离屏 canvas 渲染
// ----------------------------------------------------------------

/** 创建离屏 canvas 并全量渲染 */
export function createOffscreen(
  pattern: Pattern,
  opts: {
    showGrid: boolean
    gridColor: string
    backgroundColor: string
    showNumbers?: boolean
  },
): OffscreenData {
  const w = pattern.width * CELL_PX
  const h = pattern.height * CELL_PX
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // 像素图不模糊
  ctx.imageSmoothingEnabled = false

  // 构建 colorMap
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

  // 网格线 (在离屏画一次, 缩放时随 drawImage 缩放)
  if (opts.showGrid) {
    ctx.strokeStyle = opts.gridColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = 0; x <= pattern.width; x++) {
      const px = x * CELL_PX + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
    }
    for (let y = 0; y <= pattern.height; y++) {
      const py = y * CELL_PX + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(w, py)
    }
    ctx.stroke()
  }

  // 序列号叠加 (仅在 CELL_PX >= 12 且开启时绘制)
  if (opts.showNumbers && CELL_PX >= 12) {
    const serialMap = buildSerialMap(pattern.palette)
    const fNum = Math.max(7, Math.round(CELL_PX * 0.4))
    ctx.font = `${fNum}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < pattern.height; y++) {
      for (let x = 0; x < pattern.width; x++) {
        const idx = grid[y][x]
        const rgb = colorMap.get(idx)
        const serial = serialMap.get(idx)
        if (serial === undefined || !rgb) continue
        const cx = x * CELL_PX + CELL_PX / 2
        const cy = y * CELL_PX + CELL_PX / 2
        if (luma(rgb[0], rgb[1], rgb[2]) > 150) {
          ctx.fillStyle = 'rgba(30,30,30,0.47)'
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.59)'
        }
        ctx.fillText(String(serial).padStart(2, '0'), cx, cy)
      }
    }
  }

  return { canvas, ctx, colorMap }
}

/** 更新离屏上单个格子 */
export function updateOffscreenCell(
  off: OffscreenData,
  x: number, y: number, paletteIndex: number,
  backgroundColor: string
) {
  const rgb = off.colorMap.get(paletteIndex)
  off.ctx.fillStyle = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : backgroundColor
  off.ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX + 0.5, CELL_PX + 0.5)
}

/** 更新离屏上多个格子 */
export function updateOffscreenCells(
  off: OffscreenData,
  cells: { x: number; y: number; idx: number }[],
  backgroundColor: string
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
  showNumbers: boolean = false,
) {
  const { ctx, canvas } = off
  const w = canvas.width; const h = canvas.height
  // 重建 colorMap
  off.colorMap.clear()
  for (const p of pattern.palette) {
    off.colorMap.set(p.index, p.rgb)
  }
  // 全量重绘格子 (颜色变了)
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
  // 重绘网格线
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
  // 序列号叠加
  if (showNumbers && CELL_PX >= 12) {
    const serialMap = buildSerialMap(pattern.palette)
    const fNum = Math.max(7, Math.round(CELL_PX * 0.4))
    ctx.font = `${fNum}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < pattern.height; y++) {
      for (let x = 0; x < pattern.width; x++) {
        const idx = grid[y][x]
        const rgb = off.colorMap.get(idx)
        const serial = serialMap.get(idx)
        if (serial === undefined || !rgb) continue
        const cx = x * CELL_PX + CELL_PX / 2
        const cy = y * CELL_PX + CELL_PX / 2
        if (luma(rgb[0], rgb[1], rgb[2]) > 150) {
          ctx.fillStyle = 'rgba(30,30,30,0.47)'
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.59)'
        }
        ctx.fillText(String(serial).padStart(2, '0'), cx, cy)
      }
    }
  }
}

/** 将离屏渲染到主 canvas (带缩放平移变换) */
export function paintFromOffscreen(
  mainCtx: CanvasRenderingContext2D,
  off: OffscreenData,
  viewport: ViewportState,
  canvasW: number,
  canvasH: number,
  dpr: number,
  backgroundColor: string
) {
  const { offsetX, offsetY, zoom } = viewport

  mainCtx.save()
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0) // DPR
  mainCtx.fillStyle = backgroundColor
  mainCtx.fillRect(0, 0, canvasW / dpr, canvasH / dpr)

  // 变换: 离屏坐标 → 屏幕坐标
  const scale = zoom * (1 / CELL_PX) * CELL_PX * zoom   // 等价于 zoom
  // 实际变换: 每个离屏像素 = zoom 个屏幕像素, 偏移 offsetX/offsetY
  mainCtx.setTransform(
    zoom * dpr, 0,
    0, zoom * dpr,
    offsetX * dpr,
    offsetY * dpr
  )
  mainCtx.imageSmoothingEnabled = zoom < 2 // 只有缩小才平滑
  mainCtx.drawImage(off.canvas, 0, 0)
  mainCtx.restore()
}

/** 绘制 overlay (悬停十字、rect/line 预览) */
export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: ViewportState,
  options: RenderOptions,
  dpr: number
) {
  const { hoverCell, tool, rectStart, lineStart } = options
  const { offsetX, offsetY, zoom } = viewport
  const cellSize = CELL_PX * zoom

  if (!hoverCell) return

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 悬停十字
  if (cellSize >= 8) {
    const hx = offsetX + hoverCell.x * cellSize + cellSize / 2
    const hy = offsetY + hoverCell.y * cellSize + cellSize / 2
    const cl = cellSize * 0.35

    // 外轮廓
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(hx - cl, hy); ctx.lineTo(hx + cl, hy); ctx.moveTo(hx, hy - cl); ctx.lineTo(hx, hy + cl); ctx.stroke()
    // 内线
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(hx - cl, hy); ctx.lineTo(hx + cl, hy); ctx.moveTo(hx, hy - cl); ctx.lineTo(hx, hy + cl); ctx.stroke()
  }

  // 矩形预览
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

  // 直线预览
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
  showGrid: boolean = true, backgroundColor: string = '#ffffff'
): string {
  const off = createOffscreen(pattern, { showGrid, gridColor: 'rgba(0,0,0,0.15)', backgroundColor })
  return off.canvas.toDataURL('image/png')
}

// ----------------------------------------------------------------
// 完整图纸面板导出 (对齐 Python render.py build_panel)
// ----------------------------------------------------------------

/** 图例列元数据 */
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

/** 计算图例列布局 */
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
    const tW = Math.round(fLabel * 6.2)
    cw = badgeSize + 6 + swW + 6 + tW + 10
  } else {
    const tW = Math.round(fLabel * 3.4)
    cw = badgeSize + 6 + swW + 6 + tW + 10
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

/** 绘制单个图例条目: [序号徽章][圆角矩形豆色块(内嵌豆号)][数量] */
function drawLegendEntry(
  ctx: CanvasRenderingContext2D,
  entry: PaletteEntry,
  serial: number,
  count: number,
  cx: number,
  cy0: number,
  meta: LegendColMeta,
  legendStyle: LegendStyle,
) {
  const { badgeSize, swW, fBadge, fLabel } = meta
  const by = cy0 - badgeSize / 2

  // 序号徽章 (simple/detail 模式)
  if (legendStyle !== 'pure') {
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
    ctx.fillText(String(serial).padStart(2, '0'), cx + badgeSize / 2, cy0)
  }

  const bx = legendStyle !== 'pure' ? cx + badgeSize + 6 : cx

  // 圆角矩形豆色块
  const swColor: [number, number, number] = (entry.beadRgb ?? entry.rgb) as [number, number, number]
  ctx.beginPath()
  ctx.roundRect(bx, by, swW, badgeSize, Math.max(3, Math.floor(badgeSize / 4)))
  ctx.fillStyle = `rgb(${swColor[0]},${swColor[1]},${swColor[2]})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(120,120,125,1)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 内嵌豆号文字 (颜色按 luma 自适应)
  const swText = entry.code ?? hexOf(entry.rgb)
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
      text = `(\xd7${count}) ${hexOf(entry.rgb)}`
    } else {
      text = `(\xd7${count})`
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
 * 图例样式:
 *   simple: [序号徽章][圆角矩形豆色块(内嵌豆号)][数量]
 *   detail: [序号徽章][圆角矩形豆色块(内嵌豆号)][数量 #RRGGBB]
 *   pure:   [圆角矩形豆色块(内嵌豆号)]  网格强制豆色, 无序号叠加
 */
export function exportPatternPanelPng(
  pattern: Pattern,
  opts: PanelExportOptions,
): string {
  const { cellSize, showGrid, backgroundColor, legendStyle } = opts
  const pure = legendStyle === 'pure'
  const { width, height, grid, palette } = pattern

  // 构建颜色查找表
  const cm = new Map<number, PaletteEntry>()
  for (const p of palette) cm.set(p.index, p)

  // 图例条目
  const legendEntries = buildLegendEntries(palette, grid)
  const nLegend = legendEntries.length

  // 布局计算
  const titleH = Math.max(34, Math.floor(cellSize / 2))
  const numArea = cellSize
  const gx = numArea
  const gy = titleH + numArea
  const gridW = width * cellSize
  const gridH = height * cellSize

  // 图例区布局
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid[y][x]
      const entry = cm.get(idx)
      let fillRgb: [number, number, number]
      if (pure) {
        // pure 模式: 格子强制显示豆号色 (对齐 Python color_mode=1)
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
      ctx.moveTo(px, gy)
      ctx.lineTo(px, gy + gridH)
    }
    for (let y = 0; y <= height; y++) {
      const py = gy + y * cellSize + 0.5
      ctx.moveTo(gx, py)
      ctx.lineTo(gx + gridW, py)
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

  // 行号格区边框
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

  // 行号数字
  for (let y = 0; y < height; y++) {
    const y0 = gy + y * cellSize
    ctx.fillText(String(y + 1), cellSize / 2, y0 + cellSize / 2)
  }

  // 网格内半透明颜色序号 (非 pure 模式)
  if (!pure && cellSize >= 12) {
    const serialMap = buildSerialMap(palette)
    const fNumO = Math.max(7, Math.round(cellSize * 0.4))
    ctx.font = `bold ${fNumO}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = grid[y][x]
        const entry = cm.get(idx)
        const serial = serialMap.get(idx)
        if (serial === undefined || !entry) continue
        const lumRgb = entry.rgb
        const cx = gx + x * cellSize + cellSize / 2
        const cy = gy + y * cellSize + cellSize / 2
        if (luma(lumRgb[0], lumRgb[1], lumRgb[2]) > 150) {
          ctx.fillStyle = 'rgba(30,30,30,0.47)'
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.59)'
        }
        ctx.fillText(String(serial).padStart(2, '0'), cx, cy)
      }
    }
  }

  // 右侧图例
  if (legMeta && nLegend > 0) {
    const legendX = gx + gridW + Math.round(cellSize * 0.5)
    let colCx = legendX
    for (let colI = 0; colI < legMeta.cols.length; colI++) {
      const c = legMeta.cols[colI]
      for (let row = 0; row < c.nItems; row++) {
        const idx = colI * LEGEND_MAX_ROWS + row
        if (idx >= nLegend) break
        const le = legendEntries[idx]
        drawLegendEntry(
          ctx, le.entry, le.serial, le.count,
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
