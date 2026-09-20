// ============================================================
// helpers/node-sqlite-adapter.ts — 测试专用 better-sqlite3 适配器工厂
//
// 背景：backup/index.ts 的验证辅助（getDbFileSchemaVersion /
// getIntegrityCheckResult / getRestoredFkViolations）动态 import
// better-sqlite3（Electron ABI），在 vitest（Node ABI）下不可加载。
// 测试经 vi.mock('better-sqlite3') 注入本适配器（node:sqlite 实现），
// 使真 SQLite 验证逻辑可在 vitest 下真实执行。生产代码零改动。
//
// 用法：
//   vi.mock('better-sqlite3', async () => {
//     const { createFileDbClass } = await import('./helpers/node-sqlite-adapter')
//     return { default: createFileDbClass() }
//   })
// ============================================================
import { DatabaseSync } from 'node:sqlite'

export function createFileDbClass(): new (
  path: string,
  opts?: { readonly?: boolean; fileMustExist?: boolean }
) => unknown {
  return class FileDb {
    private raw: DatabaseSync
    constructor(p: string, _opts?: { readonly?: boolean; fileMustExist?: boolean }) {
      // 只读语义由调用方保证（验证函数仅执行 PRAGMA 查询）；
      // node:sqlite 的 readOnly 选项跨版本可用性不一，此处以可写打开但只跑查询。
      this.raw = new DatabaseSync(p)
    }
    get memory(): boolean {
      return false
    }
    /** better-sqlite3 pragma 语义：{simple:true} 返回标量，否则返回行数组 */
    pragma(sql: string, opts?: { simple?: boolean }): unknown {
      const stmt = this.raw.prepare(`PRAGMA ${sql}`)
      if (opts?.simple) {
        const row = stmt.get() as Record<string, unknown> | undefined
        return row ? Object.values(row)[0] : undefined
      }
      return stmt.all()
    }
    close(): void {
      this.raw.close()
    }
  }
}
