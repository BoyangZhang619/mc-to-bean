<script setup lang="ts">
/**
 * 文档页面 -- 渲染 platform-guide.md, 带 TOC 侧栏
 */
import { ref, onMounted, computed } from 'vue'
import { marked } from 'marked'

interface TocItem {
  id: string
  text: string
  level: number
}

const html = ref('')
const tocItems = ref<TocItem[]>([])
const activeTocId = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/docs/platform-guide.md')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()

    // 解析 markdown
    html.value = await marked.parse(md)

    // 生成 TOC
    tocItems.value = extractToc(md)

    // 监听滚动, 高亮当前章节
    window.addEventListener('scroll', updateActiveToc, { passive: true })
  } catch (e) {
    html.value = `<p class="docs-error">文档加载失败: ${(e as Error).message}</p>`
  }
})

/** 从 markdown 文本中提取 ## 和 ### 标题 */
function extractToc(md: string): TocItem[] {
  const items: TocItem[] = []
  const lines = md.split('\n')
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+)$/)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      // slug: 移除特殊字符, 空格替换为连字符, 小写
      const id = text
        .toLowerCase()
        .replace(/[（）()「」【】《》""'']/g, '')
        .replace(/[^\w一-鿿\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
      items.push({ id, text, level })
    }
  }
  return items
}

/** 根据当前滚动位置高亮 TOC 项 */
function updateActiveToc() {
  const contentEl = document.querySelector('.docs-content')
  if (!contentEl) return

  const headings = contentEl.querySelectorAll('h2, h3')
  let currentId = ''
  for (const h of headings) {
    const rect = h.getBoundingClientRect()
    if (rect.top <= 120) {
      // 从 id 属性获取 (marked 默认不生成 id, 需要自定义 renderer)
      // 这里通过 text 匹配
      const text = h.textContent?.trim() ?? ''
      const id = text
        .toLowerCase()
        .replace(/[（）()「」【】《》""'']/g, '')
        .replace(/[^\w一-鿿\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
      currentId = id
    }
  }
  activeTocId.value = currentId
}

/** 点击 TOC 项滚动到对应章节 */
function scrollToSection(id: string) {
  const contentEl = document.querySelector('.docs-content')
  if (!contentEl) return

  // marked 不默认给标题加 id, 通过 heading text 查找
  const headings = contentEl.querySelectorAll('h2, h3')
  for (const h of headings) {
    const text = h.textContent?.trim() ?? ''
    const slug = text
      .toLowerCase()
      .replace(/[（）()「」【】《》""'']/g, '')
      .replace(/[^\w一-鿿\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    if (slug === id) {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' })
      activeTocId.value = id
      return
    }
  }
}
</script>

<template>
  <div class="docs-view">
    <!-- TOC 侧栏 (PC) -->
    <aside class="docs-toc" v-if="tocItems.length > 0">
      <div class="toc-title">目录</div>
      <nav class="toc-nav">
        <button
          v-for="item in tocItems"
          :key="item.id"
          class="toc-link"
          :class="{
            'toc-link--h3': item.level === 3,
            'toc-link--active': activeTocId === item.id,
          }"
          @click="scrollToSection(item.id)"
        >
          {{ item.text }}
        </button>
      </nav>
    </aside>

    <!-- 文档内容区 -->
    <div class="docs-body">
      <div class="docs-content" v-html="html" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.docs-view {
  height: 100%;
  display: flex;
  overflow: hidden;
}

// TOC 侧栏
.docs-toc {
  width: 200px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  border-right: 1px solid $color-light;
  background: $color-white;
  padding: 24px 0;
  @include scrollbar-thin;

  @include mobile {
    display: none;
  }
}

.toc-title {
  font-size: 12px;
  font-weight: 600;
  color: $color-mid;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 20px 12px;
}

.toc-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toc-link {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 20px;
  font-size: 13px;
  color: $color-text-secondary;
  line-height: 1.5;
  transition: all $transition-fast;

  &:hover {
    background: $color-bg;
    color: $color-text;
  }

  &--h3 {
    padding-left: 32px;
    font-size: 12px;
    color: $color-mid;
  }

  &--active {
    color: $color-black;
    font-weight: 600;
    background: $color-bg-active;
  }
}

// 内容区
.docs-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  @include scrollbar-thin;
}

.docs-content {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 48px 80px;

  @include mobile {
    padding: 24px 20px 60px;
    max-width: 100%;
  }

  // ---- 排版样式 ----
  :deep(h2) {
    font-size: 24px;
    font-weight: 700;
    color: $color-text;
    margin: 48px 0 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid $color-light;
    letter-spacing: -0.5px;

    &:first-child {
      margin-top: 0;
    }
  }

  :deep(h3) {
    font-size: 18px;
    font-weight: 600;
    color: $color-text;
    margin: 32px 0 12px;
    letter-spacing: -0.3px;
  }

  :deep(h4) {
    font-size: 15px;
    font-weight: 600;
    color: $color-dark;
    margin: 24px 0 8px;
  }

  :deep(p) {
    font-size: 15px;
    line-height: 1.8;
    color: $color-text-secondary;
    margin: 0 0 16px;
  }

  :deep(strong) {
    color: $color-text;
    font-weight: 600;
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid $color-light;
    margin: 32px 0;
  }

  // 代码块
  :deep(pre) {
    background: $color-bg;
    border: 1px solid $color-light;
    border-radius: $radius-md;
    padding: 16px 20px;
    overflow-x: auto;
    margin: 16px 0;
    font-size: 13px;
    line-height: 1.7;
    @include scrollbar-thin;

    code {
      background: none;
      padding: 0;
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono',
        'Consolas', 'Courier New', monospace;
      font-size: 13px;
      color: $color-dark;
    }
  }

  :deep(code) {
    background: $color-bg;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono',
      'Consolas', 'Courier New', monospace;
    font-size: 13px;
    color: $color-dark;
  }

  // 表格
  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0 24px;
    font-size: 14px;
  }

  :deep(thead th) {
    background: $color-bg;
    border: 1px solid $color-light;
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    color: $color-text;
    font-size: 13px;
  }

  :deep(tbody td) {
    border: 1px solid $color-light;
    padding: 10px 14px;
    color: $color-text-secondary;
    vertical-align: top;

    code {
      font-size: 12px;
    }
  }

  :deep(tbody tr:hover) {
    background: $color-bg;
  }

  // 列表
  :deep(ul),
  :deep(ol) {
    margin: 0 0 16px;
    padding-left: 24px;

    li {
      font-size: 15px;
      line-height: 1.8;
      color: $color-text-secondary;
      margin-bottom: 4px;
    }

    ul,
    ol {
      margin-top: 4px;
      margin-bottom: 0;
    }
  }

  // 链接
  :deep(a) {
    color: $color-dark;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color $transition-fast;

    &:hover {
      color: $color-black;
    }
  }

  // 图片
  :deep(img) {
    max-width: 100%;
    border-radius: $radius-md;
    border: 1px solid $color-light;
  }

  // 错误提示
  :deep(.docs-error) {
    color: $color-danger;
    font-size: 14px;
    padding: 24px;
  }
}
</style>
