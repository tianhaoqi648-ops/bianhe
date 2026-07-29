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
