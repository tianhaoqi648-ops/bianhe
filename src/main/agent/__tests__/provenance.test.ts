// ============================================================
// provenance.test.ts — AI 评审 provenance 纯逻辑测试（governance Task 10）
// 覆盖：
//   - deterministicHash：确定性（同输入 → 同 hash）、区分性（不同输入 → 不同 hash）
//   - judgeProvenanceModeOf：工具名 → 评审模式
//   - buildJudgeProvenance：provider/model 注入、mode、inputHash、createdAt、temperature
// ============================================================

import { describe, it, expect } from 'vitest'
import type { LLMConfig } from '@shared/agent-types'
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_VERSION,
  buildJudgeProvenance,
  deterministicHash,
  judgeProvenanceModeOf
} from '../provenance'

const CONFIG: LLMConfig = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: 'sk',
  model: 'deepseek-chat'
}

describe('deterministicHash', () => {
  it('同输入恒产出同 hash（跨多次调用确定性）', () => {
    const a = deterministicHash('whole', '辩题', '辩词全文')
    const b = deterministicHash('whole', '辩题', '辩词全文')
    expect(a).toBe(b)
  })

  it('不同输入产出不同 hash', () => {
    expect(deterministicHash('whole', '辩题A', '稿')).not.toBe(
      deterministicHash('whole', '辩题B', '稿')
    )
    expect(deterministicHash('whole', '辩题', '稿A')).not.toBe(
      deterministicHash('whole', '辩题', '稿B')
    )
    expect(deterministicHash('whole', '辩题', '稿')).not.toBe(
      deterministicHash('stage', '辩题', '稿')
    )
  })

  it('输出固定 8 位十六进制', () => {
    const h = deterministicHash('live', '辩题', '上下文', '环节')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('judgeProvenanceModeOf', () => {
  it('全场裁决 → whole', () => {
    expect(judgeProvenanceModeOf('judge_debate')).toBe('whole')
    expect(judgeProvenanceModeOf('judge_match')).toBe('whole')
  })
  it('单方复盘 → stage', () => expect(judgeProvenanceModeOf('judge_speech')).toBe('stage'))
  it('整场教练复盘 → coach', () => expect(judgeProvenanceModeOf('coach_match')).toBe('coach'))
  it('实时对辩 → live', () => expect(judgeProvenanceModeOf('judge_live')).toBe('live'))
  it('未知工具 → other', () => {
    expect(judgeProvenanceModeOf('detect_stage')).toBe('other')
    expect(judgeProvenanceModeOf('simulate_opponent')).toBe('other')
  })
})

describe('buildJudgeProvenance', () => {
  it('注入 provider/model/版本/模式与 createdAt，temperature 缺省省略', () => {
    const p = buildJudgeProvenance({
      config: CONFIG,
      toolName: 'judge_match',
      topic: 'AI 是否拥有著作权',
      inputs: ['转写全文']
    })
    expect(p.provider).toBe('deepseek')
    expect(p.model).toBe('deepseek-chat')
    expect(p.promptVersion).toBe(JUDGE_PROMPT_VERSION)
    expect(p.judgeVersion).toBe(JUDGE_VERSION)
    expect(p.mode).toBe('whole')
    expect(p.inputHash).toMatch(/^[0-9a-f]{8}$/)
    expect(p.temperature).toBeUndefined()
    expect(new Date(p.createdAt).getTime()).not.toBeNaN()
  })

  it('评审模式由 toolName 推导；显式 mode 优先', () => {
    expect(buildJudgeProvenance({ toolName: 'coach_match', topic: 't' }).mode).toBe('coach')
    expect(buildJudgeProvenance({ toolName: 'judge_live', topic: 't' }).mode).toBe('live')
    expect(
      buildJudgeProvenance({ toolName: 'judge_debate', topic: 't', mode: 'stage' }).mode
    ).toBe('stage')
  })

  it('缺 config 时 provider/model 回落 unknown', () => {
    const p = buildJudgeProvenance({ toolName: 'judge_speech', topic: 't' })
    expect(p.provider).toBe('unknown')
    expect(p.model).toBe('unknown')
  })

  it('配置了 temperature 时写入', () => {
    const p = buildJudgeProvenance({ toolName: 'judge_debate', topic: 't', temperature: 0.7 })
    expect(p.temperature).toBe(0.7)
  })

  it('input hash 确定性：相同输入/模式 → 同 hash；材料变化 → 变', () => {
    const a = buildJudgeProvenance({
      config: CONFIG,
      toolName: 'judge_debate',
      topic: '辩题',
      inputs: ['正方稿', '反方稿']
    })
    const b = buildJudgeProvenance({
      config: CONFIG,
      toolName: 'judge_debate',
      topic: '辩题',
      inputs: ['正方稿', '反方稿']
    })
    expect(a.inputHash).toBe(b.inputHash)
    const c = buildJudgeProvenance({
      config: CONFIG,
      toolName: 'judge_debate',
      topic: '辩题',
      inputs: ['正方稿', '反方稿改']
    })
    expect(a.inputHash).not.toBe(c.inputHash)
  })
})