// ============================================================
// core/rules/format-utils.ts — 赛制工具函数 + 计时主题默认值（Bianhe Core 单真源）
//
// 源：桌面 shared/debate-formats/utils.ts + 小程序 src/data/debate-formats/utils.ts（两端对齐）
//     + 两端 timer-theme-defaults.ts（逐字节同构）
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

import type { StageDef, StageSide, DebateFormatData, TimerTheme } from '../schema/debate-format'

/**
 * 解析环节初始发言方。
 * 自由辩论环节下，若 stage.side === 'both'，强制返回 'aff'，
 * 避免 currentSide='both' 导致 tick 中双方计时器同步逻辑不更新。
 * 非自由辩论环节，直接返回 stage.side。
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
 * 规则：无 weight 的环节记为 1；若全部环节均缺省 weight，则每项均为 1（等权）。
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
 * stage.speaker 非空则直接返回；否则按 side 兜底（neg→反方、both→双方、BP 四角色→''）。
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

/**
 * 计算某队伍的总时长池初始毫秒。
 * 优先 teamPoolMinutes（分钟×60000）；缺失/为 0 时回退为该队所有归属池环节的 poolSuggestedMs 之和；再否则 0。
 */
export function poolInitMs(format: DebateFormatData, team: 'aff' | 'neg'): number {
  const poolMin = format.teamPoolMinutes?.[team]
  if (typeof poolMin === 'number' && poolMin > 0) return poolMin * 60000
  const suggested = format.stages
    .filter((s) => s.poolTeam === team && typeof s.poolSuggestedMs === 'number')
    .reduce((sum, s) => sum + (s.poolSuggestedMs ?? 0), 0)
  return suggested
}

/** 默认主题：蓝红经典配色 + 正方/反方称谓 */
export const DEFAULT_TIMER_THEME: TimerTheme = {
  affLabel: '正方',
  negLabel: '反方',
  affColor: '#1677ff',
  negColor: '#ff4d4f',
  accentColor: '#1677ff'
}

/**
 * 将用户存储的主题与默认主题合并（浅合并，仅一层）。
 */
export function mergeTheme(stored: Partial<TimerTheme> | null | undefined): TimerTheme {
  if (!stored) return { ...DEFAULT_TIMER_THEME }
  return {
    ...DEFAULT_TIMER_THEME,
    ...stored
  }
}
