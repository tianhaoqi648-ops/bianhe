// ============================================================
// judge-history.repo.ts — AI 裁判结果历史 CRUD
//
// 背景：AI 裁判页的评审结果此前只存组件内存，切页/重启即丢失。
//   新增 judge_history 表，每条裁判工具（judge_speech / judge_debate /
//   judge_match / simulate_opponent / detect_stage）执行成功的记录持久化为一行。
//
// 接口：create / get / getList（支持 eventId/roundId/matchId/toolName 可选筛选，
//   按 created_at 倒序）/ delete。
// 风格与 match.repo.ts 对齐：getDb() 取库、safeJsonParse 解析 result_json、
//   async 风格同步执行（better-sqlite3）。
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type {
  JudgeHistoryCreateInput,
  JudgeHistoryFilter,
  JudgeHistoryRecord,
  JudgeProvenance
} from '../../../shared/types'

// ============================================================
// 行类型 & 映射
// ============================================================

/** result_json 中承载 provenance 的保留键（governance Task 10）。
 *  不新增 DB 列；写入时把 provenance 挂到该键，读取时拆出为独立字段。 */
const PROVENANCE_RESERVED_KEY = '__provenance'

interface JudgeHistoryRow {
  id: string
  created_at: string
  event_id: string | null
  round_id: string | null
  match_id: string | null
  judge_id: string
  tool_name: string
  stage: string | null
  side: string | null
  topic: string | null
  result_json: string | null
  error: string | null
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 从 result_json 拆出 provenance（若有），并返回去除了保留键后的纯净结果。
 * 记录无 provenance 时返回 { resultJson, provenance: null }。
 */
function splitProvenance(
  parsed: Record<string, unknown> | null | undefined
): { resultJson: Record<string, unknown> | null; provenance: JudgeProvenance | null } {
  if (!parsed || typeof parsed !== 'object') {
    return { resultJson: parsed ?? null, provenance: null }
  }
  const value = parsed[PROVENANCE_RESERVED_KEY]
  const provenance =
    value && typeof value === 'object'
      ? (value as JudgeProvenance)
      : null
  if (provenance === null) {
    return { resultJson: parsed, provenance: null }
  }
  const clean = { ...parsed }
  delete clean[PROVENANCE_RESERVED_KEY]
  return { resultJson: clean, provenance }
}

function rowToJudgeHistory(row: JudgeHistoryRow): JudgeHistoryRecord {
  const parsed = safeJsonParse<Record<string, unknown> | null>(row.result_json, null)
  const { resultJson, provenance } = splitProvenance(parsed)
  return {
    id: row.id,
    createdAt: row.created_at,
    eventId: row.event_id,
    roundId: row.round_id,
    matchId: row.match_id,
    judgeId: row.judge_id,
    toolName: row.tool_name,
    stage: row.stage,
    side: row.side,
    topic: row.topic,
    resultJson,
    error: row.error,
    provenance
  }
}

function getRow(id: string): JudgeHistoryRow | undefined {
  return getDb()
    .prepare('SELECT * FROM judge_history WHERE id = ?')
    .get(id) as JudgeHistoryRow | undefined
}

// ============================================================
// CRUD
// ============================================================

/** 保存一条裁判历史（工具执行成功后自动落库）。 */
function create(input: JudgeHistoryCreateInput): JudgeHistoryRecord {
  const db = getDb()
  const id = input.id ?? uuidv4()
  const now = new Date().toISOString()
  // provenance 不新增列：以保留键挂到 result_json 上，随其 JSON 落库
  let resultJson = input.resultJson ?? null
  if (input.provenance && typeof resultJson === 'object') {
    resultJson = { ...resultJson, [PROVENANCE_RESERVED_KEY]: input.provenance }
  }
  db.prepare(`
    INSERT INTO judge_history (
      id, created_at, event_id, round_id, match_id, judge_id, tool_name,
      stage, side, topic, result_json, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.createdAt ?? now,
    input.eventId ?? null,
    input.roundId ?? null,
    input.matchId ?? null,
    input.judgeId,
    input.toolName,
    input.stage ?? null,
    input.side ?? null,
    input.topic ?? null,
    resultJson ? JSON.stringify(resultJson) : null,
    input.error ?? null
  )

  const row = getRow(id)
  if (!row) throw new Error(`[judgeHistoryRepo] create: not found, id=${id}`)
  return rowToJudgeHistory(row)
}

/** 按 id 取单条历史（不存在返回 undefined）。 */
function get(id: string): JudgeHistoryRecord | undefined {
  const row = getRow(id)
  return row ? rowToJudgeHistory(row) : undefined
}

/**
 * 列表查询。支持 eventId / roundId / matchId / toolName 任一或组合筛选
 * （仅当传入非空值时才作为条件），按 created_at 倒序返回。
 */
function getList(filter?: JudgeHistoryFilter): JudgeHistoryRecord[] {
  const conditions: string[] = []
  const args: Array<string | null> = []
  if (filter?.eventId) {
    conditions.push('event_id = ?')
    args.push(filter.eventId)
  }
  if (filter?.roundId) {
    conditions.push('round_id = ?')
    args.push(filter.roundId)
  }
  if (filter?.matchId) {
    conditions.push('match_id = ?')
    args.push(filter.matchId)
  }
  if (filter?.toolName) {
    conditions.push('tool_name = ?')
    args.push(filter.toolName)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM judge_history ${where} ORDER BY created_at DESC`)
    .all(...args) as JudgeHistoryRow[]
  return rows.map(rowToJudgeHistory)
}

/** 删除单条历史。 */
function deleteById(id: string): boolean {
  const result = getDb().prepare('DELETE FROM judge_history WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * 备份用：返回 judge_history 全部行（DB 原始格式，result_json 不反序列化），
 * 便于导入时通过 bulkInsert 直接还原。风格与其它 repo 的 findAllForBackup 对齐。
 */
function findAllForBackup(): Array<Record<string, unknown>> {
  return getDb().prepare('SELECT * FROM judge_history').all() as Array<Record<string, unknown>>
}

// ============================================================
// 导出
// ============================================================

export const judgeHistoryRepo = {
  create,
  get,
  getList,
  delete: deleteById,
  findAllForBackup
}