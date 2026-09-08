// ============================================================
// core/rules/difficulty.ts — 难度语义统一（Bianhe Core 单真源）
//
// 源：小程序 cloud/functions/common/pure/difficulty.js（Phase 7.2，与桌面语义对齐）
// 规范档：入门 / 进阶 / 专业（引擎内部划档）
// 标签等价：入门级≡入门，进阶级≡进阶，专业级≡专业，大师级→专业
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

/** 规范档（引擎内部划档） */
export const CANONICAL_DIFFICULTIES = ['入门', '进阶', '专业'] as const
export type DifficultyLevel = (typeof CANONICAL_DIFFICULTIES)[number]

/** 难度分布比例（规范档键），三项之和应为 1 */
export interface DifficultyDistribution {
  入门: number
  进阶: number
  专业: number
}

/** DIFFICULTY_LEVELS 别名（与 CANONICAL_DIFFICULTIES 同值，兼容旧消费方） */
export const DIFFICULTY_LEVELS = CANONICAL_DIFFICULTIES

/** 轮次难度预设（镜像桌面 DIFFICULTY_PRESETS 的 standard/compact/extended，规范档） */
export const DIFFICULTY_ROUND_PRESETS = [
  {
    key: 'standard',
    label: '标准赛制（分组赛→复赛→决赛）',
    presets: [
      { name: '分组赛', difficulty: '入门' },
      { name: '复赛', difficulty: '进阶' },
      { name: '决赛', difficulty: '专业' }
    ]
  },
  {
    key: 'compact',
    label: '紧凑赛制（初赛→决赛）',
    presets: [
      { name: '初赛', difficulty: '入门' },
      { name: '决赛', difficulty: '进阶' }
    ]
  },
  {
    key: 'extended',
    label: '长赛制（小组赛→淘汰赛→半决赛→决赛）',
    presets: [
      { name: '小组赛', difficulty: '入门' },
      { name: '淘汰赛', difficulty: '入门' },
      { name: '半决赛', difficulty: '进阶' },
      { name: '决赛', difficulty: '专业' }
    ]
  }
]

/** 标签 → 规范档；未知/缺失 → null */
export function normalizeDifficulty(v: unknown): DifficultyLevel | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '入门' || s === '入门级') return '入门'
  if (s === '进阶' || s === '进阶级') return '进阶'
  if (s === '专业' || s === '专业级' || s === '大师级') return '专业'
  return null
}

/**
 * 按预设表（preset 上下文）取轮次 → 规范档。
 * 注意：`决赛` 在不同 preset 下档位不同（standard=专业 / compact=进阶 / extended=专业），
 * 因此必须给 preset 上下文，避免“名称相似误当语义相同”。
 */
export function roundNameToDifficulty(name: unknown, presetKey: unknown): DifficultyLevel | null {
  if (!name || !presetKey) return null
  const n = String(name).trim()
  const preset = DIFFICULTY_ROUND_PRESETS.find((p) => p.key === presetKey)
  if (!preset) return null
  const row = preset.presets.find((r) => r.name === n)
  return row ? (row.difficulty as DifficultyLevel) : null
}

/**
 * 轮次名 → 规范档分布（比例与桌面 getDifficultyDistribution 一致）。
 * 关键词：小组/分组/初赛→入门偏；复赛/淘汰/半决赛→进阶偏；决赛/总决赛/冠军→专业。
 */
export function getDifficultyDistribution(roundName: unknown): DifficultyDistribution {
  if (!roundName) return { 入门: 0.34, 进阶: 0.33, 专业: 0.33 }
  const name = String(roundName).toLowerCase()
  if (name.includes('小组') || name.includes('分组') || name.includes('初赛')) {
    return { 入门: 0.6, 进阶: 0.4, 专业: 0 }
  }
  if (name.includes('复赛') || name.includes('淘汰') || name.includes('半决赛')) {
    return { 入门: 0, 进阶: 0.6, 专业: 0.4 }
  }
  if (name.includes('决赛') || name.includes('总决赛') || name.includes('冠军')) {
    return { 入门: 0, 进阶: 0, 专业: 1 }
  }
  return { 入门: 0.34, 进阶: 0.33, 专业: 0.33 }
}
