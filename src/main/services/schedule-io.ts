// ============================================================
// schedule-io.ts — 赛程 Excel 导入导出服务（P1-6）
//
// 职责：把某赛事的比赛（matches）导出为 xlsx；把编辑后的 xlsx 导回并
//   提供「将新增/将更新/将删除」变更预览，确认后应用。
//
// 纯逻辑（可单测）：
//   - buildScheduleRows   matches → ScheduleRow[]
//   - parseScheduleXlsx   xlsx 文件路径 → { rows, warnings }
//   - computeScheduleDiff 当前行集 vs 导入行集 → ScheduleDiffPreview
//   - resolveRow          队伍名/辩题 → id（含未命中告警）
//   - applyScheduleDiff   对 preview 执行新增/更新/删除（加减依赖注入 ops）
//
// 说明：
//   - 身份键 = roundName#matchNumber；轮次/场次不变而队伍/辩题变化 → update。
//   - 日期/场地（venue/date）仅导出展示、导入不参与 diff/apply（无对应存储列）。
//   - xlsx 读取沿用项目既有 xlsx 方案（读 buffer → XLSX.read），规避 ESM readFile 丢失。
// ============================================================

import fs from 'fs'
import * as XLSX from 'xlsx'
import type {
  ScheduleApplyResult,
  ScheduleDiffAction,
  ScheduleDiffPreview,
  ScheduleRow
} from '../../shared/types'

/** 导出表头（含日期/场地供 Excel 编排参考） */
export const SCHEDULE_HEADERS = ['轮次', '场次', '日期', '正方队伍', '反方队伍', '辩题', '状态']

/** 表头别名 → ScheduleRow 字段（大小写不敏感匹配） */
const HEADER_ALIASES: Record<string, string[]> = {
  roundName: ['轮次', '轮次名称', 'round', 'roundname'],
  matchNumber: ['场次', '场次编号', '场次号', 'match', 'matchnumber', '序号'],
  teamAff: ['正方', '正方队伍', '正方队伍名称', '正方方', 'aff', 'teama', 'teamaff'],
  teamNeg: ['反方', '反方队伍', '反方队伍名称', '反方方', 'neg', 'teamb', 'teamneg'],
  topic: ['辩题', '辩题标题', '题目', 'topic', 'topictitle'],
  date: ['日期', 'date'],
  venue: ['场地', '地点', 'venue'],
  status: ['状态', 'status']
}

/** 反向映射：小写表头 → 字段名 */
const HEADER_REVERSE: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) m[a.toLowerCase()] = field
  }
  return m
})()

/** 身份键：轮次名 + '#' + 场次号 */
export function scheduleKey(row: { roundName: string | null; matchNumber: number | null }): string {
  const round = (row.roundName ?? '').trim()
  const no = row.matchNumber != null && !Number.isNaN(Number(row.matchNumber)) ? String(Number(row.matchNumber)) : ''
  return `${round}#${no}`
}

// ============================================================
// 构建导出行
// ============================================================

/**
 * matches → 赛程行。
 * @param matches 需含 roundName / matchNumber / teamAffName / teamNegName / topicTitle / status
 */
export function buildScheduleRows(
  matches: Array<{
    roundName: string | null
    matchNumber: number | null
    teamAffName: string | null
    teamNegName: string | null
    topicTitle: string | null
    status: string
  }>
): ScheduleRow[] {
  return matches.map((m) => ({
    roundName: m.roundName,
    matchNumber: m.matchNumber,
    teamAff: m.teamAffName || '',
    teamNeg: m.teamNegName || '',
    topic: m.topicTitle || '',
    date: '',
    venue: '',
    status: m.status || 'planned'
  }))
}

// ============================================================
// 解析导入 xlsx
// ============================================================

/**
 * 读取 xlsx 第一张工作表解析为赛程行。
 * @throws 文件不存在 / 损坏时抛出友好错误
 */
export function parseScheduleXlsx(filePath: string): { rows: ScheduleRow[]; warnings: string[] } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`)
  }
  let workbook: XLSX.WorkBook
  try {
    const buffer = fs.readFileSync(filePath)
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch (e) {
    throw new Error(`赛程文件解析失败，文件可能已损坏或已加密。${e instanceof Error ? e.message : ''}`)
  }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { rows: [], warnings: ['工作簿无任何工作表'] }
  }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
  if (rows.length < 2) {
    return { rows: [], warnings: ['工作表为空或仅含表头'] }
  }

  const warnings: string[] = []
  const headerCells = (rows[0] as any[]).map((h) => String(h ?? '').trim())
  // 表头 → 字段索引
  const colIndex: Record<string, number> = {}
  headerCells.forEach((h, i) => {
    const field = HEADER_REVERSE[h.toLowerCase()]
    if (field && colIndex[field] === undefined) colIndex[field] = i
  })

  const out: ScheduleRow[] = []
  const seen = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i] as any[]
    // 整行空跳过
    if (!line || line.every((c) => c === '' || c == null)) continue
    const cell = (field: string): string => {
      const idx = colIndex[field]
      return idx === undefined ? '' : String(line[idx] ?? '').trim()
    }
    const matchNumberRaw = cell('matchNumber')
    const matchNumberRawNum = matchNumberRaw === '' ? null : Number(matchNumberRaw)
    const matchNumber = matchNumberRawNum !== null && !Number.isNaN(matchNumberRawNum) ? matchNumberRawNum : null
    const roundName = cell('roundName') || null
    // 身份键需要同时具备 轮次 + 场次
    if (!roundName || matchNumber === null) {
      warnings.push(`第 ${i + 1} 行：缺少轮次或场次，跳过（无有效身份）`)
      continue
    }
    const row: ScheduleRow = {
      roundName,
      matchNumber,
      teamAff: cell('teamAff'),
      teamNeg: cell('teamNeg'),
      topic: cell('topic'),
      date: cell('date'),
      venue: cell('venue'),
      status: cell('status')
    }
    const key = scheduleKey(row)
    if (seen.has(key)) {
      warnings.push(`第 ${i + 1} 行：身份「${key}」重复，取第一条为准`)
      continue
    }
    seen.add(key)
    out.push(row)
  }

  if (out.length === 0) {
    warnings.push('未解析到任何有效的赛程行（需同时具备轮次与场次）')
  }
  return { rows: out, warnings }
}

// ============================================================
// 变更对比
// ============================================================

/**
 * 计算变更预览：当前行集 vs 导入行集。
 * - 新增：仅出现在导入
 * - 删除：仅出现在当前
 * - 更新：双方存在但 队伍/辩题 有变化（日期/场地不参与判断）
 */
export function computeScheduleDiff(
  current: ScheduleRow[],
  incoming: ScheduleRow[]
): ScheduleDiffPreview {
  const cur = new Map<string, ScheduleRow>()
  for (const r of current) {
    const k = scheduleKey(r)
    if (!cur.has(k)) cur.set(k, r)
  }
  const inc = new Map<string, ScheduleRow>()
  for (const r of incoming) {
    const k = scheduleKey(r)
    if (!inc.has(k)) inc.set(k, r)
  }

  const added: ScheduleDiffAction[] = []
  const updated: ScheduleDiffAction[] = []
  const deleted: ScheduleDiffAction[] = []
  let unchanged = 0
  const warnings: string[] = []

  for (const [key, row] of inc) {
    const existing = cur.get(key)
    if (!existing) {
      added.push({ kind: 'add', key, row })
    } else if (
      existing.teamAff !== row.teamAff ||
      existing.teamNeg !== row.teamNeg ||
      existing.topic !== row.topic
    ) {
      updated.push({ kind: 'update', key, row })
    } else {
      unchanged++
    }
  }
  for (const [key, row] of cur) {
    if (!inc.has(key)) {
      deleted.push({ kind: 'delete', key, row })
    }
  }

  return { added, updated, deleted, unchanged, warnings }
}

// ============================================================
// 解析（队伍名/辩题 → id）与应用
// ============================================================

/** 解析上下文：队伍、辩题、轮次名→roundId */
export interface ScheduleResolveCtx {
  teams: Array<{ id: string; name: string }>
  topics: Array<{ id: string; title: string }>
  /** 轮次名 → roundId（缺省 null 表示未定轮） */
  roundNameToId: (name: string | null) => string | null
}

export interface ScheduleRowResolved {
  roundId: string | null
  teamAffId: string | null
  teamNegId: string | null
  topicId: string | null
  skip: boolean
  reason: string
}

/** 把一行解析为可达的 id；队伍名/辩题无法在当前上下文中匹配则标记 skip */
export function resolveRow(row: ScheduleRow, ctx: ScheduleResolveCtx): ScheduleRowResolved {
  const teamsByName = new Map<string, string>()
  for (const t of ctx.teams) {
    const key = t.name.trim()
    if (key && !teamsByName.has(key)) teamsByName.set(key, t.id)
  }
  const topicsByTitle = new Map<string, string>()
  for (const t of ctx.topics) {
    const key = t.title.trim()
    if (key && !topicsByTitle.has(key)) topicsByTitle.set(key, t.id)
  }

  const teamAff = row.teamAff.trim()
  const teamNeg = row.teamNeg.trim()
  const topic = row.topic.trim()

  const reason: string[] = []
  if (teamAff && teamAff !== '正方' && !teamsByName.has(teamAff)) reason.push(`正方队伍「${teamAff}」未匹配`)
  if (teamNeg && teamNeg !== '反方' && !teamsByName.has(teamNeg)) reason.push(`反方队伍「${teamNeg}」未匹配`)
  if (topic && !topicsByTitle.has(topic)) reason.push(`辩题「${topic}」未匹配`)
  // teamAff/teamNeg/data placeholder 正方/反方 允许空
  const teamAffId = teamAff && teamsByName.has(teamAff) ? teamsByName.get(teamAff) ?? null : null
  const teamNegId = teamNeg && teamsByName.has(teamNeg) ? teamsByName.get(teamNeg) ?? null : null
  const topicId = topic && topicsByTitle.has(topic) ? topicsByTitle.get(topic) ?? null : null

  // 空行（无任何可应用字段）直接跳过
  if (!teamAffId && !teamNegId && !topicId) {
    return { roundId: null, teamAffId: null, teamNegId: null, topicId: null, skip: true, reason: '该行无有效队伍/辩题，无法生成比赛' }
  }

  return {
    roundId: ctx.roundNameToId(row.roundName),
    teamAffId,
    teamNegId,
    topicId: topicId || null,
    skip: reason.length > 0,
    reason: reason.join('；')
  }
}

/** 应用依赖注入：创建/更新/删除比赛（由 IPC 层提供真实 DB 写入） */
export interface ScheduleApplyOps {
  create: (data: { eventId: string; roundId: string | null; matchNumber: number | null; teamAffId: string | null; teamNegId: string | null; topicId: string | null; teamAff: string; teamNeg: string; topic: string }) => void
  update: (matchId: string, data: { teamAffId: string | null; teamNegId: string | null; topicId: string | null }) => void
  remove: (matchId: string) => void
}

export interface ScheduleApplyContext {
  eventId: string
  ctx: ScheduleResolveCtx
  ops: ScheduleApplyOps
  /** 当前既有比赛 id：key → matchId（供 update/delete 定位） */
  matchIdsByKey: Map<string, string>
}

/**
 * 对变更预览执行应用。
 * @param preview computeScheduleDiff 的结果
 * @returns ScheduleApplyResult
 */
export function applyScheduleDiff(
  preview: ScheduleDiffPreview,
  context: ScheduleApplyContext
): ScheduleApplyResult {
  const warnings = [...preview.warnings]
  let appliedAdd = 0
  let appliedUpdate = 0
  let appliedDelete = 0
  let skipped = 0

  for (const action of preview.added) {
    const r = resolveRow(action.row, context.ctx)
    if (r.skip) {
      skipped++
      warnings.push(`跳过新增：「${action.key}」——${r.reason}`)
      continue
    }
    context.ops.create({
      eventId: context.eventId,
      roundId: r.roundId,
      matchNumber: action.row.matchNumber,
      teamAffId: r.teamAffId,
      teamNegId: r.teamNegId,
      topicId: r.topicId,
      teamAff: action.row.teamAff,
      teamNeg: action.row.teamNeg,
      topic: action.row.topic
    })
    appliedAdd++
  }

  for (const action of preview.updated) {
    const matchId = context.matchIdsByKey.get(action.key)
    if (!matchId) {
      skipped++
      warnings.push(`跳过更新：「${action.key}」——未找到对应比赛`)
      continue
    }
    const r = resolveRow(action.row, context.ctx)
    if (r.skip) {
      skipped++
      warnings.push(`跳过更新：「${action.key}」——${r.reason}`)
      continue
    }
    context.ops.update(matchId, { teamAffId: r.teamAffId, teamNegId: r.teamNegId, topicId: r.topicId })
    appliedUpdate++
  }

  for (const action of preview.deleted) {
    const matchId = context.matchIdsByKey.get(action.key)
    if (!matchId) {
      skipped++
      continue
    }
    context.ops.remove(matchId)
    appliedDelete++
  }

  return { appliedAdd, appliedUpdate, appliedDelete, skipped, warnings }
}

// ============================================================
// 序列化（写 workbook buffer）—— 供 IPC 导出
// ============================================================

/** 构建赛程 xlsx 的 NodeJS Buffer */
export function buildScheduleWorkbookBuffer(rows: ScheduleRow[]): Buffer {
  const aoa: (string | number)[][] = [SCHEDULE_HEADERS]
  for (const r of rows) {
    aoa.push([
      r.roundName ?? '',
      r.matchNumber ?? '',
      r.date,
      r.teamAff,
      r.teamNeg,
      r.topic,
      r.status
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '赛程')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}