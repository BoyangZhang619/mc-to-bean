package dev.mcperler.section;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;

/**
 * 截面平面参数 —— F2 view/section 功能的核心数据类。
 *
 * 通过两个对角坐标定义轴对齐矩形平面：
 *   两个 BlockPos 必须恰有一个轴相等（共面），平面法线即该轴的轴向。
 *
 * 示例：
 *   (0, 64, 0) 和 (0, 64, 100) → 法线 X，YZ 平面，u=Y, v=Z
 *   (0, 64, 0) 和 (100, 64, 100) → 法线 Y，XZ 平面，u=X, v=Z
 *   (0, 64, 0) 和 (100, 100, 0) → 法线 Z，XY 平面，u=X, v=Y
 */
public class SectionPlane {

    /** 截面法线方向（即沿哪个轴做截面） */
    public enum Axis {
        /** X 轴：取 YZ 平面，u=Y, v=Z */
        X,
        /** Y 轴：取 XZ 平面（水平截面），u=X, v=Z */
        Y,
        /** Z 轴：取 XY 平面，u=X, v=Y */
        Z
    }

    /** 平面法线轴 */
    private final Axis axis;
    /** 沿法线轴的固定坐标值 */
    private final int offset;
    /** 平面内第一轴（u）的最小坐标（含） */
    private final int minU;
    /** 平面内第二轴（v）的最小坐标（含） */
    private final int minV;
    /** 平面内第一轴（u）的最大坐标（含） */
    private final int maxU;
    /** 平面内第二轴（v）的最大坐标（含） */
    private final int maxV;

    /**
     * 从两个对角坐标构造截面平面。
     *
     * 两个坐标必须恰有一個軸相等（共面校验），否则抛出 IllegalArgumentException。
     *
     * @param corner1 矩形平面一个角的世界坐标
     * @param corner2 矩形平面对角的世界坐标
     * @throws IllegalArgumentException 如果两个坐标不共面（没有恰有一个轴相等）
     */
    public SectionPlane(BlockPos corner1, BlockPos corner2) {
        int dx = Math.abs(corner1.getX() - corner2.getX());
        int dy = Math.abs(corner1.getY() - corner2.getY());
        int dz = Math.abs(corner1.getZ() - corner2.getZ());

        int equalCount = 0;
        if (dx == 0) equalCount++;
        if (dy == 0) equalCount++;
        if (dz == 0) equalCount++;

        if (equalCount != 1) {
            throw new IllegalArgumentException(String.format(
                    "两个坐标必须恰有一个轴相等（共面）。当前: (%d,%d,%d) 与 (%d,%d,%d) — %d 个轴相等",
                    corner1.getX(), corner1.getY(), corner1.getZ(),
                    corner2.getX(), corner2.getY(), corner2.getZ(),
                    equalCount));
        }

        if (dx == 0) {
            // X 相等 → 法线 X，YZ 平面
            this.axis = Axis.X;
            this.offset = corner1.getX();
            this.minU = Math.min(corner1.getY(), corner2.getY());
            this.maxU = Math.max(corner1.getY(), corner2.getY());
            this.minV = Math.min(corner1.getZ(), corner2.getZ());
            this.maxV = Math.max(corner1.getZ(), corner2.getZ());
        } else if (dy == 0) {
            // Y 相等 → 法线 Y，XZ 平面
            this.axis = Axis.Y;
            this.offset = corner1.getY();
            this.minU = Math.min(corner1.getX(), corner2.getX());
            this.maxU = Math.max(corner1.getX(), corner2.getX());
            this.minV = Math.min(corner1.getZ(), corner2.getZ());
            this.maxV = Math.max(corner1.getZ(), corner2.getZ());
        } else {
            // Z 相等 → 法线 Z，XY 平面
            this.axis = Axis.Z;
            this.offset = corner1.getZ();
            this.minU = Math.min(corner1.getX(), corner2.getX());
            this.maxU = Math.max(corner1.getX(), corner2.getX());
            this.minV = Math.min(corner1.getY(), corner2.getY());
            this.maxV = Math.max(corner1.getY(), corner2.getY());
        }
    }

    /**
     * 将平面内的网格坐标 (u, v) 转换为世界坐标 BlockPos。
     *
     * @param u 平面第一轴的局部索引（0 起始，从 minU 开始）
     * @param v 平面第二轴的局部索引（0 起始，从 minV 开始）
     * @return 对应的世界坐标
     */
    public BlockPos toWorldPos(int u, int v) {
        int worldU = minU + u;
        int worldV = minV + v;
        return switch (axis) {
            case X -> new BlockPos(offset, worldU, worldV);  // YZ 平面
            case Y -> new BlockPos(worldU, offset, worldV);  // XZ 平面
            case Z -> new BlockPos(worldU, worldV, offset);  // XY 平面
        };
    }

    // ─── 方向合法性校验 ───

    /**
     * 校验给定的 Direction 是否可合法用于本平面的视图方向。
     *
     * 规则（根据 IMPLEMENTATION.md）：
     *   法线 X → east / west
     *   法线 Z → north / south
     *   法线 Y → up / down
     *
     * 即：方向必须沿法线轴的轴向（正负方向）。
     *
     * @param dir 待校验的方向
     * @throws IllegalArgumentException 如果方向不合法
     */
    public void validateDirection(Direction dir) {
        Direction.Axis dirAxis = dir.getAxis();
        boolean valid = switch (axis) {
            case X -> dirAxis == Direction.Axis.X;
            case Y -> dirAxis == Direction.Axis.Y;
            case Z -> dirAxis == Direction.Axis.Z;
        };
        if (!valid) {
            String legalValues = switch (axis) {
                case X -> "east / west";
                case Y -> "up / down";
                case Z -> "north / south";
            };
            throw new IllegalArgumentException(String.format(
                    "方向 %s 不合法。法线轴为 %s，合法方向: %s", dir.getName(), axis, legalValues));
        }
    }

    /**
     * 获取法线轴对应的合法 Direction 数组（2 个）。
     * 用于命令帮助文本和自动补全。
     */
    public Direction[] getLegalDirections() {
        return switch (axis) {
            case X -> new Direction[]{Direction.EAST, Direction.WEST};
            case Y -> new Direction[]{Direction.UP, Direction.DOWN};
            case Z -> new Direction[]{Direction.NORTH, Direction.SOUTH};
        };
    }

    // ─── 便捷属性 ───

    /** 平面宽度（列数）= u 方向范围 */
    public int getWidth() {
        return maxU - minU + 1;
    }

    /** 平面高度（行数）= v 方向范围 */
    public int getHeight() {
        return maxV - minV + 1;
    }

    /** 面上的方块总数（width × height） */
    public int getFaceBlockCount() {
        return getWidth() * getHeight();
    }

    public Axis getAxis() { return axis; }
    public int getOffset() { return offset; }
    public int getMinU() { return minU; }
    public int getMinV() { return minV; }
    public int getMaxU() { return maxU; }
    public int getMaxV() { return maxV; }

    @Override
    public String toString() {
        return String.format("SectionPlane{axis=%s, offset=%d, u=[%d..%d], v=[%d..%d], size=%dx%d}",
                axis, offset, minU, maxU, minV, maxV, getWidth(), getHeight());
    }
}
