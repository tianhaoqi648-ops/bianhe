// ============================================================
// core/schema/match.ts — 比赛评决 schema（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/types.ts L700-704 + L754-792 + L941-950（评决子集）
// 【双源登记】与 shared/types.ts 同名类型结构一致、独立声明；改动需同步两处。
// 铁律：零外部 import（仅 core 内部）。
// 注：不包含 Match 完整实体（L845-894 含录音/AI，属排除范围）。
// ============================================================

/** 比赛状态机 */
export type MatchStatus = 'planned' | 'resulted'

/** 赛果（人工评审权威）：aff 正方胜 / neg 反方胜 / draw 平 / abandoned 弃赛 */
export const MatchWinner = { AFF: 'aff', NEG: 'neg', DRAW: 'draw', ABANDONED: 'abandoned' } as const
export type MatchWinner = (typeof MatchWinner)[keyof typeof MatchWinner]

/** 评决制度：三票制（印象/环节/决胜） 或 百分制（可切换，用户决策） */
export const MatchJudgeSystem = { THREE_VOTES: 'three_votes', PERCENTAGE: 'percentage' } as const
export type MatchJudgeSystem = (typeof MatchJudgeSystem)[keyof typeof MatchJudgeSystem]

/** 单环节评分（环节加权可配置，缺省等权） */
export interface MatchStageScore {
  stageId: string
  stageName: string
  weight: number
  aff: number
  neg: number
}

/** 裁判 */
export interface MatchJudge {
  id: string
  matchId: string
  name: string
  sortOrder: number
  isAi: boolean
  createdAt: string
}

/** 裁判评决（每裁判每场一条） */
export interface MatchJudgeVote {
  id: string
  matchId: string
  judgeId: string
  judgeSystem: MatchJudgeSystem
  /** 印象票：aff/neg（三票制） */
  impressionVote: 'aff' | 'neg' | null
  /** 决胜票：aff/neg（三票制） */
  decisionVote: 'aff' | 'neg' | null
  /** 正方/反方得分：三票制=环节加权累计；百分制=直接分 */
  affTotal: number | null
  negTotal: number | null
  /** 环节明细 */
  stageScores: MatchStageScore[] | null
  /** 该裁判投出的最佳辩手 */
  bestSpeaker: string | null
  comment: string | null
  createdAt: string
  updatedAt: string
}

/** 单裁判评决入参 */
export interface MatchJudgeVoteInput {
  judgeSystem?: MatchJudgeSystem
  impressionVote?: 'aff' | 'neg' | null
  decisionVote?: 'aff' | 'neg' | null
  affTotal?: number | null
  negTotal?: number | null
  stageScores?: MatchStageScore[] | null
  bestSpeaker?: string | null
  comment?: string | null
}
