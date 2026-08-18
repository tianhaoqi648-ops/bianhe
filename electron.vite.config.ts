import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@preload': resolve(__dirname, 'src/preload')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    // 2026-08-18 修复：把 @electron-toolkit/preload 内联进 bundle（exclude externalize）。
    // Electron 31 的 ESM preload（.mjs）无法 import 外部 node_modules 包——
    // 之前 externalize 后 preload 运行时 `import { electronAPI } from '@electron-toolkit/preload'`
    // 加载失败，导致整个 preload 崩溃、contextBridge 未注入、渲染层白屏（「核心模块加载失败」）。
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(version)
    }
  }
})
