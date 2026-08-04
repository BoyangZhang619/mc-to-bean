package dev.mcperler.color;

import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.MapColor;

/**
 * 方块 → RGB 颜色的映射器。
 *
 * 【骨架阶段实现】
 * 使用 Minecraft 内置的 MapColor（地图颜色），与方块实际颜色有基本对应关系。
 * 这是快速但粗糙的方案：MapColor 是预定义的 60+ 种颜色，每种代表一类方块。
 *
 * 【后续迭代计划】
 * 通过读取方块纹理贴图取面平均色：
 *   1. 获取 BlockModel（Minecraft.getInstance().getBlockRenderer().getBlockModel(state)）
 *   2. 从 BakedModel 取出面向相机的 quads
 *   3. 取对应的 Sprite / TextureAtlasSprite 的像素数据
 *   4. 计算面平均 RGB
 * 备选方案：
 *   - 直接读 assets/minecraft/textures/block/*.png（需要绑定资源包）
 *   - 使用 BlockRenderDispatcher.renderBatched() 离线渲染单方块并读回像素
 *
 * TODO: 需在 26.2 上验证
 *   - MapColor 在 26.2 中可能改为 record，字段名从 col 变成其他
 *   - 26.2 引入 Vulkan 渲染后端，BlockRenderDispatcher 的 API 可能调整
 *   - 获取 MapColor 的方法签名：state.getMapColor(BlockGetter, BlockPos) 确认参数
 */
public class BlockColorMapper {

    /** 空气 / 空位用的默认背景色（白色） */
    private static final int[] BACKGROUND_COLOR = { 255, 255, 255 };

    /**
     * 获取 BlockState 对应的 ARGB int 颜色。
     * 用于 ViewSampler 直接返回 int 数组。
     *
     * @param state 方块状态，不可为 null 或 air
     * @return ARGB int（Alpha=0xFF）
     */
    public static int toARGB(BlockState state) {
        int[] rgb = getColor(state);
        return 0xFF000000 | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    }

    /**
     * 获取 BlockState 对应的 RGB 颜色。
     *
     * @param state 方块状态，可为 null（表示空气/空位）
     * @return int[3] = {r, g, b}，各分量 0-255
     */
    public static int[] getColor(BlockState state) {
        if (state == null || state.isAir()) {
            return BACKGROUND_COLOR;
        }

        // ── 主方案：使用 MapColor（地图颜色） ──
        try {
            // TODO: 需在 26.2 上验证 — getMapColor 方法签名
            // 26.1/26.2 未混淆版本预期签名：
            //   MapColor getMapColor(BlockGetter level, BlockPos pos)
            // 备选 API:
            //   state.getBlock().defaultMapColor()  返回 MapColor
            //   state.getMapColor(world, pos)       需要 world/pos 上下文
            //
            // 传入 null 参数是因为我们只需要方块类型的默认颜色，不依赖具体坐标
            MapColor mapColor = state.getMapColor(null, null);

            if (mapColor != null) {
                // TODO: 需在 26.2 上验证 — MapColor 的 ARGB 字段名
                // 26.1 中 MapColor 可能是 record MapColor(int col, MaterialColor.Brightness brightness)
                // 备选字段名: col, color, argb, packed
                // 如果 MapColor 变为 record，用 mapColor.col() 而非 mapColor.col
                int argb = getMapColorARGB(mapColor);
                return new int[]{
                        (argb >> 16) & 0xFF,
                        (argb >> 8) & 0xFF,
                        argb & 0xFF
                };
            }
        } catch (Exception e) {
            // MapColor 方案失败，降级到哈希方案
            // 常见原因：26.2 中 MapColor API 变化
        }

        // ── 降级方案：基于方块注册 ID 生成稳定哈希颜色 ──
        // 此方案保证同种方块总是得到相同颜色，但颜色不反映实际外观
        return hashColor(String.valueOf(state.getBlock()));
    }

    /**
     * 尝试从 MapColor 获取 ARGB int。
     * 处理多种可能的 API 形态（record vs class, 不同字段名）。
     *
     * TODO: 需在 26.2 上验证 — 确认后移除多余的备选路径
     */
    private static int getMapColorARGB(MapColor mapColor) {
        // 尝试 1：直接访问 col 字段（传统 class 形态）
        try {
            return mapColor.col;
        } catch (NoSuchFieldError | IllegalAccessError e) {
            // 字段不存在或不可访问
        }

        // 尝试 2：record 形态，调用 col() 方法
        try {
            // 反射调用 mapColor.col() — record 的 accessor 方法
            return (int) MapColor.class.getMethod("col").invoke(mapColor);
        } catch (Exception e) {
            // 方法不存在
        }

        // 尝试 3：其他常见字段名
        for (String fieldName : new String[]{"color", "argb", "packed", "materialColor"}) {
            try {
                java.lang.reflect.Field field = MapColor.class.getDeclaredField(fieldName);
                field.setAccessible(true);
                return (int) field.get(mapColor);
            } catch (Exception ignored) {
            }
        }

        // 所有尝试失败，返回灰色
        return 0xFF888888;
    }

    /**
     * 基于字符串 key 生成稳定的 RGB 颜色（降级方案）。
     * 保证相同 key 总是得到相同颜色。
     */
    private static int[] hashColor(String key) {
        int hash = key.hashCode();
        // 限制在中等亮度的颜色范围，避免过暗或过亮
        return new int[]{
                Math.abs(hash % 180) + 40,         // R: 40-219
                Math.abs((hash >> 8) % 180) + 40,  // G: 40-219
                Math.abs((hash >> 16) % 180) + 40  // B: 40-219
        };
    }
}
