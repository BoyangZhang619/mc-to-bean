/**
 * MARD 色卡数据解析
 * CSV 格式: code,name,r,g,b,source (无表头)
 * 前导字母 = 主题色系分组
 */

import mardCsvRaw from '@/assets/mard.csv?raw'

export interface MardColor {
  code: string
  name: string
  rgb: [number, number, number]
  source: string
}

/** 分组标签 */
const GROUP_LABELS: Record<string, string> = {
  A: '黄橙系',
  B: '绿色系',
  C: '蓝色系',
  D: '紫色系',
  E: '粉色系',
  F: '红色系',
  G: '棕肤系',
  H: '黑白灰',
  M: '混色系',
  P: '珠光系',
  R: '透明系',
}

/** 分组排序 */
const GROUP_ORDER: Record<string, number> = {
  H: 0,  // 黑白灰最常用, 排前面
  G: 1,
  A: 2,
  B: 3,
  C: 4,
  D: 5,
  E: 6,
  F: 7,
  M: 8,
  P: 9,
  R: 10,
}

export interface MardGroup {
  key: string
  label: string
  colors: MardColor[]
}

let cachedGroups: MardGroup[] | null = null

/** 解析 CSV 并按分组返回 */
export function getMardGroups(): MardGroup[] {
  if (cachedGroups) return cachedGroups

  const lines = mardCsvRaw.trim().split('\n')
  const groupMap = new Map<string, MardColor[]>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(',')
    if (parts.length < 5) continue

    const code = parts[0]
    const name = parts[1]
    const r = parseInt(parts[2], 10)
    const g = parseInt(parts[3], 10)
    const b = parseInt(parts[4], 10)
    const source = parts[5] ?? ''

    if (isNaN(r) || isNaN(g) || isNaN(b)) continue

    const groupKey = code.charAt(0).toUpperCase()
    const color: MardColor = { code, name, rgb: [r, g, b], source }

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, [])
    }
    groupMap.get(groupKey)!.push(color)
  }

  const groups: MardGroup[] = []
  for (const [key, colors] of groupMap) {
    groups.push({
      key,
      label: GROUP_LABELS[key] ?? `${key} 组`,
      colors,
    })
  }

  groups.sort((a, b) => (GROUP_ORDER[a.key] ?? 99) - (GROUP_ORDER[b.key] ?? 99))
  cachedGroups = groups
  return groups
}

/** 按 RGB 查找最接近的 MARD 颜色 (CIE76 欧氏距离) */
export function findClosestMard(r: number, g: number, b: number): MardColor | null {
  const groups = getMardGroups()
  let best: MardColor | null = null
  let bestDist = Infinity
  for (const group of groups) {
    for (const c of group.colors) {
      const dr = r - c.rgb[0]
      const dg = g - c.rgb[1]
      const db = b - c.rgb[2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
  }
  return best
}
