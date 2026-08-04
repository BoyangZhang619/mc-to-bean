/**
 * 全局键盘快捷键
 */

import { onMounted, onUnmounted } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import type { ToolType } from '@/types'

const toolShortcuts: Record<string, ToolType> = {
  'b': 'brush',
  'e': 'eraser',
  'g': 'fill',
  'i': 'eyedropper',
  'r': 'rect',
  'l': 'line',
  'h': 'move',
}

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

    // 工具快捷键
    if (toolShortcuts[key] && !e.ctrlKey && !e.metaKey) {
      editor.setTool(toolShortcuts[key])
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
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
