package dev.mcperler.color;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 面纹理提供器 (M5): 解析 assets 模型文件, 取方块"被看到那一面"的 16×16 纹理像素。
 *
 * 不依赖 26.2 客户端渲染 API (模型系统已重构为渲染状态机, 提取像素风险高),
 * 直接解析 blockstates / models JSON + 贴图 PNG — 与 Python 端离线管线同源。
 *
 * 已知限制 (TODO):
 *   - 忽略 blockstates variant 的 x/y 旋转 (旋转会改变面方向映射, 影响少数旋转方块)
 *   - 忽略 face 的 tintindex (草/树叶缺生物群系着色, 显示原纹理色)
 *   - 多 element 模型 (门/火把等) 按 faces 顺序覆盖采样 (后写覆盖先写, 近似效果)
 *
 * 线程安全: 本类在客户端主线程 (渲染线程) 使用, 不跨线程共享。
 */
public final class FaceTextureProvider {

    private static final Logger LOGGER = LoggerFactory.getLogger("mcperler-facetexture");

    private final ResourceManager resourceManager;
    /** JSON 缓存 (blockstates/models) */
    private final Map<Identifier, JsonObject> jsonCache = new HashMap<>();
    /** 贴图缓存 (NativeImage) */
    private final Map<Identifier, NativeImage> textureCache = new HashMap<>();

    public FaceTextureProvider(ResourceManager resourceManager) {
        this.resourceManager = resourceManager;
    }

    /**
     * 取方块某个面的 16×16 ARGB 纹理像素数组 out[y][x]。
     * 解析失败返回 empty (调用方回退 MapColor 单色)。
     */
    public Optional<int[][]> getFacePixels(BlockState state, Direction facing) {
        try {
            Identifier blockId = BuiltInRegistries.BLOCK.getKey(state.getBlock());
            JsonObject blockstates = loadJson(id(blockId.getNamespace(), "blockstates/" + blockId.getPath()));
            if (blockstates == null || !blockstates.has("variants")) {
                return Optional.empty();
            }
            JsonObject variant = matchVariant(blockstates.getAsJsonObject("variants"), state);
            if (variant == null || !variant.has("model")) {
                return Optional.empty();
            }
            JsonObject model = loadModel(Identifier.parse(variant.get("model").getAsString()));
            if (model == null || !model.has("elements")) {
                return Optional.empty();
            }

            int[][] out = new int[16][16];
            boolean any = false;
            for (JsonElement el : model.getAsJsonArray("elements")) {
                JsonObject element = el.getAsJsonObject();
                if (!element.has("faces")) {
                    continue;
                }
                JsonObject faces = element.getAsJsonObject("faces");
                String dirName = facing.getSerializedName();
                if (!faces.has(dirName)) {
                    continue;
                }
                JsonObject face = faces.getAsJsonObject(dirName);
                if (!face.has("texture")) {
                    continue;
                }
                // UV: 缺省 = 全贴图 [0,0,16,16]; 模型 uv y 向上, 贴图 y 向下 → 采样时翻转
                float[] uv = {0f, 0f, 16f, 16f};
                if (face.has("uv")) {
                    JsonArray arr = face.getAsJsonArray("uv");
                    uv = new float[]{
                            arr.get(0).getAsFloat(), arr.get(1).getAsFloat(),
                            arr.get(2).getAsFloat(), arr.get(3).getAsFloat()};
                }
                Identifier texId = resolveTexture(model, face.get("texture").getAsString());
                if (texId == null) {
                    continue;
                }
                NativeImage img = loadTexture(texId);
                if (img == null) {
                    continue;
                }
                int tw = img.getWidth();
                int th = img.getHeight();
                for (int y = 0; y < 16; y++) {
                    float vy = 16f - (uv[1] + (uv[3] - uv[1]) * (y + 0.5f) / 16f);
                    for (int x = 0; x < 16; x++) {
                        float vx = uv[0] + (uv[2] - uv[0]) * (x + 0.5f) / 16f;
                        int px = clamp((int) (vx / 16f * tw), 0, tw - 1);
                        int py = clamp((int) (vy / 16f * th), 0, th - 1);
                        out[y][x] = img.getPixel(px, py);   // 26.2: getPixel 返回 ARGB
                    }
                }
                any = true;
            }
            return any ? Optional.of(out) : Optional.empty();
        } catch (Exception e) {
            LOGGER.warn("面纹理解析失败: {} {} ({})", state, facing, e.toString());
            return Optional.empty();
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  blockstates variants 匹配
    // ─────────────────────────────────────────────────────────────

    private JsonObject matchVariant(JsonObject variants, BlockState state) {
        for (Map.Entry<String, JsonElement> entry : variants.entrySet()) {
            String key = entry.getKey();   // 如 "axis=x" 或 ""
            if (key.isBlank()) {
                continue;                  // 默认 variant 最后兜底
            }
            boolean allMatch = true;
            for (String pair : key.split(",")) {
                int eq = pair.indexOf('=');
                if (eq < 0) {
                    allMatch = false;
                    break;
                }
                String propName = pair.substring(0, eq);
                String wantValue = pair.substring(eq + 1);
                if (!matchesProperty(state, propName, wantValue)) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                return entry.getValue().getAsJsonObject();
            }
        }
        // 兜底: 默认 variant ("")
        JsonElement fallback = variants.get("");
        return fallback != null ? fallback.getAsJsonObject() : null;
    }

    private boolean matchesProperty(BlockState state, String propName, String wantValue) {
        for (Property<?> prop : state.getProperties()) {
            if (prop.getName().equals(propName)) {
                // 26.2: BlockState.getValue(Property) 替代 Property.getValue(BlockState)
                return state.getValue(prop).toString().equals(wantValue);
            }
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────
    //  模型解析 (parent 链 + textures 变量)
    // ─────────────────────────────────────────────────────────────

    /**
     * 加载模型并沿 parent 链合并 textures; 返回含最终 textures 与 elements 的 JsonObject。
     * 遍历中维护 textures 覆盖表: 子层覆盖父层, #ref 用父层已解析值。
     */
    private JsonObject loadModel(Identifier modelId) {
        Identifier cached = modelId;
        if (jsonCache.containsKey(cached)) {
            return jsonCache.get(cached);
        }
        Map<String, String> textures = new HashMap<>();
        JsonObject merged = new JsonObject();
        boolean hasElements = false;

        Identifier current = modelId;
        int depth = 0;
        while (current != null && depth < 16) {
            JsonObject raw = loadJson(id(current.getNamespace(), "models/" + current.getPath()));
            if (raw == null) {
                break;
            }
            // textures 覆盖 (子层优先: 先解析的 parent 是"更深"层, 后解析的覆盖它)
            if (raw.has("textures")) {
                JsonObject t = raw.getAsJsonObject("textures");
                for (Map.Entry<String, JsonElement> e : t.entrySet()) {
                    String v = e.getValue().getAsString();
                    textures.put(e.getKey(), v.startsWith("#") ? resolveRef(textures, v) : v);
                }
            }
            if (!hasElements && raw.has("elements")) {
                merged.add("elements", raw.get("elements"));
                hasElements = true;
            }
            current = raw.has("parent")
                    ? Identifier.parse(raw.get("parent").getAsString())
                    : null;
            depth++;
        }
        merged.add("textures", toJsonObject(textures));
        jsonCache.put(cached, merged);
        return merged;
    }

    /** 解析 #ref 链 (如 #side → 最终贴图路径), 死循环保护。 */
    private String resolveRef(Map<String, String> textures, String ref) {
        String cur = ref;
        for (int i = 0; i < 8 && cur.startsWith("#"); i++) {
            String next = textures.get(cur.substring(1));
            if (next == null) {
                return null;
            }
            cur = next;
        }
        return cur;
    }

    /** 解析 #ref 链，JsonObject 重载（用于 resolveTexture 中 model.getAsJsonObject("textures") 直接传入）。 */
    private String resolveRef(JsonObject textures, String ref) {
        String cur = ref;
        for (int i = 0; i < 8 && cur.startsWith("#"); i++) {
            JsonElement next = textures.get(cur.substring(1));
            if (next == null) {
                return null;
            }
            cur = next.getAsString();
        }
        return cur;
    }

    /** 把 face.texture ("#side" / "minecraft:block/x") 解析为贴图 Identifier。 */
    private Identifier resolveTexture(JsonObject model, String texRef) {
        String resolved;
        if (texRef.startsWith("#")) {
            resolved = resolveRef(model.getAsJsonObject("textures"), texRef);
        } else {
            resolved = texRef;
        }
        if (resolved == null || resolved.startsWith("#")) {
            return null;
        }
        return Identifier.parse(resolved);
    }

    // ─────────────────────────────────────────────────────────────
    //  资源加载
    // ─────────────────────────────────────────────────────────────

    private JsonObject loadJson(Identifier path) {
        if (jsonCache.containsKey(path)) {
            JsonObject hit = jsonCache.get(path);
            return hit == null ? null : hit;   // null 也缓存 (失败不再重试)
        }
        try {
            var stack = resourceManager.getResourceStack(path);
            if (stack.isEmpty()) {
                jsonCache.put(path, null);
                return null;
            }
            // 26.2: Resource 为 record，无 close()；只需 close InputStream
            Resource res = stack.get(0);
            InputStream in = res.open();
            try {
                InputStreamReader r = new InputStreamReader(in, StandardCharsets.UTF_8);
                JsonObject obj = JsonParser.parseReader(r).getAsJsonObject();
                jsonCache.put(path, obj);
                return obj;
            } finally {
                in.close();
            }
        } catch (Exception e) {
            jsonCache.put(path, null);
            return null;
        }
    }

    private NativeImage loadTexture(Identifier path) {
        NativeImage hit = textureCache.get(path);
        if (hit != null) {
            return hit;
        }
        try {
            var stack = resourceManager.getResourceStack(path);
            if (stack.isEmpty()) {
                return null;
            }
            // 26.2: Resource 为 record，无 close()；只需 close InputStream
            Resource res = stack.get(0);
            InputStream in = res.open();
            try {
                NativeImage img = NativeImage.read(in);
                textureCache.put(path, img);
                return img;
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static Identifier id(String namespace, String path) {
        return Identifier.parse(namespace + ":" + path);
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static JsonObject toJsonObject(Map<String, String> map) {
        JsonObject obj = new JsonObject();
        map.forEach(obj::addProperty);
        return obj;
    }
}
