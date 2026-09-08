// ============================================================
// difficulty-presets.ts — 难度梯度一键预设方案（兼容 shim）
//
// 唯一真源：Bianhe Core `@core/rules/difficulty` 的 DIFFICULTY_ROUND_PRESETS。
// 本文件不再独立声明第二份 mapping：DIFFICULTY_PRESETS 从 Core 推导，
// 仅把「规范档(入门/进阶/专业) → 桌面 label 态(入门级/进阶级/专业级)」作为
// Desktop 展示层适配（label 态是已存 round.difficulty_override 的刻画，非 Core 规则）。
// DIFFICULTY_OPTIONS 含「大师级」，为 Desktop UI Select 选项，不进 Core。
// ============================================================
import type { DifficultyLevel } from '@core/rules/difficulty'
import { DIFFICULTY_ROUND_PRESETS } from '@core/rules/difficulty'

export interface DifficultyPresetRound {
  name: string
  round_number: number
  difficulty_override: string
}

export interface DifficultyPreset {
  key: string
  label: string
  presets: DifficultyPresetRound[]
}

/** Desktop 展示层适配：规范档 → label 态（仅桌面/已存数据的刻画，非 Core 规则） */
const LEVEL_TO_LABEL: Record<DifficultyLevel, string> = {
  入门: '入门级',
  进阶: '进阶级',
  专业: '专业级',
}

/** 难度梯度一键预设方案（从 Core DIFFICULTY_ROUND_PRESETS 推导，与历史值逐项等值） */
export const DIFFICULTY_PRESETS: DifficultyPreset[] = DIFFICULTY_ROUND_PRESETS.map((p) => ({
  key: p.key,
  label: p.label,
  presets: p.presets.map((r, i) => ({
    name: r.name,
    round_number: i + 1,
    difficulty_override: LEVEL_TO_LABEL[r.difficulty as DifficultyLevel] ?? r.difficulty,
  })),
}))

/** 难度可选项（用于 Select 下拉；Desktop UI 选项，含大师级） */
export const DIFFICULTY_OPTIONS = ['入门级', '进阶级', '专业级', '大师级']
