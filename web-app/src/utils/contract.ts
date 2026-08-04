/**
 * 契约 JSON 解析与校验
 * 对齐 D:\gitLocal\mc-to-bean\技术架构.md 第 3 节
 */

import type { Pattern, ContractJson, PaletteEntry } from '@/types'

/** 契约字段映射: 蛇形 -> 驼峰 */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/** 校验颜色数组 */
function isValidRgb(v: unknown): v is [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return false
  return v.every((n) => typeof n === 'number' && n >= 0 && n <= 255)
}

function isValidRgbNullable(v: unknown): v is [number, number, number] | null {
  if (v === null) return true
  return isValidRgb(v)
}

interface PaletteEntryResultOk { ok: true; entry: PaletteEntry }
interface PaletteEntryResultErr { ok: false; error: string }
type PaletteEntryResult = PaletteEntryResultOk | PaletteEntryResultErr

/** 校验并解析单个 palette 条目 */
function parsePaletteEntry(raw: any, i: number): PaletteEntryResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `palette[${i}] 不是有效的对象` }
  }
  if (typeof raw.index !== 'number' || raw.index < 0) {
    return { ok: false, error: `palette[${i}].index 必须是大于等于 0 的数字` }
  }
  if (!isValidRgb(raw.rgb)) {
    return { ok: false, error: `palette[${i}].rgb 必须是 [r,g,b] 格式 (0-255)` }
  }
  if (raw.code !== undefined && raw.code !== null && typeof raw.code !== 'string') {
    return { ok: false, error: `palette[${i}].code 必须是字符串或 null` }
  }
  if (raw.name !== undefined && raw.name !== null && typeof raw.name !== 'string') {
    return { ok: false, error: `palette[${i}].name 必须是字符串或 null` }
  }
  return {
    ok: true,
    entry: {
      index: raw.index as number,
      rgb: raw.rgb as [number, number, number],
      code: raw.code ?? null,
      name: raw.name ?? null,
      delta: typeof raw.delta === 'number' ? raw.delta : undefined,
      beadRgb: isValidRgbNullable(raw.bead_rgb) ? raw.bead_rgb : null,
    },
  }
}

/** 解析结果 */
export interface ContractParseResultOk { ok: true; pattern: Pattern }
export interface ContractParseResultErr { ok: false; errors: string[] }
export type ContractParseResult = ContractParseResultOk | ContractParseResultErr

/** 解析契约 JSON 字符串 */
export function parseContractJson(jsonStr: string): ContractParseResult {
  const errors: string[] = []

  let raw: any
  try {
    raw = JSON.parse(jsonStr)
  } catch (e: any) {
    return { ok: false, errors: [`JSON 解析失败: ${e.message}`] }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['JSON 顶层必须是对象'] }
  }

  // 校验必填字段
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push('name 必须是有效字符串')
  }
  if (typeof raw.width !== 'number' || raw.width < 1 || !Number.isInteger(raw.width)) {
    errors.push('width 必须是正整数')
  }
  if (typeof raw.height !== 'number' || raw.height < 1 || !Number.isInteger(raw.height)) {
    errors.push('height 必须是正整数')
  }
  if (raw.cell_size_mm !== undefined && (typeof raw.cell_size_mm !== 'number' || raw.cell_size_mm <= 0)) {
    errors.push('cell_size_mm 必须是正数')
  }
  if (!Array.isArray(raw.palette) || raw.palette.length === 0) {
    errors.push('palette 必须是非空数组')
  }
  if (!Array.isArray(raw.grid) || raw.grid.length === 0) {
    errors.push('grid 必须是非空数组')
  }

  if (errors.length > 0) return { ok: false, errors }

  // 校验 palette
  const palette: PaletteEntry[] = []
  const indexSet = new Set<number>()
  for (let i = 0; i < raw.palette.length; i++) {
    const result = parsePaletteEntry(raw.palette[i], i)
    if (!result.ok) {
      errors.push(result.error)
      continue
    }
    if (indexSet.has(result.entry.index)) {
      errors.push(`palette[${i}].index=${result.entry.index} 重复`)
    }
    indexSet.add(result.entry.index)
    palette.push(result.entry)
  }

  // 校验 grid
  const w = raw.width as number
  const h = raw.height as number

  if (raw.grid.length !== h) {
    errors.push(`grid 行数 (${raw.grid.length}) 与 height (${h}) 不匹配`)
  }

  let gridOk = true
  // 只检查前几行和后几行避免过多报错
  const rowsToCheck = Math.min(h, 50)
  for (let y = 0; y < h; y++) {
    const row = raw.grid[y]
    if (!Array.isArray(row)) {
      if (y < rowsToCheck || y >= h - 5) {
        errors.push(`grid[${y}] 不是数组`)
      }
      gridOk = false
      continue
    }
    if (row.length !== w) {
      if (y < rowsToCheck || y >= h - 5) {
        errors.push(`grid[${y}] 的长度 (${row.length}) 与 width (${w}) 不匹配`)
      }
      gridOk = false
      continue
    }
    if (y < rowsToCheck || y >= h - 5) {
      for (let x = 0; x < w; x++) {
        if (typeof row[x] !== 'number' || !indexSet.has(row[x])) {
          errors.push(`grid[${y}][${x}] = ${row[x]}, 但 palette 中没有 index=${row[x]} 的颜色`)
          break // 每行只报第一个错误
        }
      }
    }
  }

  if (!gridOk || errors.length > 0) return { ok: false, errors }

  // 通过 -- 构建 Pattern 对象
  const now = Date.now()
  const pattern: Pattern = {
    id: crypto.randomUUID(),
    name: raw.name.trim(),
    width: w,
    height: h,
    cellSizeMm: raw.cell_size_mm ?? 5,
    palette,
    grid: raw.grid as number[][],
    bgColor: typeof raw.bgColor === 'string' ? raw.bgColor : undefined,
    createdAt: now,
    updatedAt: now,
  }

  return { ok: true, pattern }
}

/** 将 Pattern 导出为契约 JSON 字符串 */
export function exportContractJson(pattern: Pattern): string {
  const contract: ContractJson = {
    name: pattern.name,
    width: pattern.width,
    height: pattern.height,
    cell_size_mm: pattern.cellSizeMm,
    palette: pattern.palette.map((p) => ({
      index: p.index,
      rgb: p.rgb,
      code: p.code ?? null,
      name: p.name ?? null,
      delta: p.delta,
      bead_rgb: p.beadRgb ?? null,
    })),
    grid: pattern.grid,
  }
  if (pattern.bgColor) {
    contract.bgColor = pattern.bgColor
  }
  return JSON.stringify(contract, null, 2)
}
