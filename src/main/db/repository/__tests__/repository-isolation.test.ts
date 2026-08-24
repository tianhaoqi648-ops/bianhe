// ============================================================
// repository-isolation.test.ts — Repository 去直接依赖（Governance Task 6）
//
// 校验 repository 不再入口直接 import 另一个 repository：
//   - batch-edit-history.repo 不再 import topic.repo（撤销编排已上移到 Service）
//   - bell-asset.repo 不再 import audit.repo（文件删除失败审计已上移到调用方）
// 直接读取源码做静态断言，作为对「依赖隔离」不变量的回归保护。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

function readRepoSource(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8')
}

describe('Repository 内部不直接依赖另一 Repository（Governance Task 6）', () => {
  it('batch-edit-history.repo.ts 不再 import ./topic.repo', () => {
    const src = readRepoSource('batch-edit-history.repo.ts')
    expect(src).not.toMatch(/from\s+['"]\.\/topic\.repo['"]/)
  })

  it('bell-asset.repo.ts 不再 import ./audit.repo', () => {
    const src = readRepoSource('bell-asset.repo.ts')
    expect(src).not.toMatch(/from\s+['"]\.\/audit\.repo['"]/)
  })

  it('batch-edit-history.repo.ts 以 markReverted 取代 revertHistory（单库单动作）', () => {
    const src = readRepoSource('batch-edit-history.repo.ts')
    expect(src).toMatch(/function\s+markReverted\b/)
    expect(src).not.toMatch(/function\s+revertHistory\b/)
  })
})