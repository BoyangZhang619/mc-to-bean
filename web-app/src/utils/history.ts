/**
 * 撤销/重做历史栈
 * 合并连续同类操作，上限 200
 * cells: [x, y] 元组 (markRaw 防深层响应式)
 */

import type { HistoryEntry, ToolType } from '@/types'

const MAX_HISTORY = 200

export class HistoryStack {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  /** 推送一条操作记录 */
  push(entry: HistoryEntry): void {
    // 调色板变更不合并，直接入栈
    if (entry.paletteChanges) {
      this.undoStack.push(entry)
      this.redoStack = []
      this.trimUndo()
      return
    }

    // 尝试与栈顶合并: 同类 grid 操作且间隔 < 2 秒
    const top = this.undoStack[this.undoStack.length - 1]
    if (
      top &&
      !top.paletteChanges &&
      top.tool === entry.tool &&
      (entry.timestamp - top.timestamp) < 2000
    ) {
      const existingKeys = new Set(top.cells.map(([x, y]) => `${x},${y}`))
      for (let i = 0; i < entry.cells.length; i++) {
        const [x, y] = entry.cells[i]
        const key = `${x},${y}`
        if (!existingKeys.has(key)) {
          top.cells.push([x, y])
          top.prevValues.push(entry.prevValues[i])
          top.nextValues.push(entry.nextValues[i])
          existingKeys.add(key)
        }
      }
      top.timestamp = entry.timestamp
    } else {
      this.undoStack.push(entry)
    }

    this.redoStack = []
    this.trimUndo()
  }

  private trimUndo() {
    while (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift()
    }
  }

  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop()
    if (entry) {
      this.redoStack.push(entry)
      return entry
    }
    return null
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop()
    if (entry) {
      this.undoStack.push(entry)
      return entry
    }
    return null
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
