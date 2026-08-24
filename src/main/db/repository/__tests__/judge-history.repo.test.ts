// ============================================================
// judge-history.repo.test.ts — AI 裁判历史仓库测试
//
// 背景：better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法直接加载
// （见 agent-session.repo.test.ts / match.repo.test.ts 注释），因此 mock getDb()
// 返回内存桩。用 vi.hoisted 共享状态，避免 vi.mock 提升导致 TDZ 引用。
//
// 覆盖：create / get / getList（eventId/roundId/matchId/toolName 筛选，倒序）/ delete。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  /** 内存表：key=id，val=row */
  let rows = new Map<string, Record<string, unknown>>()

  const prepare = (sql: string) => {
    const s = sql.trim()
    const stmt = {
      run: (...args: unknown[]) => {
        // INSERT INTO judge_history
        if (/^INSERT\s+INTO\s+judge_history/i.test(s)) {
          const row = {
            id: String(args[0]),
            created_at: String(args[1]),
            event_id: args[2] ?? null,
            round_id: args[3] ?? null,
            match_id: args[4] ?? null,
            judge_id: String(args[5]),
            tool_name: String(args[6]),
            stage: args[7] ?? null,
            side: args[8] ?? null,
            topic: args[9] ?? null,
            result_json: args[10] ?? null,
            error: args[11] ?? null
          }
          rows.set(row.id, row)
          return { changes: 1 }
        }
        // DELETE FROM judge_history WHERE id = ?
        if (/^DELETE\s+FROM\s+judge_history\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
          const before = rows.size
          rows.delete(String(args[0]))
          return { changes: before > rows.size ? 1 : 0 }
        }
        if (/^DELETE\s+FROM\s+judge_history/i.test(s)) {
          const before = rows.size
          rows.clear()
          return { changes: before }
        }
        return { changes: 0 }
      },
      get: (...args: unknown[]) => {
        // SELECT * FROM judge_history WHERE id = ?
        if (/^SELECT\s+\*\s+FROM\s+judge_history\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
          return rows.get(String(args[0]))
        }
        return undefined
      },
      all: (...args: unknown[]) => {
        // SELECT * FROM judge_history [WHERE ...] ORDER BY created_at DESC
        if (/^SELECT\s+\*\s+FROM\s+judge_history/i.test(s)) {
          let list = Array.from(rows.values())
          const m = s.match(/WHERE\s+(.+?)\s+ORDER\s+BY/i)
          const clause = m ? m[1] : ''
          const tokens: string[] = []
          const regex = /(\w+)\s*=\s*\?/g
          let t: RegExpExecArray | null = null
          while ((t = regex.exec(clause)) !== null) tokens.push(t[1])
          if (tokens.length > 0) {
            const conditions: Record<string, string> = {}
            tokens.forEach((col, idx) => {
              conditions[col] = String(args[idx])
            })
            list = list.filter((r) =>
              tokens.every((col) => String(r[col]) === conditions[col])
            )
          }
          return list.sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at))
          )
        }
        return []
      }
    }
    return stmt
  }

  return {
    prepare,
    reset: () => {
      rows = new Map()
    }
  }
})

vi.mock('../../index', () => ({
  getDb: () => ({
    prepare: (sql: string) => h.prepare(sql)
  })
}))

import { judgeHistoryRepo } from '../judge-history.repo'

beforeEach(() => {
  h.reset()
})

describe('judgeHistoryRepo', () => {
  it('create：落库并返回带 id/createdAt/resultJson 的对象', () => {
    const rec = judgeHistoryRepo.create({
      eventId: 'e1',
      roundId: 'r1',
      matchId: 'm1',
      judgeId: 'j1',
      toolName: 'judge_match',
      stage: 'closing',
      side: 'aff',
      topic: 'AI 是否应拥有著作权',
      resultJson: { winner: 'aff', score: 88 }
    })
    expect(rec.id).toBeTruthy()
    expect(rec.createdAt).toBeTruthy()
    expect(rec.eventId).toBe('e1')
    expect(rec.toolName).toBe('judge_match')
    expect(rec.resultJson).toMatchObject({ winner: 'aff' })
  })

  it('create：省略可选字段时落为 null，resultJson 缺省为 null', () => {
    const rec = judgeHistoryRepo.create({ judgeId: 'j0', toolName: 'detect_stage' })
    expect(rec.eventId).toBeNull()
    expect(rec.roundId).toBeNull()
    expect(rec.matchId).toBeNull()
    expect(rec.stage).toBeNull()
    expect(rec.side).toBeNull()
    expect(rec.topic).toBeNull()
    expect(rec.resultJson).toBeNull()
    expect(rec.error).toBeNull()
  })

  it('get：按 id 取回，result_json 被反序列化为对象', () => {
    const created = judgeHistoryRepo.create({
      judgeId: 'j1',
      toolName: 'judge_speech',
      resultJson: { dimension: { logic: 90 }, suggestions: [] }
    })
    const got = judgeHistoryRepo.get(created.id)
    expect(got).toBeTruthy()
    expect(got!.toolName).toBe('judge_speech')
    expect(got!.resultJson).toMatchObject({ dimension: { logic: 90 } })
  })

  it('get：查无此条返回 undefined', () => {
    expect(judgeHistoryRepo.get('nonexistent')).toBeUndefined()
  })

  it('getList：无筛选返回全部，按 created_at 倒序', () => {
    judgeHistoryRepo.create({ judgeId: 'j1', toolName: 'judge_match', createdAt: '2026-08-20T10:00:00.000Z' })
    judgeHistoryRepo.create({ judgeId: 'j2', toolName: 'judge_speech', createdAt: '2026-08-21T10:00:00.000Z' })
    judgeHistoryRepo.create({ judgeId: 'j3', toolName: 'detect_stage', eventId: 'other', createdAt: '2026-08-19T10:00:00.000Z' })
    const list = judgeHistoryRepo.getList()
    expect(list).toHaveLength(3)
    expect(list[0].createdAt).toBe('2026-08-21T10:00:00.000Z')
    expect(list[2].createdAt).toBe('2026-08-19T10:00:00.000Z')
  })

  it('getList：支持 eventId / roundId / matchId / toolName 组合筛选', () => {
    judgeHistoryRepo.create({ judgeId: 'j1', toolName: 'judge_match', eventId: 'e1', roundId: 'r1', matchId: 'm1' })
    judgeHistoryRepo.create({ judgeId: 'j2', toolName: 'judge_debate', eventId: 'e1', roundId: 'r1' })
    judgeHistoryRepo.create({ judgeId: 'j3', toolName: 'judge_match', eventId: 'e2' })

    expect(judgeHistoryRepo.getList({ eventId: 'e1' })).toHaveLength(2)
    expect(judgeHistoryRepo.getList({ eventId: 'e1', roundId: 'r1' })).toHaveLength(2)
    expect(judgeHistoryRepo.getList({ eventId: 'e1', roundId: 'r1', matchId: 'm1' })).toHaveLength(1)
    expect(judgeHistoryRepo.getList({ toolName: 'judge_match' })).toHaveLength(2)
    expect(judgeHistoryRepo.getList({ toolName: 'judge_match', eventId: 'e1' })).toHaveLength(1)
    expect(judgeHistoryRepo.getList({ eventId: 'nope' })).toHaveLength(0)
  })

  it('delete：删除成功返回 true，再查无', () => {
    const rec = judgeHistoryRepo.create({ judgeId: 'j1', toolName: 'simulate_opponent' })
    expect(judgeHistoryRepo.delete(rec.id)).toBe(true)
    expect(judgeHistoryRepo.get(rec.id)).toBeUndefined()
  })

  it('delete：删除不存在的记录返回 false', () => {
    expect(judgeHistoryRepo.delete('nonexistent')).toBe(false)
  })

  it('create：携带 provenance 时持久化并返回独立 provenance 字段，resultJson 保持纯净', () => {
    const provenance = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptVersion: '2026-08',
      judgeVersion: '1.0.0',
      mode: 'whole',
      inputHash: '0a1b2c3d',
      createdAt: '2026-08-24T00:00:00.000Z'
    }
    const rec = judgeHistoryRepo.create({
      judgeId: 'j1',
      toolName: 'judge_match',
      topic: 'AI 是否应拥有著作权',
      resultJson: { winner: 'aff', score: 88 },
      provenance
    })
    expect(rec.provenance).toEqual(provenance)
    // resultJson 不含保留键 __provenance
    expect(rec.resultJson).toEqual({ winner: 'aff', score: 88 })
    expect((rec.resultJson as Record<string, unknown>).__provenance).toBeUndefined()
  })

  it('get：provenance 随 DB 行往返保留（读取拆回独立字段）', () => {
    const provenance = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptVersion: '2026-08',
      judgeVersion: '1.0.0',
      mode: 'stage',
      inputHash: 'feedcafe',
      createdAt: '2026-08-24T01:00:00.000Z'
    }
    const created = judgeHistoryRepo.create({
      judgeId: 'j2',
      toolName: 'judge_speech',
      resultJson: { summary: 's' },
      provenance
    })
    const got = judgeHistoryRepo.get(created.id)
    expect(got!.provenance).toEqual(provenance)
    expect(got!.resultJson).toEqual({ summary: 's' })
  })

  it('无 provenance 的记录读回时 provenance 为 null', () => {
    const rec = judgeHistoryRepo.create({ judgeId: 'j3', toolName: 'detect_stage' })
    expect(rec.provenance).toBeNull()
  })

  it('findAllForBackup：返回 DB 原始行，result_json 不反序列化', () => {
    judgeHistoryRepo.create({
      judgeId: 'j1',
      toolName: 'judge_match',
      resultJson: { winner: 'aff', score: 88 }
    })
    judgeHistoryRepo.create({ judgeId: 'j2', toolName: 'detect_stage' })

    const rows = judgeHistoryRepo.findAllForBackup()
    expect(rows).toHaveLength(2)
    // 原始行：result_json 为字符串而非对象
    const match = rows.find((r) => r.judge_id === 'j1')
    expect(match).toBeTruthy()
    expect(typeof match!.result_json).toBe('string')
    expect(JSON.parse(match!.result_json as string)).toMatchObject({ winner: 'aff' })
  })
})