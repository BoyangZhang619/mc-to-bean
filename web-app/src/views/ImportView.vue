<script setup lang="ts">
/**
 * 导入页面 -- JSON 导入 + 图片导入 (tab 切换)
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePatternStore } from '@/stores/patternStore'
import { parseContractJson } from '@/utils/contract'
import Icon from '@/components/Icon.vue'
import Toast from '@/components/Toast.vue'
import type { Pattern } from '@/types'

const router = useRouter()
const store = usePatternStore()

// ---- tab ----
type ImportTab = 'json' | 'image'
const activeTab = ref<ImportTab>('json')

// ---- JSON 导入 ----
const textInput = ref('')
const showTextArea = ref(false)
const errors = ref<string[]>([])
const preview = ref<Pattern | null>(null)
const importing = ref(false)
const toastRef = ref<InstanceType<typeof Toast> | null>(null)

function showToast(text: string, type: 'info' | 'success' | 'error' = 'info') {
  toastRef.value?.show(text, type)
}

function processJson(jsonStr: string) {
  const result = parseContractJson(jsonStr)
  if (!result.ok) {
    errors.value = result.errors
    preview.value = null
    showToast('JSON 校验失败, 请检查格式', 'error')
    return
  }
  errors.value = []
  preview.value = result.pattern
  showToast('JSON 校验通过', 'success')
}

function handleJsonFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => processJson(reader.result as string)
  reader.onerror = () => showToast('文件读取失败', 'error')
  reader.readAsText(file)
}

function handlePasteText() {
  if (!textInput.value.trim()) { showToast('请输入 JSON 文本', 'error'); return }
  processJson(textInput.value.trim())
}

async function doJsonImport() {
  if (!preview.value) return
  importing.value = true
  const ok = await store.save(preview.value)
  if (ok) {
    showToast('导入成功', 'success')
    setTimeout(() => router.push(`/editor/${preview.value!.id}`), 600)
  } else {
    showToast('保存失败, 请重试', 'error')
    importing.value = false
  }
}

function clearPreview() { preview.value = null; errors.value = []; textInput.value = '' }

// ---- 图片导入 ----
const imageDragOver = ref(false)
const imageLongEdge = ref(64)
const imagePreviewUrl = ref<string | null>(null)
const imagePreviewCanvas = ref<HTMLCanvasElement | null>(null)
const imageProcessing = ref(false)

function handleImageFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  loadImageFile(file)
}

function handleImageDrop(e: DragEvent) {
  imageDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  loadImageFile(file)
}

function loadImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择 PNG 或 JPG 图片', 'error')
    return
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    // 源图尺寸限制
    if (img.width > 4096 || img.height > 4096) {
      showToast('源图过大 (最大 4096x4096), 请缩小后重试', 'error')
      URL.revokeObjectURL(url)
      return
    }
    // 生成预览
    previewImage(img)
    imagePreviewUrl.value = url
  }
  img.onerror = () => {
    showToast('图片加载失败', 'error')
    URL.revokeObjectURL(url)
  }
  img.src = url
}

/** 在 canvas 上预览降采样效果 */
function previewImage(img: HTMLImageElement) {
  const canvas = imagePreviewCanvas.value
  if (!canvas) return
  const longEdge = imageLongEdge.value
  const ratio = img.width / img.height
  let outW: number, outH: number
  if (ratio >= 1) { outW = longEdge; outH = Math.round(longEdge / ratio) }
  else { outH = longEdge; outW = Math.round(longEdge * ratio) }

  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, outW, outH)
}

/** 图片转换 -> Pattern 并保存 */
async function processImage() {
  const canvas = imagePreviewCanvas.value
  if (!canvas) return
  imageProcessing.value = true

  try {
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const w = canvas.width
    const h = canvas.height

    // 收集所有颜色并构建 palette (按遇到顺序)
    const colorMap = new Map<string, number>() // "r,g,b" -> index
    const palette: { index: number; rgb: [number, number, number]; code: null; name: null }[] = []

    function getOrCreateIndex(r: number, g: number, b: number): number {
      const key = `${r},${g},${b}`
      if (colorMap.has(key)) return colorMap.get(key)!
      const idx = palette.length
      colorMap.set(key, idx)
      palette.push({ index: idx, rgb: [r, g, b], code: null, name: null })
      return idx
    }

    // 构建 grid
    const grid: number[][] = []
    for (let y = 0; y < h; y++) {
      const row: number[] = []
      for (let x = 0; x < w; x++) {
        const offset = (y * w + x) * 4
        const r = pixels[offset]
        const g = pixels[offset + 1]
        const b = pixels[offset + 2]
        // 忽略 alpha, 直接取 RGB
        row.push(getOrCreateIndex(r, g, b))
      }
      grid.push(row)
    }

    const now = Date.now()
    const pattern: Pattern = {
      id: crypto.randomUUID(),
      name: `图片导入 ${w}x${h}`,
      width: w,
      height: h,
      cellSizeMm: 5,
      palette,
      grid,
      bgColor: '#ffffff',
      createdAt: now,
      updatedAt: now,
    }

    const ok = await store.save(pattern)
    if (ok) {
      showToast('图片导入成功', 'success')
      setTimeout(() => router.push(`/editor/${pattern.id}`), 600)
    } else {
      showToast('保存失败', 'error')
    }
  } catch (e: any) {
    showToast(`处理失败: ${e.message}`, 'error')
  } finally {
    imageProcessing.value = false
  }
}

const imageCanvasStyle = computed(() => {
  const canvas = imagePreviewCanvas.value
  if (!canvas || canvas.width === 0) return {}
  const maxW = 280
  const ratio = maxW / canvas.width
  return { width: `${maxW}px`, height: `${canvas.height * ratio}px` }
})
</script>

<template>
  <div class="import-view">
    <div class="import-content">
      <h1 class="import-title">导入图纸</h1>

      <!-- Tab 切换 -->
      <div class="import-tabs">
        <button class="import-tab" :class="{ active: activeTab === 'json' }" @click="activeTab = 'json'">
          <Icon name="save" :size="15" />
          <span>JSON 导入</span>
        </button>
        <button class="import-tab" :class="{ active: activeTab === 'image' }" @click="activeTab = 'image'">
          <Icon name="gallery" :size="15" />
          <span>图片导入</span>
        </button>
      </div>

      <!-- ========== JSON Tab ========== -->
      <template v-if="activeTab === 'json'">
        <p class="import-subtitle">支持导入符合契约格式的 JSON 文件。可通过文件选择、拖拽文件或直接粘贴 JSON 文本导入。</p>

        <div class="import-methods" v-if="!preview">
          <div class="import-card">
            <div class="card-icon"><Icon name="import" :size="32" :stroke-width="1.5" /></div>
            <h3>选择文件</h3>
            <p>从本地选择 .json 文件导入</p>
            <label class="btn btn--outline file-select-btn">
              <input type="file" accept=".json" @change="handleJsonFile" class="file-input-hidden" />
              选择文件
            </label>
          </div>
          <div class="import-card" @click="showTextArea = true">
            <div class="card-icon"><Icon name="rename" :size="32" :stroke-width="1.5" /></div>
            <h3>粘贴文本</h3>
            <p>复制 JSON 内容直接粘贴</p>
          </div>
        </div>

        <div v-if="showTextArea && !preview" class="text-area-section">
          <textarea v-model="textInput" class="json-textarea" placeholder='粘贴 JSON 内容, 如:&#10;{ "name":"my",&#10;  "width":16,"height":16,... }' rows="12" />
          <div class="text-area-actions">
            <button class="btn btn--ghost" @click="showTextArea = false; textInput = ''">取消</button>
            <button class="btn btn--primary" @click="handlePasteText" :disabled="!textInput.trim()">校验 JSON</button>
          </div>
        </div>

        <div v-if="errors.length > 0" class="error-section">
          <div class="error-header"><Icon name="warning" :size="16" /><span>校验发现 {{ errors.length }} 个问题</span></div>
          <ul class="error-list"><li v-for="(err,i) in errors.slice(0,20)" :key="i">{{ err }}</li>
          <li v-if="errors.length > 20">... 还有 {{ errors.length - 20 }} 个错误</li></ul>
        </div>

        <div v-if="preview" class="preview-section">
          <div class="preview-header"><h2>预览确认</h2><button class="btn-link" @click="clearPreview">重新选择</button></div>
          <div class="preview-info">
            <div class="preview-row"><span class="preview-label">名称</span><span class="preview-value">{{ preview.name }}</span></div>
            <div class="preview-row"><span class="preview-label">尺寸</span><span class="preview-value">{{ preview.width }} x {{ preview.height }}</span></div>
            <div class="preview-row"><span class="preview-label">色数</span><span class="preview-value">{{ preview.palette.length }} 种颜色</span></div>
            <div class="preview-row"><span class="preview-label">豆径</span><span class="preview-value">{{ preview.cellSizeMm }}mm</span></div>
          </div>
          <button class="btn btn--primary btn--large" @click="doJsonImport" :disabled="importing">
            <template v-if="importing"><div class="loading-spinner-sm" /><span>导入中...</span></template>
            <template v-else><Icon name="check" :size="18" /><span>确认导入并开始编辑</span></template>
          </button>
        </div>

        <details class="format-help" v-if="!preview">
          <summary>契约 JSON 格式说明</summary>
          <pre class="format-example">{
  "name": "图纸名称",
  "width": 16,
  "height": 16,
  "cell_size_mm": 5,
  "palette": [
    { "index": 0, "rgb": [140, 116, 84], "name": null, "code": null }
  ],
  "grid": [ [0, 1, ...], ... ]
}</pre>
        </details>
      </template>

      <!-- ========== Image Tab ========== -->
      <template v-if="activeTab === 'image'">
        <p class="import-subtitle">上传 PNG/JPG 图片, 自动降采样生成拼豆图纸。</p>

        <!-- 长边设置 -->
        <div class="field" style="margin-bottom:16px;">
          <label class="field-label">长边像素数 (输出图纸宽度或高度)</label>
          <div class="longedge-row">
            <input type="range" v-model.number="imageLongEdge" min="8" max="512" step="8" class="longedge-slider" />
            <input type="number" v-model.number="imageLongEdge" min="8" max="512" class="longedge-num" />
          </div>
        </div>

        <!-- 拖拽+文件选择共用区 -->
        <div
          class="image-drop-zone"
          :class="{ 'drag-over': imageDragOver }"
          @dragover.prevent="imageDragOver = true"
          @dragleave.prevent="imageDragOver = false"
          @drop.prevent="handleImageDrop"
        >
          <template v-if="!imagePreviewUrl">
            <Icon name="gallery" :size="40" :stroke-width="1" color="#aaa" />
            <p>拖拽图片到此处, 或点击下方按钮选择文件</p>
            <label class="btn btn--outline file-select-btn">
              <input type="file" accept="image/png,image/jpeg" @change="handleImageFile" class="file-input-hidden" />
              选择图片
            </label>
          </template>
          <template v-else>
            <canvas ref="imagePreviewCanvas" :style="imageCanvasStyle" class="image-preview-canvas" />
            <p style="margin-top:8px;">{{ imageLongEdge }}px 长边预览</p>
            <div class="image-preview-actions">
              <label class="btn btn--ghost btn--sm">
                <input type="file" accept="image/png,image/jpeg" @change="handleImageFile" class="file-input-hidden" />
                重新选择
              </label>
              <button class="btn btn--primary" @click="processImage" :disabled="imageProcessing">
                <template v-if="imageProcessing"><div class="loading-spinner-sm" /><span>处理中...</span></template>
                <template v-else><Icon name="check" :size="16" /><span>导入并编辑</span></template>
              </button>
            </div>
          </template>
        </div>
      </template>
    </div>

    <Toast ref="toastRef" />
  </div>
</template>

<style scoped lang="scss">
.import-view { height: calc(100vh - $header-height); overflow-y: auto; @include scrollbar-thin; }
.import-content { max-width: 720px; margin: 0 auto; padding: 32px 24px 60px; }
.import-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
.import-subtitle { font-size: 14px; color: $color-text-secondary; line-height: 1.6; margin-bottom: 24px; }

// Tabs
.import-tabs { display: flex; gap: 2px; margin-bottom: 10px; background: $color-bg; border-radius: $radius-md; padding: 3px; }
.import-tab { @include flex-center; gap: 6px; padding: 10px 20px; border-radius: $radius-sm; font-size: 14px; font-weight: 500; color: $color-text-secondary; cursor: pointer; transition: all $transition-fast; border: none; background: none;
  &.active { background: $color-white; color: $color-black; box-shadow: $shadow-sm; }
  &:hover:not(.active) { color: $color-black; }
}

// JSON
.import-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; @include mobile { grid-template-columns: 1fr; } }
.import-card { background: $color-white; border: 1.5px solid $color-light; border-radius: $radius-lg; padding: 24px 20px; text-align: center; cursor: pointer; transition: all $transition-fast;
  &:hover { border-color: $color-mid-light; box-shadow: $shadow-sm; transform: translateY(-1px); }
  .card-icon { margin-bottom: 12px; color: $color-mid-dark; }
  h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: $color-text; }
  p { font-size: 12px; color: $color-mid; line-height: 1.5; }
}
.file-select-btn { display: inline-block; margin-top: 14px; position: relative; cursor: pointer; overflow: hidden; }
.file-input-hidden { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.btn--sm { position: relative; overflow: hidden; }

.text-area-section { margin-bottom: 24px; }
.json-textarea { width: 100%; padding: 14px; border: 1px solid $color-light; border-radius: $radius-md; font-family: monospace; font-size: 13px; line-height: 1.6; resize: vertical; background: $color-white; color: $color-text;
  &:focus { outline: none; border-color: $color-mid-dark; }
}
.text-area-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

.error-section { background: $color-white; border: 1px solid #fecaca; border-radius: $radius-md; padding: 16px 18px; margin-bottom: 24px; }
.error-header { display: flex; align-items: center; gap: 8px; color: $color-danger; font-weight: 600; font-size: 14px; margin-bottom: 10px; }
.error-list { font-size: 13px; color: $color-text-secondary; padding-left: 20px; line-height: 1.8; li { word-break: break-all; } }

.preview-section { background: $color-white; border: 1px solid $color-light; border-radius: $radius-lg; padding: 24px; }
.preview-header { @include flex-between; margin-bottom: 18px; h2 { font-size: 18px; font-weight: 700; } }
.btn-link { font-size: 13px; color: $color-mid-dark; cursor: pointer; background: none; border: none; &:hover { color: $color-black; text-decoration: underline; } }
.preview-info { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; padding: 16px; background: $color-bg; border-radius: $radius-md; }
.preview-row { display: flex; gap: 12px; }
.preview-label { font-size: 13px; color: $color-mid; width: 60px; flex-shrink: 0; }
.preview-value { font-size: 13px; color: $color-text; font-weight: 500; }

// Image
.field-label { display: block; font-size: 12px; font-weight: 600; color: $color-text-secondary; margin-bottom: 6px; }
.longedge-row { display: flex; align-items: center; gap: 12px; }
.longedge-slider { flex: 1; accent-color: $color-black; }
.longedge-num { width: 64px; padding: 6px 8px; border: 1px solid $color-light; border-radius: $radius-sm; font-size: 13px; font-family: monospace; text-align: center;
  &:focus { outline: none; border-color: $color-mid-dark; }
}

.image-drop-zone { background: $color-white; border: 2px dashed $color-light; border-radius: $radius-lg; padding: 40px 20px; text-align: center; transition: all $transition-fast; margin-bottom: 16px;
  &.drag-over { border-color: $color-black; background: $color-bg; }
  p { font-size: 13px; color: $color-mid; margin: 12px 0; }
}
.image-preview-canvas { display: block; margin: 0 auto; border: 1px solid $color-light; border-radius: $radius-sm; image-rendering: pixelated; }
.image-preview-actions { display: flex; justify-content: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }

// Buttons
.btn { @include flex-center; gap: 8px; padding: 10px 22px; border-radius: $radius-sm; font-size: 14px; font-weight: 500; cursor: pointer; transition: all $transition-fast;
  &--primary { background: $color-black; color: $color-white; &:hover { background: $color-dark; } &:disabled { opacity: 0.5; cursor: default; } }
  &--outline { background: transparent; border: 1.5px solid $color-light; color: $color-text-secondary; &:hover { border-color: $color-mid-dark; background: $color-bg; } }
  &--ghost { background: transparent; color: $color-text-secondary; border: 1px solid $color-light; &:hover { background: $color-bg; } }
  &--large { padding: 12px 28px; font-size: 15px; width: 100%; justify-content: center; }
  &--sm { padding: 6px 14px; font-size: 12px; }
}
.loading-spinner-sm { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: $color-white; border-radius: 50%; animation: spin 0.6s linear infinite; }

.format-help { margin-top: 32px; padding: 16px; background: $color-white; border: 1px solid $color-light; border-radius: $radius-md;
  summary { font-size: 13px; color: $color-mid-dark; cursor: pointer; font-weight: 500; }
}
.format-example { margin-top: 12px; padding: 14px; background: $color-bg; border-radius: $radius-sm; font-family: monospace; font-size: 12px; line-height: 1.6; color: $color-text-secondary; overflow-x: auto; }
</style>
