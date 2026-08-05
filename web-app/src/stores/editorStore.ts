import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import type { Pattern, PaletteEntry, ToolType, ViewportState, BrushSize, SelectionRect } from '@/types'
import { HistoryStack } from '@/utils/history'
import { floodFill } from '@/utils/floodFill'
import * as db from '@/utils/db'
import type { LegendStyle, GridLabelMode } from '@/utils/renderer'

interface DirtyCell {
  x: number; y: number; oldValue: number; newValue: number
}

export const useEditorStore = defineStore('editor', () => {
  // ---- state ----
  const pattern = ref<Pattern | null>(null)
  const viewport = ref<ViewportState>({ offsetX: 0, offsetY: 0, zoom: 1 })
  const currentTool = ref<ToolType>('brush')
  const currentColorIndex = ref(0)
  const brushSize = ref<BrushSize>(1)
  const showGrid = ref(true)
  const gridLabelMode = ref<GridLabelMode>('none')
  const backgroundColor = ref('#ffffff')
  const legendStyle = ref<LegendStyle>('simple')
  const isDirty = ref(false)
  const isSaving = ref(false)
  const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
  const hoverCell = ref<{ x: number; y: number } | null>(null)
  const gridAnimationProgress = ref(1)
  const renderVersion = ref(0)

  // 历史栈
  const history = ref(new HistoryStack())

  // 矩形框选起始点
  const rectStart = ref<{ x: number; y: number } | null>(null)
  // 直线起点
  const lineStart = ref<{ x: number; y: number } | null>(null)

  // rAF 批量合并: 拖拽绘制期间的待刷新脏格
  const dirtyCells = ref<Map<string, DirtyCell>>(new Map())
  const lastFlushedCells = ref<DirtyCell[]>([])

  // 颜色替换状态
  const replaceSourceIndex = ref<number | null>(null)
  const replaceMessage = ref<string | null>(null)

  // 选区 (P2-2)
  const selection = ref<SelectionRect | null>(null)
  const selectStart = ref<{ x: number; y: number } | null>(null)
  // 剪贴板 (存储选区内的 grid 切片)
  const clipboard = ref<{ grid: number[][]; width: number; height: number } | null>(null)

  // 图层 (P3-1)
  const layers = ref<{ name: string; visible: boolean; grid: number[][] }[]>([])
  const activeLayerIndex = ref(0)

  // ---- 增量 colorStats (P1-3) ----
  const _colorCounts = ref<Map<number, number>>(new Map())
  const _colorStatsDirty = ref(true)

  function _rebuildColorCounts() {
    if (!pattern.value) { _colorCounts.value.clear(); return }
    const m = new Map<number, number>()
    for (const row of pattern.value.grid) {
      for (const idx of row) {
        m.set(idx, (m.get(idx) ?? 0) + 1)
      }
    }
    _colorCounts.value = m
    _colorStatsDirty.value = false
  }

  function _ensureColorStats() {
    if (_colorStatsDirty.value) _rebuildColorCounts()
  }

  function _incColorCount(idx: number, delta: number) {
    if (!pattern.value) return
    _ensureColorStats()
    const cur = _colorCounts.value.get(idx) ?? 0
    const next = cur + delta
    if (next <= 0) _colorCounts.value.delete(idx)
    else _colorCounts.value.set(idx, next)
  }

  // ---- getters ----
  const canUndo = computed(() => history.value.canUndo)
  const canRedo = computed(() => history.value.canRedo)

  const currentColor = computed(() => {
    if (!pattern.value) return null
    return pattern.value.palette.find((p) => p.index === currentColorIndex.value) ?? pattern.value.palette[0] ?? null
  })

  const colorStats = computed(() => {
    if (!pattern.value) return []
    _ensureColorStats()
    const total = pattern.value.width * pattern.value.height
    return pattern.value.palette.map((p) => ({
      ...p,
      count: _colorCounts.value.get(p.index) ?? 0,
      percentage: total > 0 ? ((_colorCounts.value.get(p.index) ?? 0) / total) * 100 : 0,
    }))
  })

  // ---- actions ----
  function loadPattern(p: Pattern) {
    p.grid = markRaw(p.grid.map((row) => markRaw(row)))
    pattern.value = p
    isDirty.value = false
    saveStatus.value = 'saved'
    history.value.clear()
    dirtyCells.value.clear()
    brushSize.value = 1
    replaceSourceIndex.value = null
    _colorStatsDirty.value = true
    if (p.palette.length > 0) {
      currentColorIndex.value = p.palette[0].index
    }
    backgroundColor.value = p.bgColor ?? '#ffffff'
    viewport.value = { offsetX: 0, offsetY: 0, zoom: 1 }
    initLayers()
  }

  function setTool(tool: ToolType) {
    currentTool.value = tool
    rectStart.value = null
    lineStart.value = null
  }

  function setCurrentColorIndex(index: number) {
    if (pattern.value && pattern.value.palette.some((p) => p.index === index)) {
      // 如果在颜色替换模式中点击色板 → 选为目标色
      if (currentTool.value === 'replace' && replaceSourceIndex.value !== null) {
        _executeReplace(replaceSourceIndex.value, index)
        return
      }
      currentColorIndex.value = index
    }
  }

  function setViewport(v: Partial<ViewportState>) {
    viewport.value = { ...viewport.value, ...v }
  }

  // ---- 画笔绘制 (支持 brushSize) ----
  function paintCell(x: number, y: number): boolean {
    if (!pattern.value) return false
    const sz = currentTool.value === 'eraser' ? brushSize.value : brushSize.value
    const half = Math.floor(sz / 2)
    let anyChanged = false
    for (let dy = -half; dy < sz - half; dy++) {
      for (let dx = -half; dx < sz - half; dx++) {
        const px = x + dx
        const py = y + dy
        if (px < 0 || px >= pattern.value.width || py < 0 || py >= pattern.value.height) continue
        const newValue = currentTool.value === 'eraser' ? (pattern.value.palette[0]?.index ?? 0) : currentColorIndex.value
        const oldValue = pattern.value.grid[py][px]
        if (oldValue === newValue) continue
        const key = `${px},${py}`
        const existing = dirtyCells.value.get(key)
        if (existing) {
          existing.newValue = newValue
        } else {
          dirtyCells.value.set(key, { x: px, y: py, oldValue, newValue })
        }
        anyChanged = true
      }
    }
    return anyChanged
  }

  // ---- flush 脏格 ----
  function flushDirtyCells(): number {
    if (!pattern.value || dirtyCells.value.size === 0) return 0

    const { grid } = pattern.value
    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (const dc of dirtyCells.value.values()) {
      if (dc.oldValue === dc.newValue) continue
      grid[dc.y][dc.x] = dc.newValue
      _incColorCount(dc.oldValue, -1)
      _incColorCount(dc.newValue, 1)
      cells.push([dc.x, dc.y])
      prevValues.push(dc.oldValue)
      nextValues.push(dc.newValue)
    }

    const flushed = [...dirtyCells.value.values()].filter(dc => dc.oldValue !== dc.newValue)
    lastFlushedCells.value = flushed
    dirtyCells.value.clear()

    if (cells.length === 0) return 0

    renderVersion.value++

    history.value.push({
      cells, prevValues, nextValues,
      tool: currentTool.value === 'replace' ? 'replace' : currentTool.value,
      timestamp: Date.now(),
    })

    isDirty.value = true
    saveStatus.value = 'unsaved'
    return cells.length
  }

  // ---- 填充 ----
  function doFloodFill(x: number, y: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const fillValue = currentColorIndex.value
    const result = floodFill(grid, x, y, fillValue, width, height)
    if (result.cells.length === 0) return

    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []
    for (const [cx, cy] of result.cells) {
      cells.push([cx, cy])
      const old = pattern.value.grid[cy]?.[cx] ?? -1
      prevValues.push(old)
      nextValues.push(fillValue)
      _incColorCount(old, -1)
      _incColorCount(fillValue, 1)
    }

    for (const [cx, cy] of result.cells) {
      pattern.value.grid[cy][cx] = fillValue
    }

    history.value.push({
      cells, prevValues, nextValues,
      tool: 'fill', timestamp: Date.now(),
    })

    lastFlushedCells.value = result.cells.map(([cx, cy]) => ({ x: cx, y: cy, oldValue: -1, newValue: fillValue }))
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  // ---- 矩形 ----
  function doRectFill(x1: number, y1: number, x2: number, y2: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const minX = Math.max(0, Math.min(x1, x2))
    const maxX = Math.min(width - 1, Math.max(x1, x2))
    const minY = Math.max(0, Math.min(y1, y2))
    const maxY = Math.min(height - 1, Math.max(y1, y2))
    const fillValue = currentColorIndex.value

    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const oldVal = grid[cy][cx]
        if (oldVal !== fillValue) {
          cells.push([cx, cy])
          prevValues.push(oldVal)
          nextValues.push(fillValue)
          grid[cy][cx] = fillValue
          _incColorCount(oldVal, -1)
          _incColorCount(fillValue, 1)
        }
      }
    }

    if (cells.length === 0) return
    history.value.push({ cells, prevValues, nextValues, tool: 'rect', timestamp: Date.now() })
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  // ---- 直线 ----
  function doLine(x1: number, y1: number, x2: number, y2: number) {
    if (!pattern.value) return
    const { width, height, grid } = pattern.value
    const fillValue = currentColorIndex.value
    const brush = brushSize.value
    const half = Math.floor(brush / 2)

    const linePts: [number, number][] = []
    let x = x1, y = y1
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1
    let err = dx - dy
    while (true) {
      linePts.push([x, y])
      if (x === x2 && y === y2) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x += sx }
      if (e2 < dx) { err += dx; y += sy }
    }

    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []
    const seen = new Set<string>()

    for (const [lx, ly] of linePts) {
      for (let dy = -half; dy < brush - half; dy++) {
        for (let dx = -half; dx < brush - half; dx++) {
          const cx = lx + dx, cy = ly + dy
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
          const k = `${cx},${cy}`
          if (seen.has(k)) continue
          seen.add(k)
          const oldVal = grid[cy][cx]
          if (oldVal !== fillValue) {
            cells.push([cx, cy])
            prevValues.push(oldVal)
            nextValues.push(fillValue)
            grid[cy][cx] = fillValue
            _incColorCount(oldVal, -1)
            _incColorCount(fillValue, 1)
          }
        }
      }
    }

    if (cells.length === 0) return
    history.value.push({ cells, prevValues, nextValues, tool: 'line', timestamp: Date.now() })
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  // ---- 撤销 / 重做 ----
  function undo() {
    if (!pattern.value) return
    const entry = history.value.undo()
    if (!entry) return

    // P2-1: resize 撤销
    if (entry.resizeSnapshot) {
      restoreResizeSnapshot(entry.resizeSnapshot, true)
      return
    }

    if (entry.paletteChanges) {
      for (const pc of entry.paletteChanges) {
        const pe = pattern.value.palette.find((p) => p.index === pc.index)
        if (pe) pe.rgb = pc.oldRgb
      }
    } else {
      for (let i = 0; i < entry.cells.length; i++) {
        const [x, y] = entry.cells[i]
        const oldVal = entry.prevValues[i]
        const curVal = pattern.value.grid[y][x]
        _incColorCount(curVal, -1)
        _incColorCount(oldVal, 1)
        pattern.value.grid[y][x] = oldVal
      }
    }
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  function redo() {
    if (!pattern.value) return
    const entry = history.value.redo()
    if (!entry) return

    // P2-1: resize 重做
    if (entry.resizeSnapshot) {
      restoreResizeSnapshot(entry.resizeSnapshot, false)
      return
    }

    if (entry.paletteChanges) {
      for (const pc of entry.paletteChanges) {
        const pe = pattern.value.palette.find((p) => p.index === pc.index)
        if (pe) pe.rgb = pc.newRgb
      }
    } else {
      for (let i = 0; i < entry.cells.length; i++) {
        const [x, y] = entry.cells[i]
        const curVal = pattern.value.grid[y][x]
        _incColorCount(curVal, -1)
        _incColorCount(entry.nextValues[i], 1)
        pattern.value.grid[y][x] = entry.nextValues[i]
      }
    }
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  /** P2-1: 恢复 resize 快照到当前 pattern (undo 回退 / redo 重放) */
  function restoreResizeSnapshot(_snap: { width: number; height: number; grid: number[][] }, _isUndo: boolean) {
    if (!pattern.value) return
    // undo 时: 当前 = 新尺寸, 需恢复到旧尺寸。根据 snapshot 恢复尺寸和 grid。
    // redo 时: 在 redo push 前 snapshot 已交换, 直接恢复即可。
    // 简化: 直接恢复 pattern 到 snapshot 状态
    pattern.value.width = _snap.width
    pattern.value.height = _snap.height
    pattern.value.grid = _snap.grid
    _colorStatsDirty.value = true
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  // ---- 取色 ----
  function pickColor(x: number, y: number) {
    if (!pattern.value) return
    const idx = pattern.value.grid[y]?.[x]
    if (idx !== undefined && idx >= 0) {
      if (currentTool.value === 'replace' && replaceSourceIndex.value === null) {
        replaceSourceIndex.value = idx
      } else {
        currentColorIndex.value = idx
      }
    }
  }

  // ---- 色板编辑 (可撤销) ----
  function updatePaletteEntry(index: number, rgb: [number, number, number]) {
    if (!pattern.value) return
    const entry = pattern.value.palette.find((p) => p.index === index)
    if (entry) {
      const oldRgb = [...entry.rgb] as [number, number, number]
      entry.rgb = rgb
      history.value.push({
        cells: [],
        prevValues: [],
        nextValues: [],
        tool: 'brush',
        timestamp: Date.now(),
        paletteChanges: [{ index, oldRgb, newRgb: rgb }],
      })
      renderVersion.value++
      isDirty.value = true
      saveStatus.value = 'unsaved'
    }
  }

  // ---- 颜色替换 ----
  function _executeReplace(sourceIdx: number, targetIdx: number) {
    if (!pattern.value || sourceIdx === targetIdx) {
      replaceSourceIndex.value = null
      return
    }
    const { width, height, grid } = pattern.value
    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y][x] === sourceIdx) {
          cells.push([x, y])
          prevValues.push(sourceIdx)
          nextValues.push(targetIdx)
          grid[y][x] = targetIdx
          _incColorCount(sourceIdx, -1)
          _incColorCount(targetIdx, 1)
        }
      }
    }

    if (cells.length > 0) {
      history.value.push({
        cells, prevValues, nextValues,
        tool: 'replace', timestamp: Date.now(),
      })
      renderVersion.value++
      isDirty.value = true
      saveStatus.value = 'unsaved'
      replaceMessage.value = `已替换 ${cells.length} 格`
    } else {
      replaceMessage.value = '未找到可替换的颜色'
    }

    // 切换到目标色并回到画笔
    currentColorIndex.value = targetIdx
    replaceSourceIndex.value = null
    currentTool.value = 'brush'
  }

  function setReplaceSource(index: number) {
    if (!pattern.value) return
    replaceSourceIndex.value = index
  }

  function cancelReplace() {
    replaceSourceIndex.value = null
  }

  // ---- 图层操作 (P3-1) ----
  function initLayers() {
    if (!pattern.value) return
    layers.value = [{ name: '图层 1', visible: true, grid: pattern.value.grid }]
    activeLayerIndex.value = 0
  }

  function addLayer(name?: string) {
    if (!pattern.value) return
    const h = pattern.value.height, w = pattern.value.width
    const defaultIdx = pattern.value.palette[0]?.index ?? 0
    const newGrid = Array.from({ length: h }, () => Array(w).fill(defaultIdx))
    layers.value.push({ name: name ?? `图层 ${layers.value.length + 1}`, visible: true, grid: newGrid })
    activeLayerIndex.value = layers.value.length - 1
    pattern.value.grid = newGrid
    _colorStatsDirty.value = true
    renderVersion.value++
  }

  function setActiveLayer(index: number) {
    if (index < 0 || index >= layers.value.length || !pattern.value) return
    // 保存当前 layer 的 grid
    layers.value[activeLayerIndex.value].grid = pattern.value.grid
    activeLayerIndex.value = index
    pattern.value.grid = layers.value[index].grid
    _colorStatsDirty.value = true
    renderVersion.value++
  }

  function removeLayer(index: number) {
    if (layers.value.length <= 1 || !pattern.value) return
    layers.value.splice(index, 1)
    if (activeLayerIndex.value >= layers.value.length) {
      activeLayerIndex.value = layers.value.length - 1
    }
    pattern.value.grid = layers.value[activeLayerIndex.value].grid
    _colorStatsDirty.value = true
    renderVersion.value++
  }

  function toggleLayerVisibility(index: number) {
    if (index < 0 || index >= layers.value.length) return
    layers.value[index].visible = !layers.value[index].visible
    renderVersion.value++
  }

  function getCompositeGrid(): number[][] {
    // 从底到顶合成所有可见 layer
    if (layers.value.length === 0 && pattern.value) return pattern.value.grid
    const h = pattern.value?.height ?? 0
    const w = pattern.value?.width ?? 0
    const result = Array.from({ length: h }, () => Array(w).fill(-1))
    for (const layer of layers.value) {
      if (!layer.visible) continue
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (layer.grid[y]?.[x] !== undefined && layer.grid[y][x] >= 0) {
            result[y][x] = layer.grid[y][x]
          }
        }
      }
    }
    return result
  }

  // ---- 选区操作 (P2-2) ----
  function setSelection(sel: SelectionRect | null) {
    selection.value = sel
  }

  function setSelectStart(pos: { x: number; y: number } | null) {
    selectStart.value = pos
  }

  function getNormalizedSelection(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!selection.value || !pattern.value) return null
    const { x1, y1, x2, y2 } = selection.value
    return {
      minX: Math.max(0, Math.min(x1, x2)),
      minY: Math.max(0, Math.min(y1, y2)),
      maxX: Math.min(pattern.value.width - 1, Math.max(x1, x2)),
      maxY: Math.min(pattern.value.height - 1, Math.max(y1, y2)),
    }
  }

  function copySelection() {
    if (!pattern.value) return
    const n = getNormalizedSelection()
    if (!n) return
    const w = n.maxX - n.minX + 1
    const h = n.maxY - n.minY + 1
    const slice: number[][] = []
    for (let y = n.minY; y <= n.maxY; y++) {
      slice.push(pattern.value.grid[y].slice(n.minX, n.maxX + 1))
    }
    clipboard.value = { grid: slice, width: w, height: h }
  }

  function pasteSelection(pasteX: number, pasteY: number) {
    if (!pattern.value || !clipboard.value) return
    const { grid: slice, width: pw, height: ph } = clipboard.value
    const { width, height, grid } = pattern.value
    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (let dy = 0; dy < ph; dy++) {
      for (let dx = 0; dx < pw; dx++) {
        const cx = pasteX + dx, cy = pasteY + dy
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
        const nv = slice[dy][dx]
        const ov = grid[cy][cx]
        if (ov !== nv) {
          cells.push([cx, cy])
          prevValues.push(ov)
          nextValues.push(nv)
          grid[cy][cx] = nv
          _incColorCount(ov, -1)
          _incColorCount(nv, 1)
        }
      }
    }

    if (cells.length > 0) {
      history.value.push({ cells, prevValues, nextValues, tool: 'select', timestamp: Date.now() })
      renderVersion.value++
      isDirty.value = true
      saveStatus.value = 'unsaved'
    }
  }

  function deleteSelection() {
    if (!pattern.value) return
    const n = getNormalizedSelection()
    if (!n) return
    const defaultIdx = pattern.value.palette[0]?.index ?? 0
    const cells: [number, number][] = []
    const prevValues: number[] = []
    const nextValues: number[] = []

    for (let y = n.minY; y <= n.maxY; y++) {
      for (let x = n.minX; x <= n.maxX; x++) {
        const ov = pattern.value.grid[y][x]
        if (ov !== defaultIdx) {
          cells.push([x, y])
          prevValues.push(ov)
          nextValues.push(defaultIdx)
          pattern.value.grid[y][x] = defaultIdx
          _incColorCount(ov, -1)
          _incColorCount(defaultIdx, 1)
        }
      }
    }

    if (cells.length > 0) {
      history.value.push({ cells, prevValues, nextValues, tool: 'select', timestamp: Date.now() })
      renderVersion.value++
      isDirty.value = true
      saveStatus.value = 'unsaved'
    }
    selection.value = null
  }

  // ---- resize (P2-1: 保留历史) ----
  function resizePattern(
    newWidth: number, newHeight: number,
    fill: 'crop' | 'extend' | 'scale',
    anchor: 'top-left' | 'center'
  ) {
    if (!pattern.value) return
    const { width: oldW, height: oldH, grid, palette } = pattern.value
    const defaultIndex = palette.length > 0 ? palette[0].index : 0

    // P2-1: 保存 resize 前快照
    const snapshot = { width: oldW, height: oldH, grid: grid.map((row) => [...row]) }
    history.value.push({
      cells: [], prevValues: [], nextValues: [],
      tool: 'brush', timestamp: Date.now(),
      resizeSnapshot: snapshot,
    })

    const newGrid: number[][] = []
    if (fill === 'scale') {
      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        const srcY = Math.floor(y * oldH / newHeight)
        for (let x = 0; x < newWidth; x++) {
          row.push(grid[Math.min(srcY, oldH - 1)]?.[Math.floor(x * oldW / newWidth)] ?? defaultIndex)
        }
        newGrid.push(row)
      }
    } else if (fill === 'extend') {
      const offX = anchor === 'center' ? Math.floor((newWidth - oldW) / 2) : 0
      const offY = anchor === 'center' ? Math.floor((newHeight - oldH) / 2) : 0
      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        for (let x = 0; x < newWidth; x++) {
          const sx = x - offX, sy = y - offY
          row.push((sx >= 0 && sx < oldW && sy >= 0 && sy < oldH) ? grid[sy][sx] : defaultIndex)
        }
        newGrid.push(row)
      }
    } else {
      const offX = anchor === 'center' ? Math.floor((oldW - newWidth) / 2) : 0
      const offY = anchor === 'center' ? Math.floor((oldH - newHeight) / 2) : 0
      for (let y = 0; y < newHeight; y++) {
        const row: number[] = []
        for (let x = 0; x < newWidth; x++) {
          const sx = x + offX, sy = y + offY
          row.push((sx >= 0 && sx < oldW && sy >= 0 && sy < oldH) ? grid[sy][sx] : defaultIndex)
        }
        newGrid.push(row)
      }
    }

    pattern.value.grid = newGrid
    pattern.value.width = newWidth
    pattern.value.height = newHeight
    _colorStatsDirty.value = true
    renderVersion.value++
    isDirty.value = true
    saveStatus.value = 'unsaved'
  }

  // ---- 持久化 ----
  async function save(): Promise<boolean> {
    if (!pattern.value || !isDirty.value) return true
    saveStatus.value = 'saving'
    pattern.value.updatedAt = Date.now()
    pattern.value.bgColor = backgroundColor.value
    try {
      await db.savePattern(pattern.value)
      isDirty.value = false
      saveStatus.value = 'saved'
      return true
    } catch (e: any) {
      saveStatus.value = 'unsaved'
      return false
    }
  }

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
      loadPattern(clone)
      return clone
    } catch {
      return null
    }
  }

  return {
    pattern, viewport, currentTool, currentColorIndex, brushSize,
    showGrid, gridLabelMode, backgroundColor, legendStyle,
    isDirty, isSaving, saveStatus, hoverCell,
    gridAnimationProgress, renderVersion,
    history, rectStart, lineStart, replaceSourceIndex, replaceMessage,
    selection, selectStart, clipboard,
    layers, activeLayerIndex,
    canUndo, canRedo, currentColor, colorStats,
    initLayers, addLayer, setActiveLayer, removeLayer, toggleLayerVisibility, getCompositeGrid,
    loadPattern, setTool, setCurrentColorIndex, setViewport,
    dirtyCells, lastFlushedCells,
    paintCell, flushDirtyCells,
    doFloodFill, doRectFill, doLine,
    undo, redo, pickColor,
    updatePaletteEntry, setReplaceSource, cancelReplace,
    setSelection, setSelectStart, getNormalizedSelection,
    copySelection, pasteSelection, deleteSelection,
    resizePattern, save, saveAsNew,
  }
})
