/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// CanvasRenderingContext2D.roundRect 类型声明 (ES2020 DOM lib 不含此 API)
interface CanvasRenderingContext2D {
  roundRect(x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | (number | DOMPointInit)[]): void
}
