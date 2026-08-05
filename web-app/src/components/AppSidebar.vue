<script setup lang="ts">
/**
 * PC 端侧栏导航
 * >=1024px 显示，垂直布局：Logo + 导航项 + 底部版本号
 */

import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'

const route = useRoute()
const router = useRouter()

const navItems = [
  { to: '/', label: '首页', icon: 'home' as const },
  { to: '/gallery', label: '图纸库', icon: 'gallery' as const },
  { to: '/official', label: '官方图纸', icon: 'palette' as const },
  { to: '/tools/fonts', label: '字体生成', icon: 'rename' as const },
  { to: '/import', label: '导入', icon: 'import' as const },
]

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-top">
      <!-- Logo -->
      <router-link to="/" class="sidebar-brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="8" height="8" fill="#333" />
          <rect x="14" y="2" width="8" height="8" fill="#555" />
          <rect x="2" y="14" width="8" height="8" fill="#555" />
          <rect x="14" y="14" width="8" height="8" fill="#333" />
        </svg>
        <span class="brand-text">拼豆图纸</span>
      </router-link>

      <!-- 导航项 -->
      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          :class="{ active: isActive(item.to) }"
        >
          <Icon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </div>

    <!-- 底部版本 -->
    <div class="sidebar-bottom">
      <span class="version-text">v1.0.0</span>
    </div>
  </aside>
</template>

<style scoped lang="scss">
$sidebar-width: 200px;

.app-sidebar {
  width: $sidebar-width;
  height: 100vh;
  background: $color-white;
  border-right: 1px solid $color-light;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: $z-header;
  animation: slideInLeft 0.3s ease;
}

.sidebar-top {
  display: flex;
  flex-direction: column;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid $color-light;

  .brand-text {
    font-size: 15px;
    font-weight: 600;
    color: $color-text;
    letter-spacing: -0.3px;
  }
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: $radius-sm;
  font-size: 14px;
  color: $color-text-secondary;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
    color: $color-text;
  }

  &.active {
    background: $color-black;
    color: $color-white;
  }
}

.sidebar-bottom {
  padding: 12px 16px;
  border-top: 1px solid $color-bg;

  .version-text {
    font-size: 11px;
    color: $color-mid-light;
    font-family: monospace;
  }
}
</style>
