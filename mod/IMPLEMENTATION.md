# MC Perler Pattern 模组实现文档

> 依据: 技术架构.md v0.2（第 3 节图纸 JSON 契约、第 5 节指令规范与采样算法）
> 目标版本: Minecraft Java Edition 26.2 · Fabric Loom 1.17 / Loader 0.19.3 / Fabric API 0.155.2+26.2

## 1. 范围

| 功能 | 子命令 | 状态 |
|------|--------|------|
| F2 正交视图 | `/perler view` | 本实现文档主体 |
| F2 截面 | `/perler section` | view 的 d=0 特例，一并实现 |
| F3 视角截图 | `/perler screenshot` | 阶段 5 |
| 面纹理取色 | — | 阶段 4（骨架期用 MapColor 占位） |

## 2. 类设计

```
dev.mcperler/
├── McPerlerMod.java               # 入口: 注册命令树、启动异步采样线程池 (已有骨架)
├── command/
│   └── PerlerCommand.java         # 新增: 命令树 /perler view|section|screenshot + 参数解析
├── section/
│   ├── SectionPlane.java          # 平面: 两对角坐标 → 法线/UV 轴/尺寸 (已有, 需补 共面校验+方向合法性)
│   ├── SampleOptions.java         # 新增: 采样选项 (direction/distance/ignore集/granularity/bg/name/save)
│   ├── SectionSampler.java        # 已有: d=0 截面采样 (改造为复用统一采样核心)
│   └── ViewSampler.java           # 新增: 正交视图采样 (逐方块 raycast + 忽略集 + granularity 聚合)
├── color/
│   ├── BlockColorMapper.java      # 已有: state → 颜色 (MapColor 占位)
│   └── FaceTextureProvider.java   # 新增(阶段4): state+direction → 16×16 面纹理像素数组
├── screenshot/
│   └── ScreenshotSampler.java     # 新增(阶段5): 帧缓冲读取 → 平均降采样 → 网格
└── export/
    └── PatternExporter.java       # 已有: 网格 → 契约 JSON
```

### 核心接口（新增）

```java
// SampleOptions: 采样选项
record SampleOptions(Direction direction, int distance,
                     Set<Block> ignoreSet,          // 默认 air/barrier/structure_void
                     int granularity,               // 1|2|4|8|16
                     int bgColor, String name, Path savePath) {}

// ViewSampler: 正交视图采样
// 返回: int[][] 颜色网格 (grid[v][u]), 每格 = (16/g)² 豆的输出块
// 实现: 逐方块 raycast → BlockColorMapper 取色; granularity>16 时由 FaceTextureProvider 提供纹理
class ViewSampler {
    int[][] sample(ServerLevel level, SectionPlane plane,
                   SampleOptions opts, BlockColorMapper mapper);
}

// FaceTextureProvider: 方块某面的 16×16 纹理像素
interface FaceTextureProvider {
    Optional<int[][]> facePixels(BlockState state, Direction facing); // RGB 数组
}
```

## 3. 实现流程（按阶段，每阶段可独立验证）

### 阶段 1：命令框架与校验
- `PerlerCommand`：子命令 view / section，参数解析（坐标×6、`--direction/-d`、`--distance/-D`、`--ignore`、`--keep`、`--granularity/-g`、`--bg`、`--name`、`--save`）
- 校验：
  - 两坐标必须共面（恰有一个轴相等），否则报错；
  - 方向合法性表（法线 X→east/west；法线 Z→north/south；法线 Y→up/down），非法方向报错并列出合法项；
  - 硬上限：面 ≤512×512、distance ≤256、输出豆数（面格数×(16/g)²）≤ 1M，超限拒绝；
  - 忽略集：默认 {air, barrier, structure_void}，`--ignore` 追加、`--keep` 移除。
- **验证**：命令帮助输出、非法参数报错信息、方向合法性全组合（6 方向 × 3 法线）。

### 阶段 2：section 采样 + 异步执行 + 导出
- 统一采样核心：`ViewSampler.sample`（distance 参数为 0 时即 section——平面上每格取 `level.getBlockState(p)` 本身）；
- 服务端命令体提交到**独立线程池**（不进主线程），完成发送消息回执（含输出路径）；
- `PatternExporter` 输出契约 JSON 到 `--save`（默认 `.minecraft/patterns/<name>.json`）。
- **验证**：已知结构（一堵石墙）section 采样 → JSON 内容人工核对（调色板/网格正确、空气为背景色）。

### 阶段 3：view 探测 + granularity（MapColor 占位）
- raycast：每格沿 direction 步进 ≤distance，第一个不在忽略集的方块 → `BlockColorMapper.map`；
- granularity 16 时 1 方块 1 豆（取色一次）；granularity 1/2/4/8 时 `FaceTextureProvider` 未实现 → 先以"整面单色重复到所有子块"占位（MapColor 无细节，语义等价整面平均）；
- 超 distance → 背景色。
- **验证**：含空气层/玻璃/深墙的测试结构，view 输出与预期比对；距离边界（0、1、上限）。

### 阶段 4：面纹理取色（FaceTextureProvider）
- 解析方块模型（BlockModel → 指定面 quads → 对应 atlas 纹理 UV）读取 16×16 像素；
- 对 granularity 1/2/4/8 真正输出纹理细节（每 g×g 块平均）；
- **验证**：木纹/石砖方块细粒度输出与贴图肉眼比对。

### 阶段 5：F3 screenshot（客户端命令）
- `ClientCommandManager` 注册 `/perler screenshot --long-edge N`；
- 渲染线程执行：读帧缓冲（复用 `Screenshot` 逻辑）→ 按截图宽高比 + 长边 N 计算短边 → **平均降采样** → 颜色网格 → 契约 JSON；
- **验证**：不同分辨率截图降采样比对。

## 4. 关键 API 与验证清单（26.2 新版，全部需实测）

| API | 风险 | 备选 |
|-----|------|------|
| `Level.getBlockState(BlockPos)` | 签名可能变化 | 用 `BlockGetter` 接口方法 |
| `BlockState.getMapColor(...)` / `MapColor.col` | 可能改为 record 方法 | 反射 / 硬编码色表 |
| `CommandRegistrationCallback.EVENT` | 包路径可能变化 | Fabric API 文档核对 |
| `CommandSourceStack.getLevel()` | 方法名可能变化 | `registryAccess` 上下文 |
| 客户端命令 API（阶段 5） | 26.2 可能变化 | Fabric API 文档核对 |
| Mojang 官方映射 | 26.1 起不再混淆 | 回退 yarn |

## 5. 构建与测试

```bash
cd mod
# 境外依赖下载需要代理 (v2rayn): 构建时注入 JVM 代理参数
./gradlew build -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=10809 \
                -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=10809
# 产物: build/libs/*.jar → 放入 .minecraft/mods/
```

测试命令示例（游戏内）：
```
/perler section 0 64 0  0 64 100                     # 竖直面截面 (x=0 的 YZ 面)
/perler view 0 64 0 0 100 100 --direction east --distance 32
/perler view 0 64 0 100 64 100 --direction up --granularity 4
/perler view 0 64 0 100 64 100 --direction up --keep minecraft:air
```

## 6. 需人工执行的事项

- [ ] 确认 v2rayn 代理端口（HTTP 通常 10809 / SOCKS 10808），或在 `mod/gradle.properties` 写死 `systemProp.http.proxyHost=127.0.0.1` + port 后构建
- [ ] 在 `mod/` 执行 `gradlew build`（首次会下载 Gradle 9.5.1 发行版 + Fabric 依赖，约数百 MB）
- [ ] 将 `build/libs/mcperler-*.jar` 放入游戏 `mods/` 目录（需安装对应版本 Fabric Loader）
- [ ] 进游戏执行测试命令，反馈结果（API 不匹配时回报报错信息，按第 4 节备选路径修）
