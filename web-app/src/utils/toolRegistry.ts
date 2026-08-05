/**
 * 工具注册表 (P3-2: 插件化工具系统)
 *
 * 每个工具注册: type, icon, label, shortcut, handler 函数。
 * 替换 useCanvas 中硬编码的 if/else 链，新增工具只需 register() 即可。
 */
import type { ToolType, ToolHandler } from '@/types'

const registry = new Map<ToolType, ToolHandler>()

export function registerTool(handler: ToolHandler): void {
  registry.set(handler.type, handler)
}

export function getTool(type: ToolType): ToolHandler | undefined {
  return registry.get(type)
}

export function getAllTools(): ToolHandler[] {
  return [...registry.values()]
}

export function lookupShortcut(key: string): ToolType | undefined {
  for (const t of registry.values()) {
    if (t.shortcut.toLowerCase() === key.toLowerCase()) {
      return t.type
    }
  }
  return undefined
}

/** 注册内置工具集 */
export function registerDefaultTools(): void {
  registerTool({
    type: 'brush', icon: 'brush', label: '画笔', shortcut: 'B',
    onPointerDown(pos, editor) { editor.paintCell(pos.x, pos.y) },
    onPointerMove(pos, editor) { editor.paintCell(pos.x, pos.y) },
  })
  registerTool({
    type: 'eraser', icon: 'eraser', label: '橡皮', shortcut: 'E',
    onPointerDown(pos, editor) { editor.paintCell(pos.x, pos.y) },
    onPointerMove(pos, editor) { editor.paintCell(pos.x, pos.y) },
  })
  registerTool({
    type: 'fill', icon: 'fill', label: '填充', shortcut: 'G',
    onPointerDown(pos, editor) { editor.doFloodFill(pos.x, pos.y) },
  })
  registerTool({
    type: 'eyedropper', icon: 'eyedropper', label: '取色器', shortcut: 'I',
    onPointerDown(pos, editor) { editor.pickColor(pos.x, pos.y) },
  })
  registerTool({
    type: 'replace', icon: 'replace', label: '替换', shortcut: 'X',
    onPointerDown(pos, editor) { editor.pickColor(pos.x, pos.y) },
  })
  registerTool({
    type: 'select', icon: 'crosshair', label: '选区', shortcut: 'S',
    onPointerDown(pos, editor) {
      editor.setSelectStart({ x: pos.x, y: pos.y })
      editor.setSelection({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
    },
    onPointerMove(pos, editor) {
      if (editor.selectStart) {
        editor.setSelection({ x1: editor.selectStart.x, y1: editor.selectStart.y, x2: pos.x, y2: pos.y })
      }
    },
  })
  registerTool({
    type: 'rect', icon: 'rect', label: '矩形', shortcut: 'R',
    onPointerDown(pos, editor) { editor.rectStart = { x: pos.x, y: pos.y } },
    onPointerUp(pos, editor) {
      if (editor.rectStart) {
        editor.doRectFill(editor.rectStart.x, editor.rectStart.y, pos.x, pos.y)
        editor.rectStart = null
      }
    },
  })
  registerTool({
    type: 'line', icon: 'line', label: '直线', shortcut: 'L',
    onPointerDown(pos, editor) { editor.lineStart = { x: pos.x, y: pos.y } },
    onPointerUp(pos, editor) {
      if (editor.lineStart) {
        editor.doLine(editor.lineStart.x, editor.lineStart.y, pos.x, pos.y)
        editor.lineStart = null
      }
    },
  })
  registerTool({
    type: 'move', icon: 'move', label: '平移', shortcut: 'H',
    // move 工具由 useCanvas 的 isPanning 逻辑处理
  })
}
