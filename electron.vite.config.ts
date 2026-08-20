import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      // 源码目录 src/ 曾混入旧 tsc 编译产物（同名 .js/.d.ts）。Vite 默认扩展名 .js 优先于 .ts，
      // 会导致 main 误用陈旧 .js、忽略最新的 .ts（例如新注册的 FunASR IPC handler 不生效）。
      // 因此显式让 .ts 优先，确保始终使用真实 TypeScript 源码。
      extensions: ['.mts', '.ts', '.mjs', '.js', '.jsx', '.tsx', '.json', '.node'],
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
    // 2026-08-18 修复：preload 输出 CJS（index.cjs）。
    // Electron 31 的 ESM preload（.mjs）加载不稳定（cjsPreparseModuleExports 崩、
    // 无法 import 外部包），CJS preload 是 Electron 完全成熟支持的路径。
    // 同时内联 @electron-toolkit/preload（不 externalize）。
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs'
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
