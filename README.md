# MC 拼豆图纸工具 (mc-to-bean)

将 Minecraft Java Edition 26.2 的内容转化为**拼豆图纸**（Perler Beads / 拼拼豆豆）：图纸中每颗豆 = 一个像素单元，照着图纸用对应颜色的豆子即可拼出 MC 的物品、方块或场景。

项目由**三大子系统**组成，覆盖从游戏内采样到图纸编辑的完整链路：

```
游戏内采样 (Fabric 模组) ──► 契约 JSON ──► Web 平台 (编辑/管理) ──► 图纸
纹理批量转换 (Python 工具) ────────────────────────► PNG 图纸
```

## ✨ 特性一览

| 子系统 | 能力 | 状态 |
|--------|------|------|
| **Python 工具** | 纹理 → 图纸（单张/批量/动画帧）、MARD 豆号匹配（Lab 最近邻）、3 种颜色显示模式、JSON 契约导出 | ✅ 稳定 |
| **Fabric 模组** | 游戏内 `/perler section\|view`（正交视图、面纹理取色、granularity 1-16）、`/perler screenshot`（F9 快捷键 + 配置命令） | ✅ 可用 |
| **Web 平台** | 契约 JSON/图片导入、从零新建、7 种绘制工具、撤销重做、IndexedDB 持久化、JSON/PNG 导出 | ✅ 可用 |

## 🚀 快速开始

### 1. Python 工具（离线）

```bash
python pattern-tool/entry.py                                          # 交互式入口
python pattern-tool/texture_to_pattern.py <纹理.png> --palette mard   # 单张 CLI
python pattern-tool/batch_convert.py                                  # 全量批量（4378 张）
python pattern-tool/split_animations.py                               # 动画帧拆分
python pattern-tool/json_to_pattern.py <图纸.json>                    # 契约 JSON → PNG
```

> 💡 Windows 中文乱码时：`PYTHONIOENCODING=utf-8 python ...`

### 2. Fabric 模组（游戏内）

**安装**：从 [GitHub Releases](https://github.com/ZhangBY619/mc-to-bean/releases) 下载 `mc-perler-pattern-0.1.2.jar`（源码不含构建产物），放入 `.minecraft/versions/<版本>/mods/`（需 Fabric Loader 0.19.3 + Minecraft 26.2）。

```text
/perler section <x1> <y1> <z1> <x2> <y2> <z2> [选项]        # 截面
/perler view <x1> <y1> <z1> <x2> <y2> <z2> --direction <方向> --distance <N> [选项]   # 正交视图（面纹理）
/perler screenshot --long-edge 64                            # 玩家视角截图
/perler screenshot config --long-edge 96                     # F9 快捷键配置
/perler howtouse                                             # 命令帮助
```

按 **F9** 一键截图（画面干净无输入框）。产物为契约 JSON，存于 `.minecraft/patterns/`。

### 3. Web 平台（本地图纸编辑器）

```bash
cd web-app
npm install
npm run dev        # → http://localhost:5173
```

导入模组 JSON / 图片 / 从零新建 → 绘制编辑（画笔/橡皮/填充/取色/矩形/直线）→ 自动持久化到浏览器 IndexedDB → 导出。

## 📐 数据契约（共享图纸 JSON 格式）

模组、Python 工具、Web 平台三端互通的统一格式（详见 `技术架构.md` 第 3 节）：

```json
{
  "name": "view_z0_north_d32",
  "width": 11, "height": 21,
  "cell_size_mm": 5,
  "palette": [
    { "index": 0, "rgb": [194, 157, 98], "code": "G4", "name": "G4", "delta": 11.25, "bead_rgb": [225, 179, 131] }
  ],
  "grid": [[0, 0, 0, ...], [...]]
}
```

## 🎨 豆号色卡

| 品牌 | 格式 | 数量 | 说明 |
|------|------|------|------|
| **MARD**（默认） | A1-A26 黄橙 / B1-B32 绿 / C 蓝 / D 紫 / E 粉 / F 红 / G 棕肤 / H 黑白灰 / M 混 / P 珠光 / R 透明 | 291 | 国产拼豆主流色号，推荐 |
| Artkal S | S01-S159+ | 199 | 单一前缀 |
| Hama | H01+ | 91 | 丹麦 |
| Perler | 80-xxxxx | 102 | 商品号格式，备用 |

匹配算法：sRGB → **CIE Lab 最近邻**（人眼感知更准），Python 与模组端算法一致并交叉验证。色卡数据在 `pattern-tool/data/`（来源 [beadcolors](https://github.com/maxcleme/beadcolors)）。

## 📁 目录结构

```
mc-to-bean/
├── README.md / 业务计划.md / 技术架构.md
├── pattern-tool/          # 子系统 A：Python 离线工具
│   ├── entry.py           #   交互式入口
│   ├── texture_to_pattern.py / json_to_pattern.py / batch_convert.py / split_animations.py
│   ├── palette.py / render.py / data/   # 色卡匹配 / 渲染核心 / 色卡 CSV
├── mod/                   # 子系统 B：Fabric 模组（26.2，Mojang 映射）
│   ├── build.gradle / gradle.properties / gradlew
│   └── src/main/java/dev/mcperler/  # command / section / color / export / palette
└── web-app/               # 子系统 C：Web 平台（Vue3 + Pinia + IndexedDB）
    └── src/               # views / components / stores / composables / utils
```

> `assets/`（原版资源）、`patterns/`（批量图纸）、构建产物均不入库，详见 `.gitignore`。

## 🗺 路线图

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1-M2 | Python 工具：批量转换、MARD 色卡、动画拆分 | ✅ |
| M3 | 模组 section/view + 豆号输出 + 命令树修复 | ✅ |
| M4 | 玩家视角截图（F9 快捷键 + 配置命令） | ✅ |
| M5 | 面纹理取色（granularity 真聚合） | ✅ |
| M6 | Web 平台：导入/新建/编辑/持久化/性能优化 | ✅ |
| M7 | 3D 实体视图 / 立体拼豆展开 | 规划中 |

## 🛠 开发构建

```bash
# 模组（需代理下载 Gradle/Fabric 依赖）
cd mod
export GRADLE_OPTS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=10809 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=10809"
./gradlew build        # 产物 mod/build/libs/*.jar（发布到 GitHub Releases）

# Web 平台
cd web-app && npm test && npm run build
```

## ⚠️ 版权声明

原版 Minecraft 贴图与游戏内容版权归 Mojang Studios。本工具不内置任何游戏资源（`assets/` 需用户自备），生成的图纸仅限个人手工使用，请勿用于商业用途。
