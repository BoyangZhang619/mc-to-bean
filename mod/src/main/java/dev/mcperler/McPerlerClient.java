package dev.mcperler;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import dev.mcperler.command.ClientPerlerCommand;
import dev.mcperler.command.ClientScreenshotCommand;
import dev.mcperler.command.ScreenshotHotkey;

/**
 * 客户端初始化入口 (F3/M4: 玩家视角截图)。
 *
 * 服务端命令 (/perler section|view) 在 McPerlerMod 注册;
 * 客户端命令 (/perler screenshot) 与截图快捷键 (F9) 必须在这里注册 —
 * 截图涉及渲染线程与帧缓冲, 只能存在于客户端。
 */
public class McPerlerClient implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register(
                (dispatcher, buildContext) -> {
                    ClientScreenshotCommand.register(dispatcher);
                    ClientPerlerCommand.register(dispatcher);
                });
        ScreenshotHotkey.register();
        McPerlerMod.LOGGER.info("MC Perler Pattern 客户端初始化完成 (截图命令 + section/view + F9 快捷键已注册)");
    }
}
