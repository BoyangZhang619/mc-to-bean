<script setup lang="ts">
/**
 * 图纸库 -- IndexedDB 列表, 缩略图, 搜索/排序/删除/重命名/导出
 */

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePatternStore } from '@/stores/patternStore'
import { renderThumbnail, exportFullPng } from '@/utils/renderer'
import { exportContractJson } from '@/utils/contract'
import type { Pattern } from '@/types'
import Icon from '@/components/Icon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import NewPatternDialog from '@/components/NewPatternDialog.vue'

const router = useRouter()
const store = usePatternStore()

const showNewDialog = ref(false)

const searchQuery = ref('')
const sortBy = ref<'updatedAt' | 'name' | 'createdAt'>('updatedAt')
const sortDir = ref<'asc' | 'desc'>('desc')
const loaded = ref(false)

// 确认删除
const deleteTarget = ref<Pattern | null>(null)
const deleteMessage = computed(() => `确定要删除 "${deleteTarget.value?.name ?? ''}" 吗？此操作不可撤销。`)
const showDeleteConfirm = ref(false)

// 重命名
const renameTarget = ref<Pattern | null>(null)
const renameValue = ref('')
const showRenameDialog = ref(false)

onMounted(async () => {
  await store.loadAll()
  loaded.value = true
})

const filtered = computed(() => {
  let list = [...store.patterns]

  // 搜索
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter((p) => p.name.toLowerCase().includes(q))
  }

  // 排序
  list.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else {
      cmp = a[sortBy.value] - b[sortBy.value]
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })

  return list
})

function getThumb(pattern: Pattern): string {
  return renderThumbnail(pattern, 160)
}

function openEditor(id: string) {
  router.push(`/editor/${id}`)
}

function openPreview(id: string) {
  router.push(`/preview/${id}`)
}

function confirmDelete(p: Pattern) {
  deleteTarget.value = p
  showDeleteConfirm.value = true
}

async function doDelete() {
  if (deleteTarget.value) {
    await store.remove(deleteTarget.value.id)
  }
  showDeleteConfirm.value = false
  deleteTarget.value = null
}

async function handleCreateNew(name: string, width: number, height: number, bgColor: string) {
  try {
    const pattern = await store.createEmpty(name, width, height, bgColor)
    showNewDialog.value = false
    router.push(`/editor/${pattern.id}`)
  } catch (_e: any) {
    // error handled by store
  }
}

function startRename(p: Pattern) {
  renameTarget.value = p
  renameValue.value = p.name
  showRenameDialog.value = true
}

async function doRename() {
  if (renameTarget.value && renameValue.value.trim()) {
    await store.rename(renameTarget.value.id, renameValue.value.trim())
  }
  showRenameDialog.value = false
  renameTarget.value = null
}

function doExportJson(p: Pattern) {
  const json = exportContractJson(p)
  downloadFile(`${p.name}.json`, json, 'application/json')
}

function doExportPng(p: Pattern) {
  const dataUrl = exportFullPng(p, 16, true)
  // 将 data URL 转换为 blob 下载
  fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${p.name}.png`
      a.click()
      URL.revokeObjectURL(url)
    })
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="gallery-view">
    <div class="gallery-content">
      <!-- 工具栏 -->
      <div class="gallery-toolbar">
        <div class="search-box">
          <Icon name="search" :size="16" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索图纸名称..."
            class="search-input"
          />
        </div>
        <div class="sort-controls">
          <select v-model="sortBy" class="sort-select">
            <option value="updatedAt">修改时间</option>
            <option value="name">名称</option>
            <option value="createdAt">创建时间</option>
          </select>
          <button class="sort-dir-btn" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">
            <Icon name="arrow-right" :size="14" :style="{ transform: sortDir === 'asc' ? 'rotate(-90deg)' : 'rotate(90deg)' }" />
          </button>
        </div>
        <button class="new-pattern-btn" @click="showNewDialog = true">
          <Icon name="plus" :size="16" />
          <span>新建</span>
        </button>
      </div>

      <!-- 统计 -->
      <div class="gallery-stats" v-if="loaded">
        <template v-if="filtered.length === store.patterns.length">
          共 {{ store.patterns.length }} 张图纸
        </template>
        <template v-else>
          找到 {{ filtered.length }} 张 (共 {{ store.patterns.length }} 张)
        </template>
      </div>

      <!-- 加载态 -->
      <div v-if="!loaded" class="loading-state">
        <div class="loading-spinner" />
        <span>加载中...</span>
      </div>

      <!-- 空态 -->
      <div v-else-if="store.patterns.length === 0" class="empty-state">
        <Icon name="gallery" :size="48" color="#aaa" />
        <h3>图纸库为空</h3>
        <p>还没有导入任何图纸</p>
        <button class="btn btn--primary" @click="router.push('/import')">
          <Icon name="import" :size="16" />
          <span>导入图纸</span>
        </button>
      </div>

      <!-- 搜索无结果 -->
      <div v-else-if="filtered.length === 0" class="empty-state">
        <Icon name="search" :size="48" color="#aaa" />
        <p>没有找到匹配 "<strong>{{ searchQuery }}</strong>" 的图纸</p>
      </div>

      <!-- 网格列表 -->
      <div v-else class="gallery-grid">
        <TransitionGroup name="card-list">
          <div
            v-for="pattern in filtered"
            :key="pattern.id"
            class="gallery-card"
          >
            <div class="card-thumb" @click="openPreview(pattern.id)">
              <img :src="getThumb(pattern)" :alt="pattern.name" />
            </div>
            <div class="card-body">
              <div class="card-info" @click="openPreview(pattern.id)">
                <span class="card-name">{{ pattern.name }}</span>
                <span class="card-dims">{{ pattern.width }} x {{ pattern.height }} | {{ pattern.palette.length }} 色</span>
                <span class="card-date">{{ formatDate(pattern.updatedAt) }}</span>
              </div>
              <div class="card-actions">
                <button title="预览" @click="openPreview(pattern.id)">
                  <Icon name="search" :size="15" />
                </button>
                <button title="编辑" @click="openEditor(pattern.id)">
                  <Icon name="brush" :size="15" />
                </button>
                <button title="重命名" @click="startRename(pattern)">
                  <Icon name="rename" :size="15" />
                </button>
                <button title="导出 PNG" @click="doExportPng(pattern)">
                  <Icon name="export" :size="15" />
                </button>
                <button title="导出 JSON" @click="doExportJson(pattern)">
                  <Icon name="save" :size="15" />
                </button>
                <button title="删除" class="danger-btn" @click="confirmDelete(pattern)">
                  <Icon name="delete" :size="15" />
                </button>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- 删除确认 -->
    <ConfirmDialog
      :visible="showDeleteConfirm"
      title="删除图纸"
      :message="deleteMessage"
      confirm-text="删除"
      :danger="true"
      @confirm="doDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- 重命名弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="showRenameDialog" class="dialog-overlay" @click.self="showRenameDialog = false">
          <div class="dialog-box">
            <h3 class="dialog-title">重命名图纸</h3>
            <input
              v-model="renameValue"
              type="text"
              class="rename-input"
              placeholder="输入新名称"
              @keyup.enter="doRename"
              ref="renameInput"
            />
            <div class="dialog-actions">
              <button class="btn btn--ghost" @click="showRenameDialog = false">取消</button>
              <button class="btn btn--primary" @click="doRename" :disabled="!renameValue.trim()">确认</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <NewPatternDialog
      :visible="showNewDialog"
      @cancel="showNewDialog = false"
      @confirm="handleCreateNew"
    />
  </div>
</template>

<style scoped lang="scss">
.gallery-view {
  height: calc(100vh - $header-height);
  overflow-y: auto;
  @include scrollbar-thin;
}

.gallery-content {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.gallery-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  align-items: center;

  @include mobile {
    flex-direction: column;
  }
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  padding: 8px 12px;
  color: $color-mid;
  transition: border-color $transition-fast;

  &:focus-within {
    border-color: $color-mid-dark;
  }
}

.search-input {
  flex: 1;
  border: none;
  background: none;
  font-size: 14px;
  outline: none;
  color: $color-text;

  &::placeholder {
    color: $color-mid-light;
  }
}

.sort-controls {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.sort-select {
  padding: 8px 12px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 13px;
  background: $color-white;
  color: $color-text-secondary;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: $color-mid-dark;
  }
}

.sort-dir-btn {
  width: 36px;
  height: 36px;
  @include flex-center;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  background: $color-white;
  color: $color-mid-dark;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
  }
}

.new-pattern-btn {
  @include flex-center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  background: $color-white;
  font-size: 13px;
  color: $color-text-secondary;
  cursor: pointer;
  transition: all $transition-fast;
  white-space: nowrap;

  &:hover {
    background: $color-black;
    color: $color-white;
    border-color: $color-black;
  }
}

.gallery-stats {
  font-size: 12px;
  color: $color-mid;
  margin-bottom: 16px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;

  @include mobile {
    grid-template-columns: repeat(2, 1fr);
  }
}

.gallery-card {
  background: $color-white;
  border: 1px solid $color-light;
  border-radius: $radius-md;
  overflow: hidden;
  transition: all $transition-fast;

  &:hover {
    box-shadow: $shadow-md;
    border-color: $color-mid-light;
    transform: translateY(-1px);
  }
}

.card-thumb {
  cursor: pointer;
  aspect-ratio: 1;
  overflow: hidden;
  background: $color-bg;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
}

.card-body {
  padding: 10px 12px;
}

.card-info {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: $color-text;
  @include text-ellipsis;
}

.card-dims {
  font-size: 11px;
  color: $color-mid;
  font-family: monospace;
}

.card-date {
  font-size: 10px;
  color: $color-mid-light;
}

.card-actions {
  display: flex;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid $color-bg;

  button {
    width: 28px;
    height: 28px;
    @include flex-center;
    border-radius: $radius-sm;
    color: $color-mid-dark;
    transition: all $transition-fast;

    &:hover {
      background: $color-bg;
      color: $color-black;
    }

    &.danger-btn:hover {
      background: #fef2f2;
      color: $color-danger;
    }
  }
}

.empty-state {
  @include flex-center;
  flex-direction: column;
  gap: 10px;
  padding: 60px 0;
  color: $color-mid;

  h3 {
    font-size: 16px;
    color: $color-text-secondary;
  }

  p {
    font-size: 14px;
  }
}

.loading-state {
  @include flex-center;
  flex-direction: column;
  gap: 12px;
  padding: 60px 0;
  color: $color-mid;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid $color-light;
  border-top-color: $color-dark;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

// 卡片列表过渡
.card-list-enter-active {
  animation: fadeInUp 0.3s ease;
}

.card-list-leave-active {
  animation: fadeIn 0.2s ease reverse;
}

.card-list-move {
  transition: transform 0.25s ease;
}

// 重命名弹窗
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
  padding: 24px;
  max-width: 360px;
  width: 90%;
  box-shadow: $shadow-lg;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.rename-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid $color-light;
  border-radius: $radius-sm;
  font-size: 14px;
  margin-bottom: 20px;

  &:focus {
    outline: none;
    border-color: $color-mid-dark;
  }
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 8px 18px;
  border-radius: $radius-sm;
  font-size: 13px;
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
</style>
