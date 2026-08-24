// ============================================================
// schedule-io.test.ts — 赛程 Excel 导入导出纯逻辑单测（P1-6）
//
// 覆盖：
//   - buildScheduleRows       matches → 赛程行（含轮次/场次/队伍/辩题）
//   - scheduleKey / computeScheduleDiff   新增/更新/删除/不变
//   - parseScheduleXlsx       读取临时 xlsx（沿用项目动态构造 fixture 方案）
//   - resolveRow / applyScheduleDiff      队伍/辩题解析 + 应用（注入 mock ops）
// ============================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>()
  return {
    ...actual,
    readFile: undefined as unknown as typeof actual.readFile
  }
})

import path from 'path'
import fs from 'fs'
import os from 'os'
import * as XLSX from 'xlsx'
import {
  buildScheduleRows,
  computeScheduleDiff,
  parseScheduleXlsx,
  resolveRow,
  applyScheduleDiff,
  scheduleKey,
  buildScheduleWorkbookBuffer
} from '../schedule-io'
import type { ScheduleDiffPreview, ScheduleRow } from '../../../shared/types'

function row(p: Partial<ScheduleRow>): ScheduleRow {
  return {
    roundName: p.roundName ?? null,
    matchNumber: p.matchNumber ?? null,
    teamAff: p.teamAff ?? '',
    teamNeg: p.teamNeg ?? '',
    topic: p.topic ?? '',
    date: p.date ?? '',
    venue: p.venue ?? '',
    status: p.status ?? 'planned'
  }
}

function writeXlsx(rows: (string | number)[][]): string {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, '赛程')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const p = path.join(os.tmpdir(), `test-schedule-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`)
  fs.writeFileSync(p, buf)
  return p
}

describe('buildScheduleRows', () => {
  it('把 matches 映射为赛程行', () => {
    const rowsStr = buildScheduleRows([
      {
        roundName: '初赛',
        matchNumber: 1,
        teamAffName: 'A队',
        teamNegName: 'B队',
        topicTitle: '辩题X',
        status: 'planned'
      }
    ])
    expect(rowsStr[0]).toMatchObject({
      roundName: '初赛',
      matchNumber: 1,
      teamAff: 'A队',
      teamNeg: 'B队',
      topic: '辩题X',
      status: 'planned'
    })
  })

  it('缺省名使用空串而非 null', () => {
    const rowsStr = buildScheduleRows([
      { roundName: null, matchNumber: null, teamAffName: null, teamNegName: null, topicTitle: null, status: 'planned' }
    ])
    expect(rowsStr[0].teamAff).toBe('')
    expect(rowsStr[0].teamNeg).toBe('')
    expect(rowsStr[0].topic).toBe('')
  })
})

describe('scheduleKey / computeScheduleDiff', () => {
  it('身份键由 轮次+场次 组成', () => {
    expect(scheduleKey({ roundName: '初赛', matchNumber: 2 })).toBe('初赛#2')
  })

  it('识别 新增 / 更新 / 删除 / 不变', () => {
    const current = [
      row({ roundName: '初赛', matchNumber: 1, teamAff: 'A', teamNeg: 'B', topic: 'T1' }),
      row({ roundName: '初赛', matchNumber: 2, teamAff: 'C', teamNeg: 'D', topic: 'T2' }),
      row({ roundName: '初赛', matchNumber: 3, teamAff: 'H', teamNeg: 'I', topic: 'T5' }) // 不在导入 → 删除
    ]
    const incoming = [
      row({ roundName: '初赛', matchNumber: 1, teamAff: 'A', teamNeg: 'B', topic: 'T1' }), // 不变
      row({ roundName: '初赛', matchNumber: 2, teamAff: 'C', teamNeg: 'E', topic: 'T3' }), // 更新
      row({ roundName: '复赛', matchNumber: 1, teamAff: 'F', teamNeg: 'G', topic: 'T4' }) // 新增
    ]
    const d = computeScheduleDiff(current, incoming)
    expect(d.unchanged).toBe(1)
    expect(d.updated).toHaveLength(1)
    expect(d.updated[0].key).toBe('初赛#2')
    expect(d.added).toHaveLength(1)
    expect(d.added[0].key).toBe('复赛#1')
    expect(d.deleted).toHaveLength(1)
    expect(d.deleted[0].key).toBe('初赛#3')
  })

  it('同一键仅取首条（重复告警）', () => {
    const incoming = [
      row({ roundName: '初赛', matchNumber: 1, teamAff: 'A' }),
      row({ roundName: '初赛', matchNumber: 1, teamAff: 'B' })
    ]
    const d = computeScheduleDiff([], incoming)
    expect(d.added).toHaveLength(1)
  })

  it('仅日期/场地变化不算 update', () => {
    const current = [row({ roundName: '初赛', matchNumber: 1, teamAff: 'A', teamNeg: 'B' })]
    const incoming = [row({ roundName: '初赛', matchNumber: 1, teamAff: 'A', teamNeg: 'B', date: '2026-09-01', venue: '主厅' })]
    const d = computeScheduleDiff(current, incoming)
    expect(d.updated).toHaveLength(0)
    expect(d.unchanged).toBe(1)
  })
})

describe('parseScheduleXlsx / buildScheduleWorkbookBuffer', () => {
  it('解析表头与数据行（含别名与数字场次）', () => {
    const file = writeXlsx([
      ['轮次', '场次', '辩题', '正方队伍', '反方队伍'],
      ['初赛', 1, '辩题A', '甲队', '乙队'],
      ['初赛', 2, '辩题B', '丙队', '丁队']
    ])
    try {
      const { rows, warnings } = parseScheduleXlsx(file)
      expect(warnings).toEqual([])
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ roundName: '初赛', matchNumber: 1, teamAff: '甲队', teamNeg: '乙队', topic: '辩题A' })
      expect(rows[1].matchNumber).toBe(2)
    } finally {
      fs.unlinkSync(file)
    }
  })

  it('缺失场次行跳过并告警', () => {
    const file = writeXlsx([['轮次', '场次', '正方队伍', '反方队伍'], ['初赛', '', '甲', '乙']])
    try {
      const { rows, warnings } = parseScheduleXlsx(file)
      expect(rows).toHaveLength(0)
      expect(warnings.join()).toContain('未解析到任何有效的赛程行')
    } finally {
      fs.unlinkSync(file)
    }
  })

  it('文件不存在抛错', () => {
    expect(() => parseScheduleXlsx('nonexist.xlsx')).toThrow('文件不存在')
  })

  it('buildScheduleWorkbookBuffer 产生可再解析的 buffer', () => {
    const src = [row({ roundName: '半决赛', matchNumber: 1, teamAff: 'X', teamNeg: 'Y', topic: 'TT' })]
    const buf = buildScheduleWorkbookBuffer(src)
    const p = path.join(os.tmpdir(), `test-sch-buf-${Date.now()}.xlsx`)
    fs.writeFileSync(p, buf)
    try {
      const { rows } = parseScheduleXlsx(p)
      expect(rows[0].teamAff).toBe('X')
      expect(rows[0].roundName).toBe('半决赛')
    } finally {
      fs.unlinkSync(p)
    }
  })
})

describe('resolveRow / applyScheduleDiff', () => {
  const ctx = {
    teams: [
      { id: 't1', name: '甲队' },
      { id: 't2', name: '乙队' }
    ],
    topics: [{ id: 'tp1', title: '辩题A' }],
    roundNameToId: () => 'r1'
  }

  it('可解析全部字段', () => {
    const r = resolveRow(row({ teamAff: '甲队', teamNeg: '乙队', topic: '辩题A' }), ctx)
    expect(r.skip).toBe(false)
    expect(r.teamAffId).toBe('t1')
    expect(r.teamNegId).toBe('t2')
    expect(r.topicId).toBe('tp1')
  })

  it('未匹配的队伍/辩题 → skip 并给原因', () => {
    const r = resolveRow(row({ teamAff: '未知队', teamNeg: '乙队' }), ctx)
    expect(r.skip).toBe(true)
    expect(r.reason).toContain('正方队伍「未知队」未匹配')
  })

  it('apply 正确分派 create/update/delete，并统计 skipped', () => {
    const create = vi.fn()
    const update = vi.fn()
    const remove = vi.fn()
    const preview: ScheduleDiffPreview = {
      added: [{
        kind: 'add',
        key: '复赛#1',
        row: row({ roundName: '复赛', matchNumber: 1, teamAff: '甲队', teamNeg: '乙队', topic: '辩题A' })
      }],
      updated: [{
        kind: 'update',
        key: '初赛#1',
        matchId: 'm1',
        row: row({ roundName: '初赛', matchNumber: 1, teamAff: '甲队', teamNeg: '乙队', topic: '辩题A' })
      }],
      deleted: [{ kind: 'delete', key: '初赛#3', matchId: 'm3', row: row({ roundName: '初赛', matchNumber: 3 }) }],
      unchanged: 0,
      warnings: []
    }
    const result = applyScheduleDiff(preview, {
      eventId: 'ev1',
      ctx,
      matchIdsByKey: new Map([
        ['初赛#1', 'm1'],
        ['初赛#3', 'm3']
      ]),
      ops: { create, update, remove }
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('m1', { teamAffId: 't1', teamNegId: 't2', topicId: 'tp1' })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('m3')
    expect(result.appliedAdd).toBe(1)
    expect(result.appliedUpdate).toBe(1)
    expect(result.appliedDelete).toBe(1)
  })

  it('新增行缺队伍/辩题解析 → 跳过并告警', () => {
    const create = vi.fn()
    const preview: ScheduleDiffPreview = {
      added: [
        { kind: 'add', key: '未知#1', row: row({ roundName: '未知', matchNumber: 1, teamAff: '不存在', teamNeg: '乙队' }) }
      ],
      updated: [],
      deleted: [],
      unchanged: 0,
      warnings: []
    }
    const result = applyScheduleDiff(preview, {
      eventId: 'ev1',
      ctx,
      matchIdsByKey: new Map(),
      ops: { create, update: vi.fn(), remove: vi.fn() }
    })
    expect(create).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.warnings.join()).toContain('跳过新增')
  })
})

describe('applyScheduleDiff 事务原子性（governance 原子边界）', () => {
  const ctx = {
    teams: [
      { id: 't1', name: '甲队' },
      { id: 't2', name: '乙队' }
    ],
    topics: [{ id: 'tp1', title: '辩题A' }],
    roundNameToId: () => 'r1'
  }

  // 模拟 better-sqlite3 db.transaction 语义：整个 run 包裹在事务内，
  // run 抛错则整批回滚（把“已写入”的 committed 恢复为进入事务前的快照）。
  // 对应注入方 `run => getDb().transaction(run)()` 的提交/回滚行为。
  function rollbackTransaction<T>(committed: unknown[], run: () => T): T {
    const snapshot = [...committed]
    try {
      return run()
    } catch (e) {
      committed.length = 0
      committed.push(...snapshot)
      throw e
    }
  }

  function makePreview(count: number): ScheduleDiffPreview {
    return {
      added: Array.from({ length: count }, (_, i) => ({
        kind: 'add',
        key: `第${i + 1}#1`,
        row: row({ roundName: `第${i + 1}`, matchNumber: i + 1, teamAff: '甲队', teamNeg: '乙队', topic: '辩题A' })
      })),
      updated: [],
      deleted: [],
      unchanged: 0,
      warnings: []
    }
  }

  it('正常成功提交：整批写入、无回滚残留', () => {
    const committed: unknown[] = []
    const create = vi.fn((d: { matchNumber: number | null }) => {
      committed.push(d.matchNumber) // 模拟写入入库
    })
    const result = applyScheduleDiff(makePreview(3), {
      eventId: 'ev1',
      ctx,
      matchIdsByKey: new Map(),
      transaction: (run) => rollbackTransaction(committed, run),
      ops: { create, update: vi.fn(), remove: vi.fn() }
    })
    expect(result.appliedAdd).toBe(3)
    expect(create).toHaveBeenCalledTimes(3)
    expect(committed).toEqual([1, 2, 3]) // 全部提交（未触发回滚）
  })

  it('第 N 场创建失败 → 整批回滚零残留：前 N-1 不存在、第 N 不存在、N+1 及之后不存在', () => {
    const failAt = 3
    const committed: unknown[] = []
    const create = vi.fn((d: { matchNumber: number | null }) => {
      committed.push(d.matchNumber) // 模拟写入入库
      if (committed.length === failAt) {
        throw new Error(`注入：第 ${failAt} 场写入失败`)
      }
    })
    expect(() =>
      applyScheduleDiff(makePreview(5), {
        eventId: 'ev1',
        ctx,
        matchIdsByKey: new Map(),
        transaction: (run) => rollbackTransaction(committed, run),
        ops: { create, update: vi.fn(), remove: vi.fn() }
      })
    ).toThrow('注入：第 3 场写入失败')
    // 第 N 场抛错即中断，N+1 及之后不再执行
    expect(create).toHaveBeenCalledTimes(failAt)
    // 整批回滚：即便前 N-1 场的“写入”已发生，也一并撤销 → DB 零残留
    expect(committed).toEqual([])
  })

  it('未注入事务执行器时仍直跑原逻辑（兼容纯逻辑单测，不破坏既有 apply 用例）', () => {
    const create = vi.fn()
    const result = applyScheduleDiff(makePreview(1), {
      eventId: 'ev1',
      ctx,
      matchIdsByKey: new Map(),
      ops: { create, update: vi.fn(), remove: vi.fn() }
    })
    expect(result.appliedAdd).toBe(1)
    expect(create).toHaveBeenCalledTimes(1)
  })
})