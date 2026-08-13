// ============================================================
// llm-client-validate-config.test.ts — validateConfig 单元测试
//
// 覆盖 Task 2 新增的 validateConfig 函数：
//   - 合法配置返回 valid=true
//   - apiKey 为空 / 仅空格 → no_api_key
//   - baseURL 缺协议头 → invalid_baseURL
//   - http:// 开头合法
//   - model 为空 / 仅空格 → invalid_model
// ============================================================

import { describe, it, expect } from 'vitest'
import { validateConfig } from '../llm-client'
import type { LLMConfig } from '@shared/agent-types'

describe('validateConfig', () => {
  const validConfig: LLMConfig = {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-key',
    model: 'deepseek-chat'
  }

  it('合法配置返回 valid=true', () => {
    expect(validateConfig(validConfig)).toEqual({ valid: true })
  })

  it('apiKey 为空返回 no_api_key', () => {
    expect(validateConfig({ ...validConfig, apiKey: '' })).toEqual({
      valid: false,
      code: 'no_api_key',
      message: '请先填写 API Key'
    })
  })

  it('apiKey 仅空格返回 no_api_key', () => {
    expect(validateConfig({ ...validConfig, apiKey: '   ' })).toEqual({
      valid: false,
      code: 'no_api_key',
      message: '请先填写 API Key'
    })
  })

  it('baseURL 缺少协议头返回 invalid_baseURL', () => {
    expect(validateConfig({ ...validConfig, baseURL: 'api.deepseek.com/v1' })).toEqual({
      valid: false,
      code: 'invalid_baseURL',
      message: 'baseURL 必须以 http:// 或 https:// 开头'
    })
  })

  it('baseURL 为 http:// 开头合法', () => {
    expect(validateConfig({ ...validConfig, baseURL: 'http://localhost:8080/v1' })).toEqual({
      valid: true
    })
  })

  it('model 为空返回 invalid_model', () => {
    expect(validateConfig({ ...validConfig, model: '' })).toEqual({
      valid: false,
      code: 'invalid_model',
      message: '请填写模型名'
    })
  })

  it('model 仅空格返回 invalid_model', () => {
    expect(validateConfig({ ...validConfig, model: '  ' })).toEqual({
      valid: false,
      code: 'invalid_model',
      message: '请填写模型名'
    })
  })
})
