import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Pattern } from '@/types'
import * as db from '@/utils/db'

/** hex 颜色字符串转 RGB 数组 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ]
  }
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

export const usePatternStore = defineStore('patterns', () => {
  // ---- state ----
  const patterns = ref<Pattern[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---- getters ----
  const recentPatterns = computed(() => {
    return [...patterns.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
  })

  const patternCount = computed(() => patterns.value.length)

  // ---- actions ----
  async function loadAll() {
    loading.value = true
    error.value = null
    try {
      patterns.value = await db.getAllPatterns()
    } catch (e: any) {
      error.value = `加载图纸列表失败: ${e.message}`
    } finally {
      loading.value = false
    }
  }

  async function getById(id: string): Promise<Pattern | undefined> {
    try {
      return await db.getPatternById(id)
    } catch (e: any) {
      error.value = `加载图纸失败: ${e.message}`
      return undefined
    }
  }

  async function save(pattern: Pattern): Promise<boolean> {
    try {
      await db.savePattern(pattern)
      // 更新本地列表
      const idx = patterns.value.findIndex((p) => p.id === pattern.id)
      if (idx >= 0) {
        patterns.value[idx] = { ...pattern }
      } else {
        patterns.value.push({ ...pattern })
      }
      return true
    } catch (e: any) {
      console.error('[patternStore] 保存失败:', e)
      error.value = `保存失败: ${e.message}`
      return false
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await db.deletePattern(id)
      patterns.value = patterns.value.filter((p) => p.id !== id)
      return true
    } catch (e: any) {
      error.value = `删除失败: ${e.message}`
      return false
    }
  }

  async function rename(id: string, newName: string): Promise<boolean> {
    try {
      await db.renamePattern(id, newName)
      const p = patterns.value.find((p) => p.id === id)
      if (p) {
        p.name = newName
        p.updatedAt = Date.now()
      }
      return true
    } catch (e: any) {
      error.value = `重命名失败: ${e.message}`
      return false
    }
  }

  /** 创建空白图纸并持久化, 返回新 Pattern */
  async function createEmpty(
    name: string,
    width: number,
    height: number,
    bgColor: string = '#ffffff'
  ): Promise<Pattern> {
    const now = Date.now()
    const pattern: Pattern = {
      id: crypto.randomUUID(),
      name,
      width,
      height,
      cellSizeMm: 5,
      palette: [{ index: 0, rgb: hexToRgb(bgColor), name: null, code: null }],
      grid: Array.from({ length: height }, () => Array(width).fill(0)),
      bgColor,
      createdAt: now,
      updatedAt: now,
    }
    const ok = await save(pattern)
    if (!ok) {
      throw new Error(error.value ?? '创建图纸保存失败')
    }
    return pattern
  }

  function clearError() {
    error.value = null
  }

  return {
    patterns,
    loading,
    error,
    recentPatterns,
    patternCount,
    loadAll,
    getById,
    save,
    remove,
    rename,
    createEmpty,
    clearError,
  }
})
