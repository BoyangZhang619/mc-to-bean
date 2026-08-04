# MC Perler Pattern — Fabric 模组

将 Minecraft 世界中的内容转化为**拼豆图纸**（Perler Beads）。

当前版本：**v0.1.0 骨架** — F2 截面采样模块，后续将追加 F3 视角截图 + F4 墙面视图。

---

## 调研结论

| 项目 | 版本 | 依据 |
|------|------|------|
| **Minecraft** | 26.2 | 新版号体系（非 1.26.2），2026 年发布 |
| **Fabric Loom** | 1.17 | [Fabric for MC 26.2 官方公告](https://fabricmc.net/2026/06/15/262.html) |
| **Fabric Loader** | 0.19.3 | 同上 |
| **Fabric API** | 0.155.2+26.2 | 社区 smoke-test 验证通过的最新版 |
| **Gradle** | 9.5.1 | 官方推荐 |
| **Java** | 25 | 本机 Java 25.0.2 LTS 满足要求 |
| **Mappings** | Mojang 官方映射 | 26.1 起 Minecraft 不再混淆，Fabric 官方建议使用 loom.officialMojangMappings() |

> **注意**：Fabric meta API (`meta.fabricmc.net`) 在本机网络环境中被拦截，以上版本号来自 web 搜索和官方公告，构建前建议手动确认 [Fabric 开发者站点](https://fabricmc.net/develop/)。

---

## 编译验证结果

**状态：✅ 编译通过（2026-08-03）**

通过代理（v2rayn HTTP 10809）完成构建，产出 `build/libs/mc-perler-pattern-0.1.0.jar`。

构建排障记录（26.2 是"无混淆"新版本，踩坑如下）：

| 问题 | 原因与修复 |
|------|-----------|
| Loom 1.17 找不到 | 真实版本 1.17.17（带补丁号）；26.x 需用 `1.17-SNAPSHOT`（buildscript classpath 方式加载，Fabric maven 无插件 marker） |
| Failed to find official mojang mappings | 26.2 无 mappings 文件（26.1 起不混淆，版本 JSON 只有 client/server）——**不需要配置 mappings** |
| `mappings` has no dependencies | Loom 1.17-SNAPSHOT 对 26.x 走 `disableObfuscation()`，不再注册映射/remap 配置 |
| `modImplementation` 找不到 | 无混淆模式**无 mod 配置**，依赖一律用普通 `implementation`（官方模板同款） |
| 编译报错（ArgumentBuilder / hasPermission / sendFeedback） | 26.2 API 变化：builder 类移到 `brigadier.builder` 包；权限改为 `permissions().hasPermission(Permissions.COMMANDS_ADMIN)`；反馈改为 `sendSuccess`/`sendFailure` |

构建命令（需要代理）：
```bash
cd mod
export GRADLE_OPTS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=10809 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=10809"
./gradlew build      # 产出 build/libs/mc-perler-pattern-0.1.0.jar
./gradlew runClient   # 启动 Minecraft 26.2 开发客户端测试
```

---

## 快速开始

### 环境要求

- **Java 25** 或更高版本
- **Git**（用于 clone）
- 网络连接（首次构建需下载 Gradle + Minecraft + Fabric 依赖，约 300MB+）

### 构建

```bash
cd mod

# 首次运行会自动下载 Gradle 9.5.1（通过 gradle-wrapper）
./gradlew build        # Linux / macOS / Git Bash
gradlew.bat build      # Windows 命令提示符 / PowerShell
```

构建产物位于 `build/libs/mc-perler-pattern-0.1.0.jar`。

> **如果 gradlew 下载 Gradle 失败**：本模组已预置 `gradle/wrapper/gradle-wrapper.jar`（来自 Gradle 9.5.1 GitHub release）。若遇到网络问题：
> 1. 手动下载 `https://services.gradle.org/distributions/gradle-9.5.1-bin.zip`
> 2. 放到 `%USERPROFILE%/.gradle/wrapper/dists/gradle-9.5.1-bin/` 下（具体子目录名由 wrapper 自动生成）

### 安装到游戏

1. 安装 [Fabric Loader 0.19.3+](https://fabricmc.net/use/) for Minecraft 26.2
2. 安装 [Fabric API 0.152.0+](https://modrinth.com/mod/fabric-api) for 26.2
3. 将构建好的 `mc-perler-pattern-0.1.0.jar` 放入 `.minecraft/mods/`
4. 启动游戏

### 使用

在游戏内（单人或多人的 OP/作弊模式）使用命令：

```
/perler section <axis> <offset>
/perler section <axis> <offset> <minU> <minV> <maxU> <maxV>
```

**参数说明**：

| 参数 | 说明 |
|------|------|
| `axis` | 截面法线方向：`x` / `y` / `z` |
| `offset` | 沿 axis 的坐标值 |
| `minU minV maxU maxV` | （可选）平面内两个方向的坐标范围。省略时默认以玩家为中心取 ±8 格区域 |

**示例**：

```
/perler section y 64              # 水平截面 Y=64，玩家周围 17x17
/perler section x 0 -10 -10 10 10 # X=0 处的 YZ 平面，20x20 范围
/perler section z -32 0 0 31 31   # Z=-32 处的 XY 平面，32x32 范围
```

**输出**：JSON 文件保存到 `.minecraft/patterns/section_<axis><offset>_<timestamp>.json`，格式符合项目 `技术架构.md` 第 3 节定义的共享图纸 JSON 格式。

---

## 文件结构

```
mod/
├── build.gradle              # fabric-loom 1.17 + MC 26.2 依赖配置
├── settings.gradle           # Gradle 插件仓库（Fabric Maven）
├── gradle.properties         # 版本变量集中管理
├── gradlew / gradlew.bat     # Gradle Wrapper 启动脚本
├── gradle/wrapper/
│   ├── gradle-wrapper.jar    # Wrapper JAR（已预置，来自 Gradle 9.5.1）
│   └── gradle-wrapper.properties  # Gradle 分发 URL
├── fabric.mod.json           # 模组元数据（id: mcperler）
├── README.md                 # 本文档
└── src/main/java/dev/mcperler/
    ├── McPerlerMod.java      # ModInitializer 入口，注册 /perler 命令
    ├── section/
    │   ├── SectionPlane.java     # 截面平面参数数据类
    │   └── SectionSampler.java   # F2 核心：世界方块采样（BlockState 网格）
    ├── color/
    │   └── BlockColorMapper.java # 方块 → RGB 颜色（骨架用 MapColor）
    └── export/
        └── PatternExporter.java  # 导出图纸 JSON（严格遵守共享格式）
```

---

## F2 实现状态

### 完整实现

| 模块 | 状态 | 说明 |
|------|------|------|
| **SectionPlane** | 完成 | 轴对齐平面参数定义，坐标转换逻辑，参数校验 |
| **SectionSampler** | 完成 | 按平面参数遍历 `Level.getBlockState()`，生成 BlockState[][] 网格 |
| **PatternExporter** | 完成 | 构建调色板 + 颜色索引网格，导出符合技术架构.md 第 3 节的 JSON |
| **命令注册** | 完成 | `/perler section` 命令，支持可选范围参数 + 默认范围（玩家周围） |
| **构建配置** | 完成 | fabric-loom 1.17 + Mojang 映射 + Gradle 9.5.1 wrapper |

### 占位 / TODO

| 模块 | 当前方案 | 后续改进方向 |
|------|----------|--------------|
| **BlockColorMapper** | 使用 `MapColor`（地图颜色，60+ 种预设色） | 读取实际方块纹理贴图的平均色（BakedModel → Sprite → 像素采样） |
| **透明方块处理** | 全部视为不透明方块着色 | 半透明方块（玻璃等）支持混合背景色模式 |
| **空气处理** | ignoreAir=true 时 null 位填白色 | 可配置的背景色 |
| **命令自动补全** | 仅基本参数解析 | 添加 axis 参数的自动补全提示 |
| **输出格式** | 仅 JSON | 后续追加 PNG 渲染（复用 pattern-tool 的 render.py 管线） |
| **配置界面** | 无 | F5 将添加游戏内 GUI 配置（范围/颜色选项） |

---

## 未验证点清单

以下所有 `// TODO: 需在 26.2 上验证` 标记的 API 都需要在实际构建和运行时确认：

### 构建阶段

1. **Loom 1.17 插件可用性** — 需 Gradle 能成功解析 `id 'fabric-loom' version '1.17'`
2. **Fabric API 版本号** — `0.155.2+26.2` 是否存在于 Fabric Maven 仓库
3. **Mojang 映射** — `loom.officialMojangMappings()` 对 26.2 是否可用（26.1+ 官方说法是已不混淆）
4. **Java 25 兼容性** — Loom 1.17 是否完全兼容 Java 25

### 运行时 API（26.2 新版本变化风险）

| API | 当前假设 | 可能变化 | 验证方法 |
|-----|----------|----------|----------|
| `Level.getBlockState(BlockPos)` | 方法名不变 | 26.2 可能改为 `getBlockState` 返回 Optional 或其他类型 | 反编译 26.2 客户端或查 Yarn/Mojang 映射 |
| `BlockState.isAir()` | 方法名不变 | 低风险，基础方法 | 同上 |
| `MapColor.col` | int 字段存储 ARGB | 26.2 可能改为 record，字段名变 `col()` | 查 26.2 的 MapColor 类定义 |
| `BlockState.getMapColor(BlockGetter, BlockPos)` | 双参数方法 | 26.2 可能变更参数数量或类型 | 反编译或 Fabric 论坛查询 |
| `CommandRegistrationCallback.EVENT` | 路径 `net.fabricmc.fabric.api.command.v2` | 26.2 Fabric API 可能调整包路径 | 查看 Fabric API 0.155.x 源码 |
| `CommandSourceStack.getLevel()` | 返回 ServerLevel | 低风险 | 构建后 IDE 自动提示 |
| `FabricLoader.getInstance().getGameDir()` | 返回 Path | 低风险 | 构建后 IDE 自动提示 |

### 验证步骤建议

```
# 1. 构建（解决依赖和映射问题）
cd mod && ./gradlew build

# 2. 如果构建失败，尝试降级方案：
#    - 在 gradle.properties 中改用 yarn 映射：
#      yarn_mappings=26.2+build.1
#    - 在 build.gradle 中改用：
#      mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"

# 3. 构建成功后，在 dev 客户端中运行：
#    ./gradlew runClient
#    然后执行 /perler section y 64 测试
```

---

## 开发说明

- **中文注释**：所有源代码使用中文注释，面向中文开发者。
- **包名**：`dev.mcperler`，遵循 Java 包命名惯例。
- **Fabric 版本锁定**：版本号集中在 `gradle.properties`，升级 MC 版本只需修改一处。
- **架构一致性**：JSON 输出格式与项目根 `pattern-tool/` 子系统保持兼容，可互相读取。

---

## 参考链接

- [Fabric for Minecraft 26.2 官方公告](https://fabricmc.net/2026/06/15/262.html)
- [Fabric 开发者文档](https://docs.fabricmc.net/)
- [Fabric Loom GitHub](https://github.com/FabricMC/fabric-loom)
- [Fabric Example Mod](https://github.com/FabricMC/fabric-example-mod)
- [Gradle 9.5.1 Release](https://docs.gradle.org/9.5.1/release-notes.html)
