package dev.mcperler.command;

import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.network.chat.Component;
import dev.mcperler.export.PatternExporter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.function.BiConsumer;

/**
 * /perler screenshot — 玩家视角截图 → 契约图纸 JSON (F3/M4)。
 *
 * 语法: /perler screenshot --long-edge <N> [--name <名>] [--save <路径>]
 *   --long-edge N   图纸长边的豆数 (1..512, 必填); 短边按截图宽高比自动计算
 *
 * 也提供快捷键入口 (ScreenshotHotkey, 默认 F9): 画面干净无输入框, 参数用默认值。
 *
 * 流程 (渲染线程):
 *   1. Screenshot.takeScreenshot(主渲染目标, 回调) 直接拿 NativeImage 像素 (不写文件)
 *   2. 按目标尺寸平均降采样 → int[][] ARGB 网格
 *   3. PatternExporter.exportFromColors → 契约 JSON (含 MARD 豆号)
 */
public final class ClientScreenshotCommand {

    private static final int MAX_LONG_EDGE = 512;

    private ClientScreenshotCommand() {}

    /**
     * 截图公共入口 (命令与快捷键共用)。
     *
     * @param mc        客户端实例
     * @param longEdge  图纸长边豆数
     * @param parsed    选项 (命令模式来自命令行; 快捷键模式传空 OptMap 用默认)
     * @param feedback  消息回调 (component, isError) — 命令模式接 sendFeedback/sendError,
     *                  快捷键模式接 player.sendSystemMessage
     */
    public static void triggerScreenshot(Minecraft mc, int longEdge, PerlerCommand.OptMap parsed,
                                         BiConsumer<net.minecraft.network.chat.Component, Boolean> feedback) {
        // TODO(自检): 需在 26.2+Fabric 上验证 — 客户端命令处理线程是否为渲染线程,
        //   以及 mc.execute() 是否确保持帧边界安全地调用 takeScreenshot。
        //   如果客户端命令已在渲染线程执行, mc.execute() 会延迟到下一帧 (可能截到空白帧)。
        mc.execute(() -> capture(mc, longEdge, parsed, feedback));
    }

    public static void register(CommandDispatcher<FabricClientCommandSource> dispatcher) {
        // 26.2 brigadier 1.3.10: then() 立即 build，必须先配置子节点再挂链
        // -- /perler screenshot --long-edge <N> [--name <名>] [--save <路径>]
        var options = RequiredArgumentBuilder.<FabricClientCommandSource, String>argument(
                        "options", StringArgumentType.greedyString())
                .executes(ctx -> execute(ctx, StringArgumentType.getString(ctx, "options")));

        // -- /perler screenshot config [--long-edge <N>] [--name <前缀>] [--save <路径>]
        var configExec = LiteralArgumentBuilder.<FabricClientCommandSource>literal("config")
                .executes(ctx -> executeConfig(ctx, ""))
                .then(RequiredArgumentBuilder.<FabricClientCommandSource, String>argument(
                        "configOptions", StringArgumentType.greedyString())
                        .executes(ctx -> executeConfig(ctx,
                                StringArgumentType.getString(ctx, "configOptions"))));

        var screenshotNode = LiteralArgumentBuilder.<FabricClientCommandSource>literal("screenshot");
        screenshotNode.then(options);
        screenshotNode.then(configExec);

        dispatcher.register(LiteralArgumentBuilder.<FabricClientCommandSource>literal("perler")
                .then(screenshotNode));
    }

    private static int execute(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        FabricClientCommandSource source = ctx.getSource();
        try {
            PerlerCommand.OptMap parsed = PerlerCommand.parseOptions(optionsStr);

            if (!parsed.has("long-edge")) {
                source.sendError(Component.literal(
                        "screenshot 必须指定 --long-edge <N> (图纸长边豆数, 1..512)"));
                return 0;
            }
            int longEdge;
            try {
                longEdge = Integer.parseInt(parsed.getFirst("long-edge"));
            } catch (NumberFormatException e) {
                source.sendError(Component.literal(
                        "--long-edge 必须是整数, 收到: " + parsed.getFirst("long-edge")));
                return 0;
            }
            if (longEdge < 1 || longEdge > MAX_LONG_EDGE) {
                source.sendError(Component.literal(
                        "--long-edge 超出范围 (1.." + MAX_LONG_EDGE + "), 收到: " + longEdge));
                return 0;
            }

            Minecraft mc = source.getClient();
            BiConsumer<Component, Boolean> fb = (c, err) -> {
                if (err) source.sendError(c);
                else source.sendFeedback(c);
            };
            triggerScreenshot(mc, longEdge, parsed, fb);
            source.sendFeedback(Component.literal("§7截图任务已提交 (长边 " + longEdge + " 豆)..."));
            return 1;
        } catch (Exception e) {
            source.sendError(Component.literal("screenshot 参数错误: " + e.getMessage()));
            return 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  /perler screenshot config: 持久化 F9 快捷键配置
    // ═══════════════════════════════════════════════════════════════

    /** 配置文件路径：{configDir}/mcperler.properties */
    private static Path configFile() {
        return FabricLoader.getInstance().getConfigDir().resolve("mcperler.properties");
    }

    /**
     * 从配置文件读取 Properties（文件不存在或读取失败时返回空 Properties）。
     */
    private static Properties loadConfig() {
        Properties props = new Properties();
        try {
            Path cf = configFile();
            if (Files.exists(cf)) {
                try (InputStream in = Files.newInputStream(cf)) {
                    props.load(in);
                }
            }
        } catch (IOException e) {
            // 静默回退空配置 → 全部使用默认值
        }
        return props;
    }

    private static int executeConfig(CommandContext<FabricClientCommandSource> ctx, String optionsStr) {
        FabricClientCommandSource source = ctx.getSource();

        if (optionsStr == null || optionsStr.isBlank()) {
            // 无参数：显示当前配置
            Properties props = loadConfig();
            String longEdge = props.getProperty("hotkey.longEdge", "64");
            String namePrefix = props.getProperty("hotkey.namePrefix", "screenshot");
            String savePath = props.getProperty("hotkey.savePath", "默认路径");
            source.sendFeedback(Component.literal(
                    "§6F9 快捷键配置:§r\n" +
                    "  long-edge: " + longEdge + "\n" +
                    "  name-prefix: " + namePrefix + "\n" +
                    "  save-path: " + savePath));
            return 1;
        }

        PerlerCommand.OptMap parsed = PerlerCommand.parseOptions(optionsStr);
        Properties props = loadConfig();
        boolean changed = false;

        if (parsed.has("long-edge")) {
            try {
                int le = Integer.parseInt(parsed.getFirst("long-edge"));
                if (le < 1 || le > MAX_LONG_EDGE) {
                    source.sendError(Component.literal(
                            "--long-edge 超出范围 (1.." + MAX_LONG_EDGE + ")，收到: " + le));
                    return 0;
                }
                props.setProperty("hotkey.longEdge", String.valueOf(le));
                changed = true;
            } catch (NumberFormatException e) {
                source.sendError(Component.literal("--long-edge 必须是整数，收到: "
                        + parsed.getFirst("long-edge")));
                return 0;
            }
        }
        if (parsed.has("name")) {
            props.setProperty("hotkey.namePrefix", parsed.getFirst("name"));
            changed = true;
        }
        if (parsed.has("save")) {
            Path sp = Path.of(parsed.getFirst("save")).toAbsolutePath();
            props.setProperty("hotkey.savePath", sp.toString());
            changed = true;
        }

        if (changed) {
            try {
                Files.createDirectories(configFile().getParent());
                try (OutputStream out = Files.newOutputStream(configFile())) {
                    props.store(out, "MC Perler Screenshot Hotkey Config");
                }
                source.sendFeedback(Component.literal("§a已保存到 " + configFile().toAbsolutePath()));
            } catch (IOException e) {
                source.sendError(Component.literal("保存配置失败: " + e.getMessage()));
                return 0;
            }
        } else {
            source.sendFeedback(Component.literal("§7未提供任何配置项，当前配置未变更"));
        }

        return 1;
    }

    private static void capture(Minecraft mc, int longEdge, PerlerCommand.OptMap parsed,
                                BiConsumer<Component, Boolean> feedback) {
        try {
            RenderTarget target = mc.gameRenderer.mainRenderTarget();
            // TODO(自检): 需验证 takeScreenshot 回调的线程 — 确认 feedback 在回调内调用是否
            //   线程安全。如果回调不在渲染线程执行, 此处需要 mc.execute() 包裹。
            Screenshot.takeScreenshot(target, img -> {
                try {
                    processAndExport(img, longEdge, parsed, feedback);
                } catch (Exception e) {
                    feedback.accept(Component.literal("截图处理失败: " + e.getMessage()), true);
                    dev.mcperler.McPerlerMod.LOGGER.warn("截图处理异常", e);
                } finally {
                    img.close();
                }
            });
        } catch (Exception e) {
            feedback.accept(Component.literal("截图失败: " + e.getMessage()), true);
        }
    }

    private static void processAndExport(NativeImage img, int longEdge, PerlerCommand.OptMap parsed,
                                         BiConsumer<Component, Boolean> feedback) {
        int w = img.getWidth();
        int h = img.getHeight();

        // 目标尺寸: 长边 = longEdge, 短边按宽高比自动
        int outW, outH;
        if (w >= h) {
            outW = longEdge;
            outH = Math.max(1, Math.round(longEdge * (float) h / w));
        } else {
            outH = longEdge;
            outW = Math.max(1, Math.round(longEdge * (float) w / h));
        }

        // 平均降采样: 每个输出像素 = 源区域像素平均 (透明像素跳过)
        int[][] grid = new int[outH][outW];
        for (int y = 0; y < outH; y++) {
            int y0 = y * h / outH;
            int y1 = Math.max(y0 + 1, (y + 1) * h / outH);
            for (int x = 0; x < outW; x++) {
                int x0 = x * w / outW;
                int x1 = Math.max(x0 + 1, (x + 1) * w / outW);
                long r = 0, g = 0, b = 0;
                int n = 0;
                for (int sy = y0; sy < y1; sy++) {
                    for (int sx = x0; sx < x1; sx++) {
                        // 26.2 实证: getPixel 内部已做 ARGB.fromABGR() 转换, 返回 ARGB 布局
                        // (alpha 24-31, red 16-23, green 8-15, blue 0-7) — 不要按 ABGR 解析!
                        int argb = img.getPixel(sx, sy);
                        if (((argb >>> 24) & 0xFF) == 0) continue;  // 透明像素
                        r += (argb >>> 16) & 0xFF;
                        g += (argb >>> 8) & 0xFF;
                        b += argb & 0xFF;
                        n++;
                    }
                }
                if (n == 0) {
                    grid[y][x] = 0xFFFFFFFF;   // 全透明区域 → 白色背景
                } else {
                    grid[y][x] = 0xFF000000 | ((int) (r / n) << 16) | ((int) (g / n) << 8) | ((int) (b / n));
                }
            }
        }

        // 名称与保存路径
        String name = parsed.has("name") ? parsed.getFirst("name")
                : "screenshot_" + System.currentTimeMillis();
        Path savePath = parsed.has("save") ? Path.of(parsed.getFirst("save")) : null;

        Path out = PatternExporter.exportFromColors(grid, outW, outH, name, savePath, 5);
        feedback.accept(Component.literal(
                "§a截图图纸已导出! §f" + out + " §7(" + outW + "x" + outH + " 豆)"), false);
    }
}
