// ============================================================
// candidate-service.ts — 候选值合并与扩展服务
//
// 合并系统候选值（SYSTEM_CANDIDATES）与用户扩展候选值（settings
// 表 key='system.candidates'），提供统一访问接口。
//
// 用户在导入预览页选择「加入候选」时，新值通过 addCandidateValue
// 持久化到 settings 表，下次启动后自动合并到候选列表。
//
// 注意：复用 auditRepo.getSetting/setSetting，不引入独立 settingsRepo。
// ============================================================

import { SYSTEM_CANDIDATES, type CandidateField } from '../../shared/constants'
import { auditRepo } from '../db/repository/audit.repo'
import { topicRepo } from '../db/repository/topic.repo'

const SETTING_KEY = 'system.candidates'

/** 默认空扩展候选（用于兜底） */
const EMPTY_EXTRA: Record<CandidateField, string[]> = {
  type: [],
  domain: [],
  difficulty: [],
  source: [],
  source_type: []
}

/**
 * Bug 2.4: 运行时类型校验函数，防止旧版/篡改数据导致候选列表被字符拆分污染。
 * 确保用户配置数据格式为 Record<CandidateField, string[]>。
 */
function isCandidateMap(v: unknown): v is Record<CandidateField, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  return Object.keys(obj).every(
    (k) => Array.isArray(obj[k]) && obj[k]!.every((x) => typeof x === 'string')
  )
}

/**
 * 读取用户扩展候选，带类型校验兜底。
 */
function readUserExtra(): Record<CandidateField, string[]> {
  const raw = auditRepo.getSetting(SETTING_KEY)
  return isCandidateMap(raw) ? raw : { ...EMPTY_EXTRA }
}

/**
 * 获取合并后的候选值（系统候选 + 用户扩展）。
 * 用户扩展值追加在系统候选之后，去重。
 */
export function getMergedCandidates(): Record<CandidateField, string[]> {
  const userExtra = readUserExtra()

  const merged = {} as Record<CandidateField, string[]>
  for (const field of Object.keys(SYSTEM_CANDIDATES) as CandidateField[]) {
    const base: string[] = [...SYSTEM_CANDIDATES[field]]
    const extra = userExtra[field] ?? []
    for (const v of extra) {
      if (!base.includes(v)) base.push(v)
    }
    merged[field] = base
  }
  return merged
}

/**
 * 永久加入一个候选值。
 * - 若已存在（系统候选或已加入过的扩展候选），不重复写入
 * - 否则追加到 settings 表 key='system.candidates' 对应字段数组
 *
 * Bug 4.9: 只读一次 DB，避免重复读取。
 */
export function addCandidateValue(field: CandidateField, value: string): void {
  const userExtra = readUserExtra()
  // 合并系统候选 + 用户扩展用于判重
  const merged = new Set<string>([...SYSTEM_CANDIDATES[field], ...(userExtra[field] ?? [])])
  if (merged.has(value)) return

  userExtra[field] = [...(userExtra[field] ?? []), value]
  auditRepo.setSetting(SETTING_KEY, userExtra)
}

/**
 * 获取合并后的候选值（系统候选 + 用户扩展 + DB 实际值）。
 * 用于 FilterPanel 等需要展示「所有可选值」的场景。
 * DB 实际值追加在最后，去重。
 *
 * 实现说明：
 *   - 系统+用户扩展候选来自 getMergedCandidates()
 *   - DB 实际值来自 topicRepo.listDistinctValues(['type','domain','difficulty','source','source_type'])
 *   - 三层合并去重，保留系统候选顺序，DB 实际值追加在后
 */
export function getMergedCandidatesWithDB(): Record<CandidateField, string[]> {
  const system = getMergedCandidates()
  const dbValues = topicRepo.listDistinctValues([
    'type',
    'domain',
    'difficulty',
    'source',
    'source_type'
  ])
  const merged: Record<CandidateField, string[]> = { ...system }
  // Bug 4.7: 显式过滤系统候选 key，防止 dbValues 含未知 key
  for (const k of Object.keys(dbValues) as CandidateField[]) {
    if (!SYSTEM_CANDIDATES[k]) continue
    const set = new Set<string>(system[k] ?? [])
    // Bug 4.8: 过滤 null 和空字符串（DB 中可能是 null 或空字符串）
    for (const r of dbValues[k]) {
      if (r.value != null && r.value !== '') set.add(r.value)
    }
    merged[k] = Array.from(set)
  }
  return merged
}
