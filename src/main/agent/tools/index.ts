// ============================================================
// tools/index.ts — Agent 工具统一导出（AI Agent v1.3.0 Week 2 Task 13.1 / Week 6 Task 39）
//
// 汇总 12 个业务工具的命名导出，便于按需引用；
// 同时提供 allTools 数组，供 register-tools 一次性批量注册。
//
// 工具清单：
//   - 8 个基础工具（Week 2 Task 13.1）：题库 / 抽取 / 赛事 / 赛制计时
//   - 4 个赛事流程工具（Week 6 Task 35-38）：批量导入 / 赛制推荐 / 分组优化 / 赛程生成
// ============================================================

export { searchTopicsTool } from './search-topics.tool'
export { getTopicDetailTool } from './get-topic-detail.tool'
export { createTopicTool } from './create-topic.tool'
export { drawTopicsTool } from './draw-topics.tool'
export { listEventsTool } from './list-events.tool'
export { createEventTool } from './create-event.tool'
export { getFormatTool } from './get-format.tool'
export { getTimerStateTool } from './get-timer-state.tool'
export { importEventBatchTool } from './import-event-batch.tool'
export { recommendFormatTool } from './recommend-format.tool'
export { optimizeTeamGroupsTool } from './optimize-team-groups.tool'
export { generateScheduleTool } from './generate-schedule.tool'
export { judgeDebateTool } from './judge-debate.tool'
export { judgeSpeechTool } from './judge-speech.tool'
export { detectStageTool } from './detect-stage.tool'

import type { ToolDefinition } from '@shared/agent-types'
import { searchTopicsTool } from './search-topics.tool'
import { getTopicDetailTool } from './get-topic-detail.tool'
import { createTopicTool } from './create-topic.tool'
import { drawTopicsTool } from './draw-topics.tool'
import { listEventsTool } from './list-events.tool'
import { createEventTool } from './create-event.tool'
import { getFormatTool } from './get-format.tool'
import { getTimerStateTool } from './get-timer-state.tool'
import { importEventBatchTool } from './import-event-batch.tool'
import { recommendFormatTool } from './recommend-format.tool'
import { optimizeTeamGroupsTool } from './optimize-team-groups.tool'
import { generateScheduleTool } from './generate-schedule.tool'
import { judgeDebateTool } from './judge-debate.tool'
import { judgeSpeechTool } from './judge-speech.tool'
import { detectStageTool } from './detect-stage.tool'

/**
 * 全部 12 个工具（用于一次性注册）。
 *
 * 类型说明：各工具的 TArgs / TResult 泛型参数各异（如 GetTopicDetailArgs / Topic），
 * 而 ToolDefinition.execute 为函数属性（严格逆变），无法统一收敛到默认
 * ToolDefinition<Record<string, unknown>, unknown>。此处用 any 抹平泛型差异，
 * 形成异构工具集合，便于批量注册；具体类型安全由各工具文件自行保证。
 *
 * 顺序约定：现有 8 个基础工具在前，4 个赛事流程工具在后（Task 35-38 顺序）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: ToolDefinition<any, any>[] = [
  searchTopicsTool,
  getTopicDetailTool,
  createTopicTool,
  drawTopicsTool,
  listEventsTool,
  createEventTool,
  getFormatTool,
  getTimerStateTool,
  importEventBatchTool,
  recommendFormatTool,
  optimizeTeamGroupsTool,
  generateScheduleTool,
  judgeDebateTool,
  judgeSpeechTool,
  detectStageTool
]
