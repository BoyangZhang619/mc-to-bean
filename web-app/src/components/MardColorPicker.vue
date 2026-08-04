<script setup lang="ts">
/**
 * MARD 色卡分组选择器
 * 按色系分组, 可折叠, 点击色块选中
 */

import { ref, computed } from 'vue'
import { getMardGroups, type MardColor } from '@/utils/mard'

const groups = computed(() => getMardGroups())
const collapsedGroups = ref<Set<string>>(new Set())

const model = defineModel<string>({ default: '#ffffff' })

function toggleGroup(key: string) {
  if (collapsedGroups.value.has(key)) {
    collapsedGroups.value.delete(key)
  } else {
    collapsedGroups.value.add(key)
  }
}

const expandedAll = computed(() => collapsedGroups.value.size === 0)

function toggleAll() {
  if (expandedAll.value) {
    // 全部收起
    for (const g of groups.value) {
      collapsedGroups.value.add(g.key)
    }
  } else {
    collapsedGroups.value.clear()
  }
}

function selectColor(rgb: [number, number, number]) {
  const hex = '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
  model.value = hex
}

function isSelected(rgb: [number, number, number]): boolean {
  const hex = '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
  return model.value === hex
}
</script>

<template>
  <div class="mard-picker">
    <div class="mard-header">
      <span class="mard-title">MARD 色卡</span>
      <button class="mard-toggle-all" @click="toggleAll">
        {{ expandedAll ? '收起全部' : '展开全部' }}
      </button>
    </div>

    <div class="mard-groups">
      <div
        v-for="group in groups"
        :key="group.key"
        class="mard-group"
      >
        <!-- 分组标题行 -->
        <button
          class="mard-group-header"
          @click="toggleGroup(group.key)"
        >
          <span class="group-arrow" :class="{ collapsed: collapsedGroups.has(group.key) }">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="2,3 5,6 8,3" />
            </svg>
          </span>
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.colors.length }}</span>
        </button>

        <!-- 色块列表 -->
        <div
          v-show="!collapsedGroups.has(group.key)"
          class="mard-colors"
        >
          <button
            v-for="color in group.colors"
            :key="color.code"
            class="mard-color-btn"
            :class="{ selected: isSelected(color.rgb) }"
            :title="`${color.code} ${color.name} RGB(${color.rgb.join(',')})`"
            @click="selectColor(color.rgb)"
          >
            <span
              class="mard-color-swatch"
              :style="{ background: `rgb(${color.rgb.join(',')})` }"
            />
            <span class="mard-color-code">{{ color.code }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mard-picker {
  border: 1px solid $color-light;
  border-radius: $radius-md;
  overflow: hidden;
}

.mard-header {
  @include flex-between;
  padding: 8px 12px;
  background: $color-bg;

  .mard-title {
    font-size: 12px;
    font-weight: 600;
    color: $color-text-secondary;
  }

  .mard-toggle-all {
    font-size: 11px;
    color: $color-mid-dark;
    cursor: pointer;
    background: none;
    border: none;

    &:hover {
      color: $color-black;
    }
  }
}

.mard-groups {
  overflow-y: auto;
  @include scrollbar-thin;
}

.mard-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  cursor: pointer;
  border: none;
  background: none;
  color: $color-text-secondary;
  font-size: 12px;
  border-bottom: 1px solid $color-bg;
  transition: background $transition-fast;

  &:hover {
    background: $color-bg;
  }
}

.group-arrow {
  display: inline-flex;
  align-items: center;
  transition: transform 0.15s ease;
  color: $color-mid;

  &.collapsed {
    transform: rotate(-90deg);
  }
}

.group-label {
  font-weight: 500;
  flex: 1;
  text-align: left;
}

.group-count {
  font-size: 10px;
  color: $color-mid;
}

.mard-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 6px 8px;
}

.mard-color-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 3px;
  border-radius: $radius-sm;
  border: 1.5px solid transparent;
  cursor: pointer;
  background: none;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
    border-color: $color-mid-light;
  }

  &.selected {
    border-color: $color-black;
    background: $color-bg-active;
    box-shadow: $shadow-sm;
  }
}

.mard-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 2px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.mard-color-code {
  font-size: 10px;
  font-weight: 500;
  color: $color-text-secondary;
  font-family: monospace;
  line-height: 1;
}
</style>
