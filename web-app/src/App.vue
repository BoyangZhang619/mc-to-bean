<script setup lang="ts">
/**
 * App 根组件
 *
 * 布局:
 * - PC (>=1024px): 左侧侧栏 + 内容区 (flex row)
 * - 移动端 (<1024px): 顶部栏 + 内容区 (flex column)
 * - 编辑器: 全屏 (无侧栏、无顶部栏)
 */

import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const isFullScreen = computed(() => route.name === 'editor')
</script>

<template>
  <div class="app-layout" :class="{ 'app-layout--editor': isFullScreen }">
    <!-- 编辑器模式: 全屏, 无导航 -->
    <template v-if="isFullScreen">
      <router-view v-slot="{ Component }">
        <Transition name="route" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </template>

    <!-- 非编辑器: 侧栏(PC) + 顶部栏(移动端) + 内容区 -->
    <template v-else>
      <!-- PC 侧栏 (>=1024px 显示): 必须用 div 包裹, 否则 scoped CSS 无法作用到子组件根元素 -->
      <div class="layout-sidebar">
        <AppSidebar />
      </div>
      <!-- 移动端顶部栏 (<1024px 显示) -->
      <div class="layout-header">
        <AppHeader />
      </div>
      <main class="layout-main">
        <router-view v-slot="{ Component }">
          <Transition name="route" mode="out-in">
            <component :is="Component" />
          </Transition>
        </router-view>
      </main>
    </template>
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  width: 100vw;
  height: 100vh;
  display: flex;
  overflow: hidden;

  // 移动端: 纵向布局
  @include mobile {
    flex-direction: column;
  }

  // 编辑器模式: 全屏, 无导航
  &--editor {
    flex-direction: column;
  }
}

// PC 侧栏 (>=1024px 显示)
.layout-sidebar {
  display: flex;

  @include mobile {
    display: none;
  }
}

// 移动端顶部栏 (<1024px 显示)
.layout-header {
  display: none;

  @include mobile {
    display: flex;
    flex-direction: column;
  }

  // 编辑器模式下隐藏
  .app-layout--editor & {
    display: none;
  }
}

// 主内容区
.layout-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.route-enter-active {
  animation: fadeIn 0.2s ease;
}

.route-leave-active {
  animation: fadeIn 0.15s ease reverse;
}
</style>
