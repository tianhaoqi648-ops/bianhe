// ============================================================
// register-tools.ts — Agent 工具批量注册
//
// 提供 registerAllTools：在主进程启动时将 allTools 中的全部业务工具注册到 tool-registry。
//   - 基础工具（8）：题库搜索/详情/新建、抽取、赛事列表/新建、赛制、计时状态
//   - 赛事流程（4）：批量导入、赛制推荐、分组优化、赛程生成
//   - AI 裁判/陪练（7）：judge_debate、judge_match、judge_speech、coach_match、
//     detect_stage、simulate_opponent、judge_live
//   - 赛程与队徽（4）：export_event_schedule、import_event_schedule、list_badges、bind_team_badge
// 注册顺序与 tools/index.ts 中 allTools 数组顺序一致（共 23 个）。
// 幂等设计：多次调用安全，仅首次执行实际注册。
// resetToolRegistry 仅用于测试场景，清空注册中心并重置幂等标记。
// ============================================================

import { register, clear } from './tool-registry'
import { allTools } from './tools'

let registered = false

/** 注册全部 Agent 工具到 tool-registry（幂等，多次调用安全） */
export function registerAllTools(): void {
  if (registered) return
  for (const tool of allTools) {
    register(tool)
  }
  registered = true
  console.log(`[agent] Registered ${allTools.length} tools`)
}

/** 仅用于测试：清空并重置注册状态 */
export function resetToolRegistry(): void {
  clear()
  registered = false
}
