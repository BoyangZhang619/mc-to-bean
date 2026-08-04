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

/** 历史记录条目 */
export interface HistoryEntry {
  /** 被修改的坐标集 (压缩存储: "x,y" 字符串数组) */
  cells: string[]
  /** 修改前的值 */
  prevValues: number[]
  /** 修改后的值 */
  nextValues: number[]
  /** 工具类型，用于合并连续同类操作 */
  tool: ToolType
  /** 时间戳 */
  timestamp: number
}

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
