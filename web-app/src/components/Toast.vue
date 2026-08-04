<script setup lang="ts">
/**
 * Toast 消息通知组件
 */

import { ref } from 'vue'
import Icon from './Icon.vue'

export interface ToastMessage {
  id: number
  text: string
  type: 'info' | 'success' | 'error'
}

const toasts = ref<ToastMessage[]>([])
let nextId = 0

function show(text: string, type: 'info' | 'success' | 'error' = 'info', duration = 3000) {
  const id = nextId++
  toasts.value.push({ id, text, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)
}

function remove(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" v-if="toasts.length > 0">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast--${toast.type}`"
          @click="remove(toast.id)"
        >
          <Icon
            :name="toast.type === 'success' ? 'check' : toast.type === 'error' ? 'warning' : 'info'"
            :size="16"
            :stroke-width="2.5"
          />
          <span class="toast-text">{{ toast.text }}</span>
          <button class="toast-close" @click.stop="remove(toast.id)">
            <Icon name="close" :size="12" :stroke-width="2" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: $z-toast;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  box-shadow: $shadow-md;
  cursor: pointer;
  pointer-events: auto;
  animation: slideInRight 0.25s ease;
  transition: opacity $transition-fast;

  &:hover {
    opacity: 0.9;
  }

  &--success {
    border-left: 3px solid $color-success;
  }

  &--error {
    border-left: 3px solid $color-danger;
  }

  &--info {
    border-left: 3px solid $color-dark;
  }
}

.toast-text {
  flex: 1;
  font-size: 13px;
  color: $color-text;
  line-height: 1.4;
}

.toast-close {
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity $transition-fast;

  &:hover {
    opacity: 1;
  }
}

.toast-enter-active {
  animation: slideInRight 0.25s ease;
}

.toast-leave-active {
  animation: fadeIn 0.2s ease reverse;
}
</style>
