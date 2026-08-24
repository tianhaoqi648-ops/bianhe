import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // 该库 tsconfig 将 jsx 设为 preserve，vitest(内嵌 Vite 8/oxc) 默认不会转译 JSX；
  // 显式指定 automatic，让 .tsx 单测与组件在被引入时被正确转译。
  oxc: {
    jsx: { runtime: 'automatic' }
  },
  resolve: {
    alias: {
      '@main/': `${resolve(__dirname, 'src/main')}/`,
      '@shared/': `${resolve(__dirname, 'src/shared')}/`,
      '@preload/': `${resolve(__dirname, 'src/preload')}/`
    }
  },
  test: {
    // services 层 + shared 纯函数工具 + renderer 纯函数工具 + stores 的单元测试，避开 electron 运行时依赖
    // Task 51: 新增 agent 层（schedule-engine / agent-loop / tools）与 db repository 层测试
    include: [
      'src/main/services/__tests__/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/shared/utils/__tests__/**/*.test.ts',
      'src/renderer/src/utils/__tests__/**/*.test.ts',
      'src/renderer/src/components/**/__tests__/**/*.test.tsx',
      'src/renderer/src/stores/__tests__/**/*.test.ts',
      'src/main/agent/__tests__/**/*.test.ts',
      'src/main/agent/tools/__tests__/**/*.test.ts',
      'src/main/db/repository/__tests__/**/*.test.ts',
      'src/main/db/migrations/__tests__/**/*.test.ts',
      'src/main/ipc/__tests__/**/*.test.ts'
    ],
    environment: 'node',
    globals: false
  }
})

