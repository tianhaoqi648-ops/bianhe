// ============================================================
// debate-formats/utils.ts — 赛制相关工具函数（main/renderer 共用）
//
// 抽出到 shared 层，避免 main 进程为了使用 resolveInitialSide
// 而引用 renderer 模块（会破坏三层架构约束）。
// ============================================================

import type { StageDef, StageSide } from './types'

/**
 * 解析环节初始发言方。
 *
 * 自由辩论环节下，若 stage.side === 'both'，强制返回 'aff'，
 * 避免 currentSide='both' 导致 tick 中双方计时器同步逻辑不更新
 * （bug：总时长变 12 分钟）。
 *
 * 非自由辩论环节，直接返回 stage.side。
 *
 * 此函数同时被 main 进程（timer-session.repo.create）和
 * renderer 进程（useTimerEngine）使用，确保双方行为一致。
 */
export function resolveInitialSide(
  stage: Pick<StageDef, 'isFreeDebate' | 'side'> | undefined
): StageSide {
  if (!stage) return 'aff'
  if (stage.isFreeDebate && stage.side === 'both') return 'aff'
  return stage.side
}

/**
 * 计算各环节的归一化权重，供环节票累计与亮牌展示使用。
 *
 * 规则：无 weight 的环节记为 1；若全部环节均缺省 weight，则每项均为 1（等权）。
 * 若部分环节提供了自定义 weight，则保留该数值并写回 Record，供调用方按需归一化。
 */
export function normalizeStageWeights(
  stages: Array<{ id: string; weight?: number }>
): Record<string, number> {
  const hasAnyWeight = stages.some((s) => s.weight !== undefined)
  const result: Record<string, number> = {}
  for (const s of stages) {
    result[s.id] = hasAnyWeight ? (s.weight ?? 1) : 1
  }
  return result
}

/**
 * 返回该环节发言人的展示文案。
 * stage.speaker 非空则直接返回；否则按 side 兜底返回默认"正方/反方"（双方环节返回"双方"，BP 四角色返回空串）。
 */
export function stageSpeakerLabel(stage: { side?: string; speaker?: string; name?: string }): string {
  if (stage.speaker) return stage.speaker
  switch (stage.side) {
    case 'og':
    case 'oo':
    case 'cg':
    case 'co':
      return ''
    case 'neg':
      return '反方'
    case 'both':
      return '双方'
    case 'aff':
    default:
      return '正方'
  }
}
