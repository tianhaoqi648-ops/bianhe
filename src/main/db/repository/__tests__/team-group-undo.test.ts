// ============================================================
// team-group-undo.test.ts — P5-001 team_group 撤销链路回归（真 SQLite）
//
// 背景：TEAM_GROUP_* 写 undo log（targetType='team_group'），但
// applyEventReverse/Forward 此前无该分支 → 撤销必抛 unsupported →
// markUndone 无法执行 → 该 log 永久占据 getLatest() 栈顶，撤销功能
// 全局卡死直到重启。本文件回归：
//   1. CREATE → UNDO → REDO（组消失 / 按 after 原值重建）
//   2. UPDATE → UNDO → REDO（before/after 互逆）
//   3. DELETE → UNDO → REDO（原 ID 重建 + teams.group_id SET NULL 关联恢复）
//   4. 旧格式 payload（plain TeamGroup）兼容：组本身恢复，不误删不误抛
//   5. undo stack progression：team_group 撤销成功且 markUndone，
//      再次 UNDO 命中更早操作（不再卡栈）
//   6. 事务安全：恢复中途 FK 抛错 → 整体回滚，undone_at 不变
//
// 引擎：node:sqlite DatabaseSync（真实 SQLite，Node 22+），与
// setResult-transaction.test.ts 同模式；未走 DDL 的表不建，避免跑全量迁移。
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ---- node:sqlite → better-sqlite3 兼容薄适配（与 setResult-transaction.test.ts 同模式） ----
class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
  }
  exec(sql: string): void {
    this.raw.exec(sql)
  }
  prepare(sql: string) {
    const stmt = this.raw.prepare(sql)
    return {
      run: (...args: unknown[]) => stmt.run(...(args as never[])),
      get: (...args: unknown[]) => stmt.get(...(args as never[])),
      all: (...args: unknown[]) => stmt.all(...(args as never[]))
    }
  }
  private txDepth = 0
  private txSeq = 0
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: unknown[]) => {
      const sp = 'sp_' + ++this.txSeq
      if (this.txDepth === 0) this.raw.exec('BEGIN')
      else this.raw.exec('SAVEPOINT ' + sp)
      this.txDepth++
      try {
        const r = fn(...(args as never[]))
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('COMMIT')
        else this.raw.exec('RELEASE ' + sp)
        return r
      } catch (e) {
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('ROLLBACK')
        else {
          this.raw.exec('ROLLBACK TO ' + sp)
          this.raw.exec('RELEASE ' + sp)
        }
        throw e
      }
    }) as unknown as T
  }
}

const mockDb = new MockDb()

// event.repo / undo-service / undo-log.repo 均经 `../index`（src/main/db/index.ts）取连接
vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { withUndoLog, executeUndo, executeRedo } from '../../../services/undo-service'
import { eventRepo } from '../event.repo'
import { undoLogRepo } from '../undo-log.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS team_groups (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    store_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_data TEXT,
    after_data TEXT,
    payload_size INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    undone_at TEXT
  );
`

// ---- handler 复刻：与 event.ipc.ts 的 TEAM_GROUP_* 逐字段一致（被测路径含 payload 构造） ----

function groupCreateHandler(data: { event_id: string; name: string; sort_order: number }) {
  return withUndoLog({
    storeName: 'event',
    action: 'create',
    targetType: 'team_group',
    targetId: null,
    label: `创建分组`,
    getBefore: () => null,
    execute: () => eventRepo.createGroup(data),
    getAfter: (result) => result
  })
}

function groupUpdateHandler(id: string, data: { name?: string; sort_order?: number }) {
  return withUndoLog({
    storeName: 'event',
    action: 'update',
    targetType: 'team_group',
    targetId: id,
    label: `更新分组`,
    getBefore: () => eventRepo.getGroupById(id) ?? null,
    execute: () => eventRepo.updateGroup(id, data),
    getAfter: () => eventRepo.getGroupById(id) ?? null
  })
}

function groupDeleteHandler(id: string) {
  const before = eventRepo.getGroupById(id)
  return withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'team_group',
    targetId: id,
    label: `删除分组 ${before?.name ?? id.slice(0, 8)}`,
    // P5-001：删除分组会使 teams.group_id 经 ON DELETE SET NULL 置空，
    // 快照需一并记录受影响队伍的归属，撤销时才能恢复实际业务状态
    getBefore: () => {
      if (!before) return null
      return {
        group: before,
        teams: eventRepo
          .listTeamsByEvent(before.event_id, { group_id: before.id })
          .map((t) => ({ id: t.id, group_id: t.group_id }))
      }
    },
    execute: () => eventRepo.deleteGroup(id),
    getAfter: () => null
  })
}

// ---- 测试脚手架 ----

const EVT = 'evt-1'

function seedEvent(): void {
  mockDb
    .prepare('INSERT INTO events (id, name, created_at) VALUES (?, ?, ?)')
    .run(EVT, '测试赛事', '2026-01-01T00:00:00.000Z')
}

function seedTeam(id: string, name: string): void {
  mockDb
    .prepare('INSERT INTO teams (id, name, event_id, group_id) VALUES (?, ?, ?, NULL)')
    .run(id, name, EVT)
}

function getGroupRow(id: string): Record<string, unknown> | undefined {
  return mockDb.prepare('SELECT * FROM team_groups WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
}

function getTeamGroupId(teamId: string): string | null {
  const row = mockDb.prepare('SELECT group_id FROM teams WHERE id = ?').get(teamId) as
    | { group_id: string | null }
    | undefined
  return row?.group_id ?? null
}

function getUndoneAt(logId: string): string | null {
  const row = mockDb.prepare('SELECT undone_at FROM undo_log WHERE id = ?').get(logId) as
    | { undone_at: string | null }
    | undefined
  return row?.undone_at ?? null
}

beforeEach(() => {
  // 先建表（幂等）再清空；FK ON：先删子表再删父表
  mockDb.exec(DDL)
  mockDb.exec('DELETE FROM undo_log; DELETE FROM teams; DELETE FROM team_groups; DELETE FROM events;')
  seedEvent()
})

describe('P5-001 team_group undo（真 SQLite）', () => {
  it('CREATE → UNDO：分组消失；REDO：按 after 原值（同 id）重建', () => {
    const { result: g } = groupCreateHandler({ event_id: EVT, name: 'A组', sort_order: 2 })
    expect(getGroupRow(g.id)).toBeDefined()

    executeUndo()
    expect(getGroupRow(g.id)).toBeUndefined()

    executeRedo()
    const row = getGroupRow(g.id)
    expect(row).toBeDefined()
    expect(row?.id).toBe(g.id)
    expect(row?.name).toBe('A组')
    expect(row?.sort_order).toBe(2)
    expect(row?.created_at).toBe(g.created_at)
  })

  it('UPDATE → UNDO：恢复 before；REDO：恢复 after', () => {
    const g = eventRepo.createGroup({ event_id: EVT, name: '旧名', sort_order: 0 })
    const { logId } = groupUpdateHandler(g.id, { name: '新名', sort_order: 5 })
    expect(logId).toBeTruthy()

    executeUndo()
    let row = getGroupRow(g.id)
    expect(row?.name).toBe('旧名')
    expect(row?.sort_order).toBe(0)

    executeRedo()
    row = getGroupRow(g.id)
    expect(row?.name).toBe('新名')
    expect(row?.sort_order).toBe(5)
  })

  it('DELETE → UNDO → REDO：原 ID 重建 + teams.group_id 关联恢复/再次置空', () => {
    const g = eventRepo.createGroup({ event_id: EVT, name: 'B组', sort_order: 1 })
    seedTeam('t1', '队伍一')
    seedTeam('t2', '队伍二')
    eventRepo.assignTeamToGroup('t1', g.id)
    eventRepo.assignTeamToGroup('t2', g.id)

    const { logId } = groupDeleteHandler(g.id)
    expect(logId).toBeTruthy()
    // 删除生效：组消失，FK SET NULL 触发
    expect(getGroupRow(g.id)).toBeUndefined()
    expect(getTeamGroupId('t1')).toBeNull()
    expect(getTeamGroupId('t2')).toBeNull()

    // UNDO：按原 ID 重建，且受影响队伍归属一并恢复
    executeUndo()
    const row = getGroupRow(g.id)
    expect(row).toBeDefined()
    expect(row?.id).toBe(g.id)
    expect(row?.name).toBe('B组')
    expect(row?.sort_order).toBe(1)
    expect(row?.created_at).toBe(g.created_at)
    expect(getTeamGroupId('t1')).toBe(g.id)
    expect(getTeamGroupId('t2')).toBe(g.id)

    // REDO：重放删除，SET NULL 重新触发
    executeRedo()
    expect(getGroupRow(g.id)).toBeUndefined()
    expect(getTeamGroupId('t1')).toBeNull()
    expect(getTeamGroupId('t2')).toBeNull()
  })

  it('旧格式 payload（plain TeamGroup）兼容：组本身恢复，不抛 unsupported', () => {
    const g = eventRepo.createGroup({ event_id: EVT, name: 'C组', sort_order: 0 })
    seedTeam('t1', '队伍一')
    eventRepo.assignTeamToGroup('t1', g.id)

    // 模拟修复前的遗留 log：before_data 为 plain 组行（无 teams 关联数据）
    eventRepo.deleteGroup(g.id)
    undoLogRepo.createLog({
      store_name: 'event',
      action: 'delete',
      target_type: 'team_group',
      target_id: g.id,
      before_data: g,
      after_data: null,
      label: '删除分组（旧格式）'
    })

    executeUndo()
    const row = getGroupRow(g.id)
    expect(row).toBeDefined()
    expect(row?.id).toBe(g.id)
    expect(row?.name).toBe('C组')
    // 旧格式无关联数据：组恢复，队伍归属保持置空（不比修复前差）
    expect(getTeamGroupId('t1')).toBeNull()
  })

  it('undo stack progression：team_group 撤销成功并 markUndone，再次 UNDO 命中更早操作', () => {
    const g = eventRepo.createGroup({ event_id: EVT, name: '原组名', sort_order: 0 })
    seedTeam('t1', '队伍一')

    // 操作 A（更早）：TEAM_ASSIGN_GROUP（team assignGroup，原 team.group_id=null）
    const opA = withUndoLog({
      storeName: 'event',
      action: 'assignGroup',
      targetType: 'team',
      targetId: 't1',
      label: '分配队伍到分组',
      getBefore: () => ({ id: 't1', group_id: null }),
      execute: () => eventRepo.assignTeamToGroup('t1', g.id),
      getAfter: () => ({ id: 't1', group_id: g.id })
    })
    const opB = groupUpdateHandler(g.id, { name: '改名后' })
    if (!opA.logId || !opB.logId) throw new Error('undo log 未创建')

    // 规避同毫秒排序平局：把 A 调到 B 的 created_at 前一毫秒。
    // 不能把 A 设成久远过去——RETENTION_MS=30 天，会被 createLog 的
    // 容量保护当过期日志清掉（retain 最旧策略）。
    const bRow = mockDb.prepare('SELECT created_at FROM undo_log WHERE id = ?').get(
      opB.logId
    ) as { created_at: string }
    mockDb.prepare('UPDATE undo_log SET created_at = ? WHERE id = ?').run(
      new Date(Date.parse(bRow.created_at) - 1).toISOString(),
      opA.logId
    )

    // 第一次 UNDO：命中 B（team_group），成功且 markUndone
    const r1 = executeUndo()
    expect(r1.logId).toBe(opB.logId)
    expect(r1.storeName).toBe('event')
    expect(getGroupRow(g.id)?.name).toBe('原组名')
    expect(getUndoneAt(opB.logId)).toBeTruthy()

    // 第二次 UNDO：进入 A（栈继续回退，不再卡在 B 上）
    const r2 = executeUndo()
    expect(r2.logId).toBe(opA.logId)
    expect(getTeamGroupId('t1')).toBeNull()
    expect(getUndoneAt(opA.logId)).toBeTruthy()
  })

  it('事务安全：恢复中途 FK 抛错 → 整体回滚，undone_at 不变', () => {
    const g = eventRepo.createGroup({ event_id: EVT, name: 'D组', sort_order: 0 })
    const { logId } = groupDeleteHandler(g.id)
    expect(logId).toBeTruthy()
    expect(getUndoneAt(logId!)).toBeNull()

    // 撤销前提失效：父行 events 被删（级联清掉组），恢复 INSERT 将触发 FK 违规
    mockDb.prepare('DELETE FROM events WHERE id = ?').run(EVT)

    expect(() => executeUndo()).toThrow()
    // 回滚生效：log 未被标记撤销，栈顶不被错误消费
    expect(getUndoneAt(logId!)).toBeNull()
  })
})
