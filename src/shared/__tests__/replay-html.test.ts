// ============================================================
// replay-html.test.ts — 复盘 HTML 可视化导出模板测试（P2-9）
//
// 覆盖：
//   - buildJudgeReplayHtml：从 judge_match 结果组装 HTML，含五维雷达/逐环节/
//     胜负/最佳辩手/建议
//   - 素材不足（verdict===null）时不抛错，输出「素材不足」判定
//   - 用户内容 HTML 转义（防注入）
//   - 文件名清洗（非法字符替换为 _）
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildReplayHtml, buildJudgeReplayHtml } from '../replay-html'

const SAMPLE_RESULT = {
  judgeName: '攻防流',
  topic: '网络让人更亲近还是更疏远',
  verdict: { winner: 'aff', confidence: 0.82, reason: '正方立论完整、全场主线清晰' },
  dimensions: [
    { key: 'logic', name: '逻辑', affScore: 8, negScore: 6, comment: '正方论证严谨' },
    { key: 'expr', name: '表达', affScore: 7, negScore: 8, comment: '反方感染力更强' },
    { key: 'attack', name: '攻防', affScore: 9, negScore: 7, comment: '正方攻防更主动' }
  ],
  stageVerdicts: [
    { stage: 'opening', winner: 'aff', confidence: 0.75, comment: '正方立论更扎实' },
    { stage: 'cross_exam', winner: 'neg', confidence: 0.68, comment: '反方质询更犀利' }
  ],
  bestSpeaker: '正方三辩',
  summary: '本场正方整体占优，建议反方加强自由辩战场取舍。',
  insufficientReason: ''
}

describe('buildJudgeReplayHtml', () => {
  it('组装自包含 HTML，含五维雷达/逐环节/胜负/最佳辩手/建议', () => {
    const { content, defaultName } = buildJudgeReplayHtml(
      [
        { stage: 'opening', side: 'aff', speaker: '正方一辩', tsMs: 1200, content: '我方认为…' }
      ],
      SAMPLE_RESULT,
      '甲队',
      '乙队',
      '辩题标题'
    )
    expect(content).toContain('<!DOCTYPE html>')
    expect(content).toContain('<html')
    expect(content).toContain('</html>')
    // 评委/辩题/对阵
    expect(content).toContain('攻防流')
    expect(content).toContain('辩题标题')
    expect(content).toContain('甲队')
    expect(content).toContain('乙队')
    // 判定 + 置信度 + 最佳辩手
    expect(content).toContain('正方（甲队）')
    expect(content).toContain('置信度 82%')
    expect(content).toContain('正方三辩')
    // 内联 SVG 雷达图（复用 shared/radar-svg）
    expect(content).toContain('能力雷达图')
    expect(content).toContain('<svg ')
    // 五维评分 + 维度名
    expect(content).toContain('五维评分')
    expect(content).toContain('逻辑')
    expect(content).toContain('正方论证严谨')
    // 逐环节点评
    expect(content).toContain('逐环节点评')
    expect(content).toContain('立论')
    expect(content).toContain('质询')
    expect(content).toContain('正方立论更扎实')
    // 全场转写
    expect(content).toContain('全场转写')
    expect(content).toContain('我方认为…')
    // AI 建议
    expect(content).toContain('AI 建议与总结')
    expect(content).toContain('本场正方整体占优')
    // 默认文件名
    expect(defaultName).toContain('辩论复盘_甲队_vs_乙队_')
  })

  it('素材不足（verdict===null）时输出「素材不足」判定且不抛错', () => {
    const { content } = buildJudgeReplayHtml(
      [],
      { ...SAMPLE_RESULT, verdict: null, dimensions: [], stageVerdicts: [], bestSpeaker: null, summary: '', insufficientReason: '录音过短无法判定' },
      undefined,
      undefined,
      undefined
    )
    expect(content).toContain('素材不足，未判定')
    expect(content).toContain('录音过短无法判定')
    // 无维度时不应生成雷达图
    expect(content).not.toContain('能力雷达图')
  })

  it('用户内容被转义，避免注入 HTML', () => {
    const content = buildReplayHtml({
      topic: '<img src=x onerror=alert(1)>',
      affName: '正&方',
      dimensions: [
        { key: 'a', name: '维<度', affScore: 5, negScore: 5, comment: '评"语"<x>' }
      ]
    })
    expect(content).not.toContain('<img src=x onerror=alert(1)>')
    expect(content).toContain('&lt;img')
    expect(content).not.toContain('维<度')
    expect(content).toContain('评&quot;语&quot;&lt;x&gt;')
  })
})

describe('buildJudgeReplayHtml 默认文件名', () => {
  it('替换非法文件名字符', () => {
    const { defaultName } = buildJudgeReplayHtml([], SAMPLE_RESULT, '甲/:*?<>|队', '乙队')
    expect(defaultName).not.toContain('/')
    expect(defaultName).not.toContain(':')
    expect(defaultName).toContain('辩论复盘_甲')
  })
})