/**
 * 契约 JSON 解析、flood fill、渲染器工具函数 单元测试
 */

import { describe, it, expect } from 'vitest'
import { parseContractJson, exportContractJson } from '@/utils/contract'
import { floodFill } from '@/utils/floodFill'
import { luma, exportPatternPanelPng, exportFullPng } from '@/utils/renderer'
import type { Pattern } from '@/types'

// ---- renderer 工具函数 ----

describe('renderer luma', () => {
  it('computes luminance correctly', () => {
    expect(luma(0, 0, 0)).toBe(0)
    expect(luma(255, 255, 255)).toBe(255)
    expect(luma(255, 0, 0)).toBeCloseTo(76.245, 1)
    expect(luma(0, 255, 0)).toBeCloseTo(149.685, 1)
    expect(luma(0, 0, 255)).toBeCloseTo(29.07, 1)
  })

  it('returns luminance threshold 150 for text color decisions', () => {
    // 深色 < 150 -> 白字
    expect(luma(50, 50, 50)).toBeLessThan(150)
    // 浅色 > 150 -> 黑字
    expect(luma(200, 200, 200)).toBeGreaterThan(150)
  })
})

describe('exportFullPng', () => {
  const samplePattern: Pattern = {
    id: 'test-id',
    name: 'test',
    width: 2,
    height: 2,
    cellSizeMm: 5,
    palette: [
      { index: 0, rgb: [255, 255, 255], code: 'W01', beadRgb: [250, 250, 250] },
      { index: 1, rgb: [0, 0, 0], code: 'B01', beadRgb: [10, 10, 10] },
    ],
    grid: [
      [0, 1],
      [1, 0],
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  // vitest node 环境没有 DOM api, 需要 mock
  function withDomMock(fn: () => void) {
    const origDocument = (globalThis as any).document
    const origWindow = (globalThis as any).window
    const mockCtx = {
      setTransform: () => {},
      imageSmoothingEnabled: false,
      fillStyle: '',
      fill: () => {},
      fillRect: () => {},
      strokeStyle: '',
      lineWidth: 0,
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      strokeRect: () => {},
      fillText: () => {},
      font: '',
      textAlign: '' as CanvasTextAlign,
      textBaseline: '' as CanvasTextBaseline,
      save: () => {},
      restore: () => {},
      roundRect: () => {},
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    }
    const mockCanvas = {
      getContext: () => mockCtx,
      toDataURL: () => 'data:image/png;base64,FAKE',
      width: 0,
      height: 0,
      style: {},
    }
    ;(globalThis as any).document = { createElement: () => mockCanvas }
    ;(globalThis as any).window = { devicePixelRatio: 1 }
    try {
      fn()
    } finally {
      if (origDocument !== undefined) (globalThis as any).document = origDocument
      else delete (globalThis as any).document
      if (origWindow !== undefined) (globalThis as any).window = origWindow
      else delete (globalThis as any).window
    }
  }

  it('returns a valid data URL for simple grid export', () => {
    withDomMock(() => {
      const dataUrl = exportFullPng(samplePattern)
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    })
  })

  it('returns a valid data URL for panel export (simple)', () => {
    withDomMock(() => {
      const dataUrl = exportPatternPanelPng(samplePattern, {
        cellSize: 16,
        showGrid: true,
        backgroundColor: '#ffffff',
        legendStyle: 'simple',
      })
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    })
  })

  it('returns a valid data URL for panel export (detail)', () => {
    withDomMock(() => {
      const dataUrl = exportPatternPanelPng(samplePattern, {
        cellSize: 16,
        showGrid: true,
        backgroundColor: '#ffffff',
        legendStyle: 'detail',
      })
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    })
  })

  it('returns a valid data URL for panel export (pure)', () => {
    withDomMock(() => {
      const dataUrl = exportPatternPanelPng(samplePattern, {
        cellSize: 16,
        showGrid: true,
        backgroundColor: '#ffffff',
        legendStyle: 'pure',
      })
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    })
  })
})

// ---- contract JSON ----

describe('contract JSON parser', () => {
  const validJson = JSON.stringify({
    name: 'test_pattern',
    width: 4,
    height: 3,
    cell_size_mm: 5,
    palette: [
      { index: 0, rgb: [255, 255, 255], name: null, code: null },
      { index: 1, rgb: [0, 0, 0], name: 'Black', code: 'P01', bead_rgb: [10, 10, 10] },
    ],
    grid: [
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [0, 1, 0, 1],
    ],
  })

  it('parses valid contract JSON', () => {
    const result = parseContractJson(validJson)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pattern.name).toBe('test_pattern')
      expect(result.pattern.width).toBe(4)
      expect(result.pattern.height).toBe(3)
      expect(result.pattern.cellSizeMm).toBe(5)
      expect(result.pattern.palette.length).toBe(2)
      expect(result.pattern.palette[1].code).toBe('P01')
      expect(result.pattern.palette[1].beadRgb).toEqual([10, 10, 10])
      expect(result.pattern.grid.length).toBe(3)
      expect(result.pattern.grid[0].length).toBe(4)
      expect(typeof result.pattern.id).toBe('string')
    }
  })

  it('rejects non-JSON input', () => {
    const result = parseContractJson('not json {{{')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('rejects missing required fields', () => {
    const result = parseContractJson(JSON.stringify({}))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('name'))).toBe(true)
      expect(result.errors.some((e) => e.includes('width'))).toBe(true)
      expect(result.errors.some((e) => e.includes('palette'))).toBe(true)
    }
  })

  it('rejects bad palette entries', () => {
    const json = JSON.stringify({
      name: 'bad',
      width: 2,
      height: 2,
      palette: [{ index: 0, rgb: [300, 0, 0] }],
      grid: [[0, 0], [0, 0]],
    })
    // rgb values > 255 should be rejected by isValidRgb
    // Actually [300, 0, 0] passes 0-255 check for each element... wait, 300 > 255
    // The check is `v.every((n) => typeof n === 'number' && n >= 0 && n <= 255)`
    // 300 <= 255 is false, so it should fail
    const result = parseContractJson(json)
    expect(result.ok).toBe(false)
  })

  it('rejects grid with wrong dimensions', () => {
    const json = JSON.stringify({
      name: 'bad_grid',
      width: 4,
      height: 3,
      palette: [{ index: 0, rgb: [100, 100, 100] }],
      grid: [[0, 0], [0, 0]],
    })
    const result = parseContractJson(json)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('不匹配'))).toBe(true)
    }
  })

  it('rejects grid with unknown palette index', () => {
    const json = JSON.stringify({
      name: 'bad_grid',
      width: 2,
      height: 2,
      palette: [{ index: 0, rgb: [100, 100, 100] }],
      grid: [[0, 99], [0, 0]],
    })
    const result = parseContractJson(json)
    expect(result.ok).toBe(false)
  })

  it('handles bgColor optional field', () => {
    const json = JSON.stringify({
      name: 'with_bg',
      width: 2,
      height: 2,
      palette: [{ index: 0, rgb: [255, 255, 255] }],
      grid: [[0, 0], [0, 0]],
      bgColor: '#eeeeee',
    })
    const result = parseContractJson(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pattern.bgColor).toBe('#eeeeee')
    }
  })

  it('handles missing bgColor as undefined', () => {
    const json = JSON.stringify({
      name: 'no_bg',
      width: 2,
      height: 2,
      palette: [{ index: 0, rgb: [255, 255, 255] }],
      grid: [[0, 0], [0, 0]],
    })
    const result = parseContractJson(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pattern.bgColor).toBeUndefined()
    }
  })

  it('round-trips through export and parse', () => {
    const parseResult = parseContractJson(validJson)
    expect(parseResult.ok).toBe(true)
    if (!parseResult.ok) return

    const exported = exportContractJson(parseResult.pattern)
    const reparseResult = parseContractJson(exported)
    expect(reparseResult.ok).toBe(true)
    if (reparseResult.ok) {
      expect(reparseResult.pattern.name).toBe('test_pattern')
      expect(reparseResult.pattern.width).toBe(4)
      expect(reparseResult.pattern.height).toBe(3)
      expect(reparseResult.pattern.grid).toEqual([
        [0, 1, 0, 1],
        [1, 0, 1, 0],
        [0, 1, 0, 1],
      ])
    }
  })
})

describe('flood fill', () => {
  it('fills connected region', () => {
    const grid = [
      [0, 0, 1],
      [0, 1, 1],
      [0, 0, 0],
    ]
    const result = floodFill(grid, 0, 0, 2, 3, 3)
    expect(result.grid).toEqual([
      [2, 2, 1],
      [2, 1, 1],
      [2, 2, 2],
    ])
    expect(result.cells.length).toBe(6)
  })

  it('does nothing when fill value equals target', () => {
    const grid = [
      [0, 0],
      [0, 0],
    ]
    const result = floodFill(grid, 0, 0, 0, 2, 2)
    expect(result.cells.length).toBe(0)
    expect(result.grid).toEqual(grid)
  })

  it('fills single cell', () => {
    const grid = [
      [0, 1],
      [1, 0],
    ]
    const result = floodFill(grid, 0, 0, 2, 2, 2)
    expect(result.grid[0][0]).toBe(2)
    expect(result.grid[0][1]).toBe(1)
    expect(result.grid[1][0]).toBe(1)
    expect(result.grid[1][1]).toBe(0) // not connected via 4-dir
  })

  it('handles edge boundary correctly', () => {
    const grid = [
      [0, 0],
      [0, 0],
    ]
    const result = floodFill(grid, 0, 0, 1, 2, 2)
    expect(result.cells.length).toBe(4)
    expect(result.grid).toEqual([
      [1, 1],
      [1, 1],
    ])
  })
})
