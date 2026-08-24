// ============================================================
// app-error.test.ts — 统一结构化错误（Task2.1/2.2）单元测试
//
// 覆盖：
//   - toApiError 分类映射（约束→「该辩题已存在」、BUSY、NOT_FOUND、VALIDATION、
//     PARTIAL_FAILURE 透传、未知回退）
//   - wrap/wrapWithUndo 走结构化包装，且 error 字段保持 string 兼容
//   - 既有成功/失败返回不被破坏
// ============================================================

import { describe, it, expect, vi } from 'vitest'

// utils.ts 依赖 electron（仅模块级 import BrowserWindow），此处 mock 避免拉入真实 Electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => [])
  }
}))

import { AppError, toApiError } from '../../../shared/app-error'
import { wrap, wrapWithUndo } from '../utils'

describe('toApiError：错误分类映射', () => {
  it('SQLite UNIQUE 约束 → SQLITE_CONSTRAINT +「该辩题已存在」', () => {
    const e = toApiError(new Error('UNIQUE constraint failed: topics.title'))
    expect(e.code).toBe('SQLITE_CONSTRAINT')
    expect(e.userMessage).toBe('该辩题已存在，请勿重复添加')
  })

  it('带错误码 SQLITE_CONSTRAINT_UNIQUE 的对象 → SQLITE_CONSTRAINT +「该辩题已存在」', () => {
    const raw = Object.assign(new Error('insert failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })
    const e = toApiError(raw)
    expect(e.code).toBe('SQLITE_CONSTRAINT')
    expect(e.userMessage).toBe('该辩题已存在，请勿重复添加')
  })

  it('数据库被锁定 → SQLITE_BUSY +「数据库正忙」', () => {
    const e = toApiError(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))
    expect(e.code).toBe('SQLITE_BUSY')
    expect(e.userMessage).toBe('数据库正忙，请稍后重试')
  })

  it('参数校验错误 → VALIDATION（userMessage 保持原中文）', () => {
    const e = toApiError(new Error('参数 teamId 必须为非空字符串'))
    expect(e.code).toBe('VALIDATION')
    expect(e.userMessage).toBe('参数 teamId 必须为非空字符串')
  })

  it('未找到记录 → NOT_FOUND', () => {
    const e = toApiError(new Error('No rows returned for topic: abc'))
    expect(e.code).toBe('NOT_FOUND')
    expect(e.userMessage).toContain('未找到指定记录')
  })

  it('PARTIAL_FAILURE AppError 实例 → 原样透传（code/userMessage 不变）', () => {
    const partial = new AppError('PARTIAL_FAILURE', 'raw', '部分操作未完全成功')
    const e = toApiError(partial)
    expect(e).toBe(partial)
    expect(e.code).toBe('PARTIAL_FAILURE')
    expect(e.userMessage).toBe('部分操作未完全成功')
  })

  it('未知错误 → UNKNOWN，userMessage 回退原始 message（兼容既有 error 字符串）', () => {
    const msg = 'some unexpected runtime error'
    const e = toApiError(new Error(msg))
    expect(e.code).toBe('UNKNOWN')
    expect(e.message).toBe(msg)
    expect(e.userMessage).toBe(msg)
  })

  it('非 Error 值（字符串）也能正常分类，回退原始串', () => {
    const e = toApiError('weird string')
    expect(e.code).toBe('UNKNOWN')
    expect(e.userMessage).toBe('weird string')
  })
})

describe('wrap：成功/失败返回不被破坏', () => {
  it('成功 → { success:true, data }', () => {
    expect(wrap(() => 42)).toEqual({ success: true, data: 42 })
  })

  it('已知约束失败 → error 保持 string 且 appError 附加 SQLITE_CONSTRAINT', () => {
    const res = wrap(() => {
      throw new Error('UNIQUE constraint failed: topics.title')
    }) as { success: boolean; error?: string; appError?: { code: string } }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error).toBe('该辩题已存在，请勿重复添加')
    expect(res.appError?.code).toBe('SQLITE_CONSTRAINT')
  })

  it('未知失败 → error 与原始 message 一致（回退），appError 为 UNKNOWN', () => {
    const msg = 'boom'
    const res = wrap(() => {
      throw new Error(msg)
    }) as { success: boolean; error?: string; appError?: { code: string; message: string } }
    expect(res.success).toBe(false)
    expect(res.error).toBe(msg)
    expect(res.appError?.code).toBe('UNKNOWN')
    expect(res.appError?.message).toBe(msg)
  })
})

describe('wrapWithUndo：成功透传 _undoLogId，失败结构化', () => {
  it('成功 → data + _undoLogId', () => {
    const res = wrapWithUndo(() => ({ result: { id: 'x' }, logId: 'log-1' }))
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ id: 'x' })
    expect(res._undoLogId).toBe('log-1')
  })

  it('失败 → success:false，error 为 string，appError 附加分类', () => {
    const res = wrapWithUndo(() => {
      throw new Error('database is locked')
    }) as { success: boolean; error?: string; appError?: { code: string } }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error).toBe('数据库正忙，请稍后重试')
    expect(res.appError?.code).toBe('SQLITE_BUSY')
  })
})