<script setup lang="ts">
/**
 * 字体图纸生成器 -- Canvas 渲染文字 → 降采样 → 拼豆图纸
 *
 * 布局: PC 左侧配置面板 + 右侧预览 / 移动端折叠配置区 + 预览
 * 功能: 字体/尺寸/字符集/阈值全可调, 生成结果可保存到图纸库或下载 JSON
 */

import { ref, computed, nextTick } from 'vue'
import { usePatternStore } from '@/stores/patternStore'
import { renderThumbnail } from '@/utils/renderer'
import type { Pattern } from '@/types'
import Icon from '@/components/Icon.vue'

const store = usePatternStore()

// ---- 字体选项 ----
const fontPresets = [
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' },
  { value: "'Palatino Linotype', 'Book Antiqua', serif", label: 'Palatino' },
  { value: 'Garamond, serif', label: 'Garamond' },
  { value: "'Segoe Script', 'Brush Script MT', cursive", label: 'Segoe Script' },
  { value: "'Baskerville Old Face', serif", label: 'Baskerville' },
]
const selectedFont = ref(fontPresets[0].value)
const customFont = ref('')
const useCustomFont = ref(false)

const effectiveFont = computed(() =>
  useCustomFont.value && customFont.value.trim()
    ? customFont.value.trim()
    : selectedFont.value
)
const fontShortName = computed(() => {
  const fam = useCustomFont.value && customFont.value.trim()
    ? customFont.value.trim()
    : selectedFont.value
  return fam.split(',')[0].replace(/['"]/g, '').replace(/\s+/g, '_')
})

// ---- 生成参数 ----
const gridSize = ref(20)
const fontSize = ref(256)
const threshold = ref(128)       // 0-255, >threshold → 白字
const darkBg = ref(true)

// ---- 字符集 ----
type CharSetMode = 'all' | 'upper' | 'lower' | 'digits' | 'custom'
const charSetMode = ref<CharSetMode>('upper')
const customChars = ref('')
const CHARS_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CHARS_LOWER = 'abcdefghijklmnopqrstuvwxyz'
const CHARS_DIGITS = '0123456789'
const CHARS_SYMBOLS = '!?,.\'"-:;+*=@#$%&()[]{}'

const effectiveChars = computed(() => {
  switch (charSetMode.value) {
    case 'upper': return CHARS_UPPER
    case 'lower': return CHARS_LOWER
    case 'digits': return CHARS_DIGITS
    case 'custom': return customChars.value || ''
    default: return CHARS_UPPER + CHARS_LOWER + CHARS_DIGITS + CHARS_SYMBOLS
  }
})

// ---- 预览缩放 ----
const previewScale = ref(4)

// ---- 生成结果 ----
interface GenResult {
  char: string
  pattern: Pattern
  thumbDataUrl: string
}
const results = ref<GenResult[]>([])
const generating = ref(false)
const selectedIndices = ref<Set<number>>(new Set())
const saving = ref(false)
const saveProgress = ref('')

// ---- 移动端配置折叠 ----
const showConfig = ref(false)

// ---- 颜色 ----
const H16: [number, number, number] = [24, 24, 24]
const T1: [number, number, number] = [255, 255, 255]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

// ---- 二值化 ----
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// ---- 渲染单个字符 ----
function renderChar(char: string): { grid: number[][]; palette: Array<{ index: number; rgb: [number, number, number]; name: string; code: string }> } {
  const size = fontSize.value
  const gs = gridSize.value
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // 背景
  ctx.fillStyle = darkBg.value ? 'rgb(24,24,24)' : 'rgb(255,255,255)'
  ctx.fillRect(0, 0, size, size)

  // 文字
  ctx.fillStyle = darkBg.value ? 'rgb(255,255,255)' : 'rgb(24,24,24)'
  const fs = Math.round(size * 0.75)
  ctx.font = `bold ${fs}px ${effectiveFont.value}, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char, size / 2, size / 2)

  const cellW = size / gs
  const cellH = size / gs
  const grid: number[][] = []

  const palette = darkBg.value
    ? [
        { index: 0, rgb: H16, name: 'H16', code: 'H16' },
        { index: 1, rgb: T1, name: 'T1', code: 'T1' },
      ]
    : [
        { index: 0, rgb: T1, name: 'T1', code: 'T1' },
        { index: 1, rgb: H16, name: 'H16', code: 'H16' },
      ]

  for (let y = 0; y < gs; y++) {
    const row: number[] = []
    for (let x = 0; x < gs; x++) {
      const sx = Math.min(Math.floor(x * cellW + cellW / 2), size - 1)
      const sy = Math.min(Math.floor(y * cellH + cellH / 2), size - 1)
      const pixel = ctx.getImageData(sx, sy, 1, 1).data
      const lum = luma(pixel[0], pixel[1], pixel[2])
      // 二值化: 根据 threshold 和 darkBg 决定
      if (darkBg.value) {
        row.push(lum > threshold.value ? 1 : 0)
      } else {
        row.push(lum > threshold.value ? 0 : 1)
      }
    }
    grid.push(row)
  }

  return { grid, palette }
}

// ---- 生成全部 ----
async function doGenerate() {
  const chars = effectiveChars.value
  if (!chars) return

  generating.value = true
  results.value = []
  selectedIndices.value = new Set()

  const fontShort = fontShortName.value
  const gs = gridSize.value
  const fSize = fontSize.value

  for (const char of chars) {
    await nextTick() // 防止阻塞 UI

    const { grid, palette } = renderChar(char)
    const now = Date.now()
    const pattern: Pattern = {
      id: crypto.randomUUID(),
      name: `${fontShort}_${char}`,
      width: gs,
      height: gs,
      cellSizeMm: 5,
      palette: palette.map((p) => ({ ...p, delta: undefined, beadRgb: null })),
      grid,
      bgColor: darkBg.value ? '#181818' : '#ffffff',
      createdAt: now,
      updatedAt: now,
    }

    const thumbDataUrl = renderThumbnail(pattern, 120)
    results.value.push({ char, pattern, thumbDataUrl })
  }

  generating.value = false
}

// ---- 选择逻辑 ----
function toggleSelect(index: number) {
  const s = new Set(selectedIndices.value)
  if (s.has(index)) s.delete(index)
  else s.add(index)
  selectedIndices.value = s
}

function selectAll() {
  if (selectedIndices.value.size === results.value.length) {
    selectedIndices.value = new Set()
  } else {
    selectedIndices.value = new Set(results.value.map((_, i) => i))
  }
}

const allSelected = computed(() =>
  results.value.length > 0 && selectedIndices.value.size === results.value.length
)

// ---- 保存到图纸库 ----
async function saveSelected() {
  const indices = [...selectedIndices.value]
  if (indices.length === 0) return

  saving.value = true
  let saved = 0
  for (const i of indices) {
    saveProgress.value = `保存中 ${saved + 1}/${indices.length}...`
    const p = results.value[i].pattern
    await store.save({ ...p })
    saved++
  }
  saveProgress.value = `已保存 ${saved} 张图纸到图纸库`
  saving.value = false
  selectedIndices.value = new Set()
}

// ---- 下载 JSON ----
function downloadSelectedJson() {
  const indices = [...selectedIndices.value]
  if (indices.length === 0) return

  const gs = gridSize.value
  const fSize = fontSize.value
  const fontShort = fontShortName.value

  indices.forEach((i, idx) => {
    setTimeout(() => {
      const { pattern, char } = results.value[i]
      const codePoint = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
      const filename = `gridsize${gs}_fontsize${fSize}_fontshort${fontShort}_U+${codePoint}_${char}.json`
      const blob = new Blob([JSON.stringify(pattern)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    }, idx * 80)
  })
}

// ---- 预览大图 ----
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const previewChar = ref<GenResult | null>(null)

function openLargePreview(result: GenResult) {
  previewChar.value = result
  nextTick(() => drawLargePreview())
}

function closeLargePreview() {
  previewChar.value = null
}

function drawLargePreview() {
  const canvas = previewCanvasRef.value
  if (!canvas || !previewChar.value) return
  const p = previewChar.value.pattern
  const scale = previewScale.value
  canvas.width = p.width * scale
  canvas.height = p.height * scale
  canvas.style.width = `${p.width * scale}px`
  canvas.style.height = `${p.height * scale}px`
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const cm = new Map<number, [number, number, number]>()
  for (const pe of p.palette) cm.set(pe.index, pe.rgb)
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const idx = p.grid[y][x]
      const rgb = cm.get(idx) ?? [128, 128, 128]
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
}
</script>

<template>
  <div class="font-gen-view">
    <!-- 顶部标题栏 -->
    <div class="gen-topbar">
      <div class="topbar-left">
        <h1 class="gen-title">字体图纸生成器</h1>
        <span class="gen-subtitle">Canvas 渲染文字 → 降采样 → 拼豆图纸</span>
      </div>
      <button class="mobile-toggle mobile-only" @click="showConfig = !showConfig">
        <Icon :name="showConfig ? 'close' : 'settings'" :size="18" />
        <span>{{ showConfig ? '关闭' : '配置' }}</span>
      </button>
    </div>

    <div class="gen-layout">
      <!-- 左侧配置面板 -->
      <aside class="gen-config" :class="{ 'config-visible': showConfig }">
        <div class="config-section">
          <h4 class="config-label">字体</h4>
          <select v-model="selectedFont" class="config-select" :disabled="useCustomFont">
            <option v-for="f in fontPresets" :key="f.label" :value="f.value">{{ f.label }}</option>
          </select>
          <label class="checkbox-row">
            <input type="checkbox" v-model="useCustomFont" />
            <span>自定义字体</span>
          </label>
          <input
            v-if="useCustomFont"
            v-model="customFont"
            type="text"
            class="config-input"
            placeholder="输入 CSS font-family, 如 'Brush Script MT', cursive"
          />
        </div>

        <div class="config-section">
          <h4 class="config-label">网格尺寸</h4>
          <div class="range-row">
            <input type="range" v-model.number="gridSize" min="12" max="36" step="2" class="config-range" />
            <span class="range-value">{{ gridSize }}px</span>
          </div>
        </div>

        <div class="config-section">
          <h4 class="config-label">渲染字号</h4>
          <div class="range-row">
            <input type="range" v-model.number="fontSize" min="128" max="512" step="16" class="config-range" />
            <span class="range-value">{{ fontSize }}px</span>
          </div>
        </div>

        <div class="config-section">
          <h4 class="config-label">二值化阈值</h4>
          <div class="range-row">
            <input type="range" v-model.number="threshold" min="60" max="240" step="5" class="config-range" />
            <span class="range-value">{{ threshold }}</span>
          </div>
        </div>

        <div class="config-section">
          <h4 class="config-label">背景</h4>
          <label class="checkbox-row">
            <input type="checkbox" v-model="darkBg" />
            <span>深色底 + 白字</span>
          </label>
        </div>

        <div class="config-section">
          <h4 class="config-label">字符集</h4>
          <select v-model="charSetMode" class="config-select">
            <option value="all">全部 (A-Z/a-z/0-9/标点)</option>
            <option value="upper">仅大写 A-Z</option>
            <option value="lower">仅小写 a-z</option>
            <option value="digits">仅数字 0-9</option>
            <option value="custom">自定义字符</option>
          </select>
          <input
            v-if="charSetMode === 'custom'"
            v-model="customChars"
            type="text"
            class="config-input"
            placeholder="输入字符, 如: ABCabc123!?"
          />
        </div>

        <button class="generate-btn" @click="doGenerate" :disabled="generating || !effectiveChars">
          <template v-if="generating">
            <div class="spinner-sm" />
            <span>生成中...</span>
          </template>
          <template v-else>
            <Icon name="brush" :size="16" />
            <span>生成 ({{ effectiveChars.length }} 字符)</span>
          </template>
        </button>
      </aside>

      <!-- 右侧预览/结果区 -->
      <div class="gen-main">
        <!-- 无结果时提示 -->
        <div v-if="results.length === 0 && !generating" class="gen-placeholder">
          <Icon name="rename" :size="48" color="#ccc" />
          <p>配置参数后点击「生成」查看效果</p>
        </div>

        <!-- 生成中 -->
        <div v-else-if="generating" class="loading-state">
          <div class="loading-spinner" />
          <span>正在渲染字符...</span>
        </div>

        <!-- 结果区 -->
        <template v-else>
          <!-- 批量操作栏 -->
          <div class="results-toolbar">
            <label class="checkbox-row">
              <input type="checkbox" :checked="allSelected" @change="selectAll" />
              <span>全选 ({{ selectedIndices.size }}/{{ results.length }})</span>
            </label>
            <div class="toolbar-actions">
              <button class="action-btn" @click="saveSelected" :disabled="selectedIndices.size === 0 || saving">
                <Icon name="save" :size="15" />
                <span>{{ saving ? saveProgress : '保存到图纸库' }}</span>
              </button>
              <button class="action-btn" @click="downloadSelectedJson" :disabled="selectedIndices.size === 0">
                <Icon name="export" :size="15" />
                <span>下载 JSON</span>
              </button>
            </div>
          </div>

          <!-- 保存反馈 -->
          <div v-if="saveProgress && !saving" class="save-feedback">
            <Icon name="check" :size="14" />
            {{ saveProgress }}
          </div>

          <!-- 结果网格 -->
          <div class="results-grid">
            <div
              v-for="(result, i) in results"
              :key="result.char + i"
              class="result-card"
              :class="{ selected: selectedIndices.has(i) }"
              @click="toggleSelect(i)"
            >
              <div class="result-thumb" @dblclick.prevent="openLargePreview(result)">
                <img :src="result.thumbDataUrl" :alt="result.char" />
              </div>
              <span class="result-char">{{ result.char }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 大图预览弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="previewChar" class="large-preview-overlay" @click.self="closeLargePreview">
          <div class="large-preview-box">
            <div class="large-preview-header">
              <span>{{ previewChar.pattern.name }} ({{ previewChar.pattern.width }}x{{ previewChar.pattern.height }})</span>
              <div>
                <button class="icon-btn" @click="previewScale = Math.max(2, previewScale - 2)">
                  <Icon name="zoom-out" :size="16" />
                </button>
                <span class="scale-label">x{{ previewScale }}</span>
                <button class="icon-btn" @click="previewScale = Math.min(20, previewScale + 2)">
                  <Icon name="zoom-in" :size="16" />
                </button>
                <button class="icon-btn" @click="closeLargePreview">
                  <Icon name="close" :size="18" />
                </button>
              </div>
            </div>
            <div class="large-preview-body">
              <canvas ref="previewCanvasRef" class="large-preview-canvas" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
// ==============================
// 页面整体
// ==============================
.font-gen-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// ==============================
// 顶部标题栏
// ==============================
.gen-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;
}

.topbar-left {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.gen-title {
  font-size: 18px;
  font-weight: 700;
}

.gen-subtitle {
  font-size: 12px;
  color: $color-mid;
}

.mobile-toggle {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: $radius-sm;
  font-size: 13px;
  color: $color-text-secondary;
  border: 1px solid $color-light;

  &:hover { background: $color-bg; }

  @include mobile { display: flex; }
}

// ==============================
// 主布局
// ==============================
.gen-layout {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;

  @include mobile {
    flex-direction: column;
  }
}

// ==============================
// 左侧配置面板
// ==============================
.gen-config {
  width: 280px;
  background: $color-white;
  border-right: 1px solid $color-light;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;

  @include mobile {
    width: 100%;
    max-height: 45vh;
    border-right: none;
    border-bottom: 1px solid $color-light;
    display: none;

    &.config-visible {
      display: flex;
    }
  }
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-label {
  font-size: 11px;
  font-weight: 600;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.config-select {
  padding: 7px 10px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 13px;
  background: $color-white;
  color: $color-text;
  cursor: pointer;

  &:focus { outline: none; border-color: $color-mid-dark; }
  &:disabled { opacity: 0.5; cursor: default; }
}

.config-input {
  padding: 7px 10px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 13px;
  color: $color-text;

  &:focus { outline: none; border-color: $color-mid-dark; }
  &::placeholder { color: $color-mid-light; }
}

.config-range {
  flex: 1;
  accent-color: $color-black;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range-value {
  font-size: 13px;
  font-family: monospace;
  color: $color-text-secondary;
  width: 40px;
  text-align: right;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: $color-text-secondary;
  cursor: pointer;

  input[type="checkbox"] { accent-color: $color-black; }
}

.generate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: $color-black;
  color: $color-white;
  border-radius: $radius-sm;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  margin-top: 4px;

  &:hover:not(:disabled) { background: $color-dark; }
  &:disabled { opacity: 0.5; cursor: default; }
}

// ==============================
// 右侧主区域
// ==============================
.gen-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-thin;
  background: $color-bg;
}

.gen-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  color: $color-mid;
  font-size: 14px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  color: $color-mid;
  font-size: 14px;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

// ==============================
// 结果工具栏
// ==============================
.results-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;

  .checkbox-row { user-select: none; }
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: $radius-sm;
  font-size: 12px;
  color: $color-text-secondary;
  border: 1px solid $color-light;
  background: $color-white;
  transition: all $transition-fast;

  &:hover:not(:disabled) {
    background: $color-black;
    color: $color-white;
    border-color: $color-black;
  }

  &:disabled { opacity: 0.4; cursor: default; }
}

.save-feedback {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  color: $color-success;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;
}

// ==============================
// 结果网格
// ==============================
.results-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  padding: 16px;

  @include mobile {
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding: 10px;
  }
}

.result-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: $color-white;
  border: 1.5px solid $color-light;
  border-radius: $radius-md;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    border-color: $color-mid-light;
    box-shadow: $shadow-sm;
    transform: translateY(-1px);
  }

  &.selected {
    border-color: $color-black;
    background: #f7f7f7;
    box-shadow: 0 0 0 1px $color-black;
  }
}

.result-thumb {
  width: 64px;
  height: 64px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    image-rendering: pixelated;
    max-width: 100%;
    max-height: 100%;
  }
}

.result-char {
  font-size: 12px;
  font-weight: 600;
  font-family: monospace;
  color: $color-text;
}

// ==============================
// 大图预览弹窗
// ==============================
.large-preview-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.large-preview-box {
  background: $color-white;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: fadeInScale 0.25s ease;
}

.large-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid $color-light;
  font-size: 14px;
  font-weight: 500;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $radius-sm;
  color: $color-mid-dark;

  &:hover { background: $color-bg; }
}

.scale-label {
  font-size: 12px;
  color: $color-mid;
  font-family: monospace;
  margin: 0 4px;
}

.large-preview-body {
  padding: 16px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.large-preview-canvas {
  image-rendering: pixelated;
}

// ==============================
// 工具类
// ==============================
.mobile-only {
  display: none;
  @include mobile { display: flex; }
}

.dialog-enter-active { animation: fadeInScale 0.25s ease; }
.dialog-leave-active { animation: fadeInScale 0.2s ease reverse; }
</style>
