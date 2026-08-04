package dev.mcperler;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import dev.mcperler.command.PerlerCommand;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MC Perler Pattern 模组主入口。
 *
 * 实现 ModInitializer，在模组加载时：
 *   1. 初始化独立采样线程池（不进主线程，避免卡顿）
 *   2. 注册 /perler view|section 命令族（委托给 PerlerCommand）
 *
 * 线程模型：
 *   - 主线程：命令解析、参数校验（快速返回）
 *   - SAMPLER_EXECUTOR（2 线程）：ViewSampler.sample + PatternExporter 导出（可能耗时）
 *   - server.execute() 回调：结果回执消息（切回主线程，线程安全）
 *
 * TODO: 需在 26.2 上验证
 *   - CommandRegistrationCallback 在 26.2 中 API 可能有调整
 *   - FabricLoader.getModContainer 可能路径变化
 */
public class McPerlerMod implements ModInitializer {

    public static final String MOD_ID = "mcperler";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    /**
     * 独立采样线程池。
     * 固定 2 线程：支持同时处理 2 个采样任务（玩家可能快速连发两条命令）。
     * 守护线程，JVM 退出时自动终止。
     */
    public static final ExecutorService SAMPLER_EXECUTOR = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "mcperler-sampler");
        t.setDaemon(true);
        return t;
    });

    @Override
    public void onInitialize() {
        LOGGER.info("MC Perler Pattern v{} 正在初始化...",
                net.fabricmc.loader.api.FabricLoader.getInstance()
                        .getModContainer(MOD_ID)
                        .map(c -> c.getMetadata().getVersion().getFriendlyString())
                        .orElse("unknown"));

        registerCommands();

        LOGGER.info("MC Perler Pattern 初始化完成。采样线程池: 2 线程。");
        LOGGER.info("使用 /perler section ... 或 /perler view ... 开始采样。");
    }

    /**
     * 注册 /perler 命令族。
     * 委托给 PerlerCommand.register() 以保持命令逻辑集中管理。
     */
    private void registerCommands() {
        // TODO: 需在 26.2 上验证 — CommandRegistrationCallback 包路径、方法签名
        // 备选包：net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            PerlerCommand.register(dispatcher);
        });
    }
}
