// ============================================================
// register-tools.ts — Agent 工具批量注册（AI Agent v1.3.0 Week 2 Task 13.2 / Week 6 Task 39）
//
// 提供 registerAllTools：在主进程启动时将 12 个业务工具注册到 tool-registry。
//   - 8 个基础工具（Week 2 Task 13.1）：题库 / 抽取 / 赛事 / 赛制计时
//   - 4 个赛事流程工具（Week 6 Task 35-38）：批量导入 / 赛制推荐 / 分组优化 / 赛程生成
// 注册顺序与 tools/index.ts 中 allTools 数组顺序一致。
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
