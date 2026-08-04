package dev.mcperler.export;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.world.level.block.state.BlockState;
import dev.mcperler.color.BlockColorMapper;
import dev.mcperler.McPerlerMod;
import dev.mcperler.palette.MardPalette;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 将采样网格导出为图纸 JSON 文件。
 *
 * 输出格式严格遵守 技术架构.md 第 3 节的共享图纸 JSON 格式：
 *   name, width, height, cell_size_mm, palette, grid
 *
 * 支持两种输入：
 *   1. BlockState[][] — 旧版兼容（自动内置取色）
 *   2. int[][] ARGB — 新版 ViewSampler 输出（颜色已预先计算）
 *
 * 输出目录：默认 {游戏目录}/patterns/，可通过 savePath 参数指定。
 */
public class PatternExporter {

    /** 默认拼豆直径 5mm（最常见的拼豆规格） */
    private static final int DEFAULT_CELL_SIZE_MM = 5;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final DateTimeFormatter TIMESTAMP_FMT = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss");

    // ═══════════════════════════════════════════════════════════════
    //  新版 API：从 int[][] ARGB 颜色网格导出（ViewSampler 输出）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 从 ARGB int 颜色网格导出图纸 JSON。
     *
     * @param colorGrid  ARGB int 二维网格 grid[v][u]
     * @param width      网格宽度（u 方向列数）
     * @param height     网格高度（v 方向行数）
     * @param name       图纸名称（用于 JSON name 字段和文件名）
     * @param savePath   保存路径（可为 null，自动生成到 .minecraft/patterns/）
     * @param cellSizeMm 每颗豆直径 mm
     * @return 输出文件的路径
     */
    public static Path exportFromColors(int[][] colorGrid, int width, int height,
                                         String name, Path savePath, int cellSizeMm) {
        if (colorGrid == null || colorGrid.length == 0) {
            throw new IllegalArgumentException("颜色网格不能为空");
        }

        // ── 步骤 1：构建调色板（扫描所有独立 ARGB 颜色，匹配 MARD 豆号） ──
        // 使用 LinkedHashMap 保持插入顺序，第一个出现的颜色索引小
        MardPalette mard = MardPalette.getInstance();
        LinkedHashMap<Integer, PaletteEntry> paletteMap = new LinkedHashMap<>();

        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                int argb = colorGrid[v][u];
                if (!paletteMap.containsKey(argb)) {
                    int[] rgb = { (argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF };
                    MardPalette.Bead bead = mard.match(argb).orElse(null);
                    paletteMap.put(argb, new PaletteEntry(paletteMap.size(), rgb, bead));
                }
            }
        }

        // ── 步骤 2：统计各 ARGB 颜色出现次数（供合并时选代表色） ──
        Map<Integer, Integer> pixelCounts = new HashMap<>();
        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                int argb = colorGrid[v][u];
                pixelCounts.merge(argb, 1, Integer::sum);
            }
        }

        // ── 步骤 3：按 bead code 分组合并 ──
        // 同 code 的多个 ARGB 颜色合并为一个 palette 条目，
        // 代表色 = 像素数最多的 ARGB，旧索引重映射到合并后的新索引。
        // code 为 null 的条目不合并，各自独立。

        // 3a: 收集同 code 的 ARGB 列表（保持 code 首次出现顺序）
        Map<String, List<Integer>> codeToArgbs = new LinkedHashMap<>();
        Set<String> seenCodes = new LinkedHashSet<>();
        for (Map.Entry<Integer, PaletteEntry> e : paletteMap.entrySet()) {
            PaletteEntry entry = e.getValue();
            if (entry.bead != null && entry.bead.code() != null) {
                String code = entry.bead.code();
                if (!seenCodes.contains(code)) {
                    seenCodes.add(code);
                    codeToArgbs.put(code, new ArrayList<>());
                }
                codeToArgbs.get(code).add(e.getKey());
            }
        }

        // 3b: 构建合并后的调色板 + 旧索引→新索引映射
        List<PaletteEntry> mergedPalette = new ArrayList<>();
        Map<Integer, Integer> oldIndexToNew = new HashMap<>();
        Set<String> processedCodes = new HashSet<>();

        for (Map.Entry<Integer, PaletteEntry> e : paletteMap.entrySet()) {
            int argb = e.getKey();
            PaletteEntry entry = e.getValue();

            if (entry.bead == null || entry.bead.code() == null) {
                // code=null: 独立条目，不合并
                PaletteEntry newEntry = new PaletteEntry(mergedPalette.size(), entry.rgb, null);
                mergedPalette.add(newEntry);
                oldIndexToNew.put(entry.index, newEntry.index);
            } else {
                String code = entry.bead.code();
                if (processedCodes.contains(code)) {
                    continue; // 此 code 已处理（在首次出现位置已合并）
                }
                processedCodes.add(code);

                List<Integer> argbs = codeToArgbs.get(code);
                // 代表色 = 像素数最多的 ARGB
                int bestArgb = argbs.get(0);
                int bestCount = pixelCounts.getOrDefault(bestArgb, 0);
                for (int a : argbs) {
                    int cnt = pixelCounts.getOrDefault(a, 0);
                    if (cnt > bestCount) {
                        bestCount = cnt;
                        bestArgb = a;
                    }
                }

                PaletteEntry bestEntry = paletteMap.get(bestArgb);
                PaletteEntry merged = new PaletteEntry(mergedPalette.size(), bestEntry.rgb, bestEntry.bead);
                mergedPalette.add(merged);

                // 同 code 所有旧索引 → 合并后的新索引
                for (int a : argbs) {
                    PaletteEntry oldE = paletteMap.get(a);
                    oldIndexToNew.put(oldE.index, merged.index);
                }
            }
        }

        // ── 步骤 4：构建索引网格（使用重映射后的索引） ──
        int[][] indexGrid = new int[height][width];
        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                int argb = colorGrid[v][u];
                PaletteEntry oldEntry = paletteMap.get(argb);
                indexGrid[v][u] = oldIndexToNew.getOrDefault(oldEntry != null ? oldEntry.index : 0, 0);
            }
        }

        // ── 步骤 5：构建并写入 JSON ──
        return writeJson(name, width, height, mergedPalette, indexGrid, savePath, cellSizeMm);
    }

    /**
     * 从 ARGB int 颜色网格导出（使用默认 cell_size_mm=5 和默认路径）。
     */
    public static Path exportFromColors(int[][] colorGrid, int width, int height, String name) {
        return exportFromColors(colorGrid, width, height, name, null, DEFAULT_CELL_SIZE_MM);
    }

    // ═══════════════════════════════════════════════════════════════
    //  旧版 API：从 BlockState[][] 网格导出（向后兼容）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 将 BlockState 采样网格导出为 JSON 文件。
     *
     * @param grid      采样到的 BlockState 二维网格 grid[v][u]（null = 空气/空位）
     * @param planeName 平面名称（用于输出文件名）
     * @param cellSizeMm 每颗豆直径（mm）
     * @return 输出文件的路径
     */
    public static Path export(BlockState[][] grid, String planeName, int cellSizeMm) {
        return export(grid, planeName, cellSizeMm, null);
    }

    /**
     * 将 BlockState 采样网格导出为 JSON 文件，指定保存路径。
     *
     * @param grid       采样到的 BlockState 二维网格 grid[v][u]（null = 空气/空位）
     * @param planeName  平面名称
     * @param cellSizeMm 每颗豆直径（mm）
     * @param savePath   保存路径（可为 null）
     * @return 输出文件的路径
     */
    public static Path export(BlockState[][] grid, String planeName, int cellSizeMm, Path savePath) {
        if (grid == null || grid.length == 0) {
            throw new IllegalArgumentException("采样网格不能为空");
        }

        int height = grid.length;
        int width = grid[0].length;

        // ── 构建调色板（匹配 MARD 豆号） ──
        MardPalette mard = MardPalette.getInstance();
        LinkedHashMap<String, PaletteEntry> paletteMap = new LinkedHashMap<>();
        paletteMap.put("__air__", new PaletteEntry(0, new int[]{255, 255, 255},
                mard.match(0xFFFFFFFF).orElse(null)));

        for (BlockState[] row : grid) {
            for (BlockState state : row) {
                if (state == null || state.isAir()) continue;
                String key = state.toString();
                if (!paletteMap.containsKey(key)) {
                    int[] rgb = BlockColorMapper.getColor(state);
                    int argb = 0xFF000000 | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
                    MardPalette.Bead bead = mard.match(argb).orElse(null);
                    paletteMap.put(key, new PaletteEntry(paletteMap.size(), rgb, bead));
                }
            }
        }

        List<PaletteEntry> palette = new ArrayList<>(paletteMap.values());

        // ── 构建索引网格 ──
        int[][] indexGrid = new int[height][width];
        for (int v = 0; v < height; v++) {
            for (int u = 0; u < width; u++) {
                BlockState state = grid[v][u];
                if (state == null || state.isAir()) {
                    indexGrid[v][u] = 0;
                } else {
                    String key = state.toString();
                    PaletteEntry entry = paletteMap.get(key);
                    indexGrid[v][u] = entry != null ? entry.index : 0;
                }
            }
        }

        return writeJson(planeName, width, height, palette, indexGrid, savePath, cellSizeMm);
    }

    // ═══════════════════════════════════════════════════════════════
    //  内部：JSON 序列化与文件写入
    // ═══════════════════════════════════════════════════════════════

    /**
     * 将调色板 + 索引网格写入 JSON 文件。
     */
    private static Path writeJson(String name, int width, int height,
                                   List<PaletteEntry> palette, int[][] indexGrid,
                                   Path savePath, int cellSizeMm) {
        // 构建 JSON 对象
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("name", name);
        json.put("width", width);
        json.put("height", height);
        json.put("cell_size_mm", cellSizeMm);

        List<Map<String, Object>> paletteJson = new ArrayList<>();
        for (PaletteEntry entry : palette) {
            Map<String, Object> entryJson = new LinkedHashMap<>();
            entryJson.put("index", entry.index);
            entryJson.put("rgb", entry.rgb);
            if (entry.bead != null) {
                entryJson.put("code", entry.bead.code());
                entryJson.put("name", entry.bead.name());
                entryJson.put("delta", Math.round(entry.bead.delta() * 100.0) / 100.0);
                int beadRgb = entry.bead.rgb();
                entryJson.put("bead_rgb", new int[]{
                    (beadRgb >> 16) & 0xFF,
                    (beadRgb >> 8) & 0xFF,
                    beadRgb & 0xFF
                });
            } else {
                entryJson.put("code", null);
                entryJson.put("name", null);
                // 无 bead_rgb 字段：未匹配到豆号时不输出
            }
            paletteJson.add(entryJson);
        }
        json.put("palette", paletteJson);
        json.put("grid", indexGrid);

        // 确定输出目录和文件名
        Path outputFile;
        if (savePath != null) {
            outputFile = savePath;
        } else {
            String timestamp = LocalDateTime.now().format(TIMESTAMP_FMT);
            String filename = String.format("%s_%s.json", safeFileName(name), timestamp);
            // TODO: 需在 26.2 上验证 — FabricLoader.getInstance().getGameDir()
            Path gameDir = FabricLoader.getInstance().getGameDir();
            Path outputDir = gameDir.resolve("patterns");
            outputFile = outputDir.resolve(filename);
        }

        // 确保父目录存在
        try {
            Files.createDirectories(outputFile.getParent());
        } catch (IOException e) {
            McPerlerMod.LOGGER.error("无法创建输出目录: {}", outputFile.getParent(), e);
            throw new RuntimeException("创建输出目录失败", e);
        }

        // 写入文件
        try {
            Files.writeString(outputFile, GSON.toJson(json), StandardCharsets.UTF_8);
        } catch (IOException e) {
            McPerlerMod.LOGGER.error("无法写入图纸文件: {}", outputFile, e);
            throw new RuntimeException("写入 JSON 失败", e);
        }

        McPerlerMod.LOGGER.info("图纸已导出: {} ({} 种颜色, {}x{})", outputFile, palette.size(), width, height);
        return outputFile;
    }

    /** 清理文件名中的不安全字符 */
    private static String safeFileName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
    }

    // ─── 内部数据类 ───

    /** 调色板条目：index + RGB + MARD 豆号匹配结果 */
    private static class PaletteEntry {
        final int index;
        final int[] rgb;
        final MardPalette.Bead bead; // null 表示未匹配到豆号

        PaletteEntry(int index, int[] rgb, MardPalette.Bead bead) {
            this.index = index;
            this.rgb = rgb;
            this.bead = bead;
        }
    }
}
