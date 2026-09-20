import { describe, expect, it } from 'vitest'
import { resolveErrorMessage } from '../errorMessage'

describe('resolveErrorMessage', () => {
  it('AppError 形状（userMessage）优先于 message', () => {
    const err = {
      name: 'AppError',
      code: 'SQLITE_CONSTRAINT',
      userMessage: '该辩题已存在，请勿重复添加',
      message: 'UNIQUE constraint failed: topics.title'
    }
    expect(resolveErrorMessage(err, '保存失败')).toBe('该辩题已存在，请勿重复添加')
  })

  it('ApiResponse 失败形状（error 字段，已是主进程 userMessage）', () => {
    expect(resolveErrorMessage({ success: false, error: '数据存在关联引用，无法执行此操作' }, '删除失败'))
      .toBe('数据存在关联引用，无法执行此操作')
  })

  it('userMessage 为空串时回退 ApiResponse.error', () => {
    expect(resolveErrorMessage({ userMessage: '', error: '文件操作失败' }, 'X失败')).toBe('文件操作失败')
  })

  it('普通 Error 使用 message（IPC 链约定：已是 userMessage）', () => {
    expect(resolveErrorMessage(new Error('队伍名称已存在'), '保存失败')).toBe('队伍名称已存在')
  })

  it('空消息 Error 回退 fallback（不透传空串）', () => {
    expect(resolveErrorMessage(new Error(''), '保存失败')).toBe('保存失败')
    const blank = new Error('   ')
    expect(resolveErrorMessage(blank, '保存失败')).toBe('保存失败')
  })

  it('unknown（非 Error / 非对象）回退 fallback，不产生 String(e) 技术串', () => {
    expect(resolveErrorMessage(undefined, '转写失败')).toBe('转写失败')
    expect(resolveErrorMessage(null, '转写失败')).toBe('转写失败')
    expect(resolveErrorMessage(42, '转写失败')).toBe('转写失败')
    expect(resolveErrorMessage({ code: 'EACCES' }, '读取失败')).toBe('读取失败')
  })

  it('纯字符串错误原样透出（内部已保证可读性的调用点）', () => {
    expect(resolveErrorMessage('网络连接失败', '操作失败')).toBe('网络连接失败')
  })

  it('空白字符串错误回退 fallback', () => {
    expect(resolveErrorMessage('   ', '操作失败')).toBe('操作失败')
  })
})
