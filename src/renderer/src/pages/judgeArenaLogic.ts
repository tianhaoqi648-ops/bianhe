// ============================================================
// judgeArenaLogic.ts — AI 裁判工作台按钮启用逻辑（2026-08-18）
//
// 纯函数：根据表单状态计算可执行的操作（按钮启用矩阵），
// 供 JudgeArena 页面与单测复用（不依赖 jsdom）。
// ============================================================

import type { DebaterRole } from '../../../shared/ai-judges'

/** 裁判工作台表单状态（页面 state 的投影） */
export interface JudgeArenaFormState {
  /** 辩题（非空才可执行） */
  topic: string
  /** 环节类型（六类之一；judge_speech/rewrite_speech 需要） */
  stage: string | undefined
  /** 当前选中立场（决定使用哪份稿子） */
  side: 'aff' | 'neg'
  /** 正方稿 */
  affSpeech: string
  /** 反方稿 */
  negSpeech: string
  /** 是否已配置 API Key（未配置时全部禁用） */
  apiKeyConfigured: boolean
}

/** 可执行的操作 */
export type JudgeAction =
  | 'judge_speech'
  | 'simulate_opponent'
  | 'judge_debate'
  | 'detect_stage'

/**
 * JudgeAction → 工作台三角色（2026-08-23）。
 *   judge_debate     → judge   裁判（双方评审）
 *   simulate_opponent→ sparring 陪练（回合制对练）
 *   judge_speech     → coach    复盘（教练诊断）
 *   detect_stage     → 辅助工具，不属于三角色主流程（返回 undefined）
 */
const ACTION_TO_ROLE: Partial<Record<JudgeAction, DebaterRole>> = {
  judge_debate: 'judge',
  simulate_opponent: 'sparring',
  judge_speech: 'coach'
}

/** 由操作推导工作台角色；detect_stage 等辅助操作返回 undefined。 */
export function roleOfAction(action: JudgeAction): DebaterRole | undefined {
  return ACTION_TO_ROLE[action]
}

/** 当前选中立场的稿子（judge_speech/simulate_opponent 用） */
export function currentSpeech(s: JudgeArenaFormState): string {
  return s.side === 'aff' ? s.affSpeech : s.negSpeech
}

/**
 * 计算当前表单状态下可执行的操作。
 * 规则：
 *   - 未配置 API Key → 全部禁用
 *   - judge_speech：topic + stage + 当前立场稿子
 *   - simulate_opponent：topic + 当前立场稿子
 *   - judge_debate：topic + 双稿均非空
 *   - detect_stage：当前立场稿子（识别环节回填用）
 */
export function getAvailableActions(s: JudgeArenaFormState): JudgeAction[] {
  if (!s.apiKeyConfigured) return []

  const actions: JudgeAction[] = []
  const hasTopic = s.topic.trim() !== ''
  const speech = currentSpeech(s)
  const hasSpeech = speech.trim() !== ''
  const hasStage = !!s.stage

  if (hasTopic && hasSpeech && hasStage) {
    actions.push('judge_speech')
  }
  if (hasTopic && hasSpeech) {
    actions.push('simulate_opponent')
  }
  if (hasTopic && s.affSpeech.trim() !== '' && s.negSpeech.trim() !== '') {
    actions.push('judge_debate')
  }
  if (hasSpeech) {
    actions.push('detect_stage')
  }
  return actions
}
