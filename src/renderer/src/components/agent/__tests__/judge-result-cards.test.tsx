// ============================================================
// judge-result-cards.test.tsx — AI 裁判结果卡片兜底渲染测试
//
// 覆盖：未知 toolName → 渲染通用兜底（返回非 null）；judge_live
// 对辩轮次（live_turn）→ 渲染对方发言卡片（返回非 null）。
// ============================================================

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JudgeResultCardByTool, CoachMatchCard } from '../judge-result-cards'

describe('JudgeResultCardByTool 兜底渲染', () => {
  it('未知 toolName → 渲染通用兜底，返回非 null 且有内容', () => {
    const result = { foo: 'bar', mode: 'unknown_mode' }
    const el = JudgeResultCardByTool({ toolName: 'some_unknown_tool', result })
    expect(el).not.toBeNull()

    const html = renderToStaticMarkup(el as JSX.Element)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('原始结果')
    expect(html).toContain('bar')
  })

  it('judge_live 对辩轮次（live_turn）→ 渲染对方发言卡片，返回非 null 且有内容', () => {
    const result = {
      success: true,
      mode: 'live_turn',
      role: 'opponent',
      phase: 'crossfire',
      speech: '你的判准为何要成立？',
      nextRounds: [
        { phase: 'constructive', opponent: '开场立论', userReply: '我的回应' }
      ],
      judgeId: 'hu-jianbiao',
      topic: '人工智能应否用于司法审判',
      side: 'neg',
      difficulty: 'intermediate',
      roundIndex: 2
    }
    const el = JudgeResultCardByTool({ toolName: 'judge_live', result })
    expect(el).not.toBeNull()

    const html = renderToStaticMarkup(el as JSX.Element)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('你的判准为何要成立？')
    expect(html).toContain('你的回应：我的回应')
  })
})

describe('CoachMatchCard 渲染', () => {
  it('按环节展示四维短板，并展示整场汇总', () => {
    const result = {
      judgeId: 'hu-jianbiao',
      judgeName: '攻防流',
      topic: '网络让人更亲近还是更疏远',
      side: 'aff' as const,
      stageReviews: [
        {
          stage: 'opening',
          stageName: '立论',
          shortboards: [
            { area: '立论' as const, point: '判准没论证', practiceHint: '补判准论证' },
            { area: '攻防' as const, point: '防守偏弱', practiceHint: '备防守卡' }
          ],
          practiceDirections: ['打磨判准'],
          rewriteExample: '',
          summary: '立论部分可以更强。'
        }
      ],
      summary: '整场而言，质询环节防守偏弱。'
    }
    const el = <CoachMatchCard result={result} />
    expect(el).not.toBeNull()
    const html = renderToStaticMarkup(el as JSX.Element)
    expect(html).toContain('整场分环节复盘')
    expect(html).toContain('立论')
    expect(html).toContain('判准没论证')
    expect(html).toContain('整场汇总')
    expect(html).toContain('质询环节防守偏弱')
  })
})