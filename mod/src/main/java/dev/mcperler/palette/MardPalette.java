package dev.mcperler.palette;

import dev.mcperler.McPerlerMod;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * MARD 拼豆色卡调色板 —— 从 classpath 加载 mard.csv，提供基于 CIE Lab(D65) 最近邻的颜色匹配。
 *
 * <p>算法与 pattern-tool/palette.py 的 {@code srgb_to_lab()} + {@code match_color()} 完全一致：
 *   <ol>
 *     <li>sRGB 线性化（c/12.92 或 ((c+0.055)/1.055)^2.4）</li>
 *     <li>sRGB → XYZ(D65)（矩阵：0.4124564/0.3575761/0.1804375 等）</li>
 *     <li>XYZ → CIE L*a*b*（D65 白点：0.95047/1.0/1.08883，f(t) 函数 d=6/29）</li>
 *     <li>Lab 空间欧氏距离最近邻匹配</li>
 *   </ol>
 *
 * <p>色卡文件路径：{@code /assets/mcperler/palettes/mard.csv}（291 行，格式 code,name,r,g,b,source）。
 *   同 RGB 颜色去重（只保留第一个），与 Python 版一致。
 *
 * <p>线程安全：构建完成后只读，{@link #match(int)} 可多线程并发调用。
 *
 * <p>加载失败/色卡为空时优雅降级：log 警告，{@link #match(int)} 返回 {@link Optional#empty()}。
 */
public final class MardPalette {

    // ─── Bead record：豆号 + 颜色名 + RGB + Lab距离 ───

    /** 匹配到的一颗豆子：豆号、颜色名、RGB 值、与目标色的 ΔE（Lab 空间欧氏距离）。 */
    public record Bead(String code, String name, int rgb, double delta) {}

    // ─── 静态单例 ───

    private static final class Holder {
        static final MardPalette INSTANCE = new MardPalette();
    }

    /** 获取全局单例（色卡在首次调用时懒加载）。 */
    public static MardPalette getInstance() {
        return Holder.INSTANCE;
    }

    // ─── 实例字段 ───

    /** 色卡中的所有豆子（已去重，不可变） */
    private final List<InternalBead> palette;
    /** 色卡中每个豆子的 Lab 值（与 palette 一一对应，预计算缓存以加速匹配） */
    private final double[][] labCache;
    /** 色卡是否可用 */
    private final boolean available;

    // ─── 内部存储（不含 delta，避免冗余） ───

    private record InternalBead(String code, String name, int rgb) {}

    // ─── 构造函数：从 classpath 加载 CSV ───

    private MardPalette() {
        List<InternalBead> loaded = loadFromClasspath();

        if (loaded.isEmpty()) {
            McPerlerMod.LOGGER.warn("[MardPalette] 色卡为空或加载失败，match() 将始终返回 empty");
            this.palette = List.of();
            this.labCache = new double[0][];
            this.available = false;
            return;
        }

        // 颜色去重：同 RGB 只留第一个（与 Python 版 palette.py 的 load_palette() 一致）
        Set<Integer> seen = new LinkedHashSet<>();
        List<InternalBead> deduped = new ArrayList<>();
        for (InternalBead b : loaded) {
            if (seen.add(b.rgb)) {
                deduped.add(b);
            }
        }

        this.palette = Collections.unmodifiableList(deduped);
        // 预计算 Lab 缓存 —— 所有豆子的 Lab 值在加载时一次性计算，匹配时直接查表
        this.labCache = new double[this.palette.size()][];
        for (int i = 0; i < this.palette.size(); i++) {
            this.labCache[i] = srgbToLab(this.palette.get(i).rgb);
        }
        this.available = true;

        McPerlerMod.LOGGER.info("[MardPalette] 色卡加载完成：{} 种颜色（原始 {} 行，去重后 {} 种）",
                this.palette.size(), loaded.size(), this.palette.size());
    }

    // ─── 从 classpath 加载 CSV ───

    /**
     * 从 {@code /assets/mcperler/palettes/mard.csv} 加载色卡。
     * 使用 {@link Class#getResourceAsStream(String)} 读取，兼容运行时 classpath 和 IDE 环境。
     */
    private List<InternalBead> loadFromClasspath() {
        String resourcePath = "/assets/mcperler/palettes/mard.csv";
        List<InternalBead> result = new ArrayList<>();
        InputStream is = null;

        try {
            is = getClass().getResourceAsStream(resourcePath);
            if (is == null) {
                McPerlerMod.LOGGER.warn("[MardPalette] classpath 资源未找到: {}", resourcePath);
                return result;
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                int lineNum = 0;
                while ((line = reader.readLine()) != null) {
                    lineNum++;
                    line = line.trim();
                    if (line.isEmpty()) continue;

                    String[] parts = line.split(",", -1);
                    if (parts.length < 5) {
                        McPerlerMod.LOGGER.debug("[MardPalette] 跳过无效行 {} (列数={}): {}", lineNum, parts.length, line);
                        continue;
                    }

                    try {
                        String code = parts[0].trim();
                        String name = parts[1].trim();
                        int r = clamp(Integer.parseInt(parts[2].trim()));
                        int g = clamp(Integer.parseInt(parts[3].trim()));
                        int b = clamp(Integer.parseInt(parts[4].trim()));

                        int rgb = (r << 16) | (g << 8) | b;
                        result.add(new InternalBead(code, name, rgb));
                    } catch (NumberFormatException e) {
                        McPerlerMod.LOGGER.debug("[MardPalette] 跳过无效行 {} (数字解析失败): {}", lineNum, line);
                    }
                }
            }
        } catch (IOException e) {
            McPerlerMod.LOGGER.warn("[MardPalette] 读取色卡 CSV 失败: {}", e.getMessage());
        }

        return result;
    }

    /** 限制 RGB 分量到 [0, 255] 范围 */
    private static int clamp(int v) {
        if (v < 0) return 0;
        if (v > 255) return 255;
        return v;
    }

    // ─── 颜色匹配 API ───

    /**
     * 在色卡中找 Lab 距离最近的豆子。
     *
     * @param argb ARGB int 颜色值（alpha 忽略，仅使用低 24 位 RGB）
     * @return 最近匹配的豆子（含 delta）；色卡不可用时返回 {@link Optional#empty()}
     */
    public Optional<Bead> match(int argb) {
        if (!available) return Optional.empty();

        int r = (argb >> 16) & 0xFF;
        int g = (argb >> 8) & 0xFF;
        int b = argb & 0xFF;
        double[] targetLab = srgbToLab(r, g, b);

        int bestIdx = 0;
        double bestDistSq = Double.POSITIVE_INFINITY;

        for (int i = 0; i < labCache.length; i++) {
            double[] lab = labCache[i];
            double dL = lab[0] - targetLab[0];
            double da = lab[1] - targetLab[1];
            double db = lab[2] - targetLab[2];
            double distSq = dL * dL + da * da + db * db; // 平方距离，避免 sqrt，仅用于比较
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestIdx = i;
            }
        }

        InternalBead best = palette.get(bestIdx);
        return Optional.of(new Bead(best.code, best.name, best.rgb, Math.sqrt(bestDistSq)));
    }

    // ═══════════════════════════════════════════════════════════════
    //  sRGB → CIE Lab (D65, 2° 观察者)
    //  公式与 pattern-tool/palette.py 的 srgb_to_lab() 完全一致
    // ═══════════════════════════════════════════════════════════════

    /** 从 RGB int（0xRRGGBB）转换到 CIE Lab */
    private static double[] srgbToLab(int rgb) {
        return srgbToLab((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
    }

    /** 从 R/G/B 分量转换到 CIE Lab */
    private static double[] srgbToLab(int r, int g, int b) {
        double lr = srgbToLinear(r);
        double lg = srgbToLinear(g);
        double lb = srgbToLinear(b);

        // sRGB → XYZ (D65) —— 矩阵系数与 Python 版完全一致
        double x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
        double y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
        double z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

        // XYZ → Lab (D65 白点归一化)
        return xyzToLab(x, y, z);
    }

    /**
     * sRGB 线性化 —— 与 Python 版 {@code _srgb_to_linear()} 完全一致。
     * <ul>
     *   <li>c / 255.0</li>
     *   <li>{@code v <= 0.04045 → v / 12.92}</li>
     *   <li>{@code v > 0.04045 → ((v + 0.055) / 1.055) ^ 2.4}</li>
     * </ul>
     */
    private static double srgbToLinear(int c) {
        double v = c / 255.0;
        if (v <= 0.04045) {
            return v / 12.92;
        } else {
            return Math.pow((v + 0.055) / 1.055, 2.4);
        }
    }

    /**
     * XYZ(D65) → CIE L*a*b* —— 与 Python 版 {@code srgb_to_lab()} 后半段完全一致。
     * <ul>
     *   <li>D65 白点：Xn=0.95047, Yn=1.0, Zn=1.08883</li>
     *   <li>L* = 116*f(Y/Yn) - 16</li>
     *   <li>a* = 500*(f(X/Xn) - f(Y/Yn))</li>
     *   <li>b* = 200*(f(Y/Yn) - f(Z/Zn))</li>
     * </ul>
     */
    static double[] xyzToLab(double x, double y, double z) {
        // D65 白点归一化（Xn/Yn/Zn 与 Python 版完全一致）
        double fx = f(x / 0.95047);
        double fy = f(y / 1.0);
        double fz = f(z / 1.08883);

        double L = 116.0 * fy - 16.0;
        double a = 500.0 * (fx - fy);
        double bb = 200.0 * (fy - fz);

        return new double[]{L, a, bb};
    }

    /**
     * CIE Lab 辅助函数 f(t) —— 与 Python 版 f(t) 完全一致。
     * <ul>
     *   <li>d = 6/29</li>
     *   <li>t > d^3 → t^(1/3)</li>
     *   <li>t ≤ d^3 → t/(3*d^2) + 4/29</li>
     * </ul>
     */
    private static double f(double t) {
        double d = 6.0 / 29.0;
        double d3 = d * d * d; // (6/29)^3 ≈ 0.00885645
        if (t > d3) {
            return Math.cbrt(t);
        } else {
            return t / (3.0 * d * d) + 4.0 / 29.0;
        }
    }
}
