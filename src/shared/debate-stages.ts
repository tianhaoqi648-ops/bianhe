// ============================================================
// debate-stages.ts — 辩论环节类型体系（AI 裁判功能演进 2026-08-18）
//
// 职责：
//   1. 定义六类通用环节类型（覆盖主流赛制：世锦赛/世界杯/新国辩/奥瑞冈/英式/BP）
//   2. 每类环节的评审要点（供 judge_speech 等工具注入 prompt）
//   3. mapStageNameToType：把赛制预设的环节名（StageDef.name）映射到环节类型
//
// 设计说明：
//   - 环节名 → 类型用**关键词纯函数**映射（零成本第一层），未命中才交
//     LLM 识别（detect_stage 工具）或用户手动选择
//   - 映射结果仅作 hint：工具入参允许显式传 stage 覆盖
//   - 奥瑞冈的"申论/答辩"语义有歧义（申论含驳论、答辩是质询应答方），
//     故关键词表按最常见的赛制语境归类，不确定的名字宁可不映射（返回 undefined）
// ============================================================

/** 六类通用环节类型 */
export type DebateStageType =
  | 'opening' // 立论 / 开篇立论 / 一辩申论
  | 'rebuttal' // 驳论 / 反驳
  | 'cross_exam' // 质询 / 攻辩 / 对辩 / 答辩（问答攻防）
  | 'cross_summary' // 质询小结 / 攻辩小结
  | 'free_debate' // 自由辩论
  | 'closing' // 总结陈词 / 结辩 / 四辩总结

/** 环节定义（评审要点 / 适配辩位 / 简介） */
export interface StageDefinition {
  type: DebateStageType
  /** 展示名 */
  name: string
  /** 一句话简介（工具描述用） */
  description: string
  /** 评审要点（注入 judge_speech prompt） */
  keyPoints: string[]
  /** 常见适配辩位 */
  typicalRoles: string[]
}

/** 六类环节定义集合 */
export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    type: 'opening',
    name: '立论',
    description: '开篇立论陈词，确立立场、判准与论点框架',
    keyPoints: [
      '立场与判准是否明确',
      '论点框架的层次与逻辑自洽',
      '定义是否严谨、有无偷换',
      '创新性与知识增量'
    ],
    typicalRoles: ['一辩']
  },
  {
    type: 'rebuttal',
    name: '驳论',
    description: '针对对方立论/论证的反驳与拆解',
    keyPoints: [
      '是否精准命中对方论证漏洞',
      '拆解是否有逻辑依据而非情绪否定',
      '是否与己方立论重复（应补证或反击）',
      '是否预判并处理对方可能的回应'
    ],
    typicalRoles: ['二辩', '三辩']
  },
  {
    type: 'cross_exam',
    name: '质询',
    description: '质询/攻辩/对辩环节的问答攻防',
    keyPoints: [
      '提问是否简明击中要害、追问是否连贯',
      '能否识别并拆解对方的回避',
      '答辩是否正面回应、有无漏答失分',
      '攻防节奏与战场控制'
    ],
    typicalRoles: ['三辩', '二辩', '四辩']
  },
  {
    type: 'cross_summary',
    name: '质询小结',
    description: '质询/攻辩环节后的小结，复盘观点、锁定漏洞',
    keyPoints: [
      '是否准确复盘双方交锋',
      '能否指明对方漏洞并强化己方',
      '小结是否与质询实况脱节'
    ],
    typicalRoles: ['三辩']
  },
  {
    type: 'free_debate',
    name: '自由辩论',
    description: '自由辩论环节的攻防转换与团队配合',
    keyPoints: [
      '攻防转换是否流畅、主线是否拉牢',
      '发言是否均衡、简洁、不重复',
      '团队配合与战场取舍',
      '能否抢回失守阵地'
    ],
    typicalRoles: ['全队']
  },
  {
    type: 'closing',
    name: '总结陈词',
    description: '四辩总结陈词，梳理全场争议、价值升华',
    keyPoints: [
      '是否梳理全场争议焦点',
      '能否回应全场核心问题',
      '价值升华是否有感染力与高度',
      '是否背稿脱节、脱离实况'
    ],
    typicalRoles: ['四辩']
  }
]

/** 按类型取环节定义（内部索引，避免重复 find） */
const stageByType = new Map<DebateStageType, StageDefinition>(
  STAGE_DEFINITIONS.map((s) => [s.type, s])
)

/**
 * 按类型取环节定义；未知类型返回 undefined。
 */
export function getStageDefinition(type: DebateStageType | undefined): StageDefinition | undefined {
  if (!type) return undefined
  return stageByType.get(type)
}

/**
 * 环节名 → 类型关键词映射表。
 * 顺序即优先级：更具体的词（如"质询小结"）必须排在宽泛词（"质询"）之前。
 * 覆盖现有赛制预设的全部环节名（stage-presets.ts / format-templates.ts）。
 */
const STAGE_NAME_KEYWORDS: Array<{ type: DebateStageType; keywords: string[] }> = [
  { type: 'cross_summary', keywords: ['质询小结', '攻辩小结'] },
  // closing 须在 opening 之前：'总结陈词' 含 '陈词'，会被 opening 的宽泛关键词抢走
  { type: 'closing', keywords: ['总结陈词', '四辩总结', '总结', '结辩'] },
  { type: 'opening', keywords: ['开篇立论', '立论', '陈词', '申论', '首相发言', '副首相发言', '领袖反对', '副领袖反对', '政府申论'] },
  { type: 'rebuttal', keywords: ['驳论', '反驳'] },
  { type: 'cross_exam', keywords: ['质询', '攻辩', '答辩', '对辩'] },
  { type: 'free_debate', keywords: ['自由辩论'] }
]

/**
 * 将赛制环节名（StageDef.name）映射为环节类型。
 * - 纯函数、零成本；关键词 includes 匹配
 * - 未命中返回 undefined（调用方交 LLM 识别或用户选择）
 */
export function mapStageNameToType(name: string | undefined): DebateStageType | undefined {
  if (!name) return undefined
  const n = name.trim()
  if (n === '') return undefined
  for (const { type, keywords } of STAGE_NAME_KEYWORDS) {
    if (keywords.some((k) => n.includes(k))) {
      return type
    }
  }
  return undefined
}
