/**
 * 四向洪水填充算法
 * 在 grid[y][x] 上将 targetValue 替换为 fillValue
 * 返回被修改的单元格坐标列表
 */

export interface FloodFillResult {
  cells: [number, number][]
  grid: number[][]
}

export function floodFill(
  grid: number[][],
  startX: number,
  startY: number,
  fillValue: number,
  width: number,
  height: number
): FloodFillResult {
  const targetValue = grid[startY]?.[startX]
  if (targetValue === undefined || targetValue === fillValue) {
    return { cells: [], grid }
  }

  // 深拷贝 grid
  const newGrid = grid.map((row) => [...row])
  const cells: [number, number][] = []
  const visited = new Set<string>()
  const stack: [number, number][] = [[startX, startY]]

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    const key = `${cx},${cy}`

    if (visited.has(key)) continue
    visited.add(key)

    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
    if (newGrid[cy][cx] !== targetValue) continue

    newGrid[cy][cx] = fillValue
    cells.push([cx, cy])

    stack.push([cx + 1, cy])
    stack.push([cx - 1, cy])
    stack.push([cx, cy + 1])
    stack.push([cx, cy - 1])
  }

  return { cells, grid: newGrid }
}
