import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import type { Pattern, PaletteEntry, ToolType, ViewportState } from '@/types'
import { HistoryStack } from '@/utils/history'
import { floodFill } from '@/utils/floodFill'
import * as db from '@/utils/db'
import type { LegendStyle } from '@/utils/renderer'

interface DirtyCell {
  x: number; y: number; oldValue: number; newValue: number; idx?: number
}

export const useEditorStore = defineStore('editor', () => {
  // ---- state ----
  const pattern = ref<Pattern | null>(null)
  const viewport = ref<ViewportState>({ offsetX: 0, offsetY: 0, zoom: 1 })
  const currentTool = ref<ToolType>('brush')
  const currentColorIndex = ref(0)
  const showGrid = ref(true)
  const showNumbers = ref(false)
  const backgroundColor = ref('#ffffff')
  const legendStyle = ref<LegendStyle>('simple')
  const isDirty = ref(false)
  const isSaving = ref(false)
  const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
  const hoverCell = ref<{ x: number; y: number } | null>(null)
  const gridAnimationProgress = ref(1)
  /** markRaw grid 后深层变更不触发 watch, 用此计数器手动通知 CanvasGrid 重绘 */
  const renderVersion = ref(0)

  // 历史栈
  const history = ref(new HistoryStack())

  // 矩形框选起始点
  const rectStart = ref<{ x: number; y: number } | null>(null)
  // 直线起点
  const lineStart = ref<{ x: number; y: number } | null>(null)

  // rAF 批量合并: 拖拽绘制期间的待刷新脏格
  const dirtyCells = ref<Map<string, DirtyCell>>(new Map())
  // 上一次 flush 写入的格子 (供 CanvasGrid 更新离屏)
  const lastFlushedCells = ref<DirtyCell[]>([])

  // ---- getters ----
  const canUndo = computed(() => history.value.canUndo)
  const canRedo = computed(() => history.value.canRedo)

  const currentColor = computed(() => {
    if (!pattern.value) return null
    return pattern.value.palette.find((p) => p.index === currentColorIndex.value) ?? pattern.value.palette[0] ?? null
  })

  /** 每种颜色在 grid 中的使用数量 */
  const colorStats = computed(() => {
    if (!pattern.value) return []
    const counts = new Map<number, number>()
    const total = pattern.value.width * pattern.value.height
    for (const row of pattern.value.grid) {
      for (const idx of row) {
        counts.set(idx, (counts.get(idx) ?? 0) + 1)
      }
    }
    return pattern.value.palette.map((p) => ({
      ...p,
      count: counts.get(p.index) ?? 0,
      percentage: total > 0 ? ((counts.get(p.index) ?? 0) / total) * 100 : 0,
    }))
  })

  // ---- actions ----
  function loadPattern(p: Pattern) {
    // 标记 grid 为非响应式 (Vue 不 proxy 深层数组, 提升读写性能)
    p.grid = markRaw(p.grid.map((row) => markRaw(row)))
    pattern.value = p
    isDirty.value = false
    saveStatus.value = 'saved'
    history.value.clear()
    dirtyCells.value.clear()
    // 默认选第一个颜色
    if (p.palette.length > 0) {
      currentColorIndex.value = p.palette[0].index
    }
    // 应用文档背景色 (默认白)
    backgroundColor.value = p.bgColor ?? '#ffffff'
    // 居中画布
    viewport.value = { offsetX: 0, offsetY: 0, zoom: 1 }
  }

  function setTool(tool: ToolType) {
    currentTool.value = tool
    rectStart.value = null
    lineStart.value = null
  }

  function setCurrentColorIndex(index: number) {
    if (pattern.value && pattern.value.palette.some((p) => p.index === index)) {
      currentColorIndex.value = index
    }
  }

  function setViewport(v: Partial<ViewportState>) {
    viewport.value = { ...viewport.value, ...v }
  }

  /** 将格点加入脏格缓冲区 (rAF 批量合并) */
  function paintCell(x: number, y: number): boolean {
    if (!pattern.value) return false
    const { width, height, grid } = pattern.value
    if (x < 0 || x >= width || y < 0 || y >= height) return false

    const newValue = currentTool.value === 'eraser' ? -1 : currentColorIndex.value
    const oldValue = grid[y][x]
    if (oldValue === newValue) return false

    const key = `${x},${y}`
    const existing = dirtyCells.value.get(key)
    if (existing) {
      // 已有脏格: 更新 newValue (保持原始 oldValue)
      existing.newValue = newValue
    } else {
      dirtyCells.value.set(key, { x, y, oldValue, newValue })
    }
    return true
  }

  /** 将缓冲区内的脏格批量写入 grid 和历史栈 */
  function flushDirtyCells(): number {
    if (!pattern.value || dirtyCells.value.size === 0) return 0

    const { grid } = pattern.value
    const cells: string[] = []
    const prevValues: number[] = []
    const nextValues: number[] = []
    const count = dirtyCells.value.size

    for (const dc of dirtyCells.value.values()) {
      // 终究要跳过 oldValue === newValue 的 (可能在缓冲期间重复修改)
      if (dc.oldValue === dc.newValue) continue
      grid[dc.y][dc.x] = dc.newValue
      cells.push(`${dc.x},${dc.y}`)
      prevValues.push(dc.oldValue)
      nextValues.push(dc.newValue)
    }
    // 保存快照供 CanvasGrid 更新离屏
    lastFlushedCells.value = [...dirtyCells.value.values()].filter(dc => dc.oldValue !== dc.newValue)
    dirtyCells.value.clear()

    if (cells.length === 0) return 0

    renderVersion.value++

    history.value.push({
      cells,
      prevValues,
      nextValues,
      tool: currentTool.value,
      timestamp: Date.now(),
    })

    isDirty.value = true
    saveStatus.value = 'unsaved'
    return cells.length
  }

  /** 执行填充 */
  function doFloodFill(x: number, y: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const fillValue = currentColorIndex.value

    const result = floodFill(grid, x, y, fillValue, width, height)
    if (result.cells.length === 0) return

    // 记录历史
    const cells: string[] = []
    const prevValues: number[] = []
    const nextValues: number[] = []
    for (const [cx, cy] of result.cells) {
      cells.push(`${cx},${cy}`)
      prevValues.push(pattern.value.grid[cy]?.[cx] ?? -1)
      nextValues.push(fillValue)
    }

    // 应用修改
    for (const [cx, cy] of result.cells) {
      pattern.value.grid[cy][cx] = fillValue
    }

    history.value.push({
      cells,
      prevValues,
      nextValues,
      tool: 'fill',
      timestamp: Date.now(),
    })

    // 通知 CanvasGrid 更新离屏
    lastFlushedCells.value = result.cells.map(([x, y]) => ({
      x, y, oldValue: -1, newValue: fillValue
    }))
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** 矩形填充: 会记录到历史 */
  function doRectFill(x1: number, y1: number, x2: number, y2: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const minX = Math.max(0, Math.min(x1, x2))
    const maxX = Math.min(width - 1, Math.max(x1, x2))
    const minY = Math.max(0, Math.min(y1, y2))
    const maxY = Math.min(height - 1, Math.max(y1, y2))
    const fillValue = currentColorIndex.value

    const cells: string[] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const oldVal = grid[cy][cx]
        if (oldVal !== fillValue) {
          cells.push(`${cx},${cy}`)
          prevValues.push(oldVal)
          nextValues.push(fillValue)
          grid[cy][cx] = fillValue
        }
      }
    }

    if (cells.length === 0) return

    history.value.push({
      cells,
      prevValues,
      nextValues,
      tool: 'rect',
      timestamp: Date.now(),
    })

    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** 直线绘制 */
  function doLine(x1: number, y1: number, x2: number, y2: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const fillValue = currentColorIndex.value

    // Bresenham 直线算法
    const cells: [number, number][] = []
    let x = x1, y = y1
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1
    const sy = y1 < y2 ? 1 : -1
    let err = dx - dy

    while (true) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        cells.push([x, y])
      }
      if (x === x2 && y === y2) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x += sx }
      if (e2 < dx) { err += dx; y += sy }
    }

    const cellKeys: string[] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (const [cx, cy] of cells) {
      const oldVal = grid[cy][cx]
      if (oldVal !== fillValue) {
        cellKeys.push(`${cx},${cy}`)
        prevValues.push(oldVal)
        nextValues.push(fillValue)
        grid[cy][cx] = fillValue
      }
    }

    if (cellKeys.length === 0) return

    history.value.push({
      cells: cellKeys,
      prevValues,
      nextValues,
      tool: 'line',
      timestamp: Date.now(),
    })

    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** 撤销 */
  function undo() {
    if (!pattern.value) return
    const entry = history.value.undo()
    if (!entry) return

    for (let i = 0; i < entry.cells.length; i++) {
      const [x, y] = entry.cells[i].split(',').map(Number)
      pattern.value.grid[y][x] = entry.prevValues[i]
    }
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** 重做 */
  function redo() {
    if (!pattern.value) return
    const entry = history.value.redo()
    if (!entry) return

    for (let i = 0; i < entry.cells.length; i++) {
      const [x, y] = entry.cells[i].split(',').map(Number)
      pattern.value.grid[y][x] = entry.nextValues[i]
    }
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** 取色 */
  function pickColor(x: number, y: number) {
    if (!pattern.value) return
    const idx = pattern.value.grid[y]?.[x]
    if (idx !== undefined && idx >= 0) {
      currentColorIndex.value = idx
    }
  }

  /** 更新调色板中某个颜色的 RGB */
  function updatePaletteEntry(index: number, rgb: [number, number, number]) {
    if (!pattern.value) return
    const entry = pattern.value.palette.find((p) => p.index === index)
    if (entry) {
      entry.rgb = rgb
      renderVersion.value++
      isDirty.value = true
      saveStatus.value = 'unsaved'
    }
  }

  /** resize 图纸 */
  function resizePattern(
    newWidth: number,
    newHeight: number,
    fill: 'crop' | 'extend' | 'scale',
    anchor: 'top-left' | 'center'
  ) {
    if (!pattern.value) return

    const { width: oldW, height: oldH, grid, palette } = pattern.value

    const newGrid: number[][] = []
    const defaultIndex = palette.length > 0 ? palette[0].index : 0

    if (fill === 'scale') {
      // 缩放内容 (最近邻)
      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        const srcY = Math.floor(y * oldH / newHeight)
        for (let x = 0; x < newWidth; x++) {
          const srcX = Math.floor(x * oldW / newWidth)
          row.push(grid[srcY]?.[srcX] ?? defaultIndex)
        }
        newGrid.push(row)
      }
    } else if (fill === 'extend') {
      // 扩展留白
      const offsetX = anchor === 'center' ? Math.floor((newWidth - oldW) / 2) : 0
      const offsetY = anchor === 'center' ? Math.floor((newHeight - oldH) / 2) : 0

      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        for (let x = 0; x < newWidth; x++) {
          const sx = x - offsetX
          const sy = y - offsetY
          if (sx >= 0 && sx < oldW && sy >= 0 && sy < oldH) {
            row.push(grid[sy][sx])
          } else {
            row.push(defaultIndex)
          }
        }
        newGrid.push(row)
      }
    } else {
      // 截断
      const offsetX = anchor === 'center' ? Math.floor((oldW - newWidth) / 2) : 0
      const offsetY = anchor === 'center' ? Math.floor((oldH - newHeight) / 2) : 0

      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        const sy = y + offsetY
        for (let x = 0; x < newWidth; x++) {
          const sx = x + offsetX
          if (sx >= 0 && sx < oldW && sy >= 0 && sy < oldH) {
            row.push(grid[sy][sx])
          } else {
            row.push(defaultIndex)
          }
        }
        newGrid.push(row)
      }
    }

    pattern.value.grid = newGrid
    pattern.value.width = newWidth
    pattern.value.height = newHeight
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
    history.value.clear()
  }

  /** 保存到 IndexedDB */
  async function save(): Promise<boolean> {
    if (!pattern.value || !isDirty.value) return true

    saveStatus.value = 'saving'
    pattern.value.updatedAt = Date.now()
    // 同步当前背景色到文档
    pattern.value.bgColor = backgroundColor.value

    try {
      await db.savePattern(pattern.value)
      isDirty.value = false
      saveStatus.value = 'saved'
      return true
    } catch (e: any) {
      console.error('[editorStore] 保存失败:', e)
      saveStatus.value = 'unsaved'
      return false
    }
  }

  /** 另存为新图纸 */
  async function saveAsNew(newName: string): Promise<Pattern | null> {
    if (!pattern.value) return null

    const now = Date.now()
    const clone: Pattern = {
      ...pattern.value,
      id: crypto.randomUUID(),
      name: newName,
      grid: pattern.value.grid.map((row) => [...row]),
      palette: pattern.value.palette.map((p) => ({ ...p })),
      bgColor: backgroundColor.value,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await db.savePattern(clone)
      // 加载克隆到编辑器
      loadPattern(clone)
      return clone
    } catch (e: any) {
      console.error('[editorStore] 另存失败:', e)
      return null
    }
  }

  return {
    pattern,
    viewport,
    currentTool,
    currentColorIndex,
    showGrid,
    showNumbers,
    backgroundColor,
    legendStyle,
    isDirty,
    isSaving,
    saveStatus,
    hoverCell,
    gridAnimationProgress,
    renderVersion,
    history,
    rectStart,
    lineStart,
    canUndo,
    canRedo,
    currentColor,
    colorStats,
    loadPattern,
    setTool,
    setCurrentColorIndex,
    setViewport,
    dirtyCells,
    lastFlushedCells,
    paintCell,
    flushDirtyCells,
    doFloodFill,
    doRectFill,
    doLine,
    undo,
    redo,
    pickColor,
    updatePaletteEntry,
    resizePattern,
    save,
    saveAsNew,
  }
})
