// Cross-End Golden: backup-protocol（随 sync-core 同步到小程序仓，两端运行同一文件）
// 仅测 Core 协议层；restore-order 等端侧映射不做跨端断言（见 KNOWN_DIVERGENCES.md #5）。
import { describe, it, expect } from 'vitest'
import {
  validateBackupPackage,
  migratePackage,
  buildExportMetadata,
  planEventScopedRead
} from '../../protocol/backup-protocol'
import fixture from './fixtures/backup.json'

describe('Cross-End Golden: backup', () => {
  const f = fixture as any
  for (const c of f.cases) {
    it(c.name, () => {
      let out: any
      switch (c.fn) {
        case 'validateBackupPackage':
          out = validateBackupPackage(c.input)
          break
        case 'migratePackage':
          out = migratePackage(c.input)
          break
        case 'buildExportMetadata':
          out = buildExportMetadata(c.input)
          break
        case 'planEventScopedRead':
          out = planEventScopedRead(c.input)
          break
        default:
          throw new Error(`golden: 未知 fn ${c.fn}`)
      }
      if (c.fn === 'migratePackage') {
        // 迁移 hook：仅断言 applied 空（v1 无迁移），数据原样透传
        expect(out.applied).toEqual(c.expected.applied)
      } else {
        expect(out).toEqual(c.expected)
      }
    })
  }
})
