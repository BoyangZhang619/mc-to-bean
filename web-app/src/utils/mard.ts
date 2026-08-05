/**
 * MARD 色卡数据解析
 * CSV 格式: code,name,r,g,b,source (无表头)
 * 前导字母 = 主题色系分组
 *
 * 颜色匹配: sRGB -> CIE Lab(D65) 欧氏距离最近邻
 * 对齐 pattern-tool/palette.py 的 match_color 算法
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

// ----------------------------------------------------------------
// sRGB → CIE Lab(D65) 颜色空间转换 (对齐 Python palette.py)
// ----------------------------------------------------------------

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB(D65, 2 degrees observer) → CIE L*a*b* */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)

  // sRGB → XYZ (D65)
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041

  // XYZ → Lab
  const xn = 0.95047
  const yn = 1.0
  const zn = 1.08883

  function f(t: number): number {
    const d = 6 / 29
    return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29
  }

  const fx = f(x / xn)
  const fy = f(y / yn)
  const fz = f(z / zn)

  return [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz),
  ]
}

/** Lab 欧氏距离的平方 */
function labDistSq(a: [number, number, number], b: [number, number, number]): number {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

// ---- 全量 MARD 颜色扁平列表及预计算 Lab (一次缓存) ----

interface MardColorLab extends MardColor {
  lab: [number, number, number]
}

let cachedFlatLab: MardColorLab[] | null = null

function getFlatLab(): MardColorLab[] {
  if (cachedFlatLab) return cachedFlatLab
  const groups = getMardGroups()
  const flat: MardColorLab[] = []
  for (const group of groups) {
    for (const c of group.colors) {
      flat.push({ ...c, lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]) })
    }
  }
  cachedFlatLab = flat
  return cachedFlatLab
}

// ---- 匹配 ----

export interface MardMatchResult {
  code: string
  name: string
  beadRgb: [number, number, number]
  /** Lab 欧氏距离 */
  delta: number
}

/** 按 Lab 距离最近邻匹配一个 sRGB 颜色到 MARD 色卡 */
export function matchMardColor(r: number, g: number, b: number): MardMatchResult | null {
  const flat = getFlatLab()
  const targetLab = rgbToLab(r, g, b)

  let best: MardColorLab | null = null
  let bestDistSq = Infinity

  for (const c of flat) {
    const d2 = labDistSq(targetLab, c.lab)
    if (d2 < bestDistSq) {
      bestDistSq = d2
      best = c
    }
  }

  if (!best) return null
  return {
    code: best.code,
    name: best.name,
    beadRgb: best.rgb,
    delta: Math.sqrt(bestDistSq),
  }
}

/** 按 RGB 查找最接近的 MARD 颜色 (CIE76 欧氏距离) -- 保留向后兼容 */
export function findClosestMard(r: number, g: number, b: number): MardColor | null {
  const result = matchMardColor(r, g, b)
  return result ? { code: result.code, name: result.name, rgb: result.beadRgb, source: '' } : null
}
