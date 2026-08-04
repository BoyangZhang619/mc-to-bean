package dev.mcperler.section;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import dev.mcperler.color.BlockColorMapper;
import dev.mcperler.color.FaceTextureProvider;
import dev.mcperler.McPerlerMod;

import java.util.Optional;

/**
 * 正交视图统一采样核心 —— F2 view/section 的采样引擎。
 *
 * 根据 distance 参数自动切换模式：
 *   distance=0 → section 模式：取平面位置的方块本身 getBlockState(p)
 *   distance>0 → view 模式：逐格沿 direction raycast，取第一个不在忽略集中的方块
 *
 * granularity 真聚合（M5）：采样时按 granularity 展开为 (16/g)² 子格，
 * 优先使用 FaceTextureProvider 取方块面纹理像素取区域平均色，
 * 失败时回退到 BlockColorMapper 的 MapColor 单色填充所有子格。
 *
 * 输出：int[][] grid[v][u]，每个元素为 ARGB int 颜色值。
 * 返回尺寸 = 原尺寸 × k（k = 16 / granularity）。
 *
 * 线程安全：本类方法为纯函数，不持有状态。
 * FaceTextureProvider 由调用方创建并传入（每个异步任务独立实例）。
 */
public class ViewSampler {

    /**
     * 统一采样核心（M5 面纹理版）。
     *
     * @param level       目标世界（ServerLevel 或 ClientLevel，统一用 Level 接口）
     * @param plane       截面平面参数（定义平面位置和范围）
     * @param opts        采样选项（direction/distance/ignoreSet/granularity/bgColor）
     * @param mapper      颜色映射器（BlockState → ARGB，静态方法，回退用）
     * @param faceTexture 面纹理提供器（null 时纯 MapColor 回退，服务端版传 null）
     * @return int[][] grid[v][u]，每个元素为 ARGB int 颜色值（含 alpha）
     */
    public static int[][] sample(Level level, SectionPlane plane,
                                  SampleOptions opts, BlockColorMapper mapper,
                                  FaceTextureProvider faceTexture) {
        int width = plane.getWidth();
        int height = plane.getHeight();
        int granularity = opts.granularity();
        int k = 16 / granularity;  // 每方块子格数（每维）
        int outHeight = height * k;
        int outWidth = width * k;

        Direction dir = opts.direction();
        int distance = opts.distance();
        int bgColor = opts.bgColor();

        // 面纹理方向：view 用探测方向，section 无方向用 UP
        Direction faceDir = (dir != null) ? dir : Direction.UP;

        McPerlerMod.LOGGER.debug("ViewSampler: 开始采样 plane={}, distance={}, dir={}, "
                        + "granularity={} k={}, size={}x{} → {}x{}",
                plane, distance, dir, granularity, k, width, height, outWidth, outHeight);

        long startTime = System.currentTimeMillis();

        int[][] grid = new int[outHeight][outWidth];

        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                BlockPos pos = plane.toWorldPos(u, v);

                if (distance == 0) {
                    // ── Section 模式：取平面位置方块本身 ──
                    BlockState state = level.getBlockState(pos);
                    if (state == null || opts.isIgnored(blockId(state))) {
                        fillSubCells(grid, v, u, k, bgColor);
                    } else {
                        fillBlockSubCells(grid, v, u, k, state, faceDir, mapper, faceTexture, bgColor);
                    }
                } else {
                    // ── View 模式：沿 direction 步进 raycast ──
                    BlockPos current = pos;
                    BlockState foundState = null;
                    for (int step = 0; step <= distance; step++) {
                        BlockState state = level.getBlockState(current);
                        if (state != null && !opts.isIgnored(blockId(state))) {
                            foundState = state;
                            break;
                        }
                        current = current.relative(dir);
                    }
                    if (foundState == null) {
                        fillSubCells(grid, v, u, k, bgColor);
                    } else {
                        fillBlockSubCells(grid, v, u, k, foundState, faceDir, mapper, faceTexture, bgColor);
                    }
                }
            }
        }

        long elapsed = System.currentTimeMillis() - startTime;
        McPerlerMod.LOGGER.debug("ViewSampler: 采样完成, 耗时 {}ms ({} 方块 × {}² 子格 = {} 豆)",
                elapsed, width * height, k, outWidth * outHeight);

        return grid;
    }

    // ─────────────────────────────────────────────────────────────
    //  子格填充（面纹理优先 + MapColor 回退）
    // ─────────────────────────────────────────────────────────────

    /**
     * 对一个方块的 k×k 子格区域填色。
     * 优先使用 FaceTextureProvider 取 16×16 面纹理像素 → 按 g×g 块平均填各子格；
     * 取纹理失败时回退 BlockColorMapper 单色填充所有子格。
     */
    private static void fillBlockSubCells(int[][] grid, int v, int u, int k,
                                          BlockState state, Direction faceDir,
                                          BlockColorMapper mapper,
                                          FaceTextureProvider faceTexture,
                                          int bgColor) {
        int baseV = v * k;
        int baseU = u * k;

        // 尝试面纹理
        if (faceTexture != null) {
            Optional<int[][]> texOpt = faceTexture.getFacePixels(state, faceDir);
            if (texOpt.isPresent()) {
                int[][] tex = texOpt.get();  // 16×16 ARGB
                int g = 16 / k;  // 每子格覆盖的纹理像素数（每维）
                for (int sv = 0; sv < k; sv++) {
                    int rowIdx = baseV + sv;
                    int y0 = sv * g;
                    for (int su = 0; su < k; su++) {
                        int x0 = su * g;
                        grid[rowIdx][baseU + su] = averageTexRegion(tex, y0, x0, g, bgColor);
                    }
                }
                return;
            }
        }

        // 回退：MapColor 单色填充所有子格
        int color = BlockColorMapper.toARGB(state);
        for (int sv = 0; sv < k; sv++) {
            int[] dstRow = grid[baseV + sv];
            int colStart = baseU;
            int colEnd = baseU + k;
            for (int su = colStart; su < colEnd; su++) {
                dstRow[su] = color;
            }
        }
    }

    /**
     * 对 k×k 子格区域填充背景色（ignore 集中的方块 / 超距离未命中）。
     */
    private static void fillSubCells(int[][] grid, int v, int u, int k, int bgColor) {
        int baseV = v * k;
        int baseU = u * k;
        for (int sv = 0; sv < k; sv++) {
            int[] dstRow = grid[baseV + sv];
            int colStart = baseU;
            int colEnd = baseU + k;
            for (int su = colStart; su < colEnd; su++) {
                dstRow[su] = bgColor;
            }
        }
    }

    /**
     * 对纹理 16×16 的 g×g 区域取平均色。
     * 透明像素（alpha=0）不计入平均，全区透明时返回 bgColor。
     *
     * @param tex     16×16 ARGB 纹理像素 tex[y][x]
     * @param y0      区域起始 y
     * @param x0      区域起始 x
     * @param g       区域大小（每维）
     * @param bgColor 全区透明时的回退色
     * @return ARGB int（全不透明）
     */
    private static int averageTexRegion(int[][] tex, int y0, int x0, int g, int bgColor) {
        long r = 0, gSum = 0, b = 0;
        int n = 0;
        for (int dy = 0; dy < g; dy++) {
            int[] row = tex[y0 + dy];
            for (int dx = 0; dx < g; dx++) {
                int argb = row[x0 + dx];
                if (((argb >>> 24) & 0xFF) > 0) {  // 非透明像素
                    r += (argb >>> 16) & 0xFF;
                    gSum += (argb >>> 8) & 0xFF;
                    b += argb & 0xFF;
                    n++;
                }
            }
        }
        if (n == 0) {
            return bgColor;
        }
        return 0xFF000000
                | ((int) (r / n) << 16)
                | ((int) (gSum / n) << 8)
                | ((int) (b / n));
    }

    // ─────────────────────────────────────────────────────────────
    //  辅助方法
    // ─────────────────────────────────────────────────────────────

    /** 获取 BlockState 的注册 ID 字符串（用于 ignoreSet 匹配）。 */
    private static String blockId(BlockState state) {
        // TODO: 需在 26.2 上验证 — BuiltInRegistries.BLOCK.getKey() 方法
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
    }

    /**
     * 统计颜色网格中非背景色的格子数（用于结果报告）。
     */
    public static int countNonBackground(int[][] grid, int bgColor) {
        int count = 0;
        for (int[] row : grid) {
            for (int color : row) {
                if (color != bgColor) {
                    count++;
                }
            }
        }
        return count;
    }
}
