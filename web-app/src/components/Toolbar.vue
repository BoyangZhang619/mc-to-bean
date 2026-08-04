<script setup lang="ts">
/**
 * 编辑器工具栏 -- 工具选择、撤销重做、网格/背景控制
 */

import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import type { ToolType, IconName } from '@/types'
import Icon from './Icon.vue'

const editor = useEditorStore()

const toolDefs: { type: ToolType; icon: IconName; label: string; shortcut: string }[] = [
  { type: 'brush', icon: 'brush', label: '画笔', shortcut: 'B' },
  { type: 'eraser', icon: 'eraser', label: '橡皮', shortcut: 'E' },
  { type: 'fill', icon: 'fill', label: '填充', shortcut: 'G' },
  { type: 'eyedropper', icon: 'eyedropper', label: '取色器', shortcut: 'I' },
  { type: 'rect', icon: 'rect', label: '矩形', shortcut: 'R' },
  { type: 'line', icon: 'line', label: '直线', shortcut: 'L' },
  { type: 'move', icon: 'move', label: '平移', shortcut: 'H' },
]

const bgColors = ['#ffffff', '#f5f5f5', '#eeeeee', '#dddddd', '#aaaaaa', '#333333']

function setTool(type: ToolType) {
  editor.setTool(type)
}

const zoomPercent = computed(() => Math.round(editor.viewport.zoom * 100))
</script>

<template>
  <div class="toolbar">
    <!-- 工具按钮组 -->
    <div class="tool-group">
      <button
        v-for="t in toolDefs"
        :key="t.type"
        class="tool-btn"
        :class="{ active: editor.currentTool === t.type }"
        :title="`${t.label} (${t.shortcut})`"
        @click="setTool(t.type)"
      >
        <Icon :name="t.icon" :size="20" />
        <span class="tool-label">{{ t.label }}</span>
        <span class="tool-shortcut">{{ t.shortcut }}</span>
      </button>
    </div>

    <div class="tool-divider" />

    <!-- 撤销/重做 -->
    <div class="tool-group">
      <button
        class="tool-btn"
        :class="{ disabled: !editor.canUndo }"
        title="撤销 (Ctrl+Z)"
        @click="editor.undo()"
        :disabled="!editor.canUndo"
      >
        <Icon name="undo" :size="20" />
        <span class="tool-label">撤销</span>
      </button>
      <button
        class="tool-btn"
        :class="{ disabled: !editor.canRedo }"
        title="重做 (Ctrl+Shift+Z)"
        @click="editor.redo()"
        :disabled="!editor.canRedo"
      >
        <Icon name="redo" :size="20" />
        <span class="tool-label">重做</span>
      </button>
    </div>

    <div class="tool-divider" />

    <!-- 视图控制 -->
    <div class="tool-group">
      <button
        class="tool-btn"
        title="缩小"
        @click="editor.setViewport({ zoom: Math.max(0.1, editor.viewport.zoom / 1.2) })"
      >
        <Icon name="zoom-out" :size="20" />
      </button>
      <span class="zoom-display">{{ zoomPercent }}%</span>
      <button
        class="tool-btn"
        title="放大"
        @click="editor.setViewport({ zoom: Math.min(20, editor.viewport.zoom * 1.2) })"
      >
        <Icon name="zoom-in" :size="20" />
      </button>
    </div>

    <div class="tool-divider" />

    <!-- 网格开关 -->
    <div class="tool-group">
      <button
        class="tool-btn"
        :class="{ active: editor.showGrid }"
        title="网格线开关 (Ctrl+G)"
        @click="editor.showGrid = !editor.showGrid"
      >
        <Icon name="grid" :size="20" />
        <span class="tool-label">网格</span>
      </button>
    </div>

    <!-- 背景色 -->
    <div class="tool-group bg-group">
      <span class="group-label">背景</span>
      <div class="bg-swatches">
        <button
          v-for="bg in bgColors"
          :key="bg"
          class="bg-swatch"
          :class="{ active: editor.backgroundColor === bg }"
          :style="{ background: bg }"
          :title="bg"
          @click="editor.backgroundColor = bg"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.toolbar {
  width: $toolbar-width;
  background: $color-white;
  border-right: 1px solid $color-light;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  gap: 2px;
  overflow-y: auto;
  @include scrollbar-thin;

  @include mobile {
    flex-direction: row;
    width: 100%;
    height: 56px;
    border-right: none;
    border-top: 1px solid $color-light;
    padding: 4px 8px;
    gap: 2px;
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;

    // 左侧渐变遮罩提示可继续滑动
    &::before {
      content: '';
      position: sticky;
      left: 0;
      z-index: 2;
      width: 28px;
      min-width: 28px;
      height: 56px;
      margin-top: -4px;
      margin-bottom: -4px;
      margin-left: -8px;
      background: linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 100%);
      pointer-events: none;
    }

    // 右侧滑动提示箭头
    &::after {
      content: '';
      position: sticky;
      right: 6px;
      z-index: 2;
      width: 18px;
      min-width: 18px;
      height: 18px;
      align-self: center;
      margin-right: -4px;
      border-right: 2px solid $color-mid-light;
      border-bottom: 2px solid $color-mid-light;
      transform: rotate(-45deg);
      opacity: 0.6;
      pointer-events: none;
      animation: scrollHintBounce 1.8s ease-in-out infinite;
    }
  }
}

@keyframes scrollHintBounce {
  0%, 100% { transform: rotate(-45deg) translateX(0); }
  50% { transform: rotate(-45deg) translateX(-4px); }
}

.tool-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  @include mobile {
    flex-direction: row;
    gap: 2px;
  }
}

.tool-divider {
  width: 28px;
  height: 1px;
  background: $color-light;
  margin: 6px 0;

  @include mobile {
    width: 1px;
    height: 28px;
    margin: 0 4px;
    flex-shrink: 0;
  }
}

.tool-btn {
  @include flex-center;
  flex-direction: column;
  width: 44px;
  height: 44px;
  border-radius: $radius-sm;
  color: $color-mid-dark;
  transition: all $transition-fast;
  position: relative;

  &:hover {
    background: $color-bg;
    color: $color-black;
  }

  &.active {
    background: $color-black;
    color: $color-white;

    .tool-shortcut {
      color: $color-mid-light;
    }
  }

  &.disabled {
    opacity: 0.3;
    pointer-events: none;
  }

  @include mobile {
    width: 36px;
    height: 36px;
  }
}

.tool-label {
  font-size: 10px;
  line-height: 1;
  margin-top: 1px;

  @include mobile {
    display: none;
  }
}

.tool-shortcut {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 8px;
  color: $color-mid-light;
  font-weight: 600;

  @include mobile {
    display: none;
  }
}

.zoom-display {
  font-size: 11px;
  font-family: monospace;
  color: $color-mid-dark;
  padding: 4px 0;
}

.group-label {
  font-size: 10px;
  color: $color-mid;
  margin-bottom: 2px;
}

.bg-swatches {
  display: flex;
  flex-direction: column;
  gap: 3px;

  @include mobile {
    flex-direction: row;
  }
}

.bg-swatch {
  width: 20px;
  height: 20px;
  border-radius: $radius-sm;
  border: 2px solid $color-light;
  transition: transform $transition-fast;

  &.active {
    border-color: $color-black;
    transform: scale(1.15);
  }

  &:hover {
    transform: scale(1.1);
    border-color: $color-mid-dark;
  }
}
</style>
