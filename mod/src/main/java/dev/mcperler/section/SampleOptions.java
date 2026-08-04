package dev.mcperler.section;

import net.minecraft.core.Direction;

import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 采样选项 —— F2 view/section 命令的所有参数封装。
 *
 * 不可变 record，通过 Builder 或工厂方法构造。
 *
 * @param direction   视图方向（view 模式使用，section 模式下为 null）
 * @param distance    射线探测距离（0 = section 模式，>0 = view 模式逐格 raycast）
 * @param ignoreSet   忽略的方块 ID 集合（如 "minecraft:air"），不区分大小写匹配时建议 toLowerCase
 *                    默认含 air/barrier/structure_void
 * @param granularity 输出粒度 1|2|4|8|16（阶段 3 才真正聚合，目前仅记录元数据）
 * @param bgColor     背景色 ARGB int（空气 / 超距离位置的填充色，默认 0xFFFFFFFF 白色）
 * @param name        输出图纸名称
 * @param savePath    保存路径（可为 null，此时自动生成到 .minecraft/patterns/）
 */
public record SampleOptions(
        Direction direction,
        int distance,
        Set<String> ignoreSet,
        int granularity,
        int bgColor,
        String name,
        Path savePath) {

    /** 默认忽略的方块 ID（均为透明/不可见方块） */
    public static final Set<String> DEFAULT_IGNORE = Set.of(
            "minecraft:air",
            "minecraft:cave_air",       // TODO: 需在 26.2 上验证此 ID 是否存在
            "minecraft:void_air",       // TODO: 同上
            "minecraft:barrier",
            "minecraft:structure_void"
    );

    /** 默认背景色：不透明白色 */
    public static final int DEFAULT_BG_COLOR = 0xFFFFFFFF;

    /** 默认粒度：16（1 方块 = 1 豆） */
    public static final int DEFAULT_GRANULARITY = 16;

    /** 允许的粒度值 */
    public static final Set<Integer> VALID_GRANULARITIES = Set.of(1, 2, 4, 8, 16);

    // ─── 工厂方法 / Builder ───

    /** 创建 section 模式（distance=0, direction=null）的默认选项 */
    public static SampleOptions forSection(String name) {
        return new SampleOptions(null, 0, Collections.unmodifiableSet(new LinkedHashSet<>(DEFAULT_IGNORE)),
                DEFAULT_GRANULARITY, DEFAULT_BG_COLOR, name, null);
    }

    /** 创建 view 模式的默认选项 */
    public static SampleOptions forView(Direction direction, int distance, String name) {
        return new SampleOptions(direction, distance, Collections.unmodifiableSet(new LinkedHashSet<>(DEFAULT_IGNORE)),
                DEFAULT_GRANULARITY, DEFAULT_BG_COLOR, name, null);
    }

    // ─── 衍生方法 ───

    /** 向忽略集追加方块 ID，返回新实例（不可变语义） */
    public SampleOptions withAddedIgnore(String blockId) {
        Set<String> newSet = new LinkedHashSet<>(ignoreSet);
        newSet.add(blockId);
        return new SampleOptions(direction, distance, Collections.unmodifiableSet(newSet),
                granularity, bgColor, name, savePath);
    }

    /** 从忽略集移除方块 ID，返回新实例（不可变语义） */
    public SampleOptions withRemovedIgnore(String blockId) {
        Set<String> newSet = new LinkedHashSet<>(ignoreSet);
        newSet.remove(blockId);
        return new SampleOptions(direction, distance, Collections.unmodifiableSet(newSet),
                granularity, bgColor, name, savePath);
    }

    /** 判断给定方块注册 ID 是否在忽略集中 */
    public boolean isIgnored(String blockId) {
        return ignoreSet.contains(blockId);
    }

    @Override
    public String toString() {
        return String.format("SampleOptions{dir=%s, dist=%d, ignore=%s, gran=%d, bg=0x%08X, name=%s, save=%s}",
                direction, distance, ignoreSet, granularity, bgColor, name, savePath);
    }
}
