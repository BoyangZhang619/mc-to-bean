<script setup lang="ts">
/**
 * 编辑器页面 -- 核心功能页
 * 布局: 顶部状态栏 + 左侧工具条 + 中央画布 + 右侧色板
 * 移动端: 底部工具条 + 画布 + 色板底部抽屉
 */

import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useEditorStore } from '@/stores/editorStore'
import { usePatternStore } from '@/stores/patternStore'
import { useKeyboard } from '@/composables/useKeyboard'
import { exportContractJson } from '@/utils/contract'
import { exportFullPng, exportPatternPanelPng, type LegendStyle } from '@/utils/renderer'
import type { Pattern } from '@/types'
import CanvasGrid from '@/components/CanvasGrid.vue'
import Toolbar from '@/components/Toolbar.vue'
import ColorSwatch from '@/components/ColorSwatch.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import NewPatternDialog from '@/components/NewPatternDialog.vue'
import Toast from '@/components/Toast.vue'
import Icon from '@/components/Icon.vue'
import { registerDefaultTools } from '@/utils/toolRegistry'

// P3-2: 初始化工具注册表
registerDefaultTools()

const route = useRoute()
const router = useRouter()
const editor = useEditorStore()
const patternStore = usePatternStore()

// 键盘快捷键
useKeyboard()

const toastRef = ref<InstanceType<typeof Toast> | null>(null)
const canvasRef = ref<InstanceType<typeof CanvasGrid> | null>(null)
const loading = ref(true)

// Resize 弹窗
const showResizeDialog = ref(false)
const resizeWidth = ref(0)
const resizeHeight = ref(0)
const resizeFill = ref<'crop' | 'extend' | 'scale'>('extend')
const resizeAnchor = ref<'top-left' | 'center'>('center')

// 导出选项
const showExportMenu = ref(false)

// 移动端色板抽屉
const paletteDrawerOpen = ref(false)

// 另存为 / 新建
const showSaveAsDialog = ref(false)
const saveAsName = ref('')

// 保存状态文字
const saveStatusText = computed(() => {
  switch (editor.saveStatus) {
    case 'saved': return '已保存'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
  return ''
})

// 加载图纸
onMounted(async () => {
  const id = route.params.id as string
  const pattern = await patternStore.getById(id)
  if (!pattern) {
    toastRef.value?.show('图纸不存在', 'error')
    router.push('/gallery')
    return
  }
  editor.loadPattern(pattern)
  loading.value = false
})

// 颜色替换结果 toast
watch(() => editor.replaceMessage, (msg) => {
  if (msg) {
    toastRef.value?.show(msg, msg.startsWith('已替换') ? 'success' : 'info')
    editor.replaceMessage = null
  }
})

// 离开确认
onBeforeRouteLeave((_to, _from, next) => {
  if (editor.isDirty) {
    const confirm = window.confirm('你有未保存的更改, 确定要离开吗?')
    if (!confirm) {
      next(false)
      return
    }
  }
  next()
})

// 手动保存 (带遮罩动画)
async function handleSave() {
  if (editor.isSaving) return
  editor.isSaving = true

  try {
    const ok = await editor.save()
    if (ok) {
      toastRef.value?.show('保存成功', 'success')
    } else {
      toastRef.value?.show('保存失败', 'error')
    }
  } catch (e: any) {
    toastRef.value?.show('保存失败', 'error')
  } finally {
    editor.isSaving = false
  }
}

// 导出 PNG (带图例的完整面板)
function handleExportPngPanel(style: LegendStyle) {
  if (!editor.pattern) return
  const dataUrl = exportPatternPanelPng(editor.pattern, {
    cellSize: 16,
    showGrid: editor.showGrid,
    backgroundColor: editor.backgroundColor,
    legendStyle: style,
  })
  fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${editor.pattern!.name}.png`
      a.click()
      URL.revokeObjectURL(url)
      toastRef.value?.show('PNG 导出成功', 'success')
    })
}

// 导出 PNG (仅网格, 无图例)
function handleExportPng() {
  if (!editor.pattern) return
  const dataUrl = exportFullPng(editor.pattern, 16, editor.showGrid, editor.backgroundColor)
  fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${editor.pattern!.name}.png`
      a.click()
      URL.revokeObjectURL(url)
      toastRef.value?.show('PNG 导出成功', 'success')
    })
}

// 导出 JSON
function handleExportJson() {
  if (!editor.pattern) return
  const json = exportContractJson(editor.pattern)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${editor.pattern.name}.json`
  a.click()
  URL.revokeObjectURL(url)
  toastRef.value?.show('JSON 导出成功', 'success')
}

// 另存为新图纸
async function handleSaveAsNew() {
  if (!editor.pattern) return
  saveAsName.value = `${editor.pattern.name} (副本)`
  showSaveAsDialog.value = true
}

async function handleCreateNew(name: string, _width: number, _height: number, _bgColor: string) {
  // 从编辑器触发: 使用当前图纸参数作为默认, 名称用用户输入
  showSaveAsDialog.value = false
}

async function confirmSaveAsNew(newName: string, _w: number, _h: number, _bgColor: string) {
  const clone = await editor.saveAsNew(newName)
  if (clone) {
    toastRef.value?.show('已保存为新图纸', 'success')
  } else {
    toastRef.value?.show('另存失败', 'error')
  }
}

// Resize
function openResizeDialog() {
  if (!editor.pattern) return
  resizeWidth.value = editor.pattern.width
  resizeHeight.value = editor.pattern.height
  showResizeDialog.value = true
}

function doResize() {
  editor.resizePattern(resizeWidth.value, resizeHeight.value, resizeFill.value, resizeAnchor.value)
  showResizeDialog.value = false
  toastRef.value?.show('尺寸已调整', 'success')
}

// 返回画廊
function goBack() {
  router.push('/gallery')
}

// 1:1 缩放 (委托 CanvasGrid 计算准确容器尺寸)
function zoomToFit() {
  canvasRef.value?.zoomToFit()
}

// 监听 ESC 关闭弹窗
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    showExportMenu.value = false
    showResizeDialog.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="editor-view">
    <div v-if="loading" class="editor-loading">
      <div class="loading-spinner" />
      <span>加载图纸中...</span>
    </div>

    <template v-else-if="editor.pattern">
      <!-- 顶部状态栏 (PC + 移动端共用) -->
      <div class="editor-topbar">
        <div class="topbar-left">
          <button class="back-btn" @click="goBack" title="返回图纸库">
            <Icon name="arrow-left" :size="18" />
          </button>
          <div class="pattern-title-area">
            <h1 class="pattern-title">
              {{ editor.pattern.name }}
              <span v-if="editor.isDirty" class="unsaved-dot" title="有未保存的更改" />
            </h1>
            <span class="pattern-dims">
              {{ editor.pattern.width }} x {{ editor.pattern.height }}
              | {{ editor.pattern.palette.length }} 色
            </span>
          </div>
        </div>
        <div class="topbar-right desktop-only">
          <span class="save-status" :class="`status--${editor.saveStatus}`">
            {{ saveStatusText }}
          </span>
          <button class="topbar-btn" @click="handleSave" title="保存 (Ctrl+S)">
            <Icon name="save" :size="16" />
            <span>保存</span>
          </button>
          <button class="topbar-btn" @click="handleSaveAsNew" title="另存为新图纸">
            <Icon name="plus" :size="16" />
            <span>另存为</span>
          </button>
          <button class="topbar-btn" @click="zoomToFit" title="适应窗口">
            <Icon name="expand" :size="16" />
          </button>
          <button class="topbar-btn" @click="openResizeDialog" title="调整尺寸">
            <Icon name="resize" :size="16" />
          </button>
          <div class="export-menu-wrapper">
            <button class="topbar-btn" @click="showExportMenu = !showExportMenu" title="导出">
              <Icon name="export" :size="16" />
              <span>导出</span>
            </button>
            <Transition name="fade-scale">
              <div v-if="showExportMenu" class="export-dropdown">
                <div class="export-section-title">PNG (完整面板)</div>
                <button @click="handleExportPngPanel('simple'); showExportMenu = false">
                  <Icon name="export" :size="14" /><span>Simple</span>
                </button>
                <button @click="handleExportPngPanel('detail'); showExportMenu = false">
                  <Icon name="info" :size="14" /><span>Detail</span>
                </button>
                <button @click="handleExportPngPanel('pure'); showExportMenu = false">
                  <Icon name="palette" :size="14" /><span>Pure</span>
                </button>
                <div class="export-divider" />
                <button @click="handleExportPng(); showExportMenu = false">
                  <Icon name="gallery" :size="14" /><span>导出 PNG</span>
                </button>
                <button @click="handleExportJson(); showExportMenu = false">
                  <Icon name="save" :size="14" /><span>导出 JSON</span>
                </button>
              </div>
            </Transition>
          </div>
        </div>
        <!-- 移动端: 色板 + 更多菜单 -->
        <div class="topbar-right mobile-only">
          <button class="topbar-btn" @click="handleSave" title="保存">
            <Icon name="save" :size="16" />
          </button>
          <button class="topbar-btn" :class="{ active: paletteDrawerOpen }" @click="paletteDrawerOpen = !paletteDrawerOpen" title="色板">
            <Icon name="palette" :size="16" />
          </button>
          <div class="export-menu-wrapper">
            <button class="topbar-btn" @click="showExportMenu = !showExportMenu" title="更多">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            <Transition name="fade-scale">
              <div v-if="showExportMenu" class="export-dropdown mobile-more-menu">
                <button @click="handleSaveAsNew(); showExportMenu = false">
                  <Icon name="plus" :size="14" /><span>另存为</span>
                </button>
                <button @click="zoomToFit(); showExportMenu = false">
                  <Icon name="expand" :size="14" /><span>适应窗口</span>
                </button>
                <button @click="openResizeDialog(); showExportMenu = false">
                  <Icon name="resize" :size="14" /><span>调整尺寸</span>
                </button>
                <div class="export-divider" />
                <button @click="handleExportPngPanel('simple'); showExportMenu = false">
                  <Icon name="export" :size="14" /><span>导出 PNG</span>
                </button>
                <button @click="handleExportJson(); showExportMenu = false">
                  <Icon name="save" :size="14" /><span>导出 JSON</span>
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <!-- 主编辑区域 -->
      <div class="editor-main">
        <Toolbar class="desktop-toolbar" />
        <CanvasGrid ref="canvasRef" />
        <ColorSwatch class="desktop-palette" />
      </div>

      <!-- 移动端: 底部核心工具栏 (紧凑模式) -->
      <div class="mobile-bottom-bar mobile-only">
        <Toolbar compact />
      </div>

      <!-- 移动端: 色板右侧面板 -->
      <Teleport to="body">
        <Transition name="palette-slide">
          <div v-if="paletteDrawerOpen" class="palette-overlay" @click.self="paletteDrawerOpen = false">
            <aside class="palette-panel" @click.stop>
              <div class="palette-panel-header">
                <span>色板</span>
                <button @click="paletteDrawerOpen = false">
                  <Icon name="close" :size="18" />
                </button>
              </div>
              <div class="palette-panel-body">
                <ColorSwatch />
              </div>
            </aside>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- 另存为新图纸弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="showSaveAsDialog" class="dialog-overlay" @click.self="showSaveAsDialog = false">
          <div class="resize-dialog">
            <h3>另存为新图纸</h3>
            <div class="field" style="margin-bottom: 20px;">
              <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">名称</label>
              <input
                v-model="saveAsName"
                type="text"
                class="saveas-input"
                @keyup.enter="confirmSaveAsNew(saveAsName.trim() || editor.pattern!.name, editor.pattern!.width, editor.pattern!.height, editor.backgroundColor)"
              />
            </div>
            <div class="dialog-actions">
              <button class="btn btn--ghost" @click="showSaveAsDialog = false">取消</button>
              <button
                class="btn btn--primary"
                :disabled="!saveAsName.trim()"
                @click="confirmSaveAsNew(saveAsName.trim(), editor.pattern!.width, editor.pattern!.height, editor.backgroundColor)"
              >
                确认另存
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Resize 弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="showResizeDialog" class="dialog-overlay" @click.self="showResizeDialog = false">
          <div class="resize-dialog">
            <h3>调整图纸尺寸</h3>
            <div class="resize-inputs">
              <label>
                宽度
                <input type="number" v-model.number="resizeWidth" min="1" max="512" />
              </label>
              <label>
                高度
                <input type="number" v-model.number="resizeHeight" min="1" max="512" />
              </label>
            </div>
            <div class="resize-options">
              <label class="radio-label">
                <input type="radio" v-model="resizeFill" value="extend" />
                扩展留白
              </label>
              <label class="radio-label">
                <input type="radio" v-model="resizeFill" value="crop" />
                截断
              </label>
              <label class="radio-label">
                <input type="radio" v-model="resizeFill" value="scale" />
                缩放内容
              </label>
            </div>
            <div class="resize-options" v-if="resizeFill !== 'scale'">
              <label class="radio-label">
                <input type="radio" v-model="resizeAnchor" value="top-left" />
                左上对齐
              </label>
              <label class="radio-label">
                <input type="radio" v-model="resizeAnchor" value="center" />
                居中
              </label>
            </div>
            <div class="dialog-actions">
              <button class="btn btn--ghost" @click="showResizeDialog = false">取消</button>
              <button class="btn btn--primary" @click="doResize">确认调整</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 保存动画遮罩 -->
    <Teleport to="body">
      <Transition name="save-overlay">
        <div v-if="editor.isSaving" class="save-overlay">
          <div class="save-spinner-wrap">
            <div class="save-spinner" />
            <span class="save-text">保存中...</span>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Toast ref="toastRef" />
  </div>
</template>

<style scoped lang="scss">
.editor-view {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-loading {
  @include flex-center;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  color: $color-mid;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

// ==================== 顶部状态栏 ====================
.editor-topbar {
  height: 44px;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  z-index: 10;
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

.pattern-title-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pattern-title {
  font-size: 14px;
  font-weight: 600;
  @include text-ellipsis;
}

.pattern-dims {
  font-size: 11px;
  color: $color-mid;
  font-family: monospace;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.save-status {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: $radius-sm;
  font-weight: 500;

  &.status--saved {
    color: $color-success;
    background: rgba(39, 174, 96, 0.08);
  }

  &.status--saving {
    color: $color-mid;
    background: $color-bg;
  }

  &.status--unsaved {
    color: $color-danger;
    background: rgba(192, 57, 43, 0.08);
  }
}

.topbar-btn {
  @include flex-center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: $radius-sm;
  font-size: 12px;
  color: $color-text-secondary;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
    color: $color-black;
  }
}

.export-menu-wrapper {
  position: relative;
}

.export-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  box-shadow: $shadow-md;
  padding: 4px;
  z-index: 100;
  min-width: 220px;

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border-radius: $radius-sm;
    font-size: 13px;
    color: $color-text-secondary;
    transition: all $transition-fast;

    &:hover {
      background: $color-bg;
      color: $color-black;
    }
  }
}

.export-section-title {
  font-size: 10px;
  font-weight: 600;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 12px 2px;
}

.export-divider {
  height: 1px;
  background: $color-light;
  margin: 4px 8px;
}

// ==================== 主编辑区域 ====================
.editor-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;

  @include mobile {
    flex-direction: column;
  }
}

.desktop-toolbar {
  @include mobile {
    display: none;
  }
}

.desktop-palette {
  @include mobile {
    display: none;
  }
}

// ==================== 移动端底部栏 ====================
.mobile-bottom-bar {
  flex-shrink: 0;
  background: $color-white;
  border-top: 1px solid $color-light;
  overflow-x: auto;
  display: flex;

  &::-webkit-scrollbar { display: none; }
}

// ==================== 移动端色板右侧面板 ====================
.palette-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  display: flex;
  justify-content: flex-end;
}

.palette-panel {
  width: 280px;
  max-width: 85vw;
  height: 100%;
  background: $color-white;
  display: flex;
  flex-direction: column;
  box-shadow: $shadow-lg;
  overflow: hidden;
}

.palette-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid $color-light;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;

  button {
    width: 36px; height: 36px;
    @include flex-center;
    border-radius: $radius-sm;
    color: $color-mid-dark;
    &:hover { background: $color-bg; }
  }
}

.palette-panel-body {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
}

.palette-slide-enter-active {
  animation: paletteSlideIn 0.25s ease;
  .palette-panel { animation: slideInRight 0.25s ease; }
}
.palette-slide-leave-active {
  animation: paletteSlideIn 0.2s ease reverse;
  .palette-panel { animation: slideInRight 0.2s ease reverse; }
}

@keyframes paletteSlideIn {
  from { background: transparent; }
  to { background: $color-overlay; }
}

// ==================== 移动端更多菜单 ====================
.mobile-more-menu {
  right: 0;
  min-width: 170px !important;
}

// ==================== Resize 弹窗 ====================
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  @include flex-center;
}

.resize-dialog {
  background: $color-white;
  border-radius: $radius-lg;
  padding: 28px;
  max-width: 380px;
  width: 90%;
  box-shadow: $shadow-lg;

  h3 {
    font-size: 17px;
    font-weight: 600;
    margin-bottom: 20px;
  }
}

.resize-inputs {
  display: flex;
  gap: 16px;
  margin-bottom: 18px;

  label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: $color-mid;
    font-weight: 500;
  }

  input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid $color-light;
    border-radius: $radius-sm;
    font-size: 14px;
    font-family: monospace;

    &:focus {
      outline: none;
      border-color: $color-mid-dark;
    }
  }
}

.resize-options {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: $color-text-secondary;
  cursor: pointer;

  input[type="radio"] {
    accent-color: $color-black;
  }
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  padding: 8px 18px;
  border-radius: $radius-sm;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &--primary {
    background: $color-black;
    color: $color-white;

    &:hover { background: $color-dark; }
  }

  &--ghost {
    background: transparent;
    color: $color-text-secondary;
    border: 1px solid $color-light;

    &:hover { background: $color-bg; }
  }
}

// 另存为新图纸输入框
.saveas-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 14px;
  color: $color-text;
  transition: border-color $transition-fast;

  &:focus {
    outline: none;
    border-color: $color-mid-dark;
  }
}

// ==================== 响应式工具类 ====================
.desktop-only {
  @include mobile {
    display: none;
  }
}

.mobile-only {
  display: none;

  @include mobile {
    display: flex;
  }
}

// ==================== 过渡动画 ====================
.fade-scale-enter-active {
  animation: fadeInScale 0.15s ease;
}

.fade-scale-leave-active {
  animation: fadeInScale 0.1s ease reverse;
}

.slide-up-enter-active {
  animation: slideInUp 0.25s ease;
}

.slide-up-leave-active {
  animation: slideInUp 0.2s ease reverse;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;

  .resize-dialog {
    transition: transform 0.2s ease;
  }
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;

  .resize-dialog {
    transform: scale(0.95);
  }
}

// 未保存指示圆点
.unsaved-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: $color-danger;
  margin-left: 6px;
  vertical-align: middle;
  animation: pulse 1.5s ease infinite;
}

// 保存动画遮罩
.save-overlay {
  position: fixed;
  inset: 0;
  z-index: $z-overlay;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  @include flex-center;
}

.save-spinner-wrap {
  @include flex-center;
  flex-direction: column;
  gap: 16px;
  background: $color-white;
  border-radius: $radius-lg;
  padding: 36px 48px;
  box-shadow: $shadow-lg;
}

.save-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid $color-light;
  border-top-color: $color-black;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.save-text {
  font-size: 15px;
  font-weight: 500;
  color: $color-text-secondary;
}

.save-overlay-enter-active {
  transition: opacity 0.25s ease;
}

.save-overlay-leave-active {
  transition: opacity 0.2s ease;
}

.save-overlay-enter-from,
.save-overlay-leave-to {
  opacity: 0;
}
</style>
