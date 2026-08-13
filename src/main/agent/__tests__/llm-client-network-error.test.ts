// ============================================================
// llm-client-network-error.test.ts — wrapNetworkError 单元测试
//
// 覆盖 Task 3 增强后的 wrapNetworkError 行为：
//   - TypeError + cause（Error 实例）：保留 cause.message
//   - TypeError + cause（带 message 的对象）：保留 cause.message
//   - TypeError 无 cause：回退到 err.message
//   - AbortError 原样抛出（不视为错误）
//   - LLMError 原样返回
//   - 其他错误包装为 unknown
//   - LLMError network 错误信息可包含原始细节
// ============================================================

import { describe, it, expect } from 'vitest'
import { LLMError, wrapNetworkError } from '../llm-client'

describe('wrapNetworkError', () => {
  it('TypeError + cause 为 Error 实例时保留 cause.message', () => {
    const cause = new Error('getaddrinfo ENOTFOUND api.deepseek.com')
    const err = new TypeError('fetch failed')
    ;(err as { cause?: unknown }).cause = cause

    const result = wrapNetworkError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.code).toBe('network')
    expect(result.message).toBe('网络连接失败：getaddrinfo ENOTFOUND api.deepseek.com')
  })

  it('TypeError + cause 为带 message 的对象时保留 cause.message', () => {
    const err = new TypeError('fetch failed')
    ;(err as { cause?: unknown }).cause = {
      message: 'unable to verify the first certificate'
    }

    const result = wrapNetworkError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.code).toBe('network')
    expect(result.message).toBe('网络连接失败：unable to verify the first certificate')
  })

  it('TypeError 无 cause 时回退到 err.message', () => {
    const err = new TypeError('load failed')

    const result = wrapNetworkError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.code).toBe('network')
    expect(result.message).toBe('网络连接失败：load failed')
  })

  it('AbortError 原样抛出（不视为错误）', () => {
    const err = new DOMException('The user aborted a request', 'AbortError')
    expect(() => wrapNetworkError(err)).toThrow(err)
  })

  it('LLMError 原样返回', () => {
    const original = new LLMError('rate_limit', '请求过于频繁，请稍后重试', 429)
    const result = wrapNetworkError(original)
    expect(result).toBe(original)
  })

  it('其他 Error 包装为 unknown 并保留 message', () => {
    const err = new Error('something went wrong')
    const result = wrapNetworkError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.code).toBe('unknown')
    expect(result.message).toBe('something went wrong')
  })

  it('非 Error 值包装为 unknown 并用 String 转换', () => {
    const result = wrapNetworkError('plain string error')
    expect(result).toBeInstanceOf(LLMError)
    expect(result.code).toBe('unknown')
    expect(result.message).toBe('plain string error')
  })
})

describe('LLMError network 错误信息', () => {
  it('LLMError network 包含原始错误细节', () => {
    const err = new LLMError('network', '网络连接失败：getaddrinfo ENOTFOUND api.deepseek.com')
    expect(err.code).toBe('network')
    expect(err.message).toContain('getaddrinfo ENOTFOUND')
    expect(err.message).toContain('网络连接失败')
  })

  it('LLMError network SSL 错误', () => {
    const err = new LLMError('network', '网络连接失败：unable to verify the first certificate')
    expect(err.code).toBe('network')
    expect(err.message).toContain('unable to verify the first certificate')
  })
})
