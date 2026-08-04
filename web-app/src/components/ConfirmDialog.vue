<script setup lang="ts">
/**
 * 确认对话框
 */

defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
        <div class="dialog-box">
          <h3 class="dialog-title">{{ title }}</h3>
          <p class="dialog-message">{{ message }}</p>
          <div class="dialog-actions">
            <button class="btn btn--ghost" @click="emit('cancel')">
              {{ cancelText ?? '取消' }}
            </button>
            <button
              class="btn"
              :class="danger ? 'btn--danger' : 'btn--primary'"
              @click="emit('confirm')"
            >
              {{ confirmText ?? '确认' }}
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
  padding: 28px 32px;
  max-width: 400px;
  width: 90%;
  box-shadow: $shadow-lg;
  animation: fadeInScale 0.2s ease;
}

.dialog-title {
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 12px;
  color: $color-text;
}

.dialog-message {
  font-size: 14px;
  color: $color-text-secondary;
  line-height: 1.6;
  margin-bottom: 24px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  padding: 8px 20px;
  border-radius: $radius-sm;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &--primary {
    background: $color-black;
    color: $color-white;

    &:hover {
      background: $color-dark;
    }
  }

  &--danger {
    background: $color-danger;
    color: $color-white;

    &:hover {
      opacity: 0.9;
    }
  }

  &--ghost {
    background: transparent;
    color: $color-text-secondary;
    border: 1px solid $color-light;

    &:hover {
      background: $color-bg;
    }
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
