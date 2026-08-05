<script setup lang="ts">
/**
 * 首页 -- 平台介绍 + 最近图纸 + 快速入口
 */

import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePatternStore } from '@/stores/patternStore'
import { renderThumbnail } from '@/utils/renderer'
import type { Pattern } from '@/types'
import Icon from '@/components/Icon.vue'
import NewPatternDialog from '@/components/NewPatternDialog.vue'

const router = useRouter()
const store = usePatternStore()
const loaded = ref(false)
const showNewDialog = ref(false)

onMounted(async () => {
  await store.loadAll()
  loaded.value = true
})

function openEditor(id: string) {
  router.push(`/editor/${id}`)
}

function openPreview(id: string) {
  router.push(`/preview/${id}`)
}

function goImport() {
  router.push('/import')
}

function goGallery() {
  router.push('/gallery')
}

async function handleCreateNew(name: string, width: number, height: number, bgColor: string) {
  try {
    const pattern = await store.createEmpty(name, width, height, bgColor)
    showNewDialog.value = false
    router.push(`/editor/${pattern.id}`)
  } catch (e: any) {
    // Toast handled by store
  }
}

function getThumb(pattern: Pattern): string {
  return renderThumbnail(pattern, 120)
}
</script>

<template>
  <div class="home-view">
    <div class="home-content">
      <!-- Hero 区域 -->
      <section class="hero">
        <div class="hero-icon">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="24" height="24" rx="2" fill="#111" />
            <rect x="36" y="4" width="24" height="24" rx="2" fill="#555" />
            <rect x="4" y="36" width="24" height="24" rx="2" fill="#555" />
            <rect x="36" y="36" width="24" height="24" rx="2" fill="#111" />
          </svg>
        </div>
        <h1 class="hero-title">拼豆图纸处理平台</h1>
        <p class="hero-desc">
          导入 Minecraft 纹理导出的拼豆图纸 JSON, 在线查看、编辑与管理。
          支持画笔、填充、矩形、取色器等多种工具, 缩放平移, 触摸操作, 导出 PNG 与 JSON。
        </p>
        <div class="hero-actions">
          <button class="btn btn--primary" @click="goImport">
            <Icon name="import" :size="18" />
            <span>导入图纸</span>
          </button>
          <button class="btn btn--outline" @click="goGallery">
            <Icon name="gallery" :size="18" />
            <span>浏览图纸库</span>
          </button>
          <button class="btn btn--outline" @click="showNewDialog = true">
            <Icon name="plus" :size="18" />
            <span>新建图纸</span>
          </button>
        </div>
      </section>

      <!-- 最近图纸 -->
      <section class="recent" v-if="loaded">
        <div class="section-header">
          <h2 class="section-title">最近图纸</h2>
          <button v-if="store.patternCount > 0" class="link-btn" @click="goGallery">
            查看全部
            <Icon name="arrow-right" :size="14" />
          </button>
        </div>

        <!-- 空态 -->
        <div v-if="store.recentPatterns.length === 0" class="empty-state">
          <Icon name="gallery" :size="40" color="#aaa" />
          <p class="empty-text">还没有图纸, 点击上方按钮导入你的第一张图纸</p>
        </div>

        <!-- 列表 -->
        <div v-else class="recent-grid">
          <button
            v-for="pattern in store.recentPatterns"
            :key="pattern.id"
            class="recent-card"
            @click="openPreview(pattern.id)"
          >
            <img
              :src="getThumb(pattern)"
              :alt="pattern.name"
              class="recent-thumb"
            />
            <div class="recent-info">
              <span class="recent-name">{{ pattern.name }}</span>
              <span class="recent-dims">{{ pattern.width }} x {{ pattern.height }}</span>
            </div>
          </button>
        </div>
      </section>

      <!-- 加载状态 -->
      <div v-else class="loading-state">
        <div class="loading-spinner" />
        <span class="loading-text">加载中...</span>
      </div>

      <!-- 平台特性 -->
      <section class="features">
        <h2 class="section-title">功能特性</h2>
        <div class="features-grid">
          <div class="feature-card">
            <Icon name="brush" :size="24" :stroke-width="1.5" />
            <h3>多工具编辑</h3>
            <p>画笔、橡皮、填充、矩形、直线、取色器, 灵活编辑</p>
          </div>
          <div class="feature-card">
            <Icon name="zoom-in" :size="24" :stroke-width="1.5" />
            <h3>流畅缩放平移</h3>
            <p>滚轮缩放、拖拽平移, 大图纸也流畅</p>
          </div>
          <div class="feature-card">
            <Icon name="export" :size="24" :stroke-width="1.5" />
            <h3>导出 PNG / JSON</h3>
            <p>渲染为高清 PNG 或导出为契约 JSON 格式</p>
          </div>
          <div class="feature-card">
            <Icon name="undo" :size="24" :stroke-width="1.5" />
            <h3>撤销重做</h3>
            <p>完整历史栈, 同类操作智能合并, 上限 200 步</p>
          </div>
          <div class="feature-card">
            <Icon name="palette" :size="24" :stroke-width="1.5" />
            <h3>调色板管理</h3>
            <p>颜色统计、百分比、双击编辑 RGB</p>
          </div>
          <div class="feature-card">
            <Icon name="resize" :size="24" :stroke-width="1.5" />
            <h3>尺寸调整</h3>
            <p>缩放内容、扩展留白、截断, 灵活改变图纸大小</p>
          </div>
        </div>
      </section>
    </div>

    <NewPatternDialog
      :visible="showNewDialog"
      @cancel="showNewDialog = false"
      @confirm="handleCreateNew"
    />
  </div>
</template>

<style scoped lang="scss">
.home-view {
  height: calc(100vh - $header-height);
  overflow-y: auto;
  @include scrollbar-thin;
}

.home-content {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}

.hero {
  text-align: center;
  padding: 48px 0 40px;
}

.hero-icon {
  margin-bottom: 20px;
}

.hero-title {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -1px;
  margin-bottom: 14px;
  color: $color-text;
}

.hero-desc {
  font-size: 15px;
  color: $color-text-secondary;
  line-height: 1.7;
  max-width: 560px;
  margin: 0 auto 28px;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 12px;

  @include mobile {
    flex-direction: column;
    align-items: center;
  }
}

.btn {
  @include flex-center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: $radius-md;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;

  &--primary {
    background: $color-black;
    color: $color-white;

    &:hover {
      background: $color-dark;
      transform: translateY(-1px);
      box-shadow: $shadow-md;
    }
  }

  &--outline {
    background: transparent;
    color: $color-text;
    border: 1.5px solid $color-light;

    &:hover {
      border-color: $color-mid-dark;
      background: $color-bg;
    }
  }
}

.section-header {
  @include flex-between;
  margin-bottom: 16px;
}

.section-title {
  font-size: 20px;
  font-weight: 700;
  color: $color-text;
  margin-bottom: 20px;
}

.link-btn {
  @include flex-center;
  gap: 4px;
  font-size: 13px;
  color: $color-mid-dark;
  transition: color $transition-fast;

  &:hover {
    color: $color-black;
  }
}

.recent-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;

  @include mobile {
    grid-template-columns: repeat(2, 1fr);
  }
}

.recent-card {
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  overflow: hidden;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    transform: translateY(-2px);
    box-shadow: $shadow-md;
    border-color: $color-mid-light;
  }
}

.recent-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
  background: $color-bg;
}

.recent-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-name {
  font-size: 13px;
  font-weight: 600;
  color: $color-text;
  @include text-ellipsis;
}

.recent-dims {
  font-size: 11px;
  color: $color-mid;
  font-family: monospace;
}

.empty-state {
  @include flex-center;
  flex-direction: column;
  gap: 12px;
  padding: 48px 0;
  color: $color-mid;
}

.empty-text {
  font-size: 14px;
  color: $color-mid;
}

.loading-state {
  @include flex-center;
  flex-direction: column;
  gap: 12px;
  padding: 48px 0;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.loading-text {
  font-size: 13px;
  color: $color-mid;
}

.features {
  margin-top: 60px;
  padding-top: 40px;
  border-top: 1px solid $color-light;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;

  @include mobile {
    grid-template-columns: repeat(2, 1fr);
  }
}

.feature-card {
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  padding: 20px;
  transition: all $transition-fast;

  &:hover {
    border-color: $color-mid-light;
    box-shadow: $shadow-sm;
  }

  h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 10px 0 6px;
    color: $color-text;
  }

  p {
    font-size: 13px;
    color: $color-text-secondary;
    line-height: 1.5;
  }
}
</style>
