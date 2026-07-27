// ============================================================
// debate-formats/types.ts — 赛制类型定义
//
// 抽出到独立文件避免 types.ts 循环依赖
// ============================================================

export type StageSide = 'aff' | 'neg' | 'both' | 'og' | 'oo' | 'cg' | 'co'

export interface BellDef {
  /** 触发时间点（剩余毫秒，0 = 时间到） */
  atMs: number
  sound: 'beep' | 'bell' | 'double_bell' | 'time_up'
}

export interface StageDef {
  id: string
  name: string
  side: StageSide
  durationMs: number
  graceMs?: number
  bells: BellDef[]
  isFreeDebate?: boolean
}

export interface DebateFormatData {
  stages: StageDef[]
  totalDurationMs: number
}
