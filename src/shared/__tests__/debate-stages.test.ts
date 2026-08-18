// ============================================================
// debate-stages.test.ts — 环节类型体系测试（AI 裁判功能演进 批1 2026-08-18）
//
// 覆盖：
//   - STAGE_DEFINITIONS 恰好六类、类型唯一、每类含评审要点/辩位/简介
//   - getStageDefinition 命中与未命中
//   - mapStageNameToType：六类关键词命中、未命中返回 undefined
//   - 映射覆盖现有赛制预设的常见环节名（来自 stage-presets / format-templates）
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  STAGE_DEFINITIONS,
  getStageDefinition,
  mapStageNameToType
} from '../debate-stages'

describe('环节类型体系结构', () => {
  it('恰好六类，类型唯一', () => {
    expect(STAGE_DEFINITIONS).toHaveLength(6)
    const types = STAGE_DEFINITIONS.map((s) => s.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('每类含非空简介、评审要点与辩位', () => {
    for (const s of STAGE_DEFINITIONS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.keyPoints.length).toBeGreaterThan(0)
      expect(s.typicalRoles.length).toBeGreaterThan(0)
    }
  })

  it('getStageDefinition：命中与未命中', () => {
    expect(getStageDefinition('opening')?.name).toBe('立论')
    expect(getStageDefinition('closing')?.name).toBe('总结陈词')
    expect(getStageDefinition('not-a-stage' as never)).toBeUndefined()
    expect(getStageDefinition(undefined)).toBeUndefined()
  })
})

describe('mapStageNameToType 关键词映射', () => {
  it('立论类命中', () => {
    expect(mapStageNameToType('正方一辩陈词')).toBe('opening')
    expect(mapStageNameToType('开篇立论')).toBe('opening')
    expect(mapStageNameToType('立论')).toBe('opening')
    expect(mapStageNameToType('申论')).toBe('opening')
    expect(mapStageNameToType('首相发言（OG）')).toBe('opening')
  })

  it('驳论类命中', () => {
    expect(mapStageNameToType('反方驳论')).toBe('rebuttal')
    expect(mapStageNameToType('反驳')).toBe('rebuttal')
    expect(mapStageNameToType('上院反驳')).toBe('rebuttal')
  })

  it('质询类命中（含优先于小结的顺序）', () => {
    expect(mapStageNameToType('质询小结')).toBe('cross_summary')
    expect(mapStageNameToType('攻辩小结')).toBe('cross_summary')
    expect(mapStageNameToType('正方质询反方一辩')).toBe('cross_exam')
    expect(mapStageNameToType('攻辩')).toBe('cross_exam')
    expect(mapStageNameToType('答辩')).toBe('cross_exam')
  })

  it('自由辩论与总结陈词命中', () => {
    expect(mapStageNameToType('正方自由辩论')).toBe('free_debate')
    expect(mapStageNameToType('自由辩论')).toBe('free_debate')
    expect(mapStageNameToType('总结陈词')).toBe('closing')
    expect(mapStageNameToType('反方四辩总结')).toBe('closing')
    expect(mapStageNameToType('结辩')).toBe('closing')
  })

  it('未命中返回 undefined', () => {
    expect(mapStageNameToType('休息')).toBeUndefined()
    expect(mapStageNameToType('评委提问')).toBeUndefined()
    expect(mapStageNameToType('')).toBeUndefined()
    expect(mapStageNameToType(undefined)).toBeUndefined()
  })

  it('覆盖现有赛制预设全部环节名', () => {
    // 与 src/renderer/src/data/stage-presets.ts / format-templates.ts 实际环节名对齐
    const presetNames = [
      '正方一辩陈词', '反方一辩陈词', '正方立论', '反方立论', '开篇立论', '陈词', '申论',
      '正方质询', '反方质询', '正方质询反方一辩', '反方质询正方一辩', '质询', '攻辩', '答辩',
      '质询小结', '攻辩小结',
      '反方驳论', '反驳', '上院反驳', '下院反驳',
      '正方自由辩论', '反方自由辩论', '自由辩论',
      '正方四辩总结', '反方四辩总结', '总结陈词', '正方总结', '反方总结', '结辩',
      '首相发言（OG）', '副首相发言（CG）', '领袖反对（OO）', '副领袖反对（CO）'
    ]
    for (const name of presetNames) {
      expect(mapStageNameToType(name), `环节名「${name}」应能映射`).toBeDefined()
    }
  })
})
