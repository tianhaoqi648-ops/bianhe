// ============================================================
// get-timer-state.tool.ts — Agent 工具：查询当前计时器状态（Week 2 Task 12.2）
//
// 提供给 LLM 的 function calling 工具，用于查询最近一次计时会话的状态：
//   - 无会话或最近会话已结束（finished）→ 返回 { active: false, message }
//   - 存在活动会话（idle/running/paused）→ 返回 { active: true, session, ... }
//
// 说明：timerSessionRepo 未提供 getCurrent/getActive 方法，使用
//   listRecent(1) 取按 created_at DESC 排序的最新一条会话作为"当前"会话。
// ============================================================

import { timerSessionRepo } from '../../db/repository/timer-session.repo'
import type { ToolDefinition } from '@shared/agent-types'

export const getTimerStateTool: ToolDefinition = {
  name: 'get_current_timer_state',
  description: '查询当前计时器状态（当前环节、剩余时间、运行状态等）。',
  parameters: {
    type: 'object',
    properties: {}
  },
  riskLevel: 'low',
  tier: 'read',
  async execute() {
    // 1. 查询最近一次计时会话
    const recent = timerSessionRepo.listRecent(1)
    const session = recent[0]

    // 2. 无会话或最近会话已结束 → 不抛错，返回非活动状态
    if (!session || session.status === 'finished') {
      return {
        active: false,
        message: session ? '最近一次计时会话已结束' : '当前无活动计时器会话'
      }
    }

    // 3. 有活动会话 → 返回完整状态
    //   附加 currentStageName 便于 LLM 直接引用当前环节名
    const stage = session.formatSnapshot.stages[session.currentStageIndex]
    return {
      active: true,
      session,
      currentStageName: stage?.name ?? null
    }
  }
}
