<script setup lang="ts">
/**
 * 画布组件 -- 离屏 canvas + 主 canvas 架构
 * 离屏: 完整静态图纸 (格子+背景+网格线)
 * 主: 每帧 drawImage 离屏 + overlay
 */
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import {
  createOffscreen, updateOffscreenCells, rebuildOffscreenColors,
  paintFromOffscreen, paintOverlay, type OffscreenData
} from '@/utils/renderer'
import { useCanvas } from '@/composables/useCanvas'

const editor = useEditorStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const canvasSize = ref({ width: 0, height: 0 })

// 离屏 canvas
const offscreen = ref<OffscreenData | null>(null)

const { screenToGrid } = useCanvas(canvasRef)
const currentCell = computed(() => editor.hoverCell)

let resizeObserver: ResizeObserver | null = null

function updateCanvasSize() {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvasSize.value = {
    width: Math.floor(rect.width * dpr),
    height: Math.floor(rect.height * dpr),
  }
}

/** 创建/重建离屏 (pattern 加载、背景色/网格切换时调用) */
function buildOffscreen() {
  if (!editor.pattern) { offscreen.value = null; return }
  offscreen.value = createOffscreen(editor.pattern, {
    showGrid: editor.showGrid,
    gridColor: 'rgba(0,0,0,0.12)',
    backgroundColor: editor.backgroundColor,
  })
}

/** 增量更新离屏: 读取 lastFlushedCells 中的格子 */
function applyDirtyToOffscreen() {
  if (!offscreen.value || !editor.pattern) return
  const flushed = editor.lastFlushedCells
  if (flushed.length === 0) return
  const cells: { x: number; y: number; idx: number }[] = []
  for (const dc of flushed) {
    cells.push({ x: dc.x, y: dc.y, idx: dc.newValue })
  }
  if (cells.length > 0) {
    updateOffscreenCells(offscreen.value, cells, editor.backgroundColor)
  }
  editor.lastFlushedCells = []
}

/** 渲染主 canvas */
function render() {
  const canvas = canvasRef.value
  if (!canvas || !editor.pattern || !offscreen.value) return

  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1

  canvas.width = canvasSize.value.width
  canvas.height = canvasSize.value.height
  canvas.style.width = `${canvasSize.value.width / dpr}px`
  canvas.style.height = `${canvasSize.value.height / dpr}px`

  // 1. 离屏 → 主 canvas
  paintFromOffscreen(ctx, offscreen.value, editor.viewport,
    canvasSize.value.width, canvasSize.value.height, dpr, editor.backgroundColor)

  // 2. Overlay (悬停十字、rect/line 预览)
  paintOverlay(ctx, editor.viewport, {
    showGrid: editor.showGrid,
    gridColor: 'rgba(0,0,0,0.12)',
    backgroundColor: editor.backgroundColor,
    hoverCell: editor.hoverCell,
    tool: editor.currentTool,
    rectStart: editor.rectStart,
    lineStart: editor.lineStart,
  }, dpr)
}

// 监听: 需要全量重建离屏的场景
watch(
  () => [editor.pattern?.id, editor.showGrid, editor.backgroundColor],
  () => { buildOffscreen() },
)

// 监听: editor.palette 编辑后重建离屏 (颜色变了)
watch(
  () => editor.pattern?.palette,
  () => {
    if (offscreen.value && editor.pattern) {
      rebuildOffscreenColors(offscreen.value, editor.pattern, editor.backgroundColor, editor.showGrid, 'rgba(0,0,0,0.12)')
    }
  },
  { deep: true }
)

// 监听: renderVersion 变化 = 更新离屏
// lastFlushedCells 非空 → 增量; 为空 → 全量重建 (batch 操作)
watch(
  () => editor.renderVersion,
  () => {
    if (editor.lastFlushedCells.length > 0) {
      applyDirtyToOffscreen()
    } else {
      buildOffscreen()
    }
  },
)

// 监听: viewport/hover/preview 变化 → 仅重绘主 canvas overlay
watch(
  () => [editor.renderVersion, editor.viewport, editor.hoverCell, editor.rectStart, editor.lineStart],
  () => { requestAnimationFrame(render) },
  { deep: true }
)

// 每 16ms 轻量刷新 overlay (十字光标丝滑跟随)
let overlayTimer: ReturnType<typeof setInterval> | null = null

function zoomToFit() {
  if (!containerRef.value || !editor.pattern) return
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const pad = Math.max(40, Math.min(rect.width, rect.height) * 0.08)
  const availW = rect.width - pad * 2; const availH = rect.height - pad * 2
  const pw = editor.pattern.width * 16; const ph = editor.pattern.height * 16
  const zoom = Math.min(availW / pw, availH / ph, 8, Math.max(1, Math.max(pw, ph) / 100))
  editor.setViewport({
    zoom: Math.max(0.1, zoom),
    offsetX: (rect.width - pw * zoom) / 2,
    offsetY: (rect.height - ph * zoom) / 2,
  })
}

let initialFitDone = false

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateCanvasSize()
      nextTick(render)
      if (!initialFitDone && containerRef.value) {
        const r = containerRef.value.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) { initialFitDone = true; zoomToFit() }
      }
    })
    resizeObserver.observe(containerRef.value)
  }
  updateCanvasSize()
  buildOffscreen()
  nextTick(() => {
    render()
    setTimeout(() => { if (!initialFitDone) { initialFitDone = true; zoomToFit() } }, 200)
  })
  // overlay 十字光标轻量刷新
  overlayTimer = setInterval(render, 33) // ~30fps overlay
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null }
})

defineExpose({ screenToGrid, render, zoomToFit })
</script>

<template>
  <div ref="containerRef" class="canvas-container">
    <canvas ref="canvasRef" class="canvas-element"
      :style="{ cursor: editor.currentTool === 'move' ? 'grab' : 'crosshair' }" />
    <div v-if="currentCell" class="cell-coords">
      <span class="coords-text">{{ currentCell.x }}, {{ currentCell.y }}</span>
    </div>
    <div class="zoom-indicator">
      <span class="zoom-text">{{ Math.round(editor.viewport.zoom * 100) }}%</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.canvas-container { flex: 1; position: relative; overflow: hidden; background: $color-bg; min-width: 0; min-height: 0; }
.canvas-element { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.cell-coords { position: absolute; top: 8px; left: 8px; background: rgba(17,17,17,0.75); padding: 4px 10px; border-radius: $radius-sm;
  .coords-text { color: $color-white; font-size: 12px; font-family: monospace; letter-spacing: 0.5px; } }
.zoom-indicator { position: absolute; bottom: 8px; right: 8px; background: rgba(17,17,17,0.75); padding: 4px 10px; border-radius: $radius-sm;
  .zoom-text { color: $color-white; font-size: 12px; font-family: monospace; } }
</style>
