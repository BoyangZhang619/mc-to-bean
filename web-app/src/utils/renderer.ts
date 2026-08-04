/**
 * Canvas 渲染器 -- 离屏 canvas + 脏矩形局部重绘架构
 *
 * 离屏 canvas: 保存完整静态图纸 (格子 + 背景 + 网格线), 尺寸 = w*cellPx × h*cellPx
 * 格子修改时只 fillRect 该格到离屏, 不重绘全图
 * 主 canvas: 每帧 drawImage 离屏 → 主 canvas (带缩放/平移变换)
 * Overlay: 悬停十字 + rect/line 预览直接画主 canvas 上 (每帧)
 */
import type { Pattern, ViewportState } from '@/types'

const CELL_PX = 16

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

/** 创建离屏 canvas 并全量渲染 */
export function createOffscreen(pattern: Pattern, opts: {
  showGrid: boolean; gridColor: string; backgroundColor: string
}): OffscreenData {
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
  gridColor: string
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

/** 导出完整图纸为 PNG (使用离屏渲染逻辑) */
export function exportFullPng(
  pattern: Pattern, cellSize: number = 16,
  showGrid: boolean = true, backgroundColor: string = '#ffffff'
): string {
  const off = createOffscreen(pattern, { showGrid, gridColor: 'rgba(0,0,0,0.15)', backgroundColor })
  return off.canvas.toDataURL('image/png')
}
