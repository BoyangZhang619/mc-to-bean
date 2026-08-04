package dev.mcperler.command;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Properties;
import java.util.function.BiConsumer;

/**
 * F3/M4 截图快捷键 — 默认 F9。
 *
 * 相比 /perler screenshot 命令: 按键瞬间没有聊天输入框/聊天栏/命令文本,
 * 截图画面天然干净。参数使用默认值 (long-edge=64), 高级参数仍走命令。
 *
 * 实现: GLFW 键状态轮询 (InputConstants.isKeyDown) + 沿触发 (按下瞬间只触发一次),
 * 不依赖 KeyBindingHelper; 屏幕上有 GUI (聊天输入框/菜单) 时不触发, 避免误截。
 *
 * 配置: 每次触发时从 {configDir}/mcperler.properties 读取:
 *   hotkey.longEdge   (默认 64)
 *   hotkey.namePrefix (默认 "screenshot")
 *   hotkey.savePath   (默认 null, 自动生成路径)
 */
public final class ScreenshotHotkey {

    /** 默认快捷键: F9 (Minecraft 未占用的常用键) */
    private static final int HOTKEY = GLFW.GLFW_KEY_F9;
    /** 快捷键默认长边豆数 */
    private static final int DEFAULT_LONG_EDGE = 64;

    private static boolean prevPressed = false;

    private ScreenshotHotkey() {}

    public static void register() {
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            // 26.2: 当前屏幕在 mc.gui.screen() (原 mc.screen 字段已移除);
            // screen == null 表示无 GUI (聊天输入框/菜单) — 此时按快捷键才触发, 防止误截
            boolean pressed = mc.gui.screen() == null && InputConstants.isKeyDown(mc.getWindow(), HOTKEY);
            if (pressed && !prevPressed) {
                onHotkey(mc);
            }
            prevPressed = pressed;
        });
    }

    private static void onHotkey(Minecraft mc) {
        if (mc.player == null) {
            return;
        }

        // ── 每次触发时从配置文件读取参数 ──
        Path configFile = FabricLoader.getInstance().getConfigDir().resolve("mcperler.properties");
        Properties props = new Properties();
        int longEdge = DEFAULT_LONG_EDGE;
        String namePrefix = "screenshot";
        Path savePath = null;

        try {
            if (Files.exists(configFile)) {
                try (InputStream in = Files.newInputStream(configFile)) {
                    props.load(in);
                }
            }
        } catch (IOException e) {
            // 静默回退默认值
        }

        String leStr = props.getProperty("hotkey.longEdge");
        if (leStr != null) {
            try {
                longEdge = Integer.parseInt(leStr);
            } catch (NumberFormatException ignored) {
                // 静默回退默认值
            }
        }

        namePrefix = props.getProperty("hotkey.namePrefix", "screenshot");

        String spStr = props.getProperty("hotkey.savePath");
        if (spStr != null && !spStr.isBlank()) {
            savePath = Path.of(spStr);
        }

        PerlerCommand.OptMap opts = new PerlerCommand.OptMap();
        // 名称: 前缀 + 时间戳（沿用现有规则）
        opts.putAll("name", List.of(namePrefix + "_" + System.currentTimeMillis()));
        if (savePath != null) {
            opts.putAll("save", List.of(savePath.toString()));
        }

        BiConsumer<Component, Boolean> fb = (c, err) -> mc.player.sendSystemMessage(c);
        ClientScreenshotCommand.triggerScreenshot(mc, longEdge, opts, fb);
    }
}
