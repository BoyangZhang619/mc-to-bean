<script setup lang="ts">
/**
 * Icon 组件 -- 全部手写 SVG, 严禁 emoji 或图标库
 * 图标集: 24x24 viewBox, stroke-only, 黑白灰
 */

defineProps<{
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
}>()

export type IconName =
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'rect'
  | 'line'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'grid'
  | 'save'
  | 'export'
  | 'import'
  | 'home'
  | 'gallery'
  | 'delete'
  | 'check'
  | 'close'
  | 'arrow-left'
  | 'arrow-right'
  | 'plus'
  | 'minus'
  | 'palette'
  | 'crosshair'
  | 'move'
  | 'menu'
  | 'search'
  | 'info'
  | 'warning'
  | 'resize'
  | 'settings'
  | 'rename'
  | 'expand'
  | 'collapse'
  | 'bg-color'
  | 'replace'
</script>

<template>
  <svg
    :width="size ?? 24"
    :height="size ?? 24"
    :viewBox="`0 0 24 24`"
    fill="none"
    :stroke="color ?? 'currentColor'"
    :stroke-width="strokeWidth ?? 2"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- 画笔 -->
    <template v-if="name === 'brush'">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </template>

    <!-- 橡皮 -->
    <template v-else-if="name === 'eraser'">
      <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14 2.2c.8-.8 2-.8 2.8 0L21 6.4c.8.8.8 2 0 2.8L12 18" />
      <path d="M6 14l4 4" />
      <line x1="18" y1="20" x2="22" y2="20" />
    </template>

    <!-- 填充 (油漆桶) -->
    <template v-else-if="name === 'fill'">
      <path d="M19 11H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" />
      <path d="M12 2v4" />
      <path d="M7 4 2 9l5 5 5-5-5-5Z" />
      <path d="M7 4v3" />
    </template>

    <!-- 取色器 -->
    <template v-else-if="name === 'eyedropper'">
      <path d="M2 22l1-1h3l9-9" />
      <path d="M3 21l-1 1" />
      <path d="m15 5 4 4" />
      <path d="m19 9-8.6 8.6a1 1 0 0 1-.7.4H7.3a1 1 0 0 1-.7-.3L5 16.3a1 1 0 0 1-.3-.7v-2.4a1 1 0 0 1 .3-.7L13.6 4a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1Z" />
      <path d="m17 6.5 3 3" />
    </template>

    <!-- 矩形框选 -->
    <template v-else-if="name === 'rect'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="10" />
    </template>

    <!-- 直线 -->
    <template v-else-if="name === 'line'">
      <line x1="4" y1="20" x2="20" y2="4" />
      <circle cx="4" cy="20" r="1.5" fill="currentColor" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" />
    </template>

    <!-- 撤销 -->
    <template v-else-if="name === 'undo'">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </template>

    <!-- 重做 -->
    <template v-else-if="name === 'redo'">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </template>

    <!-- 放大 -->
    <template v-else-if="name === 'zoom-in'">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </template>

    <!-- 缩小 -->
    <template v-else-if="name === 'zoom-out'">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </template>

    <!-- 网格 -->
    <template v-else-if="name === 'grid'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </template>

    <!-- 保存 -->
    <template v-else-if="name === 'save'">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </template>

    <!-- 导出 -->
    <template v-else-if="name === 'export'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </template>

    <!-- 导入 -->
    <template v-else-if="name === 'import'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
      <line x1="3" y1="3" x2="9" y2="3" />
      <line x1="3" y1="3" x2="3" y2="9" />
    </template>

    <!-- 首页 -->
    <template v-else-if="name === 'home'">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </template>

    <!-- 图库 -->
    <template v-else-if="name === 'gallery'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <polyline points="21 15 16 10 5 21" />
    </template>

    <!-- 删除 -->
    <template v-else-if="name === 'delete'">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </template>

    <!-- 勾选 -->
    <template v-else-if="name === 'check'">
      <polyline points="20 6 9 17 4 12" />
    </template>

    <!-- 关闭 -->
    <template v-else-if="name === 'close'">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </template>

    <!-- 左箭头 -->
    <template v-else-if="name === 'arrow-left'">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </template>

    <!-- 右箭头 -->
    <template v-else-if="name === 'arrow-right'">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </template>

    <!-- 加号 -->
    <template v-else-if="name === 'plus'">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </template>

    <!-- 减号 -->
    <template v-else-if="name === 'minus'">
      <line x1="5" y1="12" x2="19" y2="12" />
    </template>

    <!-- 色板 -->
    <template v-else-if="name === 'palette'">
      <circle cx="13.5" cy="6.5" r="2" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="2" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="2" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="2" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.6 1.5-1.5 0-.4-.1-.7-.3-1-.2-.3-.2-.6 0-.9.3-.3.6-.6.8-.6.5 0 .8.3.8.8 0 3.5-2.7 6.2-6.3 6.2C5 22 2 19 2 12S5 2 12 2Z" />
    </template>

    <!-- 十字光标 -->
    <template v-else-if="name === 'crosshair'">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </template>

    <!-- 移动/平移 -->
    <template v-else-if="name === 'move'">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </template>

    <!-- 菜单 (汉堡) -->
    <template v-else-if="name === 'menu'">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </template>

    <!-- 搜索 -->
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </template>

    <!-- 信息 -->
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </template>

    <!-- 警告 -->
    <template v-else-if="name === 'warning'">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </template>

    <!-- 尺寸调整 -->
    <template v-else-if="name === 'resize'">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>

    <!-- 设置 -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </template>

    <!-- 重命名 -->
    <template v-else-if="name === 'rename'">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </template>

    <!-- 展开 -->
    <template v-else-if="name === 'expand'">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>

    <!-- 收起 -->
    <template v-else-if="name === 'collapse'">
      <polyline points="4 8 8 4 12 8" />
      <polyline points="20 16 16 20 12 16" />
      <line x1="8" y1="4" x2="8" y2="12" />
      <line x1="16" y1="20" x2="16" y2="12" />
    </template>

    <!-- 背景色 -->
    <template v-else-if="name === 'bg-color'">
      <rect x="2" y="2" width="20" height="20" rx="4" />
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </template>

    <!-- 颜色替换 -->
    <template v-else-if="name === 'replace'">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 8 L17 8" />
      <path d="M12 4 L12 8 M12 12 L12 20" />
      <circle cx="12" cy="10" r="2" />
      <rect x="5" y="14" width="6" height="6" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="13" y="14" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
    </template>
  </svg>
</template>
