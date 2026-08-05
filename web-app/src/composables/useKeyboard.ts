/**
 * 全局键盘快捷键
 */

import { onMounted, onUnmounted } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { lookupShortcut } from '@/utils/toolRegistry'

const legacyShortcuts: Record<string, string> = {}

export function useKeyboard() {
  const editor = useEditorStore()

  function handleKeyDown(e: KeyboardEvent) {
    // 在输入框内时不处理快捷键
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    const key = e.key.toLowerCase()

    // Ctrl+Z / Cmd+Z 撤销
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      editor.undo()
      return
    }

    // Ctrl+Shift+Z / Ctrl+Y 重做
    if ((e.ctrlKey || e.metaKey) && ((key === 'z' && e.shiftKey) || key === 'y')) {
      e.preventDefault()
      editor.redo()
      return
    }

    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      e.preventDefault()
      editor.save()
      return
    }

    // 工具快捷键 (P3-2: 从工具注册表查找)
    const tool = lookupShortcut(key)
    if (tool && !e.ctrlKey && !e.metaKey) {
      editor.setTool(tool)
      return
    }

    // 数字键切换颜色 (1-9)
    if (key >= '1' && key <= '9') {
      const idx = parseInt(key) - 1
      if (editor.pattern && idx < editor.pattern.palette.length) {
        editor.setCurrentColorIndex(editor.pattern.palette[idx].index)
      }
    }

    // G 切换网格
    if (key === 'g' && e.ctrlKey) {
      e.preventDefault()
      editor.showGrid = !editor.showGrid
    }

    // [ ] 调整画笔尺寸
    if (key === '[') {
      editor.brushSize = Math.max(1, editor.brushSize - 1) as 1 | 2 | 3 | 4
    }
    if (key === ']') {
      editor.brushSize = Math.min(4, editor.brushSize + 1) as 1 | 2 | 3 | 4
    }

    // Ctrl+C: 复制选区
    if ((e.ctrlKey || e.metaKey) && key === 'c' && editor.selection) {
      e.preventDefault()
      editor.copySelection()
      return
    }

    // Ctrl+V: 粘贴选区 (在 hover 位置)
    if ((e.ctrlKey || e.metaKey) && key === 'v' && editor.clipboard && editor.hoverCell) {
      e.preventDefault()
      editor.pasteSelection(editor.hoverCell.x, editor.hoverCell.y)
      return
    }

    // Delete: 删除选区内容
    if (key === 'delete' && editor.selection) {
      e.preventDefault()
      editor.deleteSelection()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
