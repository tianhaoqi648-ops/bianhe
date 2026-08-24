// ============================================================
// generate-schedule.tool.ts — Agent 工具：生成赛程对阵（Task 38）
//
// 包装 schedule-engine 的 4 个 generate 函数，支持：
//   - single-elimination 单淘汰（标准种子位 + bye）
//   - single-round-robin  单循环（圆圈法）
//   - double-elimination  双淘汰（胜者组 + 败者组 + 决赛）
//   - swiss               瑞士轮（第 1 轮随机配对 + 后续空框架）
//
// 设计要点：
//   - teamCount 与 teams 二选一，teams 优先（含真实 id 与 name）
//   - 队伍数 < 2 / 日期无效等校验在工具内完成，错误抛 Error
//   - 风险等级 high：生成的赛程可能直接落库或影响赛事流程
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition, ScheduleRound } from '@shared/agent-types'
import {
  generateSingleElimination,
  generateSingleRoundRobin,
  generateDoubleElimination,
  generateSwiss
} from '../schedule-engine'

/** generate_schedule 工具入参（与 parameters schema 对齐） */
interface GenerateScheduleArgs {
  /** 队伍数量（与 teams 二选一，teams 优先） */
  teamCount?: number
  /** 队伍列表（与 teamCount 二选一，优先使用） */
  teams?: Array<{ id: string; name: string }>
  /** 赛制（必填） */
  format: 'single-elimination' | 'single-round-robin' | 'double-elimination' | 'swiss'
  /** 开始日期（ISO 日期字符串，如 2025-01-15，必填） */
  startDate: string
  /** 每轮间隔天数（默认 1） */
  restDays?: number
}

/** generate_schedule 工具返回值 */
interface GenerateScheduleResult {
  /** 生成的赛程轮次列表 */
  rounds: ScheduleRound[]
}

/** 支持的赛制枚举（用于校验） */
const VALID_FORMATS = [
  'single-elimination',
  'single-round-robin',
  'double-elimination',
  'swiss'
] as const

export const generateScheduleTool: ToolDefinition<
  GenerateScheduleArgs,
  GenerateScheduleResult
> = {
  name: 'generate_schedule',
  description: '为赛事生成赛程对阵。支持单淘汰/单循环/双淘汰/瑞士轮 4 种赛制。',
  parameters: {
    type: 'object',
    properties: {
      teamCount: {
        type: 'number',
        description: '队伍数量（与 teams 二选一，teams 优先）'
      },
      teams: {
        type: 'array',
        description: '队伍列表（与 teamCount 二选一，优先使用），每项为 { id, name }',
        items: { type: 'object', description: '队伍对象 { id: string, name: string }' }
      },
      format: {
        type: 'string',
        description:
          '赛制：single-elimination / single-round-robin / double-elimination / swiss',
        enum: ['single-elimination', 'single-round-robin', 'double-elimination', 'swiss']
      },
      startDate: {
        type: 'string',
        description: '开始日期（ISO 日期字符串，如 2025-01-15，必填）'
      },
      restDays: {
        type: 'number',
        description: '每轮间隔天数（默认 1）'
      }
    },
    required: ['format', 'startDate']
  },
  riskLevel: 'high',
  tier: 'dangerous',
  async execute(args: GenerateScheduleArgs): Promise<GenerateScheduleResult> {
    // 1. 校验 format
    const format = args.format
    if (!format || !VALID_FORMATS.includes(format)) {
      throw new Error(
        `[generate_schedule] format 必须为 ${VALID_FORMATS.join(' / ')} 之一`
      )
    }

    // 2. 校验 startDate
    const startDate = typeof args.startDate === 'string' ? args.startDate.trim() : ''
    if (!startDate) {
      throw new Error('[generate_schedule] startDate 不能为空')
    }
    const d = new Date(startDate)
    if (isNaN(d.getTime())) {
      throw new Error(`[generate_schedule] startDate 无效: ${startDate}`)
    }

    // 3. 校验 restDays（默认 1，非负整数）
    const restDays =
      typeof args.restDays === 'number' &&
      Number.isFinite(args.restDays) &&
      args.restDays >= 0
        ? Math.floor(args.restDays)
        : 1

    // 4. 解析 teams：优先使用 teams 入参，否则用 teamCount 生成占位
    let teams: Array<{ id: string; name: string }>
    if (Array.isArray(args.teams) && args.teams.length > 0) {
      // 过滤无效项并保证 id/name 为字符串
      teams = args.teams
        .filter(
          (t) =>
            t !== null &&
            typeof t === 'object' &&
            typeof (t as { id?: unknown }).id === 'string' &&
            typeof (t as { name?: unknown }).name === 'string'
        )
        .map((t, i) => ({
          id: (t as { id: string }).id,
          name: (t as { name: string }).name || `Team ${i + 1}`
        }))
      if (teams.length < 2) {
        throw new Error('[generate_schedule] teams 至少需要 2 支队伍')
      }
    } else if (typeof args.teamCount === 'number' && Number.isFinite(args.teamCount) && args.teamCount >= 2) {
      // 用 teamCount 生成占位队伍（id=T1, T2, ...）
      const n = Math.floor(args.teamCount)
      teams = Array.from({ length: n }, (_, i) => ({
        id: `T${i + 1}`,
        name: `Team ${i + 1}`
      }))
    } else {
      throw new Error(
        '[generate_schedule] 需提供 teams（至少 2 支）或 teamCount（>=2），且 teams 优先'
      )
    }

    // 5. 根据 format 调用对应的 generate 函数
    //    schedule-engine 内部会校验队伍数 < 2 / 日期无效 / restDays < 0 等并抛错
    let rounds: ScheduleRound[]
    switch (format) {
      case 'single-elimination':
        rounds = generateSingleElimination(teams, startDate, restDays)
        break
      case 'single-round-robin':
        rounds = generateSingleRoundRobin(teams, startDate, restDays)
        break
      case 'double-elimination':
        rounds = generateDoubleElimination(teams, startDate, restDays)
        break
      case 'swiss':
        rounds = generateSwiss(teams, startDate, restDays)
        break
      // 理论不可达（前面已校验 format 在 VALID_FORMATS 内）
      default:
        throw new Error(`[generate_schedule] 不支持的赛制: ${format}`)
    }

    return { rounds }
  }
}
