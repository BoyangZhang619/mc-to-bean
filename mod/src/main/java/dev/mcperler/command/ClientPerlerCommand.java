package dev.mcperler.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.ArgumentBuilder;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import dev.mcperler.McPerlerMod;
import dev.mcperler.color.BlockColorMapper;
import dev.mcperler.color.FaceTextureProvider;
import dev.mcperler.export.PatternExporter;
import dev.mcperler.section.SampleOptions;
import dev.mcperler.section.SectionPlane;
import dev.mcperler.section.ViewSampler;

import java.nio.file.Path;
import java.util.*;

/**
 * 客户端 /perler section|view 命令（M5 面纹理版）。
 *
 * 与服务端 PerlerCommand 的区别：
 *   - 使用 FabricClientCommandSource（客户端命令），纯 brigadier builder
 *   - 接入 FaceTextureProvider 取真实方块面纹理像素
 *   - 异步执行线程复用 McPerlerMod.SAMPLER_EXECUTOR
 *
 * 命令树（与服务端版一致）：
 *   /perler section <x1> <y1> <z1> <x2> <y2> <z2> [options]
 *   /perler view    <x1> <y1> <z1> <x2> <y2> <z2> --direction <dir> --distance <n> [options]
 *   /perler howtouse
 *
 * 可选参数：--direction/-d, --distance/-D, --ignore, --keep,
 *           --granularity/-g, --bg, --name, --save
 */
public final class ClientPerlerCommand {

    /** 短选项 → 长选项名映射（与 PerlerCommand 一致） */
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

    private ClientPerlerCommand() {}

    // ═══════════════════════════════════════════════════════════════
    //  命令树注册
    // ═══════════════════════════════════════════════════════════════

    /**
     * 构建 6 坐标参数链（从 z2 往上包 x1），纯 brigadier builder。
     *
     * 重要：brigadier 1.3.10 的 then(ArgumentBuilder) 会立即调用 build() 快照子节点，
     * 挂链之后再修改 z2 (executes/then) 全部无效 — 所以必须先配置好 z2 再挂链。
     */
    private static ArgumentBuilder<FabricClientCommandSource, ?> coordsTail(
            ArgumentBuilder<FabricClientCommandSource, ?> z2) {
        var y2 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "y2", IntegerArgumentType.integer()).then(z2);
        var x2 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "x2", IntegerArgumentType.integer()).then(y2);
        var z1 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "z1", IntegerArgumentType.integer()).then(x2);
        var y1 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "y1", IntegerArgumentType.integer()).then(z1);
        return RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "x1", IntegerArgumentType.integer()).then(y1);
    }

    /**
     * 注册客户端 /perler 命令树。
     */
    public static void register(CommandDispatcher<FabricClientCommandSource> dispatcher) {
        // /perler section <x1> <y1> <z1> <x2> <y2> <z2> [options]
        var secZ2 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "z2", IntegerArgumentType.integer());
        secZ2.executes(ctx -> executeSection(ctx, ""));
        secZ2.then(RequiredArgumentBuilder.<FabricClientCommandSource, String>argument(
                "options", StringArgumentType.greedyString())
                .executes(ctx -> executeSection(ctx,
                        StringArgumentType.getString(ctx, "options"))));
        var sectionNode = LiteralArgumentBuilder.<FabricClientCommandSource>literal("section")
                .then(coordsTail(secZ2));

        // /perler view <x1> <y1> <z1> <x2> <y2> <z2> [options]  （options 必需含 --direction --distance）
        var viewZ2 = RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                "z2", IntegerArgumentType.integer());
        viewZ2.then(RequiredArgumentBuilder.<FabricClientCommandSource, String>argument(
                "options", StringArgumentType.greedyString())
                .executes(ctx -> executeView(ctx,
                        StringArgumentType.getString(ctx, "options"))));
        var viewNode = LiteralArgumentBuilder.<FabricClientCommandSource>literal("view")
                .then(coordsTail(viewZ2));

        // /perler howtouse
        var howtouseNode = LiteralArgumentBuilder.<FabricClientCommandSource>literal("howtouse")
                .executes(ClientPerlerCommand::executeHowToUse);

        dispatcher.register(
                LiteralArgumentBuilder.<FabricClientCommandSource>literal("perler")
                        .then(sectionNode)
                        .then(viewNode)
                        .then(howtouseNode));
    }

    // ═══════════════════════════════════════════════════════════════
    //  命令执行入口
    // ═══════════════════════════════════════════════════════════════

    /** /perler section — distance=0, direction=null */
    private static int executeSection(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        try {
            return executeSectionInner(ctx, optionsStr);
        } catch (Exception e) {
            ctx.getSource().sendError(Component.literal("section 参数错误: " + e.getMessage()));
            McPerlerMod.LOGGER.warn("客户端 section 命令异常", e);
            return 0;
        }
    }

    private static int executeSectionInner(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        FabricClientCommandSource source = ctx.getSource();
        BlockPos corner1 = getCorner1(ctx);
        BlockPos corner2 = getCorner2(ctx);
        PerlerCommand.OptMap parsed = PerlerCommand.parseOptions(optionsStr);

        if (parsed.has("direction")) {
            source.sendError(Component.literal("section 模式不需要 --direction，请使用 /perler view"));
            return 0;
        }
        if (parsed.has("distance")) {
            source.sendError(Component.literal("section 模式不需要 --distance（distance 固定为 0）"));
            return 0;
        }

        return prepareAndSubmit(source, corner1, corner2, null, 0, parsed);
    }

    /** /perler view — 必须含 --direction 和 --distance */
    private static int executeView(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        try {
            return executeViewInner(ctx, optionsStr);
        } catch (Exception e) {
            ctx.getSource().sendError(Component.literal("view 参数错误: " + e.getMessage()));
            McPerlerMod.LOGGER.warn("客户端 view 命令异常", e);
            return 0;
        }
    }

    private static int executeViewInner(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        FabricClientCommandSource source = ctx.getSource();
        PerlerCommand.OptMap parsed = PerlerCommand.parseOptions(optionsStr);

        if (!parsed.has("direction")) {
            source.sendError(Component.literal(
                    "view 模式必须指定 --direction（或 -d），合法值: east / west / north / south / up / down"));
            return 0;
        }
        if (!parsed.has("distance")) {
            source.sendError(Component.literal(
                    "view 模式必须指定 --distance（或 -D），合法值: 0.." + MAX_DISTANCE));
            return 0;
        }

        String dirStr = parsed.getFirst("direction").toLowerCase();
        Direction dir = DIRECTION_MAP.get(dirStr);
        if (dir == null) {
            source.sendError(Component.literal(
                    "无效的方向 '" + dirStr + "'，合法值: east / west / north / south / up / down"));
            return 0;
        }

        int distance;
        try {
            distance = Integer.parseInt(parsed.getFirst("distance"));
        } catch (NumberFormatException e) {
            source.sendError(Component.literal("--distance 必须是整数，收到: " + parsed.getFirst("distance")));
            return 0;
        }
        if (distance < 0 || distance > MAX_DISTANCE) {
            source.sendError(Component.literal(
                    "--distance 超出范围 (0.." + MAX_DISTANCE + ")，收到: " + distance));
            return 0;
        }

        BlockPos corner1 = getCorner1(ctx);
        BlockPos corner2 = getCorner2(ctx);

        return prepareAndSubmit(source, corner1, corner2, dir, distance, parsed);
    }

    /** /perler howtouse — 输出完整中文帮助 */
    private static int executeHowToUse(CommandContext<FabricClientCommandSource> ctx) {
        ctx.getSource().sendFeedback(Component.literal(
                "§6/perler 图纸命令帮助（客户端面纹理版）§r\n\n" +
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
                "§e本命令为客户端面纹理版:§r\n" +
                "  使用真实方块纹理取面平均色，颜色精度高于服务端 MapColor 版。\n" +
                "  输出路径: 默认 .minecraft/patterns/"
        ));
        return 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  校验、构建选项、提交异步任务
    // ═══════════════════════════════════════════════════════════════

    /**
     * 统一的校验 + 选项构建 + 异步提交（客户端版，接入面纹理）。
     */
    private static int prepareAndSubmit(FabricClientCommandSource source,
                                         BlockPos corner1, BlockPos corner2,
                                         Direction dir, int distance,
                                         PerlerCommand.OptMap parsed) {
        // ── 1. 构建 SectionPlane（共面校验内置于构造函数） ──
        SectionPlane plane;
        try {
            plane = new SectionPlane(corner1, corner2);
        } catch (IllegalArgumentException e) {
            source.sendError(Component.literal("平面参数无效: " + e.getMessage()));
            return 0;
        }

        // ── 2. 方向合法性校验（view 模式） ──
        if (dir != null) {
            try {
                plane.validateDirection(dir);
            } catch (IllegalArgumentException e) {
                source.sendError(Component.literal(e.getMessage()));
                return 0;
            }
        }

        // ── 3. 面尺寸上限校验 ──
        if (plane.getWidth() > MAX_FACE_WIDTH || plane.getHeight() > MAX_FACE_HEIGHT) {
            source.sendError(Component.literal(String.format(
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
                source.sendError(Component.literal("--granularity 必须是整数"));
                return 0;
            }
            if (!VALID_GRANULARITIES.contains(granularity)) {
                source.sendError(Component.literal(
                        "--granularity 必须是 1|2|4|8|16，收到: " + granularity));
                return 0;
            }
        }

        // ── 5. 输出豆数上限校验（按 granularity 展开后计算） ──
        int scale = 16 / granularity;
        long totalBeans = (long) plane.getWidth() * plane.getHeight() * scale * scale;
        if (totalBeans > MAX_OUTPUT_BEANS) {
            source.sendError(Component.literal(String.format(
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
                source.sendError(Component.literal(
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
        for (String blockId : parsed.getAll("ignore")) {
            ignoreSet.add(blockId);
        }
        for (String blockId : parsed.getAll("keep")) {
            ignoreSet.remove(blockId);
        }
        Set<String> frozenIgnore = Collections.unmodifiableSet(ignoreSet);

        SampleOptions opts = new SampleOptions(dir, distance, frozenIgnore,
                granularity, bgColor, name, savePath);

        McPerlerMod.LOGGER.debug("客户端 构建 SampleOptions: {}", opts);

        // ── 10. 获取客户端 Level ──
        // TODO(自检): 需在 26.2 上验证 — FabricClientCommandSource.getLevel() 返回类型
        ClientLevel level = source.getLevel();
        if (level == null) {
            source.sendError(Component.literal("无法获取当前客户端世界"));
            return 0;
        }

        Minecraft client = source.getClient();
        if (client == null) {
            source.sendError(Component.literal("无法获取客户端实例"));
            return 0;
        }

        // ── 11. 创建 FaceTextureProvider（在当前线程获取 ResourceManager） ──
        // TODO(自检): 需在 26.2 上验证 — Minecraft.getResourceManager() 方法名
        FaceTextureProvider faceTexture = new FaceTextureProvider(client.getResourceManager());

        // ── 12. 发送受理回执，提交异步任务 ──
        String planeDesc = String.format("%s offset=%d %dx%d",
                plane.getAxis(), plane.getOffset(), plane.getWidth(), plane.getHeight());

        source.sendFeedback(Component.literal(
                "任务已提交 " + planeDesc + " — 正在后台采样（面纹理模式）..."));

        McPerlerMod.LOGGER.info("客户端 异步任务提交: plane={}, opts={}", plane, opts);

        submitAsync(source, client, level, plane, opts, faceTexture);

        return 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  异步执行与回执（客户端版）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 提交采样任务到独立线程池，完成后切回渲染线程发回执。
     */
    private static void submitAsync(FabricClientCommandSource source, Minecraft client,
                                     ClientLevel level, SectionPlane plane,
                                     SampleOptions opts, FaceTextureProvider faceTexture) {
        BlockColorMapper mapper = new BlockColorMapper();

        McPerlerMod.SAMPLER_EXECUTOR.submit(() -> {
            try {
                // ── 采样（含 granularity 展开 + 面纹理聚合） ──
                int[][] grid = ViewSampler.sample(level, plane, opts, mapper, faceTexture);
                int nonBgCount = ViewSampler.countNonBackground(grid, opts.bgColor());
                int actualHeight = grid.length;
                int actualWidth = grid[0].length;

                // ── 导出 ──
                Path outputPath = PatternExporter.exportFromColors(
                        grid, actualWidth, actualHeight,
                        opts.name(), opts.savePath(), 5);

                // ── 切回渲染线程发送成功回执 ──
                int finalNonBg = nonBgCount;
                int finalBeans = actualWidth * actualHeight;
                int finalW = actualWidth;
                int finalH = actualHeight;
                Path finalOutput = outputPath;
                client.execute(() -> {
                    source.sendFeedback(Component.literal(
                            String.format("§a图纸已导出! §f%s §7(有效方块: %d/%d, 豆数: %d, 尺寸: %dx%d)",
                                    finalOutput.getFileName(), finalNonBg, finalBeans,
                                    finalBeans, finalW, finalH)));
                });

                McPerlerMod.LOGGER.info("客户端 异步任务完成: {} 有效方块/{} 豆数, 输出 {}",
                        finalNonBg, finalBeans, finalOutput);

            } catch (Exception e) {
                McPerlerMod.LOGGER.error("客户端 采样任务失败", e);
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                client.execute(() -> {
                    source.sendError(Component.literal("采样失败: " + errMsg));
                });
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  辅助方法
    // ═══════════════════════════════════════════════════════════════

    private static BlockPos getCorner1(CommandContext<FabricClientCommandSource> ctx) {
        return new BlockPos(
                IntegerArgumentType.getInteger(ctx, "x1"),
                IntegerArgumentType.getInteger(ctx, "y1"),
                IntegerArgumentType.getInteger(ctx, "z1"));
    }

    private static BlockPos getCorner2(CommandContext<FabricClientCommandSource> ctx) {
        return new BlockPos(
                IntegerArgumentType.getInteger(ctx, "x2"),
                IntegerArgumentType.getInteger(ctx, "y2"),
                IntegerArgumentType.getInteger(ctx, "z2"));
    }

    /**
     * 解析十六进制颜色字符串为 ARGB int（与 PerlerCommand 一致）。
     */
    private static int parseHexColor(String hex) {
        if (hex == null || hex.isBlank()) return -1;
        hex = hex.trim();
        if (hex.startsWith("0x") || hex.startsWith("0X")) {
            hex = hex.substring(2);
        } else if (hex.startsWith("#")) {
            hex = hex.substring(1);
        }
        try {
            long val = Long.parseLong(hex, 16);
            if (hex.length() <= 6) {
                return 0xFF000000 | (int) val;
            } else {
                return (int) val;
            }
        } catch (NumberFormatException e) {
            return -1;
        }
    }
}
