<script setup lang="ts">
/**
 * App 根组件
 */

import AppHeader from '@/components/AppHeader.vue'
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const isEditor = computed(() => route.name === 'editor')
</script>

<template>
  <div class="app-layout">
    <!-- 编辑器模式下隐藏头部导航以腾出更多空间 -->
    <AppHeader v-if="!isEditor" />
    <router-view v-slot="{ Component }">
      <Transition name="route" mode="out-in">
        <component :is="Component" />
      </Transition>
    </router-view>
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.route-enter-active {
  animation: fadeIn 0.2s ease;
}

.route-leave-active {
  animation: fadeIn 0.15s ease reverse;
}
</style>
