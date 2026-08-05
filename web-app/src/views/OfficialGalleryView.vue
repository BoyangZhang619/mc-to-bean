<script setup lang="ts">
/**
 * 官方图纸区 -- 浏览 patterns/ 下生成的契约 JSON 图纸
 *
 * 分区: Minecraft方块 / Minecraft物品 / 花体字母 / 花体符文 / 其他
 * 列表: 搜索过滤 + 网格卡片 (canvas 缩略图) + 名称/尺寸
 * 点击卡片 -> 弹窗预览 (网格 + 图例) + "导入到我的图纸"
 */

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { usePatternStore } from '@/stores/patternStore'
import { parseContractJson } from '@/utils/contract'
import { renderThumbnail, groupByBeadCode } from '@/utils/renderer'
import type { Pattern } from '@/types'
import Icon from '@/components/Icon.vue'
import type { IconName } from '@/components/Icon.vue'

const router = useRouter()
const store = usePatternStore()

// ---- Manifest 条目 ----
interface ManifestEntry {
  path: string
  name: string
  category: string
  categoryLabel: string
}

const manifest = ref<ManifestEntry[]>([])
const manifestError = ref<string | null>(null)

// ---- 分区 ----
const OTHER_KEY = '__other__'

interface CategoryInfo {
  key: string
  label: string
  icon: IconName
}

const categoryDefs: CategoryInfo[] = [
  { key: 'minecraft/textures/block', label: 'Minecraft 方块', icon: 'grid' },
  { key: 'minecraft/textures/item', label: 'Minecraft 物品', icon: 'gallery' },
  { key: OTHER_KEY, label: 'Minecraft 其他', icon: 'info' },
  { key: 'fonts/illageralt', label: '花体符文', icon: 'warning' },
]

// 用于收集"其他"分区的所有 key
const otherKeysArr = [
  'minecraft/textures/entity',
  'minecraft/textures/gui',
  'minecraft/textures/environment',
  'minecraft/textures/effect',
  'minecraft/textures/font',
  'minecraft/textures/map',
  'minecraft/textures/misc',
  'minecraft/textures/mob_effect',
  'minecraft/textures/painting',
  'minecraft/textures/particle',
  'minecraft/textures/trims',
]
const otherKeys = new Set(otherKeysArr)

const activeCategory = ref<string>('minecraft/textures/block')
const searchQuery = ref('')
const loaded = ref(false)

// ---- 预览弹窗 ----
const previewPattern = ref<Pattern | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
const previewPath = ref<string | null>(null)

// 预览画布相关
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const previewContainerRef = ref<HTMLDivElement | null>(null)
const previewZoom = ref(1)
const previewOffsetX = ref(0)
const previewOffsetY = ref(0)
const isPanning = ref(false)
const lastPan = ref({ x: 0, y: 0 })
const importing = ref(false)

const BASE_CELL = 16

// ---- 加载 manifest ----
onMounted(async () => {
  try {
    const resp = await fetch('/official/manifest.json')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    // 使用 .text() + JSON.parse 而非 .json(), 避免 BOM 等问题
    const text = await resp.text()
    const cleanText = text.replace(/^﻿/, '')
    const data = JSON.parse(cleanText)
    manifest.value = Array.isArray(data) ? data : []
  } catch (e: any) {
    console.error('[OfficialGallery] 加载 manifest 失败:', e)
    manifestError.value = `加载图纸清单失败: ${e.message}`
  } finally {
    loaded.value = true
  }
})

// ---- 获取当前分区下的所有条目 ----
const currentEntries = computed(() => {
  if (activeCategory.value === OTHER_KEY) {
    return manifest.value.filter((e) => otherKeys.has(e.category))
  }
  return manifest.value.filter((e) => e.category === activeCategory.value)
})

// 是否显示"其他"分区
const hasOtherEntries = computed(() =>
  manifest.value.some((e) => otherKeys.has(e.category))
)

// 过滤掉无条目的分区
const visibleCategories = computed(() =>
  categoryDefs.filter((c) => c.key !== OTHER_KEY || hasOtherEntries.value)
)

// ---- 搜索过滤 ----
const filtered = computed(() => {
  let list = [...currentEntries.value]
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter((e) => e.name.toLowerCase().includes(q))
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
})

// ---- 缩略图 (canvas 从 json 画小图) ----
// 使用 ref<Record> 而非 raw Map —— Vue 模板需要响应式数据才能追踪变更
const thumbCache = ref<Record<string, string>>({})
const thumbLoading = new Set<string>()

async function loadThumb(entry: ManifestEntry): Promise<string> {
  const key = entry.path
  if (thumbCache.value[key]) return thumbCache.value[key]
  if (thumbLoading.has(key)) return ''

  thumbLoading.add(key)
  try {
    // 使用 encodeURI 而非 encodeURIComponent: + 是合法 URL 路径字符，不应编码
    const safePath = encodeURI(entry.path)
    const resp = await fetch(`/official/${safePath}`)
    if (!resp.ok) {
      console.warn(`[OfficialGallery] 缩略图加载失败 HTTP ${resp.status}: ${entry.path}`)
      return ''
    }
    const text = await resp.text()
    const result = parseContractJson(text)
    if (!result.ok) {
      console.warn(`[OfficialGallery] 缩略图解析失败: ${entry.path}`, result.errors)
      return ''
    }
    if (result.pattern) {
      const dataUrl = renderThumbnail(result.pattern, 160)
      thumbCache.value[key] = dataUrl
      return dataUrl
    }
  } catch (e: any) {
    console.warn(`[OfficialGallery] 缩略图加载异常: ${entry.path}`, e.message)
  } finally {
    thumbLoading.delete(key)
  }
  return ''
}

// ---- IntersectionObserver 视口懒加载缩略图 ----
const gridContainerRef = ref<HTMLDivElement | null>(null)
let thumbObserver: IntersectionObserver | null = null
// entry.path -> ManifestEntry 快速查找表，供 observer 回调使用
const entryMap = new Map<string, ManifestEntry>()

function setupThumbObserver() {
  thumbObserver?.disconnect()
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const obs of entries) {
        if (obs.isIntersecting) {
          const path = (obs.target as HTMLElement).dataset.path
          if (path) {
            const entry = entryMap.get(path)
            if (entry && !thumbCache.value[path]) {
              loadThumb(entry)
            }
          }
          // 加载一次后停止观察该卡片
          thumbObserver!.unobserve(obs.target)
        }
      }
    },
    { rootMargin: '200px' },  // 提前 200px 开始加载
  )

  // 观察当前所有卡片
  if (gridContainerRef.value) {
    const cards = gridContainerRef.value.querySelectorAll<HTMLElement>('[data-path]')
    for (const card of cards) {
      thumbObserver.observe(card)
    }
  }
}

// filtered 变化时重建 entryMap 并重新观察卡片
watch(filtered, (entries) => {
  entryMap.clear()
  for (const e of entries) {
    entryMap.set(e.path, e)
  }
  // 等待 DOM 更新后重新挂载 observer
  nextTick(() => {
    setupThumbObserver()
  })
}, { immediate: true })

onUnmounted(() => {
  thumbObserver?.disconnect()
})

// ---- 路径安全校验 ----
function isSafePath(path: string): boolean {
  if (path.includes('..')) return false
  if (path.includes('\\')) return false
  if (!path.startsWith('minecraft/') && !path.startsWith('fonts/')) return false
  if (!path.endsWith('.json')) return false
  if (path.startsWith('/')) return false
  const segments = path.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false
    if (seg.includes('\0')) return false
  }
  return true
}

// ---- 切换分区 ----
function switchCategory(key: string) {
  activeCategory.value = key
  searchQuery.value = ''
  closePreview()
  // 滚动到顶部 (overflow 在 .official-main 上)
  const main = document.querySelector('.official-main')
  if (main) main.scrollTop = 0
}

// ---- 打开/关闭预览 ----
async function openPreview(entry: ManifestEntry) {
  previewLoading.value = true
  previewError.value = null
  previewPattern.value = null
  previewPath.value = entry.path
  previewZoom.value = 1
  previewOffsetX.value = 0
  previewOffsetY.value = 0

  if (!isSafePath(entry.path)) {
    previewError.value = '路径不合法'
    previewLoading.value = false
    return
  }

  try {
    const safePath = encodeURI(entry.path)
    const resp = await fetch(`/official/${safePath}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const text = await resp.text()
    const result = parseContractJson(text)
    if (!result.ok) {
      previewError.value = result.errors.join('; ')
    } else {
      previewPattern.value = result.pattern
    }
  } catch (e: any) {
    previewError.value = `加载图纸失败: ${e.message}`
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  previewPattern.value = null
  previewPath.value = null
  previewError.value = null
  previewLoading.value = false
}

// ---- 预览画布渲染 ----
function renderPreview() {
  const canvas = previewCanvasRef.value
  if (!canvas || !previewContainerRef.value || !previewPattern.value) return

  const dpr = window.devicePixelRatio || 1
  const rect = previewContainerRef.value.getBoundingClientRect()
  const cw = rect.width
  const ch = rect.height
  if (cw === 0 || ch === 0) return

  canvas.width = cw * dpr
  canvas.height = ch * dpr
  canvas.style.width = `${cw}px`
  canvas.style.height = `${ch}px`

  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = '#f5f5f5'
  ctx.fillRect(0, 0, cw, ch)

  const pattern = previewPattern.value
  const cellSize = BASE_CELL * previewZoom.value
  const { width, height, grid, palette } = pattern

  const cm = new Map<number, [number, number, number]>()
  for (const p of palette) cm.set(p.index, p.rgb)

  const gridW = width * cellSize
  const gridH = height * cellSize

  const px = previewOffsetX.value + (cw - gridW) / 2
  const py = previewOffsetY.value + (ch - gridH) / 2

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.06)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#fff'
  ctx.fillRect(px - 2, py - 2, gridW + 4, gridH + 4)
  ctx.shadowColor = 'transparent'

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

  if (cellSize >= 8) {
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'
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

// ---- 预览交互 ----
function onPreviewPointerDown(e: PointerEvent) {
  if (!previewPattern.value) return
  const canvas = previewCanvasRef.value
  if (!canvas) return
  isPanning.value = true
  lastPan.value = { x: e.clientX, y: e.clientY }
  canvas.setPointerCapture(e.pointerId)
}

function onPreviewPointerMove(e: PointerEvent) {
  if (!isPanning.value || !previewPattern.value) return
  const dx = e.clientX - lastPan.value.x
  const dy = e.clientY - lastPan.value.y
  previewOffsetX.value += dx
  previewOffsetY.value += dy
  lastPan.value = { x: e.clientX, y: e.clientY }
  requestAnimationFrame(renderPreview)
}

function onPreviewPointerUp(e: PointerEvent) {
  isPanning.value = false
  const canvas = previewCanvasRef.value
  if (canvas) canvas.releasePointerCapture(e.pointerId)
}

function onPreviewWheel(e: WheelEvent) {
  e.preventDefault()
  if (!previewPattern.value || !previewContainerRef.value) return
  const rect = previewContainerRef.value.getBoundingClientRect()
  const factor = 1.1
  const delta = e.deltaY > 0 ? 1 / factor : factor
  const newZoom = Math.max(0.25, Math.min(32, previewZoom.value * delta))
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  previewOffsetX.value = mx - (mx - previewOffsetX.value) * (newZoom / previewZoom.value)
  previewOffsetY.value = my - (my - previewOffsetY.value) * (newZoom / previewZoom.value)
  previewZoom.value = newZoom
  requestAnimationFrame(renderPreview)
}

function zoomPreviewToFit() {
  if (!previewPattern.value || !previewContainerRef.value) return
  const rect = previewContainerRef.value.getBoundingClientRect()
  const pad = 40
  const pw = previewPattern.value.width * BASE_CELL
  const ph = previewPattern.value.height * BASE_CELL
  const zoom = Math.min((rect.width - pad) / pw, (rect.height - pad) / ph, 8)
  previewZoom.value = Math.max(0.25, zoom)
  previewOffsetX.value = 0
  previewOffsetY.value = 0
}

// ResizeObserver for preview
let previewResizeObs: ResizeObserver | null = null

watch(previewPattern, async () => {
  await nextTick()
  if (previewPattern.value) {
    zoomPreviewToFit()
    requestAnimationFrame(renderPreview)
  }
  // 设置 ResizeObserver 监听容器大小变化
  if (previewContainerRef.value) {
    previewResizeObs?.disconnect()
    previewResizeObs = new ResizeObserver(() => {
      requestAnimationFrame(renderPreview)
    })
    previewResizeObs.observe(previewContainerRef.value)
  }
})

onUnmounted(() => {
  previewResizeObs?.disconnect()
})

// ---- 导入到我的图纸 ----
async function importToMyPatterns() {
  if (!previewPattern.value || importing.value) return
  importing.value = true
  try {
    await store.save(previewPattern.value)
    router.push(`/editor/${previewPattern.value.id}`)
  } catch {
    // 错误由 store 处理
  } finally {
    importing.value = false
  }
}

// ---- 预览图例 ----
const previewColorStats = computed(() => {
  if (!previewPattern.value) return []
  const total = previewPattern.value.width * previewPattern.value.height
  const groups = groupByBeadCode(previewPattern.value.palette, previewPattern.value.grid)
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

function formatCellSize(mm: number | undefined): string {
  if (mm === undefined) return '-'
  return `${mm}mm`
}
</script>

<template>
  <div class="official-view">
    <div class="official-layout">
      <!-- PC 侧栏分区导航 -->
      <aside class="category-sidebar desktop-only">
        <h3 class="category-title">分区</h3>
        <nav class="category-nav">
          <button
            v-for="cat in visibleCategories"
            :key="cat.key"
            class="category-btn"
            :class="{ active: activeCategory === cat.key }"
            @click="switchCategory(cat.key)"
          >
            <Icon :name="cat.icon" :size="15" />
            <span>{{ cat.label }}</span>
          </button>
        </nav>
      </aside>

      <!-- 主内容区 -->
      <div class="official-main">
        <!-- 移动端分区 Tab -->
        <div class="category-tabs mobile-only">
          <button
            v-for="cat in visibleCategories"
            :key="cat.key"
            class="category-tab"
            :class="{ active: activeCategory === cat.key }"
            @click="switchCategory(cat.key)"
          >
            {{ cat.label }}
          </button>
        </div>

        <!-- 搜索 + 统计 -->
        <div class="official-toolbar">
          <div class="search-box">
            <Icon name="search" :size="16" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索图纸名称..."
              class="search-input"
            />
          </div>
          <span class="stats-text" v-if="loaded">
            {{ searchQuery ? `找到 ${filtered.length} 张` : `共 ${currentEntries.length} 张` }}
          </span>
        </div>

        <!-- 加载态 -->
        <div v-if="!loaded" class="loading-state">
          <div class="loading-spinner" />
          <span>加载中...</span>
        </div>

        <!-- 错误态 -->
        <div v-else-if="manifestError" class="error-state">
          <Icon name="warning" :size="40" color="#888" />
          <p>{{ manifestError }}</p>
        </div>

        <!-- 空态 -->
        <div v-else-if="filtered.length === 0" class="empty-state">
          <Icon name="search" :size="40" color="#aaa" />
          <p v-if="searchQuery">没有找到匹配 "{{ searchQuery }}" 的图纸</p>
          <p v-else>该分区暂无图纸</p>
        </div>

        <!-- 网格列表 -->
        <div v-else ref="gridContainerRef" class="official-grid">
          <TransitionGroup name="card-list">
            <div
              v-for="entry in filtered"
              :key="entry.path"
              class="official-card"
              :data-path="entry.path"
              @click="openPreview(entry)"
            >
              <div class="card-thumb">
                <img
                  v-if="thumbCache[entry.path]"
                  :src="thumbCache[entry.path]"
                  :alt="entry.name"
                />
                <div v-else class="thumb-placeholder">
                  <Icon name="gallery" :size="28" color="#ddd" />
                </div>
              </div>
              <div class="card-body">
                <span class="card-name">{{ entry.name }}</span>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </div>

    <!-- 预览弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="previewPath" class="preview-overlay" @click.self="closePreview">
          <div class="preview-modal">
            <!-- 标题栏 -->
            <div class="preview-modal-header">
              <span class="modal-title" v-if="previewPattern">{{ previewPattern.name }}</span>
              <span class="modal-title" v-else>图纸预览</span>
              <button class="modal-close-btn" @click="closePreview">
                <Icon name="close" :size="20" />
              </button>
            </div>

            <!-- 内容 -->
            <div class="preview-modal-body">
              <!-- 加载 -->
              <div v-if="previewLoading" class="loading-state">
                <div class="loading-spinner" />
                <span>加载图纸...</span>
              </div>

              <!-- 错误 -->
              <div v-else-if="previewError" class="error-state">
                <Icon name="warning" :size="32" color="#888" />
                <p>{{ previewError }}</p>
              </div>

              <!-- 图纸预览 -->
              <template v-else-if="previewPattern">
                <div class="preview-content">
                  <!-- 左侧图例 -->
                  <aside class="preview-legend desktop-only">
                    <section class="legend-section">
                      <h4>图纸信息</h4>
                      <div class="info-grid">
                        <div class="info-item">
                          <span class="info-label">尺寸</span>
                          <span class="info-value">{{ previewPattern.width }} x {{ previewPattern.height }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">格数</span>
                          <span class="info-value">{{ (previewPattern.width * previewPattern.height).toLocaleString() }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">颜色数</span>
                          <span class="info-value">{{ previewColorStats.length }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">单元尺寸</span>
                          <span class="info-value">{{ formatCellSize(previewPattern.cellSizeMm) }}</span>
                        </div>
                      </div>
                    </section>
                    <section class="legend-section">
                      <h4>图例 ({{ previewColorStats.length }} 色)</h4>
                      <div class="legend-list">
                        <div
                          v-for="item in previewColorStats"
                          :key="item.serial"
                          class="legend-row"
                        >
                          <div
                            class="legend-swatch"
                            :style="{ background: `rgb(${item.swatchColor.join(',')})` }"
                          />
                          <span class="legend-label">
                            <template v-if="item.code">{{ item.code }}</template>
                            <template v-else>#{{ item.serial }}</template>
                          </span>
                          <span class="legend-count">{{ item.count }}</span>
                        </div>
                      </div>
                    </section>
                  </aside>

                  <!-- 中央画布 -->
                  <div ref="previewContainerRef" class="preview-canvas-area">
                    <canvas
                      ref="previewCanvasRef"
                      class="preview-canvas"
                      @pointerdown="onPreviewPointerDown"
                      @pointermove="onPreviewPointerMove"
                      @pointerup="onPreviewPointerUp"
                      @pointerleave="onPreviewPointerUp"
                      @wheel.prevent="onPreviewWheel"
                      @contextmenu.prevent
                    />
                    <div class="zoom-badge">{{ Math.round(previewZoom * 100) }}%</div>
                  </div>
                </div>

                <!-- 底部操作栏 -->
                <div class="preview-actions">
                  <button class="action-btn" @click="zoomPreviewToFit">
                    <Icon name="expand" :size="16" />
                    <span>适应窗口</span>
                  </button>
                  <button class="action-btn primary" @click="importToMyPatterns" :disabled="importing">
                    <Icon name="import" :size="16" />
                    <span>{{ importing ? '导入中...' : '导入到我的图纸' }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
// ==============================
// 页面整体布局
// ==============================
.official-view {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.official-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  @include mobile {
    flex-direction: column;
  }
}

// ==============================
// PC 侧栏分区导航
// ==============================
.category-sidebar {
  width: 180px;
  background: $color-white;
  border-right: 1px solid $color-light;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 16px;
  flex-shrink: 0;

  &.desktop-only {
    @include mobile {
      display: none;
    }
  }
}

.category-title {
  font-size: 12px;
  font-weight: 600;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  padding-left: 4px;
}

.category-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: $radius-sm;
  font-size: 13px;
  color: $color-text-secondary;
  transition: all $transition-fast;
  text-align: left;

  &:hover {
    background: $color-bg;
    color: $color-text;
  }

  &.active {
    background: $color-black;
    color: $color-white;
  }
}

// ==============================
// 移动端分区 Tab
// ==============================
.category-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  overflow-x: auto;
  flex-shrink: 0;

  &::-webkit-scrollbar {
    display: none;
  }
}

.category-tab {
  padding: 6px 14px;
  border-radius: $radius-sm;
  font-size: 12px;
  font-weight: 500;
  color: $color-text-secondary;
  white-space: nowrap;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
  }

  &.active {
    background: $color-black;
    color: $color-white;
  }
}

// ==============================
// 主内容区
// ==============================
.official-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-thin;
}

.official-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  flex-shrink: 0;

  @include mobile {
    padding: 10px 12px;
  }
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  padding: 7px 12px;
  color: $color-mid;
  max-width: 320px;
  transition: border-color $transition-fast;

  &:focus-within {
    border-color: $color-mid-dark;
  }
}

.search-input {
  flex: 1;
  border: none;
  background: none;
  font-size: 13px;
  outline: none;
  color: $color-text;

  &::placeholder {
    color: $color-mid-light;
  }
}

.stats-text {
  font-size: 12px;
  color: $color-mid;
  white-space: nowrap;
}

// ==============================
// 网格列表
// ==============================
.official-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  padding: 4px 16px 24px;
  align-content: start;

  @include mobile {
    grid-template-columns: repeat(2, 1fr);
    padding: 4px 12px 24px;
    gap: 10px;
  }
}

.official-card {
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  overflow: hidden;
  cursor: pointer;
  transition: all $transition-fast;
  animation: fadeInUp 0.3s ease;

  &:hover {
    box-shadow: $shadow-md;
    border-color: $color-mid-light;
    transform: translateY(-2px);
  }
}

.card-thumb {
  aspect-ratio: 1;
  overflow: hidden;
  background: $color-bg;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
}

.thumb-placeholder {
  // flex child of card-thumb, auto-sized to icon content
  color: $color-mid-light;
}

.card-body {
  padding: 8px 10px;
}

.card-name {
  font-size: 12px;
  font-weight: 500;
  color: $color-text;
  @include text-ellipsis;
  display: block;
}

// ==============================
// 加载/空/错误态
// ==============================
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: $color-mid;
  font-size: 14px;
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: $color-mid;
  font-size: 14px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 0;
  color: $color-mid;
  font-size: 14px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

// ==============================
// 预览弹窗
// ==============================
.preview-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.preview-modal {
  background: $color-white;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  max-width: 900px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: fadeInScale 0.25s ease;
}

.preview-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  @include text-ellipsis;
}

.modal-close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $radius-sm;
  color: $color-mid-dark;
  flex-shrink: 0;

  &:hover {
    background: $color-bg;
    color: $color-black;
  }
}

.preview-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;

  @include mobile {
    flex-direction: column;
  }
}

// 图例面板
.preview-legend {
  width: 220px;
  background: $color-bg;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 12px;
  flex-shrink: 0;
  border-right: 1px solid $color-light;

  &.desktop-only {
    @include mobile {
      display: none;
    }
  }
}

.legend-section {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }

  h4 {
    font-size: 12px;
    font-weight: 600;
    color: $color-text;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 2px solid $color-black;
  }
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.info-item {
  background: $color-white;
  border-radius: $radius-sm;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.info-label {
  font-size: 9px;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.info-value {
  font-size: 13px;
  font-weight: 600;
  color: $color-text;
  font-family: monospace;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.legend-swatch {
  width: 18px;
  height: 18px;
  border-radius: $radius-sm;
  border: 1px solid $color-light;
  flex-shrink: 0;
}

.legend-label {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: $color-text;
  @include text-ellipsis;
}

.legend-count {
  font-size: 12px;
  font-family: monospace;
  color: $color-mid;
}

// 画布区域
.preview-canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f8f8f8;
  min-height: 300px;
}

.preview-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
}

.zoom-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(17, 17, 17, 0.75);
  color: #fff;
  font-size: 10px;
  font-family: monospace;
  padding: 3px 8px;
  border-radius: $radius-sm;
}

// 底部操作栏
.preview-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid $color-light;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
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

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
}

// ==============================
// 工具类
// ==============================
.desktop-only {
  @include mobile {
    display: none !important;
  }
}

.mobile-only {
  display: none;

  @include mobile {
    display: flex;
  }
}

// ==============================
// 动画
// ==============================
.card-list-enter-active {
  animation: fadeInUp 0.3s ease;
}

.card-list-leave-active {
  animation: fadeIn 0.2s ease reverse;
}

.card-list-move {
  transition: transform 0.25s ease;
}

.dialog-enter-active {
  animation: fadeInScale 0.25s ease;
}

.dialog-leave-active {
  animation: fadeInScale 0.2s ease reverse;
}
</style>
