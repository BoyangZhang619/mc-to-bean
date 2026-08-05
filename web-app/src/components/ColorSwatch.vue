<script setup lang="ts">
/**
 * 色板面板 -- 分两区:
 *   上区: "图纸颜色" — palette 条目列表 + 当前色预览 + 颜色编辑
 *   下区: "MARD 色卡" — 分组折叠, 单击自动加入 palette 并设为当前色
 */

import { ref } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import MardColorPicker from './MardColorPicker.vue'
import Icon from './Icon.vue'

const editor = useEditorStore()

// 颜色编辑弹窗状态
const editingIndex = ref<number | null>(null)
const editR = ref(0)
const editG = ref(0)
const editB = ref(0)

const collapsed = ref(false)
const activeTab = ref<'colors' | 'mard'>('colors')

function selectColor(index: number) {
  editor.setCurrentColorIndex(index)
}

function startEdit(index: number, rgb: [number, number, number]) {
  editingIndex.value = index
  editR.value = rgb[0]
  editG.value = rgb[1]
  editB.value = rgb[2]
}

function saveEdit() {
  if (editingIndex.value === null) return
  editor.updatePaletteEntry(editingIndex.value, [
    Math.max(0, Math.min(255, editR.value)),
    Math.max(0, Math.min(255, editG.value)),
    Math.max(0, Math.min(255, editB.value)),
  ])
  editingIndex.value = null
}

function cancelEdit() {
  editingIndex.value = null
}

/**
 * MARD 色卡点击: 自动加入 palette (去重) 并设为当前色
 */
function addMardColor(hex: string) {
  if (!editor.pattern) return

  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  // 去重: 检查 palette 中是否已有此 RGB
  const existing = editor.pattern.palette.find(
    (p) => p.rgb[0] === r && p.rgb[1] === g && p.rgb[2] === b
  )
  if (existing) {
    editor.setCurrentColorIndex(existing.index)
    return
  }

  // 分配新 index (取当前最大 index + 1)
  const maxIdx = editor.pattern.palette.reduce((max, p) => Math.max(max, p.index), -1)
  const newIndex = maxIdx + 1

  // 追加到 palette
  editor.pattern.palette.push({
    index: newIndex,
    rgb: [r, g, b],
    code: null,
    name: null,
  })

  // 标记脏数据
  editor.pattern.updatedAt = Date.now()
  // Pinia 自动追踪 push — isDirty 由 save 检测, 不在此处设

  editor.setCurrentColorIndex(newIndex)
}
</script>

<template>
  <div class="color-swatch" :class="{ collapsed }">
    <!-- 头部 -->
    <div class="swatch-header">
      <span class="swatch-title">色板</span>
      <span class="swatch-count" v-if="editor.pattern">
        {{ editor.pattern.palette.length }} 色
      </span>
      <button class="collapse-btn" @click="collapsed = !collapsed" :title="collapsed ? '展开' : '收起'">
        <Icon :name="collapsed ? 'expand' : 'collapse'" :size="14" />
      </button>
    </div>

    <!-- 当前选中色大预览 -->
    <div class="current-color" v-if="editor.currentColor && !collapsed">
      <div
        class="current-color-preview"
        :style="{ background: `rgb(${editor.currentColor.rgb.join(',')})` }"
      />
      <div class="current-color-info">
        <span class="current-color-rgb">
          RGB({{ editor.currentColor.rgb.join(', ') }})
        </span>
        <span class="current-color-code" v-if="editor.currentColor.code">
          {{ editor.currentColor.code }}
        </span>
      </div>
    </div>

    <!-- Tab 导航 -->
    <div class="swatch-tabs" v-if="!collapsed">
      <button class="swatch-tab" :class="{ active: activeTab === 'colors' }" @click="activeTab = 'colors'">图纸颜色</button>
      <button class="swatch-tab" :class="{ active: activeTab === 'mard' }" @click="activeTab = 'mard'">MARD 色卡</button>
    </div>

    <!-- Tab: 图纸颜色列表 -->
    <div class="swatch-list" v-if="!collapsed && activeTab === 'colors'">
      <button
        v-for="entry in editor.colorStats"
        :key="entry.index"
        class="swatch-item"
        :class="{ active: editor.currentColorIndex === entry.index }"
        @click="selectColor(entry.index)"
        @dblclick="startEdit(entry.index, entry.rgb)"
      >
        <div
          class="swatch-color"
          :style="{ background: `rgb(${entry.rgb.join(',')})` }"
        />
        <div class="swatch-details">
          <span class="swatch-code" v-if="entry.code">{{ entry.code }}</span>
          <span class="swatch-rgb">RGB({{ entry.rgb.join(',') }})</span>
        </div>
        <div class="swatch-stats">
          <span class="swatch-count-num">{{ entry.count }}</span>
          <span class="swatch-percent">{{ entry.percentage.toFixed(1) }}%</span>
        </div>
      </button>
    </div>

    <!-- Tab: MARD 色卡 -->
    <div class="mard-section" v-if="!collapsed && activeTab === 'mard'">
      <p class="mard-section-hint">单击颜色自动加入图纸色板并设为画笔色</p>
      <MardColorPicker @update:model-value="addMardColor" />
    </div>

    <!-- 颜色编辑弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="editingIndex !== null" class="color-edit-overlay" @click.self="cancelEdit">
          <div class="color-edit-box">
            <h4 class="edit-title">编辑颜色</h4>
            <div class="color-preview-big" :style="{ background: `rgb(${editR},${editG},${editB})` }" />
            <div class="edit-inputs">
              <label class="edit-label">
                R
                <input type="number" v-model.number="editR" min="0" max="255" class="edit-input" />
              </label>
              <label class="edit-label">
                G
                <input type="number" v-model.number="editG" min="0" max="255" class="edit-input" />
              </label>
              <label class="edit-label">
                B
                <input type="number" v-model.number="editB" min="0" max="255" class="edit-input" />
              </label>
            </div>
            <input
              type="color"
              :value="`#${editR.toString(16).padStart(2,'0')}${editG.toString(16).padStart(2,'0')}${editB.toString(16).padStart(2,'0')}`"
              @input="(e: Event) => {
                const hex = (e.target as HTMLInputElement).value
                editR = parseInt(hex.slice(1,3), 16)
                editG = parseInt(hex.slice(3,5), 16)
                editB = parseInt(hex.slice(5,7), 16)
              }"
              class="native-picker"
            />
            <div class="edit-actions">
              <button class="btn btn--ghost-sm" @click="cancelEdit">取消</button>
              <button class="btn btn--primary-sm" @click="saveEdit">确认</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.color-swatch {
  width: $palette-width;
  background: $color-white;
  border-left: 1px solid $color-light;
  display: flex;
  flex-direction: column;
  transition: width $transition-normal;

  &.collapsed {
    width: 40px;
  }

  @include mobile {
    width: 100%;
    max-height: 50vh;
    border-left: none;
    border-top: 1px solid $color-light;

    &.collapsed {
      width: 100%;
      max-height: 44px;
    }
  }
}

.swatch-header {
  @include flex-between;
  padding: 12px 14px;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;

  .swatch-title {
    font-size: 13px;
    font-weight: 600;
    color: $color-text;
  }

  .swatch-count {
    font-size: 11px;
    color: $color-mid;
  }

  .collapse-btn {
    width: 24px;
    height: 24px;
    @include flex-center;
    border-radius: $radius-sm;
    color: $color-mid;

    &:hover {
      background: $color-bg;
      color: $color-black;
    }
  }
}

.current-color {
  padding: 12px 14px;
  border-bottom: 1px solid $color-light;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;
}

.current-color-preview {
  width: 44px;
  height: 44px;
  border-radius: $radius-md;
  border: 1px solid $color-mid-light;
  flex-shrink: 0;
}

.current-color-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  .current-color-rgb {
    font-size: 12px;
    color: $color-text-secondary;
    font-family: monospace;
  }

  .current-color-code {
    font-size: 14px;
    font-weight: 600;
    color: $color-text;
  }
}

// Tab 导航
.swatch-tabs {
  display: flex;
  border-bottom: 1px solid $color-light;
  flex-shrink: 0;
}

.swatch-tab {
  flex: 1;
  padding: 8px 0;
  font-size: 12px;
  font-weight: 500;
  color: $color-mid;
  text-align: center;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  transition: all $transition-fast;

  &:hover { color: $color-text-secondary; }
  &.active { color: $color-black; border-bottom-color: $color-black; font-weight: 600; }
}

.swatch-list {
  flex: 1;
  overflow-y: auto;
  min-height: 60px;
  @include scrollbar-thin;
}

.swatch-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 14px;
  cursor: pointer;
  transition: background $transition-fast;
  text-align: left;

  &:hover {
    background: $color-bg;
  }

  &.active {
    background: $color-bg-active;
    border-left: 3px solid $color-black;
  }
}

.swatch-color {
  width: 24px;
  height: 24px;
  border-radius: $radius-sm;
  border: 1px solid $color-mid-light;
  flex-shrink: 0;
}

.swatch-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;

  .swatch-code {
    font-size: 11px;
    font-weight: 600;
    color: $color-text;
  }

  .swatch-rgb {
    font-size: 9px;
    color: $color-mid;
    font-family: monospace;
  }
}

.swatch-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;

  .swatch-count-num {
    font-size: 11px;
    font-weight: 600;
    color: $color-text-secondary;
  }

  .swatch-percent {
    font-size: 9px;
    color: $color-mid;
  }
}

// MARD 色卡区域 (tab 内容)
.mard-section {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
}

.mard-section-hint {
  font-size: 10px;
  color: $color-mid;
  padding: 4px 14px 8px;
}

// 颜色编辑弹窗 (保持不变)
.color-edit-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  @include flex-center;
}

.color-edit-box {
  background: $color-white;
  border-radius: $radius-lg;
  padding: 24px;
  max-width: 300px;
  width: 90%;
  box-shadow: $shadow-lg;
}

.edit-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}

.color-preview-big {
  width: 100%;
  height: 60px;
  border-radius: $radius-md;
  border: 2px solid $color-light;
  margin-bottom: 16px;
}

.edit-inputs {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.edit-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: $color-mid;
  font-weight: 600;
}

.edit-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 13px;
  font-family: monospace;

  &:focus {
    outline: none;
    border-color: $color-mid-dark;
  }
}

.native-picker {
  width: 100%;
  height: 36px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  cursor: pointer;
  margin-bottom: 16px;
  padding: 2px;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 16px;
  border-radius: $radius-sm;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &--primary-sm {
    background: $color-black;
    color: $color-white;

    &:hover { background: $color-dark; }
  }

  &--ghost-sm {
    background: transparent;
    color: $color-text-secondary;
    border: 1px solid $color-light;

    &:hover { background: $color-bg; }
  }
}
</style>
