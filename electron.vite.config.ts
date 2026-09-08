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
        '@core': resolve(__dirname, 'src/core'),
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
    resolve: {
      // 2026-09-08 修复：shared/types.ts 已改为从 @core/schema/* 消费跨端规范类型，
      // 而 preload 经相对路径 import 了 shared/types，因此 preload 段同样需要 @core 别名，
      // 否则 rollup 无法解析 @core/schema/match，构建直接失败（main / renderer 段已配）。
      alias: {
        '@core': resolve(__dirname, 'src/core')
      }
    },
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
        '@renderer': resolve('src/renderer/src'),
        // 修复：renderer 历史无 @shared 别名（全部用相对路径），@core 一并补齐
        '@core': resolve(__dirname, 'src/core')
      }
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(version)
    }
  }
})
