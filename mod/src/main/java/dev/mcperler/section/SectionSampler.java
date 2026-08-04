package dev.mcperler.section;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 【已废弃】旧的截面采样器。
 *
 * @deprecated 自阶段 2 起，采样统一由 {@link ViewSampler} 处理（distance=0 即截面模式）。
 *             此类保留仅作参考，不再维护，请勿在新代码中使用。
 *
 * @see ViewSampler
 * @see SampleOptions
 */
@Deprecated
public class SectionSampler {

    /**
     * @deprecated 使用 {@link ViewSampler#sample(ServerLevel, SectionPlane, SampleOptions, dev.mcperler.color.BlockColorMapper)}
     *             并设置 distance=0 替代。
     */
    @Deprecated
    public static BlockState[][] sample(ServerLevel level, SectionPlane plane) {
        int width = plane.getWidth();
        int height = plane.getHeight();

        BlockState[][] grid = new BlockState[height][width];

        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                BlockPos pos = plane.toWorldPos(u, v);
                // TODO: 需在 26.2 上验证 — Level.getBlockState(BlockPos) 方法名
                BlockState state = level.getBlockState(pos);
                grid[v][u] = state;
            }
        }

        return grid;
    }

    /**
     * @deprecated 使用 {@link ViewSampler#countNonBackground(int[][], int)} 替代。
     */
    @Deprecated
    public static int countNonAir(BlockState[][] grid) {
        int count = 0;
        for (BlockState[] row : grid) {
            for (BlockState state : row) {
                if (state != null && !state.isAir()) {
                    count++;
                }
            }
        }
        return count;
    }
}
