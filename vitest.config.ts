import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 仅对 services 层做单元测试，避开 electron 运行时依赖
    include: ['src/main/services/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
})
