// ============================================================
// timer-bells.ts — 铃声触发逻辑
//
// 纯函数，无副作用。输入前一个状态和当前剩余时间，
// 返回需要触发的铃声列表。
// ============================================================

import type { BellDef, StageDef } from '../../../shared/types'

export interface BellCheckResult {
  bellsToPlay: BellDef[]
  newLastBellIndex: number
}

/**
 * 检查并返回需要触发的铃声
 *
 * H2 + L5 修复：强制按 atMs 降序排序（30s 在 0s 之前触发），
 * 避免用户升序定义（atMs: 0 → 30）导致 lastBellIndex 指向错误位置，
 * 30s 铃声永远不触发。
 *
 * 排序后 lastBellIndex 语义为"已触发的铃声数量"，
 * 因为降序后最大的 atMs 在前，触发条件 prevRemaining >= atMs && currentRemaining < atMs
 * 仍然满足单调性（已触发的不会再触发）。
 * P1-10 修复：原条件 prevRemaining > atMs 对起始铃声（atMs === durationMs）永不成立，
 * 因为 prevRemainingMs 最大值即 durationMs，不大于自身。改为 >= 后起始铃声可正常触发。
 *
 * @param stage 当前环节定义
 * @param prevRemainingMs 上一帧剩余毫秒
 * @param currentRemainingMs 当前剩余毫秒
 * @param lastBellIndex 上次已触发的铃响索引（基于排序后的数组）
 */
export function checkBells(
  stage: StageDef,
  prevRemainingMs: number,
  currentRemainingMs: number,
  lastBellIndex: number
): BellCheckResult {
  const bellsToPlay: BellDef[] = []
  let newIndex = lastBellIndex

  // 强制按 atMs 降序排序（30s 在 0s 之前触发），避免用户升序定义导致铃声不触发
  // 注意：每次调用都排序会有性能开销，但 bells 数组通常很小（<10），可接受
  const sortedBells = stage.bells.length > 0
    ? [...stage.bells].sort((a, b) => b.atMs - a.atMs)
    : []

  for (let i = lastBellIndex; i < sortedBells.length; i++) {
    const bell = sortedBells[i]
    if (currentRemainingMs <= bell.atMs && prevRemainingMs >= bell.atMs) {
      bellsToPlay.push(bell)
      newIndex = i + 1
    }
  }

  return { bellsToPlay, newLastBellIndex: newIndex }
}

/** 格式化毫秒为 mm:ss 显示 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
