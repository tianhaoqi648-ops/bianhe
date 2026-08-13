// ============================================================
// recommend-format.tool.ts — Agent 工具：推荐赛制模板（Task 36）
//
// 包装 formatRepo.listAll，根据 teamCount / totalTime / style 计算 matchScore，
// 推荐最匹配的赛制模板。
//
// 评分规则（总分 100）：
//   - teamCount 兼容性（40 分）：赛制支持队伍数与入参匹配度
//   - totalTime 接近度（30 分）：赛制总时长与入参接近度
//   - style 标签匹配度（30 分）：赛制名称/描述与入参风格匹配度
//
// 风险等级 low：只读操作，不修改数据库
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { DebateFormat } from '@shared/types'
import { formatRepo } from '@main/db/repository/format.repo'

/** recommend_format 工具入参（与 parameters schema 对齐） */
interface RecommendFormatArgs {
  /** 队伍数量（必填） */
  teamCount: number
  /** 期望总时长（分钟，可选） */
  totalTime?: number
  /** 风格标签（可选，如 'formal' / 'casual' / 'competitive'） */
  style?: string
}

/** recommend_format 工具返回值 */
interface RecommendFormatResult {
  /** 推荐赛制 ID（无匹配时为空字符串） */
  formatId: string
  /** 推荐赛制名称（无匹配时为空字符串） */
  formatName: string
  /** 匹配分数 0-100（无匹配时为 0） */
  matchScore: number
  /** 推荐理由 */
  reason: string
}

/** 风格关键词映射：常见 style 入参 → 中英文关键词 */
const STYLE_KEYWORDS: Record<string, string[]> = {
  formal: ['英式', '正式', 'bp', 'british', '牛津'],
  casual: ['休闲', 'casual', '中式', '娱乐'],
  competitive: ['竞技', '比赛', 'tournament', '赛事'],
  policy: ['政策', 'policy'],
  value: ['价值', 'value'],
  fact: ['事实', 'fact']
}

/**
 * 从赛制 stages 推断支持的队伍数。
 * - 含 og/oo/cg/co 边 → 4 队制（BP 制）
 * - 否则 → 2 队制（标准辩论）
 */
function inferFormatTeamCount(format: DebateFormat): number {
  const sides = new Set<string>()
  for (const stage of format.formatData.stages) {
    sides.add(stage.side)
  }
  if (sides.has('og') || sides.has('oo') || sides.has('cg') || sides.has('co')) {
    return 4
  }
  return 2
}

/**
 * 计算单个赛制的匹配分数。
 *
 * @returns score 0-100 与理由列表
 */
function computeMatchScore(
  format: DebateFormat,
  teamCount: number,
  totalTime?: number,
  style?: string
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // 1. teamCount 兼容性（40 分）
  const formatTeamCount = inferFormatTeamCount(format)
  if (teamCount === formatTeamCount) {
    score += 40
    reasons.push(`赛制为 ${formatTeamCount} 队制，与 ${teamCount} 支队伍完全匹配（+40 分）`)
  } else if (teamCount % formatTeamCount === 0) {
    score += 30
    reasons.push(
      `赛制为 ${formatTeamCount} 队制，${teamCount} 支队伍可分为 ${teamCount / formatTeamCount} 场（+30 分）`
    )
  } else {
    const gap = Math.abs(teamCount - formatTeamCount)
    const partial = Math.max(0, 40 - gap * 5)
    score += partial
    reasons.push(
      `赛制为 ${formatTeamCount} 队制，与 ${teamCount} 支队伍差距 ${gap}（+${partial} 分）`
    )
  }

  // 2. totalTime 接近度（30 分）
  if (typeof totalTime === 'number' && totalTime > 0) {
    const formatTotalMinutes = format.formatData.totalDurationMs / 60000
    const diff = Math.abs(formatTotalMinutes - totalTime)
    const timeScore = Math.max(0, 30 - diff * 2)
    score += timeScore
    reasons.push(
      `赛制总时长 ${formatTotalMinutes.toFixed(1)} 分钟，与目标 ${totalTime} 分钟相差 ${diff.toFixed(1)} 分钟（+${timeScore.toFixed(0)} 分）`
    )
  } else {
    score += 15
    reasons.push('未提供 totalTime，时长匹配项给半分（+15 分）')
  }

  // 3. style 标签匹配度（30 分）
  if (typeof style === 'string' && style.trim() !== '') {
    const styleLower = style.trim().toLowerCase()
    const text = `${format.name} ${format.description ?? ''}`.toLowerCase()
    const keywords = STYLE_KEYWORDS[styleLower] ?? [styleLower]
    const matched = keywords.some((k) => text.includes(k.toLowerCase()))
    if (matched) {
      score += 30
      reasons.push(`赛制名称/描述匹配风格 "${style}"（+30 分）`)
    } else {
      reasons.push(`赛制名称/描述未匹配风格 "${style}"（+0 分）`)
    }
  } else {
    score += 15
    reasons.push('未提供 style，风格匹配项给半分（+15 分）')
  }

  return { score: Math.round(score), reasons }
}

/**
 * recommend_format 工具定义。
 *
 * 执行流程：
 *   1. 校验 teamCount 为正整数
 *   2. 调用 formatRepo.listAll 获取所有赛制模板
 *   3. 对每个模板按 teamCount / totalTime / style 计算 matchScore（0-100）
 *   4. 按 matchScore 降序排序，取第 1 名
 *   5. 返回 { formatId, formatName, matchScore, reason }
 *   6. 无模板时返回 matchScore=0
 */
export const recommendFormatTool: ToolDefinition<
  RecommendFormatArgs,
  RecommendFormatResult
> = {
  name: 'recommend_format',
  description: '根据赛事规模与偏好推荐赛制模板。综合 teamCount 兼容性、totalTime 接近度、style 风格匹配度打分。',
  parameters: {
    type: 'object',
    properties: {
      teamCount: {
        type: 'number',
        description: '队伍数量（必填）'
      },
      totalTime: {
        type: 'number',
        description: '期望总时长（分钟，可选）'
      },
      style: {
        type: 'string',
        description: '风格标签（可选，如 formal / casual / competitive）'
      }
    },
    required: ['teamCount']
  },
  riskLevel: 'low',
  async execute(args: RecommendFormatArgs): Promise<RecommendFormatResult> {
    // 1. 校验 teamCount
    const teamCount = Number(args.teamCount)
    if (!Number.isFinite(teamCount) || !Number.isInteger(teamCount) || teamCount < 1) {
      throw new Error('[recommend_format] teamCount 必须为正整数')
    }

    // 2. 归一化可选参数
    const totalTime =
      typeof args.totalTime === 'number' && Number.isFinite(args.totalTime) && args.totalTime > 0
        ? args.totalTime
        : undefined
    const style =
      typeof args.style === 'string' && args.style.trim() !== ''
        ? args.style.trim()
        : undefined

    // 3. 获取所有赛制模板
    const formats = formatRepo.listAll()

    // 4. 无模板时返回 matchScore=0
    if (formats.length === 0) {
      return {
        formatId: '',
        formatName: '',
        matchScore: 0,
        reason: '数据库中无任何赛制模板'
      }
    }

    // 5. 计算每个模板的匹配分数
    const scored = formats.map((fmt) => {
      const { score, reasons } = computeMatchScore(fmt, teamCount, totalTime, style)
      return { format: fmt, score, reasons }
    })

    // 6. 按分数降序排序，取第 1 名
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]

    // 7. 返回结果
    return {
      formatId: best.format.id,
      formatName: best.format.name,
      matchScore: best.score,
      reason: best.reasons.join('；')
    }
  }
}
