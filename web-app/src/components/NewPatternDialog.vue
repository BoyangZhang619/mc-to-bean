<script setup lang="ts">
/**
 * 新建图纸对话框
 * 输入: 名称、宽、高、背景色 (黑白灰预设 + 原生取色器)
 */
import { ref } from 'vue'

const props = defineProps<{
  visible: boolean
  initialName?: string
  initialWidth?: number
  initialHeight?: number
  initialBgColor?: string
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [name: string, width: number, height: number, bgColor: string]
}>()

const name = ref(props.initialName ?? '')
const width = ref(props.initialWidth ?? 16)
const height = ref(props.initialHeight ?? 16)
const bgColor = ref(props.initialBgColor ?? '#ffffff')

const presetColors = [
  '#ffffff', '#f5f5f5', '#eeeeee', '#dddddd', '#aaaaaa', '#888888',
  '#555555', '#333333', '#111111', '#000000',
]

function submit() {
  if (!name.value.trim()) return
  emit('confirm', name.value.trim(), width.value, height.value, bgColor.value)
}

function selectPreset(color: string) {
  bgColor.value = color
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
        <div class="dialog-box">
          <h3 class="dialog-title">新建图纸</h3>

          <!-- 名称 -->
          <div class="field">
            <label class="field-label">名称</label>
            <input
              v-model="name"
              type="text"
              class="field-input"
              placeholder="输入图纸名称"
              @keyup.enter="submit"
            />
          </div>

          <!-- 尺寸 -->
          <div class="field-row">
            <div class="field">
              <label class="field-label">宽度</label>
              <input
                v-model.number="width"
                type="number"
                min="1"
                max="256"
                class="field-input field-input--sm"
              />
            </div>
            <div class="field">
              <label class="field-label">高度</label>
              <input
                v-model.number="height"
                type="number"
                min="1"
                max="256"
                class="field-input field-input--sm"
              />
            </div>
          </div>

          <!-- 背景色: 当前预览 -->
          <div class="field">
            <label class="field-label">背景色</label>
            <div class="current-bg-preview">
              <div class="current-bg-swatch" :style="{ background: bgColor }" />
              <span class="current-bg-hex">{{ bgColor }}</span>
            </div>
          </div>

          <!-- 背景色: 预设色块 -->
          <div class="bg-presets">
            <button
              v-for="c in presetColors"
              :key="c"
              class="bg-preset-btn"
              :class="{ active: bgColor === c }"
              :style="{ background: c }"
              @click="selectPreset(c)"
            />
          </div>

          <!-- 背景色: 原生取色器 -->
          <input
            type="color"
            v-model="bgColor"
            class="native-color-picker"
          />

          <!-- 操作按钮 -->
          <div class="dialog-actions">
            <button class="btn btn--ghost" @click="emit('cancel')">取消</button>
            <button
              class="btn btn--primary"
              :disabled="!name.trim() || width < 1 || height < 1 || width > 256 || height > 256"
              @click="submit"
            >
              创建图纸
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: $color-overlay;
  z-index: $z-modal;
  @include flex-center;
}

.dialog-box {
  background: $color-white;
  border-radius: $radius-lg;
  padding: 24px 28px;
  max-width: 400px;
  width: 92%;
  box-shadow: $shadow-lg;
  animation: fadeInScale 0.2s ease;
}

.dialog-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 18px;
  color: $color-text;
}

.field {
  margin-bottom: 14px;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: $color-text-secondary;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.field-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 14px;
  color: $color-text;
  transition: border-color $transition-fast;

  &:focus {
    outline: none;
    border-color: $color-mid-dark;
  }

  &--sm {
    width: 100%;
  }
}

.field-row {
  display: flex;
  gap: 14px;

  .field {
    flex: 1;
  }
}

.current-bg-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  background: $color-bg;
}

.current-bg-swatch {
  width: 36px;
  height: 36px;
  border-radius: $radius-sm;
  border: 2px solid $color-light;
  flex-shrink: 0;
}

.current-bg-hex {
  font-size: 13px;
  font-family: monospace;
  color: $color-text-secondary;
}

.bg-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.bg-preset-btn {
  width: 32px;
  height: 32px;
  border-radius: $radius-sm;
  border: 2px solid $color-light;
  cursor: pointer;
  transition: all $transition-fast;

  &.active {
    border-color: $color-black;
    transform: scale(1.15);
    box-shadow: $shadow-sm;
  }

  &:hover {
    transform: scale(1.1);
    border-color: $color-mid-dark;
  }
}

.native-color-picker {
  width: 100%;
  height: 40px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  cursor: pointer;
  background: $color-white;
  padding: 4px 8px;
  margin-bottom: 4px;

  &:hover {
    border-color: $color-mid-dark;
  }
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  padding: 9px 22px;
  border-radius: $radius-sm;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &--primary {
    background: $color-black;
    color: $color-white;

    &:hover { background: $color-dark; }
    &:disabled { opacity: 0.4; cursor: default; }
  }

  &--ghost {
    background: transparent;
    color: $color-text-secondary;
    border: 1px solid $color-light;

    &:hover { background: $color-bg; }
  }
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;

  .dialog-box {
    transition: transform 0.2s ease;
  }
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;

  .dialog-box {
    transform: scale(0.95);
  }
}
</style>
