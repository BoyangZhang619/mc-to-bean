/** 调色板条目 */
export interface PaletteEntry {
  index: number
  rgb: [number, number, number]
  code?: string | null
  name?: string | null
  delta?: number
  beadRgb?: [number, number, number] | null
}

/** 图纸文档 */
export interface Pattern {
  id: string
  name: string
  width: number
  height: number
  cellSizeMm: number
  palette: PaletteEntry[]
  grid: number[][]
  bgColor?: string
  createdAt: number
  updatedAt: number
}

/** 契约 JSON 顶层结构 */
export interface ContractJson {
  name: string
  width: number
  height: number
  cell_size_mm: number
  palette: {
    index: number
    rgb: [number, number, number]
    code?: string | null
    name?: string | null
    delta?: number
    bead_rgb?: [number, number, number] | null
  }[]
  grid: number[][]
  bgColor?: string
}

/** IndexedDB 设置 */
export interface AppSettings {
  key: string
  value: any
}

/** 编辑器工具类型 */
export type ToolType =
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'rect'
  | 'line'
  | 'move'
  | 'replace'
  | 'select'

/** 历史记录条目 */
export interface HistoryEntry {
  /** 被修改的坐标集: [x, y] 元组数组 (markRaw 防深层响应式) */
  cells: [number, number][]
  /** 修改前的值 */
  prevValues: number[]
  /** 修改后的值 */
  nextValues: number[]
  /** 工具类型，用于合并连续同类操作 */
  tool: ToolType
  /** 时间戳 */
  timestamp: number
  /** 色板变更 (仅 palette 编辑操作使用) */
  paletteChanges?: { index: number; oldRgb: [number, number, number]; newRgb: [number, number, number] }[]
  /** resize 快照: 保存 resize 前的 pattern 完整状态以便撤销 */
  resizeSnapshot?: ResizeSnapshot
}

/** resize 前的完整快照 */
export interface ResizeSnapshot {
  width: number
  height: number
  grid: number[][]
}

/** 画笔尺寸 */
export type BrushSize = 1 | 2 | 3 | 4

/** 编辑器缩放状态 */
export interface ViewportState {
  offsetX: number
  offsetY: number
  zoom: number
}

/** Resize 方向 */
export type ResizeAnchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

/** Resize 填充策略 */
export type ResizeFill = 'crop' | 'extend' | 'scale'

/** 选区范围 */
export interface SelectionRect {
  x1: number; y1: number; x2: number; y2: number
}

/** 图层定义 */
export interface Layer {
  name: string
  grid: number[][]
  visible: boolean
}

/** 工具处理器接口 (P3-2: 工具注册表) */
export interface ToolHandler {
  type: ToolType
  icon: string
  label: string
  shortcut: string
  onPointerDown?(pos: { x: number; y: number }, editor: any): void
  onPointerMove?(pos: { x: number; y: number }, editor: any): void
  onPointerUp?(pos: { x: number; y: number }, editor: any): void
}
