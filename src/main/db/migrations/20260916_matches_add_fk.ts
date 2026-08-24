// ============================================================
// 20260916_matches_add_fk.ts
//   matches 外键安全迁移（governance Task 2, Phase 2）
//
// 背景：20260904 建的 matches 表里 event_id/round_id/team_a_id/team_b_id/topic_id
//   只带索引、无 FK。本迁移在不改已发布迁移的前提下，为 matches 补齐 REFERENCES 外键：
//     event_id   → events(id)  ON DELETE CASCADE  ON UPDATE CASCADE
//     round_id   → rounds(id)  ON DELETE CASCADE  ON UPDATE CASCADE
//     team_a_id  → teams(id)   ON DELETE SET NULL ON UPDATE CASCADE
//     team_b_id  → teams(id)   ON DELETE SET NULL ON UPDATE CASCADE
//     topic_id   → topics(id)  ON DELETE SET NULL ON UPDATE CASCADE
//   （team/topic 沿用 draw_session_items 的 SET NULL 语义，event/round 沿用其父表 CASCADE 语义。）
//
// 安全迁移（绝不静默丢行）：
//   1) 先校验现存 matches 是否存在非法引用（指向不存在的 events/rounds/teams/topics）。
//   2) 存在非法引用 → 抛错中止（标 FAILED），要求先清理，绝不静默删除任何行。
//   3) 无非法引用 → 重建 matches 为新表并带 FK，保留全部既有列与索引，迁移数据后替换。
//
// 幂等性：
//   已带父表 FK → 跳过（重复执行无副作用）。
//
// SQLite 不支持 ALTER FOREIGN KEY，需重建表。重建期间临时关闭 foreign_keys pragma
// （避免 DROP 旧 matches 时影响引用它的 match_judges/match_judge_votes），
// 因此本迁移标 transactional:false（事务内 pragma 为 no-op），内部重建各自包事务。
// ============================================================

import type { Database } from 'better-sqlite3'

interface MatchesColumn {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/** matches 需要建立的 FK：子列 → 父表（父键均为 PRIMARY KEY(id)） */
const PARENT_FKS: Array<{ col: string; table: string }> = [
  { col: 'event_id', table: 'events' },
  { col: 'round_id', table: 'rounds' },
  { col: 'team_a_id', table: 'teams' },
  { col: 'team_b_id', table: 'teams' },
  { col: 'topic_id', table: 'topics' }
]

function tableExists(db: Database, table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
}

function getMatchesColumns(db: Database): MatchesColumn[] {
  return db
    .prepare(
      "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('matches')"
    )
    .all() as MatchesColumn[]
}

/** matches 是否已带父表 FK（幂等判定：四类父表引用齐备即视为已迁移） */
function hasParentForeignKeys(db: Database): boolean {
  const rows = db
    .prepare("SELECT \"table\" FROM pragma_foreign_key_list('matches')")
    .all() as Array<{ table: string }>
  const parents = new Set(rows.map((r) => r.table))
  return parents.has('events') && parents.has('rounds') && parents.has('teams') && parents.has('topics')
}

/**
 * 查出 matches 中所有非法引用（指向不存在的父记录）。
 * 返回形如 [{ match_id, column, table }] 的清单；空数组代表全部引用合法。
 */
function findInvalidReferences(db: Database): Array<{ match_id: string; column: string; table: string }> {
  const invalid: Array<{ match_id: string; column: string; table: string }> = []
  for (const { col, table } of PARENT_FKS) {
    const rows = db
      .prepare(
        `SELECT id AS match_id, ${col} AS ref FROM matches
         WHERE ${col} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = matches.${col})`
      )
      .all() as Array<{ match_id: string }>
    for (const r of rows) {
      invalid.push({ match_id: String(r.match_id), column: col, table })
    }
  }
  return invalid
}

/** matches 现有索引（来自 sqlite_master，drop 旧表后名字释放，可原样重建） */
function getMatchesIndexes(db: Database): Array<{ name: string; sql: string }> {
  return db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='matches' AND sql IS NOT NULL"
    )
    .all() as Array<{ name: string; sql: string }>
}

/** 由 pragma_table_info 重建 creates 列定义（保留类型/NOT NULL/DEFAULT/PK），并为 FK 列追加 REFERENCES */
function buildColumnDefs(cols: MatchesColumn[]): string[] {
  const fkByCol = new Map(PARENT_FKS.map((p) => [p.col, p.table]))
  return cols.map((c) => {
    let def = `"${c.name}" ${c.type || ''}`
    const parent = fkByCol.get(c.name)
    if (parent) {
      const action =
        c.name === 'event_id' || c.name === 'round_id'
          ? 'ON DELETE CASCADE ON UPDATE CASCADE'
          : 'ON DELETE SET NULL ON UPDATE CASCADE'
      def += ` REFERENCES ${parent}(id) ${action}`
    }
    if (c.notnull) def += ' NOT NULL'
    if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT ${c.dflt_value}`
    if (c.pk) def += ' PRIMARY KEY'
    return def
  })
}

/** 安全重建 matches：带 FK 保留全部列与索引，无非法引用才执行 */
function rebuildMatchesWithFk(db: Database): void {
  const invalid = findInvalidReferences(db)
  if (invalid.length > 0) {
    const detail = invalid
      .slice(0, 20)
      .map((i) => `match ${i.match_id} 的 ${i.column} -> ${i.table}(id)`).join('; ')
    const omitted = invalid.length > 20 ? ` 等共 ${invalid.length} 条` : ''
    throw new Error(
      `[20260916_matches_add_fk] 检测到 ${invalid.length} 条非法引用（指向不存在的父记录），` +
        `已中止迁移以免丢失数据，请先清理后再升级：${detail}${omitted}`
    )
  }

  const tx = db.transaction(() => {
    const cols = getMatchesColumns(db)
    const colDefs = buildColumnDefs(cols)
    const colNames = cols.map((c) => `"${c.name}"`).join(', ')

    // 重建前先记录现有索引（drop 旧表后这些名字会释放，需原样重建）
    const indexes = getMatchesIndexes(db)

    db.exec(`CREATE TABLE matches_new (${colDefs.join(', ')})`)
    db.exec(`INSERT INTO matches_new (${colNames}) SELECT ${colNames} FROM matches`)

    db.exec('DROP TABLE matches')
    db.exec('ALTER TABLE matches_new RENAME TO matches')

    for (const idx of indexes) {
      db.exec(idx.sql)
    }
  })
  tx()
}

/**
 * matches 外键安全迁移入口。
 * 若 matches 已带父表 FK → 幂等跳过；否则校验非法引用后重建。
 * 重建期间临时关闭/恢复 foreign_keys pragma（参照 20260902）。
 */
export function addForeignKeysToMatches(db: Database): void {
  if (!tableExists(db, 'matches')) return
  if (hasParentForeignKeys(db)) return

  const fkWasOn = db.pragma('foreign_keys', { simple: true }) as number
  if (fkWasOn) {
    db.pragma('foreign_keys = OFF')
  }
  try {
    rebuildMatchesWithFk(db)
  } finally {
    if (fkWasOn) {
      db.pragma('foreign_keys = ON')
    }
  }
}