<script setup lang="ts">
/**
 * 图纸预览页 -- Web 风格可视化预览
 *
 * 布局: PC 左侧数据面板 + 中央画布 | 移动端 画布 + 底部可展开统计
 * 特色: 大画布网格缩放平移、横向条形图豆色分布、只读查看
 */
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePatternStore } from '@/stores/patternStore'
import type { Pattern } from '@/types'
import { groupByBeadCode } from '@/utils/renderer'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const store = usePatternStore()

const pattern = ref<Pattern | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// 画布
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const viewport = ref({ offsetX: 0, offsetY: 0, zoom: 1 })
const isPanning = ref(false)
const lastPan = ref({ x: 0, y: 0 })

// 移动端统计面板
const showMobileStats = ref(false)

// 条形图生长动画
const barAnimReady = ref(false)

const BASE_CELL = 16

// ---- 颜色统计 (按豆号合并分组, 对齐图例合并) ----
const colorStats = computed(() => {
  if (!pattern.value) return [] as Array<{ code: string | null; swatchColor: [number, number, number]; name: string | null; count: number; percentage: number; serial: number }>
  const total = pattern.value.width * pattern.value.height
  const groups = groupByBeadCode(pattern.value.palette, pattern.value.grid)
  return groups
    .filter((g) => g.count > 0)
    .map((g) => ({
      code: g.code,
      swatchColor: g.swatchColor,
      name: g.name,
      count: g.count,
      percentage: total > 0 ? (g.count / total) * 100 : 0,
      serial: g.serial,
    }))
})

// 条形图最大值
const maxCount = computed(() => {
  if (colorStats.value.length === 0) return 1
  return colorStats.value[0].count
})

function barWidth(count: number): string {
  return barAnimReady.value
    ? `${Math.max(2, (count / maxCount.value) * 100)}%`
    : '0%'
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function goEdit() {
  if (pattern.value) {
    router.push(`/editor/${pattern.value.id}`)
  }
}

// ---- Canvas 渲染 ----
function render() {
  const canvas = canvasRef.value
  if (!canvas || !containerRef.value || !pattern.value) return

  const dpr = window.devicePixelRatio || 1
  const rect = containerRef.value.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`

  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const cw = rect.width
  const ch = rect.height

  // 背景
  ctx.fillStyle = '#f8f8f8'
  ctx.fillRect(0, 0, cw, ch)

  const { offsetX, offsetY, zoom } = viewport.value
  const cellSize = BASE_CELL * zoom
  const { width, height, grid, palette } = pattern.value

  const cm = new Map<number, [number, number, number]>()
  for (const p of palette) cm.set(p.index, p.rgb)

  const gridW = width * cellSize
  const gridH = height * cellSize

  // 画布居中
  const px = offsetX + (cw - gridW) / 2
  const py = offsetY + (ch - gridH) / 2

  ctx.save()

  // 网格阴影
  ctx.shadowColor = 'rgba(0,0,0,0.08)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#fff'
  ctx.fillRect(px - 4, py - 4, gridW + 8, gridH + 8)
  ctx.shadowColor = 'transparent'

  // 格子
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid[y][x]
      const rgb = cm.get(idx) ?? [255, 255, 255]
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
      ctx.fillRect(
        Math.floor(px + x * cellSize),
        Math.floor(py + y * cellSize),
        Math.ceil(cellSize) + 0.5,
        Math.ceil(cellSize) + 0.5,
      )
    }
  }

  // 网格线 (缩放到足够大时显示)
  if (cellSize >= 8) {
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = 0; x <= width; x++) {
      const lx = Math.floor(px + x * cellSize) + 0.5
      ctx.moveTo(lx, Math.floor(py))
      ctx.lineTo(lx, Math.floor(py + gridH))
    }
    for (let y = 0; y <= height; y++) {
      const ly = Math.floor(py + y * cellSize) + 0.5
      ctx.moveTo(Math.floor(px), ly)
      ctx.lineTo(Math.floor(px + gridW), ly)
    }
    ctx.stroke()
  }

  ctx.restore()
}

// ---- 交互 ----
function onPointerDown(e: PointerEvent) {
  if (!pattern.value) return
  const canvas = canvasRef.value
  if (!canvas) return
  isPanning.value = true
  lastPan.value = { x: e.clientX, y: e.clientY }
  canvas.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isPanning.value || !pattern.value) return
  const dx = e.clientX - lastPan.value.x
  const dy = e.clientY - lastPan.value.y
  viewport.value = {
    ...viewport.value,
    offsetX: viewport.value.offsetX + dx,
    offsetY: viewport.value.offsetY + dy,
  }
  lastPan.value = { x: e.clientX, y: e.clientY }
  requestAnimationFrame(render)
}

function onPointerUp(e: PointerEvent) {
  isPanning.value = false
  const canvas = canvasRef.value
  if (canvas) canvas.releasePointerCapture(e.pointerId)
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (!pattern.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()

  const factor = 1.1
  const delta = e.deltaY > 0 ? 1 / factor : factor
  const newZoom = Math.max(0.25, Math.min(32, viewport.value.zoom * delta))

  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const newOffsetX = mx - (mx - viewport.value.offsetX) * (newZoom / viewport.value.zoom)
  const newOffsetY = my - (my - viewport.value.offsetY) * (newZoom / viewport.value.zoom)

  viewport.value = { zoom: newZoom, offsetX: newOffsetX, offsetY: newOffsetY }
  requestAnimationFrame(render)
}

function zoomToFit() {
  if (!pattern.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const pad = 80
  const pw = pattern.value.width * BASE_CELL
  const ph = pattern.value.height * BASE_CELL
  const zoom = Math.min((rect.width - pad) / pw, (rect.height - pad) / ph, 8)
  viewport.value = {
    zoom: Math.max(0.25, zoom),
    offsetX: 0,
    offsetY: 0,
  }
}

let resizeObs: ResizeObserver | null = null
let initialFit = false

onMounted(async () => {
  const id = route.params.id as string
  try {
    const p = await store.getById(id)
    if (!p) {
      error.value = '图纸不存在'
      loading.value = false
      return
    }
    pattern.value = p
  } catch (e: any) {
    error.value = `加载失败: ${e.message}`
  } finally {
    loading.value = false
  }

  await nextTick()
  if (containerRef.value) {
    resizeObs = new ResizeObserver(() => {
      if (!initialFit && containerRef.value) {
        const r = containerRef.value.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          initialFit = true
          zoomToFit()
        }
      }
      requestAnimationFrame(render)
    })
    resizeObs.observe(containerRef.value)
  }

  // 条形图延迟动画
  setTimeout(() => { barAnimReady.value = true }, 300)

  if (canvasRef.value) {
    canvasRef.value.addEventListener('pointerdown', onPointerDown)
    canvasRef.value.addEventListener('pointermove', onPointerMove)
    canvasRef.value.addEventListener('pointerup', onPointerUp)
    canvasRef.value.addEventListener('pointerleave', onPointerUp)
    canvasRef.value.addEventListener('wheel', onWheel, { passive: false })
    canvasRef.value.addEventListener('contextmenu', (e) => e.preventDefault())
    canvasRef.value.style.touchAction = 'none'
  }
})

onUnmounted(() => {
  resizeObs?.disconnect()
  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', onPointerDown)
    canvasRef.value.removeEventListener('pointermove', onPointerMove)
    canvasRef.value.removeEventListener('pointerup', onPointerUp)
    canvasRef.value.removeEventListener('pointerleave', onPointerUp)
    canvasRef.value.removeEventListener('wheel', onWheel)
  }
})
</script>

<template>
  <div class="preview-view" :class="{ 'preview-loaded': !loading }">
    <!-- 加载态 -->
    <div v-if="loading" class="preview-loading">
      <div class="loading-spinner" />
      <span>加载图纸中...</span>
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="preview-error">
      <Icon name="warning" :size="48" color="#888" />
      <p>{{ error }}</p>
      <button class="btn-back" @click="router.push('/gallery')">返回图纸库</button>
    </div>

    <!-- 主内容 -->
    <template v-else-if="pattern">
      <!-- 顶部信息栏 -->
      <div class="preview-topbar">
        <div class="topbar-left">
          <button class="back-btn" @click="router.push('/gallery')" title="返回图纸库">
            <Icon name="arrow-left" :size="18" />
          </button>
          <div class="title-area">
            <h1 class="pattern-name">{{ pattern.name }}</h1>
            <span class="pattern-meta">
              {{ pattern.width }} x {{ pattern.height }}
              | {{ pattern.palette.length }} 色
              | 更新于 {{ formatDate(pattern.updatedAt) }}
            </span>
          </div>
        </div>
        <div class="topbar-right">
          <button class="action-btn" @click="zoomToFit" title="适应窗口">
            <Icon name="expand" :size="16" />
            <span>适应</span>
          </button>
          <button class="action-btn primary" @click="goEdit" title="去编辑">
            <Icon name="brush" :size="16" />
            <span>去编辑</span>
          </button>
        </div>
      </div>

      <!-- 主体: PC 侧栏 + 中央画布 -->
      <div class="preview-main">
        <!-- 左侧数据面板 (PC) -->
        <aside class="data-panel desktop-panel">
          <!-- 图纸信息 -->
          <section class="stats-section">
            <h3 class="stat-section-title">图纸信息</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">尺寸</span>
                <span class="info-value">{{ pattern.width }} x {{ pattern.height }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">格数</span>
                <span class="info-value">{{ (pattern.width * pattern.height).toLocaleString() }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">颜色数</span>
                <span class="info-value">{{ colorStats.length }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">单元尺寸</span>
                <span class="info-value">{{ pattern.cellSizeMm }}mm</span>
              </div>
            </div>
          </section>

          <!-- 豆色分布条形图 -->
          <section class="stats-section">
            <h3 class="stat-section-title">
              颜色分布
              <span class="stat-subtitle">({{ colorStats.length }} 色)</span>
            </h3>
            <div class="bar-chart">
              <div
                v-for="(item, i) in colorStats"
                :key="item.serial"
                class="bar-row"
                :style="{ transitionDelay: barAnimReady ? `${i * 40}ms` : '0ms' }"
              >
                <div
                  class="bar-swatch"
                  :style="{ background: `rgb(${item.swatchColor.join(',')})` }"
                />
                <div class="bar-info">
                  <span class="bar-code" v-if="item.code">{{ item.code }}</span>
                  <span class="bar-name" v-else>#{{ item.serial }}</span>
                  <span class="bar-rgb">RGB({{ item.swatchColor.join(',') }})</span>
                </div>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: barWidth(item.count),
                      background: `rgb(${item.swatchColor.join(',')})`,
                    }"
                  />
                </div>
                <div class="bar-nums">
                  <span class="bar-count">{{ item.count }}</span>
                  <span class="bar-pct">{{ item.percentage.toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </section>

          <!-- 调色板列表 -->
          <section class="stats-section">
            <h3 class="stat-section-title">调色板</h3>
            <div class="palette-list">
              <div
                v-for="p in pattern.palette"
                :key="p.index"
                class="palette-row"
              >
                <div
                  class="palette-swatch"
                  :style="{ background: `rgb(${p.rgb.join(',')})` }"
                />
                <div class="palette-info">
                  <span class="palette-idx">#{{ p.index }}</span>
                  <span v-if="p.code" class="palette-code">{{ p.code }}</span>
                  <span v-if="p.name" class="palette-name">{{ p.name }}</span>
                </div>
                <span class="palette-rgb">RGB({{ p.rgb.join(',') }})</span>
              </div>
            </div>
          </section>
        </aside>

        <!-- 中央画布 -->
        <div ref="containerRef" class="canvas-area">
          <canvas ref="canvasRef" class="preview-canvas" />

          <div class="zoom-badge">
            {{ Math.round(viewport.zoom * 100) }}%
          </div>

          <button
            class="mobile-stats-fab mobile-only"
            @click="showMobileStats = !showMobileStats"
          >
            <Icon :name="showMobileStats ? 'close' : 'info'" :size="20" />
          </button>
        </div>
      </div>

      <!-- 移动端: 底部可展开统计面板 -->
      <Transition name="slide-up-panel">
        <div v-if="showMobileStats" class="mobile-stats-panel mobile-only">
          <div class="panel-handle" @click="showMobileStats = false">
            <div class="handle-bar" />
          </div>

          <!-- 图纸信息 (移动端复用) -->
          <section class="stats-section">
            <h3 class="stat-section-title">图纸信息</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">尺寸</span>
                <span class="info-value">{{ pattern.width }} x {{ pattern.height }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">格数</span>
                <span class="info-value">{{ (pattern.width * pattern.height).toLocaleString() }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">颜色数</span>
                <span class="info-value">{{ colorStats.length }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">单元尺寸</span>
                <span class="info-value">{{ pattern.cellSizeMm }}mm</span>
              </div>
            </div>
          </section>

          <section class="stats-section">
            <h3 class="stat-section-title">
              颜色分布
              <span class="stat-subtitle">({{ colorStats.length }} 色)</span>
            </h3>
            <div class="bar-chart">
              <div
                v-for="(item, i) in colorStats"
                :key="'m' + item.serial"
                class="bar-row"
                :style="{ transitionDelay: barAnimReady ? `${i * 40}ms` : '0ms' }"
              >
                <div
                  class="bar-swatch"
                  :style="{ background: `rgb(${item.swatchColor.join(',')})` }"
                />
                <div class="bar-info">
                  <span class="bar-code" v-if="item.code">{{ item.code }}</span>
                  <span class="bar-name" v-else>#{{ item.serial }}</span>
                  <span class="bar-rgb">RGB({{ item.swatchColor.join(',') }})</span>
                </div>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: barWidth(item.count),
                      background: `rgb(${item.swatchColor.join(',')})`,
                    }"
                  />
                </div>
                <div class="bar-nums">
                  <span class="bar-count">{{ item.count }}</span>
                  <span class="bar-pct">{{ item.percentage.toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </section>

          <section class="stats-section">
            <h3 class="stat-section-title">调色板</h3>
            <div class="palette-list">
              <div
                v-for="p in pattern.palette"
                :key="p.index"
                class="palette-row"
              >
                <div
                  class="palette-swatch"
                  :style="{ background: `rgb(${p.rgb.join(',')})` }"
                />
                <div class="palette-info">
                  <span class="palette-idx">#{{ p.index }}</span>
                  <span v-if="p.code" class="palette-code">{{ p.code }}</span>
                  <span v-if="p.name" class="palette-name">{{ p.name }}</span>
                </div>
                <span class="palette-rgb">RGB({{ p.rgb.join(',') }})</span>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped lang="scss">
// ==============================
// 页面级
// ==============================
.preview-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.35s ease;

  &.preview-loaded {
    opacity: 1;
  }
}

.preview-loading,
.preview-error {
  @include flex-center;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  color: $color-mid;
  font-size: 14px;
}

.preview-error p {
  max-width: 400px;
  text-align: center;
}

.btn-back {
  padding: 8px 20px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 13px;
  color: $color-text-secondary;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    background: $color-black;
    color: $color-white;
    border-color: $color-black;
  }
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

// ==============================
// 顶部栏
// ==============================
.preview-topbar {
  height: 48px;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  z-index: 10;
  animation: fadeInUp 0.4s ease;

  @include mobile {
    padding: 0 12px;
  }
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  @include flex-center;
  border-radius: $radius-sm;
  color: $color-mid-dark;
  flex-shrink: 0;

  &:hover {
    background: $color-bg;
    color: $color-black;
  }
}

.title-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pattern-name {
  font-size: 14px;
  font-weight: 600;
  @include text-ellipsis;
}

.pattern-meta {
  font-size: 11px;
  color: $color-mid;
  font-family: monospace;
}

.topbar-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  @include flex-center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: $radius-sm;
  font-size: 13px;
  color: $color-text-secondary;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
    color: $color-black;
  }

  &.primary {
    background: $color-black;
    color: $color-white;

    &:hover {
      background: $color-dark;
    }
  }

  @include mobile {
    padding: 6px 10px;
    font-size: 12px;
  }
}

// ==============================
// 主体布局
// ==============================
.preview-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;

  @include mobile {
    flex-direction: column;
  }
}

// ==============================
// 画布区域
// ==============================
.canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f8f8f8;
  min-width: 0;
  min-height: 0;
}

.preview-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.zoom-badge {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: rgba(17, 17, 17, 0.75);
  color: #fff;
  font-size: 11px;
  font-family: monospace;
  padding: 4px 10px;
  border-radius: $radius-sm;
}

.mobile-stats-fab {
  position: absolute;
  bottom: 12px;
  left: 12px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: $color-white;
  border: 1px solid $color-light;
  @include flex-center;
  box-shadow: $shadow-md;
  z-index: 5;
  color: $color-mid-dark;

  &:hover {
    background: $color-black;
    color: $color-white;
    border-color: $color-black;
  }
}

// ==============================
// 数据面板 (PC 侧栏)
// ==============================
.data-panel {
  width: 300px;
  background: $color-white;
  border-right: 1px solid $color-light;
  overflow-y: auto;
  @include scrollbar-thin;
  flex-shrink: 0;
  padding: 16px;

  &.desktop-panel {
    @include mobile {
      display: none;
    }
  }
}

// ==============================
// 移动端统计面板
// ==============================
.mobile-stats-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 55vh;
  background: $color-white;
  border-top: 1px solid $color-light;
  border-radius: $radius-lg $radius-lg 0 0;
  box-shadow: $shadow-lg;
  z-index: 50;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 0 16px 16px;
}

.panel-handle {
  @include flex-center;
  padding: 10px;
  cursor: pointer;
  position: sticky;
  top: 0;
  background: $color-white;
  z-index: 1;
}

.handle-bar {
  width: 36px;
  height: 4px;
  background: $color-light;
  border-radius: 2px;
}

// ==============================
// 数据区块共用样式
// ==============================
.stats-section {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.stat-section-title {
  font-size: 13px;
  font-weight: 600;
  color: $color-text;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid $color-black;
}

.stat-subtitle {
  font-weight: 400;
  font-size: 11px;
  color: $color-mid;
  margin-left: 6px;
}

// 信息网格
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.info-item {
  background: $color-bg;
  border-radius: $radius-sm;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 10px;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 15px;
  font-weight: 600;
  color: $color-text;
  font-family: monospace;
}

// 条形图
.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.bar-swatch {
  width: 18px;
  height: 18px;
  border-radius: $radius-sm;
  border: 1px solid $color-light;
  flex-shrink: 0;
}

.bar-info {
  width: 58px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.bar-code {
  font-size: 11px;
  font-weight: 600;
  color: $color-text;
  @include text-ellipsis;
}

.bar-name {
  font-size: 10px;
  color: $color-mid;
  @include text-ellipsis;
}

.bar-rgb {
  font-size: 8px;
  color: $color-mid-light;
  font-family: monospace;
}

.bar-track {
  flex: 1;
  height: 6px;
  background: $color-bg;
  border-radius: 3px;
  overflow: hidden;
  min-width: 20px;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.7s cubic-bezier(0.22, 0.61, 0.36, 1);
  width: 0;
}

.bar-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  width: 48px;
}

.bar-count {
  font-size: 12px;
  font-weight: 600;
  color: $color-text-secondary;
  font-family: monospace;
}

.bar-pct {
  font-size: 10px;
  color: $color-mid;
}

// 调色板列表
.palette-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.palette-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.palette-swatch {
  width: 20px;
  height: 20px;
  border-radius: $radius-sm;
  border: 1px solid $color-light;
  flex-shrink: 0;
}

.palette-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.palette-idx {
  font-size: 11px;
  font-weight: 600;
  color: $color-text;
}

.palette-code {
  font-size: 11px;
  font-weight: 500;
  color: $color-text-secondary;
}

.palette-name {
  font-size: 10px;
  color: $color-mid;
  @include text-ellipsis;
}

.palette-rgb {
  font-size: 9px;
  color: $color-mid;
  font-family: monospace;
  flex-shrink: 0;
}

// ==============================
// 工具类
// ==============================
.mobile-only {
  display: none;

  @include mobile {
    display: flex;
  }
}

.desktop-panel {
  display: flex;
  flex-direction: column;

  @include mobile {
    display: none;
  }
}

// ==============================
// 过渡动画
// ==============================
.slide-up-panel-enter-active {
  animation: slideInUp 0.3s ease;
}

.slide-up-panel-leave-active {
  animation: slideInUp 0.25s ease reverse;
}
</style>
