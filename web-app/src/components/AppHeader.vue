<script setup lang="ts">
/**
 * 顶部导航栏
 */

import { useRoute, useRouter } from 'vue-router'
import { ref, watch } from 'vue'
import Icon from './Icon.vue'

const route = useRoute()
const router = useRouter()
const mobileMenuOpen = ref(false)

// 路由变化时自动关闭移动端菜单
watch(() => route.path, () => {
  mobileMenuOpen.value = false
})

const navItems = [
  { to: '/', label: '首页', icon: 'home' as const },
  { to: '/gallery', label: '图纸库', icon: 'gallery' as const },
  { to: '/official', label: '官方图纸', icon: 'palette' as const },
  { to: '/tools/fonts', label: '字体生成', icon: 'rename' as const },
  { to: '/import', label: '导入', icon: 'import' as const },
  { to: '/docs', label: '文档', icon: 'info' as const },
]

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function navigate(to: string) {
  router.push(to)
  mobileMenuOpen.value = false
}
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <router-link to="/" class="header-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="8" height="8" fill="#333" />
          <rect x="14" y="2" width="8" height="8" fill="#555" />
          <rect x="2" y="14" width="8" height="8" fill="#555" />
          <rect x="14" y="14" width="8" height="8" fill="#333" />
        </svg>
        <span class="brand-text">拼豆图纸平台</span>
      </router-link>
    </div>

    <!-- PC 导航 -->
    <nav class="header-nav desktop-nav">
      <router-link
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav-link"
        :class="{ active: isActive(item.to) }"
      >
        <Icon :name="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- 移动端菜单按钮 -->
    <button class="mobile-menu-btn" @click="mobileMenuOpen = !mobileMenuOpen">
      <Icon :name="mobileMenuOpen ? 'close' : 'menu'" :size="20" />
    </button>
  </header>

  <!-- 移动端下拉菜单 -->
  <Transition name="slide-down">
    <nav v-if="mobileMenuOpen" class="mobile-nav">
      <button
        v-for="item in navItems"
        :key="item.to"
        class="mobile-nav-link"
        :class="{ active: isActive(item.to) }"
        @click="navigate(item.to)"
      >
        <Icon :name="item.icon" :size="18" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </Transition>
</template>

<style scoped lang="scss">
.app-header {
  height: $header-height;
  background: $color-white;
  border-bottom: 1px solid $color-light;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  z-index: $z-header;

  @include mobile {
    padding: 0 12px;
  }
}

.header-left {
  display: flex;
  align-items: center;
}

.header-brand {
  @include flex-center;
  gap: 10px;

  .brand-text {
    font-size: 16px;
    font-weight: 600;
    color: $color-text;
    letter-spacing: -0.3px;
  }
}

.header-nav {
  display: flex;
  gap: 4px;
}

.desktop-nav {
  @include mobile {
    display: none;
  }
}

.nav-link {
  @include flex-center;
  gap: 6px;
  padding: 8px 14px;
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

.mobile-menu-btn {
  display: none;
  width: 36px;
  height: 36px;
  @include flex-center;
  border-radius: $radius-sm;

  &:hover {
    background: $color-bg;
  }

  @include mobile {
    display: flex;
  }
}

.mobile-nav {
  display: none;

  @include mobile {
    display: flex;
    flex-direction: column;
    background: $color-white;
    border-bottom: 1px solid $color-light;
    padding: 8px;
    gap: 2px;
    z-index: $z-header;
  }
}

.mobile-nav-link {
  @include flex-center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: $radius-sm;
  font-size: 14px;
  color: $color-text-secondary;
  transition: all $transition-fast;
  text-align: left;
  width: 100%;

  &:hover {
    background: $color-bg;
  }

  &.active {
    background: $color-bg-active;
    color: $color-black;
    font-weight: 600;
  }
}

.slide-down-enter-active {
  animation: slideInUp 0.2s ease;
}

.slide-down-leave-active {
  animation: slideInUp 0.15s ease reverse;
}
</style>
