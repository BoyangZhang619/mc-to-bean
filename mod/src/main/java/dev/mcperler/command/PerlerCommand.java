package dev.mcperler.command;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.permissions.Permissions;
import dev.mcperler.McPerlerMod;
import dev.mcperler.color.BlockColorMapper;
import dev.mcperler.export.PatternExporter;
import dev.mcperler.section.SampleOptions;
import dev.mcperler.section.SectionPlane;
import dev.mcperler.section.ViewSampler;

import java.nio.file.Path;
import java.util.*;

/**
 * /perler 命令族注册与参数解析（阶段 1-2 实现）。
 *
 * 子命令树：
 *   /perler section <x1> <y1> <z1> <x2> <y2> <z2> [--options...]
 *   /perler view    <x1> <y1> <z1> <x2> <y2> <z2> --direction <dir> --distance <n> [--options...]
 *
 * 支持的可选参数（通过 --flag value 贪婪字符串解析）：
 *   --direction/-d <east|west|north|south|up|down>  （view 必需）
 *   --distance/-D  <0..256>                           （view 必需）
 *   --ignore  <block_id>                              （可重复，追加到忽略集）
 *   --keep    <block_id>                              （可重复，从忽略集移除）
 *   --granularity/-g <1|2|4|8|16>                    （默认 16）
 *   --bg  <RRGGBB>                                     （背景色，默认 FFFFFF，支持 0x 前缀）
 *   --name <字符串>                                     （图纸名称）
 *   --save <路径>                                       （输出路径，默认自动生成）
 *
 * 硬上限校验（命令层）：
 *   面尺寸 ≤ 512×512
 *   distance ≤ 256
 *   输出豆数（面格数 × (16/g)^2） ≤ 1_000_000
 */
public final class PerlerCommand {

    /** 短选项 → 长选项名映射 */
    private static final Map<String, String> SHORT_OPTIONS = Map.of(
            "-d", "direction",
            "-D", "distance",
            "-g", "granularity"
    );

    /** 合法方向名映射（小写 → Direction 枚举） */
    private static final Map<String, Direction> DIRECTION_MAP = Map.of(
            "east",  Direction.EAST,
            "west",  Direction.WEST,
            "north", Direction.NORTH,
            "south", Direction.SOUTH,
            "up",    Direction.UP,
            "down",  Direction.DOWN
    );

    /** 合法粒度值集合 */
    private static final Set<Integer> VALID_GRANULARITIES = Set.of(1, 2, 4, 8, 16);

    // ─── 硬上限常量 ───
    private static final int MAX_FACE_WIDTH  = 512;
    private static final int MAX_FACE_HEIGHT = 512;
    private static final int MAX_DISTANCE    = 256;
    private static final int MAX_OUTPUT_BEANS = 1_000_000;

    private PerlerCommand() {} // 工具类，禁止实例化

    // ═══════════════════════════════════════════════════════════════
    //  命令树注册
    // ═══════════════════════════════════════════════════════════════

    /**
     * 向命令分发器注册 /perler 命令树。
     *
     * @param dispatcher Brigadier CommandDispatcher
     */
    /**
     * 构建 6 坐标参数链 (从 z2 往上包 x1)。
     *
     * 重要: brigadier 1.3.10 的 then(ArgumentBuilder) 会【立即】调用 build() 快照子节点,
     * 挂链之后再修改 z2 (executes/then) 全部无效 — 所以必须【先配置好 z2 再挂链】。
     */
    private static com.mojang.brigadier.builder.ArgumentBuilder<CommandSourceStack, ?> coordsTail(
            com.mojang.brigadier.builder.ArgumentBuilder<CommandSourceStack, ?> z2) {
        var y2 = Commands.argument("y2", IntegerArgumentType.integer()).then(z2);
        var x2 = Commands.argument("x2", IntegerArgumentType.integer()).then(y2);
        var z1 = Commands.argument("z1", IntegerArgumentType.integer()).then(x2);
        var y1 = Commands.argument("y1", IntegerArgumentType.integer()).then(z1);
        return Commands.argument("x1", IntegerArgumentType.integer()).then(y1);
    }

    public static void register(com.mojang.brigadier.CommandDispatcher<CommandSourceStack> dispatcher) {
        // /perler section <x1> <y1> <z1> <x2> <y2> <z2> [options]
        var secZ2 = Commands.argument("z2", IntegerArgumentType.integer());
        secZ2.executes(ctx -> executeSection(ctx, ""));                 // 无 options: 全部默认
        secZ2.then(Commands.argument("options", StringArgumentType.greedyString())
                .executes(ctx -> executeSection(ctx,
                        StringArgumentType.getString(ctx, "options")))); // 有 options: 贪婪解析
        var sectionNode = Commands.literal("section").then(coordsTail(secZ2));

        // /perler view <x1> <y1> <z1> <x2> <y2> <z2> <options>  （options 必需）
        var viewZ2 = Commands.argument("z2", IntegerArgumentType.integer());
        viewZ2.then(Commands.argument("options", StringArgumentType.greedyString())
                .executes(ctx -> executeView(ctx,
                        StringArgumentType.getString(ctx, "options"))));
        var viewNode = Commands.literal("view").then(coordsTail(viewZ2));

        // /perler howtouse — 输出中文帮助
        var howtouseNode = Commands.literal("howtouse")
                .executes(PerlerCommand::executeHowToUse);

        dispatcher.register(
                Commands.literal("perler")
                        .requires(source -> source.permissions()
                                .hasPermission(Permissions.COMMANDS_ADMIN)) // 26.2: 需要 OP 2 级管理员权限
                        .then(sectionNode)
                        .then(viewNode)
                        .then(howtouseNode));
    }

    // ═══════════════════════════════════════════════════════════════
    //  命令执行入口
    // ═══════════════════════════════════════════════════════════════

    /** /perler section — distance=0, direction=null */
    private static int executeSection(CommandContext<CommandSourceStack> ctx, String optionsStr) {
        try {
            return executeSectionInner(ctx, optionsStr);
        } catch (Exception e) {
            // 防御: 任何内部异常转成明确中文消息, 避免 Brigadier 的笼统报错
            ctx.getSource().sendFailure(Component.literal("section 参数错误: " + e.getMessage()));
            McPerlerMod.LOGGER.warn("section 命令异常", e);
            return 0;
        }
    }

    private static int executeSectionInner(CommandContext<CommandSourceStack> ctx, String optionsStr) {
        CommandSourceStack source = ctx.getSource();
        BlockPos corner1 = getCorner1(ctx);
        BlockPos corner2 = getCorner2(ctx);

        // 解析 options
        OptMap parsed = parseOptions(optionsStr);

        // section 模式下不应有 --direction / --distance
        if (parsed.has("direction")) {
            source.sendFailure(Component.literal("section 模式不需要 --direction，请使用 /perler view"));
            return 0;
        }
        if (parsed.has("distance")) {
            source.sendFailure(Component.literal("section 模式不需要 --distance（distance 固定为 0）"));
            return 0;
        }

        return prepareAndSubmit(source, corner1, corner2, null, 0, parsed);
    }

    /** /perler view — 必须含 --direction 和 --distance */
    private static int executeView(CommandContext<CommandSourceStack> ctx, String optionsStr) {
        try {
            return executeViewInner(ctx, optionsStr);
        } catch (Exception e) {
            // 防御: 任何内部异常转成明确中文消息, 避免 Brigadier 的笼统报错
            ctx.getSource().sendFailure(Component.literal("view 参数错误: " + e.getMessage()));
            McPerlerMod.LOGGER.warn("view 命令异常", e);
            return 0;
        }
    }

    private static int executeViewInner(CommandContext<CommandSourceStack> ctx, String optionsStr) {
        CommandSourceStack source = ctx.getSource();

        // 解析 options
        OptMap parsed = parseOptions(optionsStr);

        // 校验必需参数
        if (!parsed.has("direction")) {
            source.sendFailure(Component.literal(
                    "view 模式必须指定 --direction（或 -d），合法值: east / west / north / south / up / down"));
            return 0;
        }
        if (!parsed.has("distance")) {
            source.sendFailure(Component.literal(
                    "view 模式必须指定 --distance（或 -D），合法值: 0.." + MAX_DISTANCE));
            return 0;
        }

        // 解析方向
        String dirStr = parsed.getFirst("direction").toLowerCase();
        Direction dir = DIRECTION_MAP.get(dirStr);
        if (dir == null) {
            source.sendFailure(Component.literal(
                    "无效的方向 '" + dirStr + "'，合法值: east / west / north / south / up / down"));
            return 0;
        }

        // 解析 distance
        int distance;
        try {
            distance = Integer.parseInt(parsed.getFirst("distance"));
        } catch (NumberFormatException e) {
            source.sendFailure(Component.literal("--distance 必须是整数，收到: " + parsed.getFirst("distance")));
            return 0;
        }
        if (distance < 0 || distance > MAX_DISTANCE) {
            source.sendFailure(Component.literal(
                    "--distance 超出范围 (0.." + MAX_DISTANCE + ")，收到: " + distance));
            return 0;
        }

        BlockPos corner1 = getCorner1(ctx);
        BlockPos corner2 = getCorner2(ctx);

        return prepareAndSubmit(source, corner1, corner2, dir, distance, parsed);
    }

    /** /perler howtouse — 输出完整中文帮助 */
    private static int executeHowToUse(CommandContext<CommandSourceStack> ctx) {
        ctx.getSource().sendSuccess(() -> Component.literal(
                "§6/perler 图纸命令帮助§r\n\n" +
                "§e语法:§r\n" +
                "  /perler section <x1> <y1> <z1> <x2> <y2> <z2> [选项]\n" +
                "  /perler view <x1> <y1> <z1> <x2> <y2> <z2> --direction <dir> --distance <N> [选项]\n\n" +
                "§e平面要求:§r\n" +
                "  两点必须共面（恰有一轴坐标相同），定义矩形采样区域。\n\n" +
                "§e方向合法性 (view模式):§r\n" +
                "  共面轴 X → east / west\n" +
                "  共面轴 Z → north / south\n" +
                "  共面轴 Y → up / down\n\n" +
                "§e选项:§r\n" +
                "  --direction/-d <方向>    视图方向 (view 必需)\n" +
                "  --distance/-D <0..256>   探测距离 (view 必需)\n" +
                "  --ignore <方块ID>         忽略该方块，可重复多次\n" +
                "  --keep <方块ID>           保留该方块（从忽略集中移除），可重复\n" +
                "  --granularity/-g <值>    粒度: 1|2|4|8|16 (默认 16)\n" +
                "  --bg <RRGGBB>            背景色 (默认 FFFFFF)\n" +
                "  --name <名称>             图纸名称\n" +
                "  --save <路径>             自定义保存路径\n\n" +
                "§e示例:§r\n" +
                "  /perler view 0 60 0 10 80 0 --direction north --distance 32\n\n" +
                "§e输出路径:§r\n" +
                "  默认 .minecraft/patterns/，JSON 可用 pattern-tool/json_to_pattern.py 渲染为 PNG"
        ), false);
        return 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  校验、构建选项、提交异步任务
    // ═══════════════════════════════════════════════════════════════

    /**
     * 统一的校验 + 选项构建 + 异步提交流程。
     *
     * @param source   命令来源
     * @param corner1  平面第一个角
     * @param corner2  平面第二个角
     * @param dir      view 方向（section 模式传 null）
     * @param distance 探测距离（section 模式传 0）
     * @param parsed   已解析的选项
     */
    private static int prepareAndSubmit(CommandSourceStack source,
                                         BlockPos corner1, BlockPos corner2,
                                         Direction dir, int distance, OptMap parsed) {
        // ── 1. 构建 SectionPlane（共面校验内置于构造函数） ──
        SectionPlane plane;
        try {
            plane = new SectionPlane(corner1, corner2);
        } catch (IllegalArgumentException e) {
            source.sendFailure(Component.literal("平面参数无效: " + e.getMessage()));
            return 0;
        }

        // ── 2. 方向合法性校验（view 模式） ──
        if (dir != null) {
            try {
                plane.validateDirection(dir);
            } catch (IllegalArgumentException e) {
                source.sendFailure(Component.literal(e.getMessage()));
                return 0;
            }
        }

        // ── 3. 面尺寸上限校验 ──
        if (plane.getWidth() > MAX_FACE_WIDTH || plane.getHeight() > MAX_FACE_HEIGHT) {
            source.sendFailure(Component.literal(String.format(
                    "采样面过大 (%dx%d)，上限为 %dx%d。请缩小坐标范围",
                    plane.getWidth(), plane.getHeight(), MAX_FACE_WIDTH, MAX_FACE_HEIGHT)));
            return 0;
        }

        // ── 4. 解析并校验 granularity ──
        int granularity = SampleOptions.DEFAULT_GRANULARITY;
        if (parsed.has("granularity")) {
            try {
                granularity = Integer.parseInt(parsed.getFirst("granularity"));
            } catch (NumberFormatException e) {
                source.sendFailure(Component.literal("--granularity 必须是整数"));
                return 0;
            }
            if (!VALID_GRANULARITIES.contains(granularity)) {
                source.sendFailure(Component.literal(
                        "--granularity 必须是 1|2|4|8|16，收到: " + granularity));
                return 0;
            }
        }

        // ── 5. 输出豆数上限校验 ──
        int scale = 16 / granularity;
        long totalBeans = (long) plane.getWidth() * plane.getHeight() * scale * scale;
        if (totalBeans > MAX_OUTPUT_BEANS) {
            source.sendFailure(Component.literal(String.format(
                    "输出豆数过多 (%d)，上限为 %d。请减小采样面或增大 --granularity",
                    totalBeans, MAX_OUTPUT_BEANS)));
            return 0;
        }

        // ── 6. 解析 name ──
        String name;
        if (parsed.has("name")) {
            name = parsed.getFirst("name");
        } else {
            name = dir != null
                    ? String.format("view_%s%d_%s_d%d",
                            plane.getAxis().name().toLowerCase(), plane.getOffset(),
                            dir.getName(), distance)
                    : String.format("section_%s%d",
                            plane.getAxis().name().toLowerCase(), plane.getOffset());
        }

        // ── 7. 解析背景色 ──
        int bgColor = SampleOptions.DEFAULT_BG_COLOR;
        if (parsed.has("bg")) {
            bgColor = parseHexColor(parsed.getFirst("bg"));
            if (bgColor < 0) {
                source.sendFailure(Component.literal(
                        "--bg 格式无效，请使用 RRGGBB（如 FFFFFF）或 AARRGGBB（如 FFFFFFFF）"));
                return 0;
            }
        }

        // ── 8. 解析 save 路径 ──
        Path savePath = null;
        if (parsed.has("save")) {
            savePath = Path.of(parsed.getFirst("save"));
        }

        // ── 9. 构建 SampleOptions ──
        Set<String> ignoreSet = new LinkedHashSet<>(SampleOptions.DEFAULT_IGNORE);
        // 应用 --ignore（追加）
        for (String blockId : parsed.getAll("ignore")) {
            ignoreSet.add(blockId);
        }
        // 应用 --keep（移除）
        for (String blockId : parsed.getAll("keep")) {
            ignoreSet.remove(blockId);
        }

        // frozen set
        Set<String> frozenIgnore = Collections.unmodifiableSet(ignoreSet);

        SampleOptions opts = new SampleOptions(dir, distance, frozenIgnore,
                granularity, bgColor, name, savePath);

        McPerlerMod.LOGGER.debug("构建 SampleOptions: {}", opts);

        // ── 10. 获取 ServerLevel ──
        // TODO: 需在 26.2 上验证 — CommandSourceStack.getLevel() 方法名
        ServerLevel level = source.getLevel();
        if (level == null) {
            source.sendFailure(Component.literal("无法获取当前世界（source.getLevel() 返回 null）"));
            return 0;
        }

        MinecraftServer server = source.getServer();
        if (server == null) {
            source.sendFailure(Component.literal("无法获取服务器实例"));
            return 0;
        }

        // ── 11. 发送受理回执，提交异步任务 ──
        String planeDesc = String.format("%s offset=%d %dx%d",
                plane.getAxis(), plane.getOffset(), plane.getWidth(), plane.getHeight());

        source.sendSuccess(() -> Component.literal(
                "任务已提交 " + planeDesc + " — 正在后台采样..."), false);

        McPerlerMod.LOGGER.info("异步任务提交: plane={}, opts={}", plane, opts);

        submitAsync(source, server, level, plane, opts);

        return 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  异步执行与回执
    // ═══════════════════════════════════════════════════════════════

    /**
     * 提交采样任务到独立线程池，完成后发回执消息给命令发起者。
     *
     * 线程模型：
     *   主线程（当前）→ 提交 Runnable → 后台线程池执行采样+导出
     *   → server.execute() 切回主线程发送回执
     */
    private static void submitAsync(CommandSourceStack source, MinecraftServer server,
                                     ServerLevel level, SectionPlane plane, SampleOptions opts) {
        // 颜色映射器（骨架阶段无状态，每次新建）
        BlockColorMapper mapper = new BlockColorMapper();

        McPerlerMod.SAMPLER_EXECUTOR.submit(() -> {
            try {
                // ── 采样（含 granularity 占位展开） ──
                int[][] grid = ViewSampler.sample(level, plane, opts, mapper, null);
                int nonBgCount = ViewSampler.countNonBackground(grid, opts.bgColor());
                int actualHeight = grid.length;
                int actualWidth = grid[0].length;

                // ── 导出 ──
                Path outputPath = PatternExporter.exportFromColors(
                        grid, actualWidth, actualHeight,
                        opts.name(), opts.savePath(), 5);

                // ── 切回主线程发送成功回执 ──
                int finalNonBg = nonBgCount;
                int finalBeans = actualWidth * actualHeight;
                int finalW = actualWidth;
                int finalH = actualHeight;
                Path finalOutput = outputPath;
                server.execute(() -> {
                    source.sendSuccess(() -> Component.literal(
                            String.format("§a图纸已导出! §f%s §7(有效方块: %d/%d, 豆数: %d, 尺寸: %dx%d)",
                                    finalOutput.getFileName(), finalNonBg, finalBeans,
                                    finalBeans, finalW, finalH)), false);
                });

                McPerlerMod.LOGGER.info("异步任务完成: {} 有效方块/{} 豆数, 输出 {}",
                        finalNonBg, finalBeans, finalOutput);

            } catch (Exception e) {
                // ── 切回主线程发送失败回执 ──
                McPerlerMod.LOGGER.error("采样任务失败", e);
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                server.execute(() -> {
                    source.sendFailure(Component.literal("采样失败: " + errMsg));
                });
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Options 字符串解析器
    // ═══════════════════════════════════════════════════════════════

    /**
     * 解析 --flag value 格式的选项字符串。
     *
     * 支持以下格式：
     *   --key value         长选项（单值）
     *   -k value            短选项（映射到长选项名）
     *   --key v1 --key v2   同 key 多次出现时合并值（--ignore, --keep）
     *
     * 注意：不支持 --key=value 等号格式（简单优先）。
     *
     * @param raw 原始选项字符串（可为空）
     * @return 解析后的选项映射（key → 值列表）
     */
    static OptMap parseOptions(String raw) {
        if (raw == null || raw.isBlank()) {
            return new OptMap();
        }

        String[] tokens = raw.trim().split("\\s+");
        String currentKey = null;
        List<String> currentValues = new ArrayList<>();
        OptMap result = new OptMap();

        for (String token : tokens) {
            if (token.startsWith("--")) {
                // 长选项：提交前一个 key 的累积值，开始新 key
                if (currentKey != null) {
                    result.putAll(currentKey, currentValues);
                }
                currentKey = token.substring(2).toLowerCase();
                currentValues = new ArrayList<>();
            } else if (token.startsWith("-") && token.length() == 2
                    && !Character.isDigit(token.charAt(1))) {
                // 短选项（如 -d, -D, -g），排除负数
                if (currentKey != null) {
                    result.putAll(currentKey, currentValues);
                }
                String mapped = SHORT_OPTIONS.getOrDefault(token.toLowerCase(),
                        token.substring(1).toLowerCase());
                currentKey = mapped;
                currentValues = new ArrayList<>();
            } else {
                // 值：追加到当前 key
                if (currentKey != null) {
                    currentValues.add(token);
                }
                // 无当前 key 时忽略孤立值（命令行末尾的残余文本等）
            }
        }

        // 冲刷最后一个 key
        if (currentKey != null) {
            result.putAll(currentKey, currentValues);
        }

        return result;
    }

    /**
     * 解析十六进制颜色字符串为 ARGB int。
     * 支持格式：RRGGBB / AARRGGBB / 0xRRGGBB / 0xAARRGGBB
     *
     * @return ARGB int（Alpha 在 bits 24-31），解析失败返回 -1
     */
    private static int parseHexColor(String hex) {
        if (hex == null || hex.isBlank()) return -1;
        hex = hex.trim();
        // 移除 0x / 0X / # 前缀
        if (hex.startsWith("0x") || hex.startsWith("0X")) {
            hex = hex.substring(2);
        } else if (hex.startsWith("#")) {
            hex = hex.substring(1);
        }

        try {
            long val = Long.parseLong(hex, 16);
            if (hex.length() <= 6) {
                // RRGGBB → 补 Alpha=FF
                return 0xFF000000 | (int) val;
            } else {
                // AARRGGBB
                return (int) val;
            }
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  辅助方法
    // ═══════════════════════════════════════════════════════════════

    private static BlockPos getCorner1(CommandContext<CommandSourceStack> ctx) {
        return new BlockPos(
                IntegerArgumentType.getInteger(ctx, "x1"),
                IntegerArgumentType.getInteger(ctx, "y1"),
                IntegerArgumentType.getInteger(ctx, "z1"));
    }

    private static BlockPos getCorner2(CommandContext<CommandSourceStack> ctx) {
        return new BlockPos(
                IntegerArgumentType.getInteger(ctx, "x2"),
                IntegerArgumentType.getInteger(ctx, "y2"),
                IntegerArgumentType.getInteger(ctx, "z2"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  内部类：选项映射
    // ═══════════════════════════════════════════════════════════════

    /**
     * 选项名 → 值列表的映射容器。
     * 支持单值选项（取第一个值）和可重复选项（取所有值）。
     */
    static class OptMap {
        private final Map<String, List<String>> map = new LinkedHashMap<>();

        boolean has(String key) {
            List<String> vals = map.get(key);
            return vals != null && !vals.isEmpty();
        }

        String getFirst(String key) {
            List<String> vals = map.get(key);
            return (vals != null && !vals.isEmpty()) ? vals.get(0) : null;
        }

        List<String> getAll(String key) {
            List<String> vals = map.get(key);
            return vals != null ? List.copyOf(vals) : List.of();
        }

        void putAll(String key, List<String> values) {
            if (values.isEmpty()) return;
            map.computeIfAbsent(key, k -> new ArrayList<>()).addAll(values);
        }
    }
}
