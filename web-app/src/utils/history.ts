/**
 * 撤销/重做历史栈
 * 合并连续同类操作，上限约 200
 */

import type { HistoryEntry, ToolType } from '@/types'

const MAX_HISTORY = 200

export class HistoryStack {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  /** 推送一条操作记录 */
  push(entry: HistoryEntry): void {
    // 尝试与栈顶合并: 同类操作且间隔 < 2 秒
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && top.tool === entry.tool && (entry.timestamp - top.timestamp) < 2000) {
      // 合并: 追加 cells, 跳过已在合并记录中的重复 cell
      const existingKeys = new Set(top.cells)
      for (let i = 0; i < entry.cells.length; i++) {
        if (!existingKeys.has(entry.cells[i])) {
          top.cells.push(entry.cells[i])
          top.prevValues.push(entry.prevValues[i])
          top.nextValues.push(entry.nextValues[i])
          existingKeys.add(entry.cells[i])
        }
      }
      top.timestamp = entry.timestamp
    } else {
      this.undoStack.push(entry)
    }

    // 清空 redo
    this.redoStack = []

    // 上限裁剪
    while (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift()
    }
  }

  /** 撤销: 返回需要恢复的操作 */
  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop()
    if (entry) {
      this.redoStack.push(entry)
      return entry
    }
    return null
  }

  /** 重做: 返回需要重新执行的操作 */
  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop()
    if (entry) {
      this.undoStack.push(entry)
      return entry
    }
    return null
  }

  /** 是否有可撤销 */
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** 是否有可重做 */
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 清空历史 */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
