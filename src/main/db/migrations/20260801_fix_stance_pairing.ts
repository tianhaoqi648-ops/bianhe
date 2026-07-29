// ============================================================
// 20260801_fix_stance_pairing.ts — 修正旧会话持方数据
//
// 修正范围：draw_session_items 表
//   1. team_stances（JSON 数组）：相邻同侧时翻转第二位
//   2. stance_a / stance_b（versus 模式）：同侧时翻转 stance_b
//
// 调用方：migrations/index.ts 中的 MIGRATIONS 数组
// 幂等性：由 __migrations 表追踪 id 保证只执行一次
// ============================================================

import type { Database } from 'better-sqlite3'
import { normalizeStances, normalizeStancePair } from '../../../shared/stance-utils'

/**
 * 修正 draw_session_items 中旧会话的持方数据。
 *
 * @returns { fixed: number; skipped: number } 修正/跳过的记录数
 */
export function fixStancePairing(db: Database): { fixed: number; skipped: number } {
  // 1. 读取所有有持方数据的 draw_session_items 记录
  const rows = db
    .prepare(
      `SELECT id, team_stances, stance_a, stance_b
       FROM draw_session_items
       WHERE team_stances IS NOT NULL OR stance_a IS NOT NULL OR stance_b IS NOT NULL`
    )
    .all() as Array<{
    id: string
    team_stances: string | null
    stance_a: string | null
    stance_b: string | null
  }>

  let fixed = 0
  let skipped = 0

  // 预编译 UPDATE 语句，循环内复用
  const updateStmt = db.prepare(
    `UPDATE draw_session_items
     SET team_stances = ?, stance_a = ?, stance_b = ?
     WHERE id = ?`
  )

  for (const row of rows) {
    let needsUpdate = false
    let newTeamStances: string | null = row.team_stances
    let newStanceA: string | null = row.stance_a
    let newStanceB: string | null = row.stance_b

    // 修正 team_stances（JSON 数组）
    if (row.team_stances) {
      try {
        const stances: string[] = JSON.parse(row.team_stances)
        const normalized = normalizeStances(stances)
        if (JSON.stringify(normalized) !== JSON.stringify(stances)) {
          newTeamStances = JSON.stringify(normalized)
          needsUpdate = true
        }
      } catch {
        // JSON 解析失败，跳过该字段
      }
    }

    // 修正 stance_a / stance_b（versus 模式）
    if (row.stance_a && row.stance_b) {
      const [normA, normB] = normalizeStancePair(row.stance_a, row.stance_b)
      if (normA !== row.stance_a || normB !== row.stance_b) {
        newStanceA = normA
        newStanceB = normB
        needsUpdate = true
      }
    }

    if (needsUpdate) {
      updateStmt.run(newTeamStances, newStanceA, newStanceB, row.id)
      fixed++
    } else {
      skipped++
    }
  }

  return { fixed, skipped }
}
