package dev.mcperler.palette;

import java.util.Optional;

/**
 * MardPalette 颜色匹配验证 —— 临时测试类（验证完成后可删除）。
 *
 * <p>用法：
 * <pre>
 *   cd mod
 *   export GRADLE_OPTS="..."
 *   ./gradlew build --no-daemon
 *   # 然后直接从 IDE 运行 main，或：
 *   java -cp build/classes/java/main:build/resources/main dev.mcperler.palette.MardPaletteVerify
 * </pre>
 *
 * <p>对照：pattern-tool 目录下运行 Python 版获取预期结果
 * <pre>
 *   cd pattern-tool
 *   PYTHONIOENCODING=utf-8 python -c "
 *   from palette import load_palette, match_color
 *   p = load_palette('mard')
 *   for rgb in [(17,14,8), (194,157,98), (255,0,0), (128,128,128), (255,255,255)]:
 *       m = match_color(rgb, p)
 *       print(f'{rgb} -> {m.code} {m.name} {m.rgb}')
 *   "
 * </pre>
 */
public class MardPaletteVerify {

    /** Python 版(已运行)的预期结果（code 精确匹配） */
    private static final record Expected(int r, int g, int b, String code) {}

    private static final Expected[] EXPECTED = {
            new Expected(17, 14, 8, "H7"),       // #110E08 → H7 黑
            new Expected(194, 157, 98, "G4"),     // #C29D62 → G4 棕
            new Expected(255, 0, 0, "F4"),        // 纯红 → F4
            new Expected(128, 128, 128, "M15"),   // 中性灰 → M15
            new Expected(255, 255, 255, "T1"),    // 纯白 → T1
            new Expected(0, 0, 0, "H7"),          // 纯黑 → H7（精确匹配，delta=0）
    };

    public static void main(String[] args) {
        MardPalette palette = MardPalette.getInstance();

        System.out.println("=== MardPalette 颜色匹配验证 (Java vs Python) ===");
        System.out.println();

        int passed = 0;
        int total = EXPECTED.length;

        for (Expected exp : EXPECTED) {
            int argb = 0xFF000000 | (exp.r << 16) | (exp.g << 8) | exp.b;
            Optional<MardPalette.Bead> result = palette.match(argb);

            System.out.printf("  RGB(%3d,%3d,%3d)  #%02X%02X%02X  期望 %s", exp.r, exp.g, exp.b, exp.r, exp.g, exp.b, exp.code);

            if (!result.isPresent()) {
                System.out.println(" -> Java: NO MATCH  FAIL");
                continue;
            }

            MardPalette.Bead bd = result.get();
            int br = (bd.rgb() >> 16) & 0xFF;
            int bg = (bd.rgb() >> 8) & 0xFF;
            int bb = bd.rgb() & 0xFF;
            boolean codeMatch = bd.code().equals(exp.code);

            System.out.printf(" -> Java: %-5s RGB(%3d,%3d,%3d) ΔE=%.2f  %s%n",
                    bd.code(), br, bg, bb, bd.delta(),
                    codeMatch ? "PASS (与 Python 一致)" : "FAIL (Java=" + bd.code() + " vs Python=" + exp.code + ")");
            if (codeMatch) passed++;
        }

        System.out.println();
        System.out.printf("Java vs Python 对照通过: %d/%d%n", passed, total);
        if (passed == total) {
            System.out.println("所有颜色匹配与 Python 端完全一致！");
        } else {
            System.out.println("存在不一致，请检查以上输出。");
            System.exit(1);
        }
    }
}
