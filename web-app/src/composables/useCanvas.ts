/**
 * Canvas 交互逻辑 -- 缩放/平移/绘制
 *
 * 使用 Pointer Events + setPointerCapture 保证拖拽连续性;
 * 坐标运算均在逻辑/CSS 坐标系中。
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { useEditorStore } from '@/stores/editorStore'

export function useCanvas(canvasRef: Ref<HTMLCanvasElement | null>) {
  const editor = useEditorStore()
  const isPanning = ref(false)
  const pointerIsDown = ref(false)
  const lastPointerPos = ref({ x: 0, y: 0 })

  // rAF 批量合并
  let rafId: number | null = null

  function scheduleFlush() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      editor.flushDirtyCells()
    })
  }

  function forceFlush() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    editor.flushDirtyCells()
  }

  function screenToGrid(screenX: number, screenY: number): { x: number; y: number } | null {
    const canvas = canvasRef.value
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const canvasX = screenX - rect.left
    const canvasY = screenY - rect.top
    const cellSize = 16 * editor.viewport.zoom
    const gridX = Math.floor((canvasX - editor.viewport.offsetX) / cellSize)
    const gridY = Math.floor((canvasY - editor.viewport.offsetY) / cellSize)
    return { x: gridX, y: gridY }
  }

  // ---- Pointer Events (统一鼠标+触摸) ----

  function onPointerDown(e: PointerEvent) {
    if (!editor.pattern) return
    const canvas = canvasRef.value
    if (!canvas) return

    const pos = screenToGrid(e.clientX, e.clientY)

    if (editor.currentTool === 'move' || e.button === 1 || e.pointerType === 'touch') {
      // move 或中键: 平移模式
      if (editor.currentTool === 'move' || e.button === 1) {
        isPanning.value = true
        lastPointerPos.value = { x: e.clientX, y: e.clientY }
        canvas.setPointerCapture(e.pointerId)
        return
      }
    }

    if (pos && (e.button === 0 || e.pointerType === 'touch')) {
      pointerIsDown.value = true
      canvas.setPointerCapture(e.pointerId)

      if (editor.currentTool === 'fill') {
        editor.doFloodFill(pos.x, pos.y)
      } else if (editor.currentTool === 'eyedropper') {
        editor.pickColor(pos.x, pos.y)
      } else if (editor.currentTool === 'replace') {
        editor.pickColor(pos.x, pos.y)
      } else if (editor.currentTool === 'select') {
        // 选区: 开始拖拽框选
        editor.setSelectStart({ x: pos.x, y: pos.y })
        editor.setSelection({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      } else if (editor.currentTool === 'rect') {
        editor.rectStart = { x: pos.x, y: pos.y }
      } else if (editor.currentTool === 'line') {
        editor.lineStart = { x: pos.x, y: pos.y }
      } else {
        // brush / eraser
        editor.paintCell(pos.x, pos.y)
        scheduleFlush()
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!editor.pattern) return

    const pos = screenToGrid(e.clientX, e.clientY)
    editor.hoverCell = pos

    if (isPanning.value) {
      const dx = e.clientX - lastPointerPos.value.x
      const dy = e.clientY - lastPointerPos.value.y
      editor.setViewport({
        offsetX: editor.viewport.offsetX + dx,
        offsetY: editor.viewport.offsetY + dy,
      })
      lastPointerPos.value = { x: e.clientX, y: e.clientY }
      return
    }

    if (pointerIsDown.value && pos) {
      if (editor.currentTool === 'select' && editor.selectStart) {
        // 拖拽选区: 更新右下角
        editor.setSelection({ x1: editor.selectStart.x, y1: editor.selectStart.y, x2: pos.x, y2: pos.y })
      } else if (editor.currentTool === 'brush' || editor.currentTool === 'eraser') {
        editor.paintCell(pos.x, pos.y)
        scheduleFlush()
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    const canvas = canvasRef.value
    if (!canvas) return

    forceFlush()
    canvas.releasePointerCapture(e.pointerId)

    if (editor.currentTool === 'rect' && editor.rectStart) {
      const pos = screenToGrid(e.clientX, e.clientY)
      if (pos) {
        editor.doRectFill(editor.rectStart.x, editor.rectStart.y, pos.x, pos.y)
        editor.rectStart = null
      }
    }

    if (editor.currentTool === 'line' && editor.lineStart) {
      const pos = screenToGrid(e.clientX, e.clientY)
      if (pos) {
        editor.doLine(editor.lineStart.x, editor.lineStart.y, pos.x, pos.y)
        editor.lineStart = null
      }
    }

    pointerIsDown.value = false
    isPanning.value = false
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (!editor.pattern) return
    const canvas = canvasRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()

    const zoomFactor = 1.1
    const delta = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor
    const newZoom = Math.max(0.1, Math.min(20, editor.viewport.zoom * delta))

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const newOffsetX = mx - (mx - editor.viewport.offsetX) * (newZoom / editor.viewport.zoom)
    const newOffsetY = my - (my - editor.viewport.offsetY) * (newZoom / editor.viewport.zoom)

    editor.setViewport({ zoom: newZoom, offsetX: newOffsetX, offsetY: newOffsetY })
  }

  onMounted(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    // 禁止浏览器默认触摸行为 (双指缩放页面等)
    canvas.style.touchAction = 'none'
  })

  onUnmounted(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  })

  return { screenToGrid }
}
