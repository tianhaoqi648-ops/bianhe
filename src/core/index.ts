// ============================================================
// core/index.ts — Bianhe Core 统一出口
//
// 显式命名 re-export 规避 export * 的跨模块同名歧义
// （DIFFICULTY_LEVELS / getDifficultyDistribution / DifficultyLevel / DifficultyDistribution
//  由 rules/draw/draw.ts 经 export * 携带；difficulty.ts 其余成员显式导出）。
// ============================================================

export * from './schema/topic'
export * from './schema/draw'
export * from './schema/match'
export * from './schema/backup'
export * from './schema/debate-format'

export { CANONICAL_DIFFICULTIES, DIFFICULTY_ROUND_PRESETS, normalizeDifficulty, roundNameToDifficulty } from './rules/difficulty'

// draw.ts 携带：DrawCandidate/DrawItem/InsufficientTopicsError/applyExclusionsByIds/
// applyDifficultyOverride/applySourceMixRatio/assign*Stances/drawFromPool/DrawPoolParams/DrawPoolOptions
// + coinFlip/weightedRandomSelect/weightedRandomSelectWithReplacement/applyDifficultyDistribution
// + getDifficultyDistribution/DIFFICULTY_LEVELS/DifficultyLevel/DifficultyDistribution
export * from './rules/draw/draw'

export * from './rules/match-result'
export * from './rules/timer-state'
export * from './rules/format-utils'
export * from './rules/stance-utils'

export * from './protocol/backup-protocol'
