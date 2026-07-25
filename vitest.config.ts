import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // services 层 + renderer 纯函数工具 + stores 的单元测试，避开 electron 运行时依赖
    include: [
      'src/main/services/__tests__/**/*.test.ts',
      'src/renderer/src/utils/__tests__/**/*.test.ts',
      'src/renderer/src/stores/__tests__/**/*.test.ts'
    ],
    environment: 'node',
    globals: false
  }
})

