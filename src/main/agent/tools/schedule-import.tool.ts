// ============================================================
// schedule-import.tool.ts — Agent 工具：导入赛程 Excel（T5）
//
// 复用 services/schedule-io 解析 xlsx 并与当前赛程做 diff：
//   - apply=false（默认）：仅返回「新增/更新/删除」变更预览，不写库
//   - apply=true：将 preview 应用到比赛（写库）
//
// 设计要点：
//   - 绝不在 apply 缺省时为 true 时写库；写操作依赖 apply:true
//   - description 明确告知 LLM：写操作需要 apply:true 且会请求确认
//   - 复用 matchRepo / eventRepo / topicRepo 组装解析上下文与写入 ops
//   - 风险等级 high：apply=true 会修改数据库，需人工确认
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type {
  Event,
  ScheduleApplyResult,
  ScheduleDiffPreview,
  ScheduleRow
} from '@shared/types'
import { eventRepo } from '@main/db/repository/event.repo'
import { matchRepo } from '@main/db/repository/match.repo'
import { topicRepo } from '@main/db/repository/topic.repo'
import {
  applyScheduleDiff,
  buildScheduleRows,
  computeScheduleDiff,
  parseScheduleXlsx,
  scheduleKey
} from '../../services/schedule-io'
import type { ScheduleResolveCtx } from '../../services/schedule-io'

/** import_event_schedule 工具入参（与 parameters schema 对齐） */
export interface ScheduleImportArgs {
  /** 赛事 ID（必填） */
  eventId: string
  /** 待导入的 xlsx 文件绝对路径（必填） */
  filePath: string
  /** 是否真正写入数据库（默认 false）。false 仅返回变更预览，true 才应用变更 */
  apply?: boolean
}

/** import_event_schedule 工具返回值 */
export interface ScheduleImportResult {
  /** 赛事 ID */
  eventId: string
  /** 是否已应用（apply=true 时为 true） */
  applied: boolean
  /** 变更预览：将新增/将更新/将删除/不变 + warnings */
  preview: ScheduleDiffPreview
  /** 应用结果（applied=true 时返回） */
  applyResult?: ScheduleApplyResult
}

/** 汇总某事件当前赛程行（比赛 → ScheduleRow） */
function currentRows(eventId: string): ScheduleRow[] {
  return buildScheduleRows(matchRepo.listByEvent(eventId))
}

/** 汇总应用的解析上下文（队伍/辩题/轮次名映射） */
function resolveCtx(eventId: string): ScheduleResolveCtx {
  const teams = eventRepo.listTeamsByEvent(eventId).map((t) => ({ id: t.id, name: t.name }))
  const topics = topicRepo
    .listTopics({ page: 1, pageSize: 100000 })
    .items.map((t) => ({ id: t.id, title: t.title }))
  const rounds = eventRepo.listRoundsByEvent(eventId)
  const byName = new Map<string, string>()
  for (const r of rounds) {
    const key = (r.name ?? '').trim()
    if (key && !byName.has(key)) byName.set(key, r.id)
  }
  return {
    teams,
    topics,
    roundNameToId: (name) => {
      const key = (name ?? '').trim()
      return key ? (byName.get(key) ?? null) : null
    }
  }
}

/** key → matchId */
function matchIdsByKey(eventId: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of matchRepo.listByEvent(eventId)) {
    const k = scheduleKey({ roundName: m.roundName, matchNumber: m.matchNumber })
    if (!map.has(k)) map.set(k, m.id)
  }
  return map
}

/** 校验赛事是否存在（返回赛事对象供后续使用） */
function requireEvent(eventId: string): Event {
  const event = eventRepo.getEventById(eventId)
  if (!event) {
    throw new Error(`[import_event_schedule] 赛事 ${eventId} 不存在`)
  }
  return event
}

export const scheduleImportTool: ToolDefinition<
  ScheduleImportArgs,
  ScheduleImportResult
> = {
  name: 'import_event_schedule',
  description:
    '导入赛事赛程 Excel(.xlsx) 并返回变更预览（新增/更新/删除）。传 eventId、filePath（文件绝对路径）。注意：仅当 apply=true 才会真正写入数据库，写操作会请求你确认；apply 缺省为 false，只解析并预览，不写库。',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: '赛事 ID（必填）'
      },
      filePath: {
        type: 'string',
        description: '待导入的 xlsx 文件绝对路径（必填）'
      },
      apply: {
        type: 'boolean',
        description: '是否真正写入数据库（默认 false）。false 仅返回变更预览，true 才应用变更'
      }
    },
    required: ['eventId', 'filePath']
  },
  riskLevel: 'high',
  tier: 'dangerous',
  async execute(args: ScheduleImportArgs): Promise<ScheduleImportResult> {
    // 1. 校验 eventId 与 filePath
    const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
    if (!eventId) {
      throw new Error('[import_event_schedule] eventId 不能为空')
    }
    const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : ''
    if (!filePath) {
      throw new Error('[import_event_schedule] filePath 不能为空')
    }

    // 2. 校验赛事存在
    requireEvent(eventId)

    // 3. 解析 xlsx 并计算 diff 预览（从未写库，仅纯计算）
    const parsed = parseScheduleXlsx(filePath)
    const preview = computeScheduleDiff(currentRows(eventId), parsed.rows)
    preview.warnings = [...parsed.warnings, ...preview.warnings]

    const result: ScheduleImportResult = {
      eventId,
      applied: false,
      preview
    }

    // 4. 仅当 apply=true 时应用变更（写库）
    if (args.apply === true) {
      const ctx = resolveCtx(eventId)
      const idsByKey = matchIdsByKey(eventId)
      const applyResult = applyScheduleDiff(preview, {
        eventId,
        ctx,
        matchIdsByKey: idsByKey,
        ops: {
          create: (d) => {
            matchRepo.create({
              eventId: d.eventId,
              roundId: d.roundId,
              matchNumber: d.matchNumber,
              teamAffId: d.teamAffId,
              teamNegId: d.teamNegId,
              topicId: d.topicId,
              stanceAff: '正方',
              stanceNeg: '反方'
            })
          },
          update: (matchId, d) => {
            matchRepo.update(matchId, {
              teamAffId: d.teamAffId,
              teamNegId: d.teamNegId,
              topicId: d.topicId
            })
          },
          remove: (matchId) => matchRepo.delete(matchId)
        }
      })
      result.applied = true
      result.applyResult = applyResult
    }

    return result
  }
}