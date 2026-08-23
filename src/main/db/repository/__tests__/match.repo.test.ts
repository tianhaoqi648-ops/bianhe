// ============================================================
// match.repo.test.ts — 比赛（matches）仓库测试
//
// 背景：better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法直接加载
// （见 agent-session.repo.test.ts 注释），因此 mock getDb() 返回内存桩。
// 用 vi.hoisted 共享状态，避免 vi.mock 提升导致 TDZ 引用。
//
// 覆盖：create / getById / listByEvent / listByRound / update / setResult /
//       setAiReview / linkSession
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const runCalls: Array<{ sql: string; args: unknown[] }> = []
  let cannedRow: Record<string, unknown> | undefined

  const fakeStatement = (sql: string) => {
    const run = (...args: unknown[]) => {
      runCalls.push({ sql, args })
      return { changes: args[0] === '__not_found__' ? 0 : 1 }
    }
    if (sql.includes('INSERT INTO matches')) {
      return { run, get: undefined, all: undefined }
    }
    if (sql.startsWith('UPDATE ')) {
      return { run, get: undefined, all: undefined }
    }
    if (sql.includes('FROM matches') && sql.includes('WHERE m.id = ?')) {
      return { run: (() => ({ changes: 0 })) as unknown, get: () => cannedRow ?? null, all: undefined }
    }
    if (sql.includes('COALESCE(MAX(match_number)')) {
      return { run, get: () => ({ m: 0 }), all: undefined }
    }
    if (sql.includes('SELECT name FROM')) {
      return { run, get: () => undefined, all: () => [{ name: 'match_id' }] }
    }
    if (sql.includes('FROM match_judge_votes') || sql.includes('FROM match_judges')) {
      return { run, get: () => undefined, all: () => [] }
    }
    return { run, get: () => undefined, all: () => (cannedRow ? [cannedRow] : []) }
  }

  return {
    runCalls,
    setRow: (r?: Record<string, unknown>) => {
      cannedRow = r
    },
    fakeStatement
  }
})

vi.mock('../../index', () => ({
  getDb: () => ({
    prepare: (sql: string) => h.fakeStatement(sql)
  })
}))

import { matchRepo, computeResult } from '../match.repo'

function baseRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    event_id: 'evt1',
    round_id: 'r1',
    match_number: 1,
    team_a_id: 'ta',
    team_b_id: 'tb',
    topic_id: null,
    stance_a: null,
    stance_b: null,
    draw_item_id: null,
    session_id: null,
    recording_ref: null,
    status: 'planned',
    winner: null,
    aff_score: null,
    neg_score: null,
    best_speaker: null,
    notes: null,
    ai_review: null,
    created_at: '2026-08-19T00:00:00.000Z',
    updated_at: '2026-08-19T00:00:00.000Z',
    team_a_name: '正方',
    team_b_name: '反方',
    topic_title: null,
    event_name: '预赛',
    round_name: '第一轮',
    ...over
  }
}

beforeEach(() => {
  h.runCalls.length = 0
  h.setRow(undefined)
})

describe('matchRepo', () => {
  it('create：返回带 id/eventId/status=planned 的比赛', () => {
    h.setRow(baseRow())
    const m = matchRepo.create({ eventId: 'evt1', roundId: 'r1', teamAffId: 'ta', teamNegId: 'tb' })
    expect(m).toBeTruthy()
    expect(m.eventId).toBe('evt1')
    expect(m.status).toBe('planned')
    expect(h.runCalls.some((c) => c.sql.includes('INSERT INTO matches'))).toBe(true)
  })

  it('getById：按 id 取回', () => {
    h.setRow(baseRow({ status: 'ready', topic_id: 'topic-1' }))
    const m = matchRepo.getById('m1')
    expect(m?.id).toBe('m1')
    expect(m?.topicId).toBe('topic-1')
  })

  it('listByEvent / listByRound：返回数组', () => {
    h.setRow(baseRow())
    expect(matchRepo.listByEvent('evt1')).toHaveLength(1)
    expect(matchRepo.listByRound('r1')).toHaveLength(1)
  })

  it('update：抽题后 status→ready 并写 topic/drawItem', () => {
    h.setRow(baseRow({ status: 'planned' }))
    const m = matchRepo.update('m1', { topicId: 'topic-1', drawItemId: 'item-1', stanceAff: '正方', stanceNeg: '反方' })
    expect(h.runCalls.some((c) => c.sql.includes('UPDATE matches'))).toBe(true)
    expect(m).toBeTruthy()
  })

  it('setResult：写入 winner/比分/最佳辩手，status→resulted', () => {
    h.setRow(baseRow({ status: 'ready' }))
    const m = matchRepo.setResult('m1', { winner: 'aff', affScore: 3, negScore: 2, bestSpeaker: '张三', notes: '全场最佳' })
    const upd = h.runCalls.find((c) => c.sql.includes('UPDATE matches'))
    expect(upd).toBeTruthy()
    expect(upd!.args[0]).toBe('aff')
    expect(upd!.args[1]).toBe(3)
    expect(upd!.args[2]).toBe(2)
    expect(upd!.args[3]).toBe('张三')
    expect(m).toBeTruthy()
  })

  it('setAiReview：存 ai_review（JSON）且不改动 winner', () => {
    h.setRow(baseRow({ status: 'ready' }))
    const m = matchRepo.setAiReview('m1', { winner: 'aff', explanation: '正方立论更稳', reviewedAt: '2026-08-19T00:00:00Z' })
    const upd = h.runCalls.find((c) => c.sql.includes('UPDATE matches'))
    expect(upd).toBeTruthy()
    expect(JSON.parse(String(upd!.args[0]))).toMatchObject({ winner: 'aff' })
    expect(m).toBeTruthy()
  })

  it('linkSession：同时写 matches.session_id 与 timer_sessions.match_id', () => {
    h.setRow(baseRow({ status: 'ready' }))
    matchRepo.linkSession('m1', 'sess-1')
    const matchUpd = h.runCalls.find((c) => c.sql.includes('UPDATE matches') && c.args[0] === 'sess-1')
    const sessUpd = h.runCalls.find((c) => c.sql.includes('UPDATE timer_sessions'))
    expect(matchUpd).toBeTruthy()
    expect(sessUpd).toBeTruthy()
    expect(sessUpd!.args[0]).toBe('m1')
    expect(sessUpd!.args[1]).toBe('sess-1')
  })

  it('upsertFromDraw：无同对阵时新建并配题（抽题结果计入该场比赛）', () => {
    h.setRow(baseRow({ status: 'ready', topic_id: 't1' }))
    const m = matchRepo.upsertFromDraw({
      eventId: 'evt1',
      roundId: 'r1',
      teamAffId: 'ta',
      teamNegId: 'tb',
      topicId: 't1',
      drawItemId: 'item-9',
      stanceAff: '正方',
      stanceNeg: '反方'
    })
    expect(h.runCalls.some((c) => c.sql.includes('INSERT INTO matches'))).toBe(true)
    expect(h.runCalls.some((c) => c.sql.includes('UPDATE matches'))).toBe(true)
    expect(m).toBeTruthy()
  })

  it('update（recordings）：按 BoundRecording[] 序列化写入 recording_meta', () => {
    h.setRow(baseRow())
    const recs = [{ id: 'rec-a', kind: 'whole' as const, filePath: '/x/a.webm', markers: [] }]
    matchRepo.update('m1', { recordings: recs })
    const upd = h.runCalls.find((c) => c.sql.includes('UPDATE matches'))
    expect(upd).toBeTruthy()
    const json = upd!.args.find((a) => typeof a === 'string' && String(a).includes('filePath'))
    expect(JSON.parse(String(json))).toEqual(recs)
  })

  it('update（旧 recordingMeta）：迁移为 BoundRecording[] 后写入 recording_meta', () => {
    h.setRow(baseRow())
    matchRepo.update('m1', {
      recordingMeta: { filePath: '/x/w.webm', segmentMode: 'whole', markers: [] }
    })
    const upd = h.runCalls.find((c) => c.sql.includes('UPDATE matches'))
    const json = upd!.args.find((a) => typeof a === 'string' && String(a).includes('filePath'))
    const arr = JSON.parse(String(json)) as Array<{ kind: string; filePath: string }>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({ kind: 'whole', filePath: '/x/w.webm' })
  })

  it('getById：读取旧 recordingMeta 对象 → 派生成一整场 whole 录音并回填 recordingMeta', () => {
    h.setRow(
      baseRow({
        recording_meta: JSON.stringify({
          filePath: '/x/w.webm',
          segmentMode: 'whole',
          markers: [{ tsMs: 0, stageId: 's1', stageName: '立论', side: 'aff', speaker: null }]
        })
      })
    )
    const m = matchRepo.getById('m1')
    expect(m?.recordings).toHaveLength(1)
    expect(m?.recordings![0].kind).toBe('whole')
    expect(m?.recordings![0].markers).toHaveLength(1)
    expect(m?.recordingMeta?.segmentMode).toBe('whole')
  })

  it('getById：读取 BoundRecording[] → 派生旧 recordingMeta（split）', () => {
    h.setRow(
      baseRow({
        recording_meta: JSON.stringify([{ id: 'rec-s1', kind: 'stage', filePath: '/x/s1.webm', stageId: 's1', tsMs: 0 }])
      })
    )
    const m = matchRepo.getById('m1')
    expect(m?.recordings).toHaveLength(1)
    expect(m?.recordings![0].kind).toBe('stage')
    expect(m?.recordingMeta?.segmentMode).toBe('split')
    expect(m?.recordingMeta?.markers[0].stageId).toBe('s1')
  })
})

// 纯函数聚合测试（computeResult 不依赖 DB，可直接测真实三票制/百分制）
function v(over: Partial<Parameters<typeof computeResult>[2][number]> = {}) {
  return {
    id: 'v',
    matchId: 'm1',
    judgeId: 'j',
    judgeSystem: 'three_votes' as const,
    impressionVote: null as 'aff' | 'neg' | null,
    decisionVote: null as 'aff' | 'neg' | null,
    affTotal: null,
    negTotal: null,
    stageScores: null,
    bestSpeaker: null,
    comment: null,
    createdAt: '',
    updatedAt: '',
    ...over
  }
}

describe('computeResult（多裁判亮牌聚合）', () => {
  it('三票制：3 名裁判 × 3 票，得票多者胜，亮出胜负牌（含各票型明细）', () => {
    const votes = [
      v({ judgeSystem: 'three_votes', impressionVote: 'aff', decisionVote: 'neg', affTotal: 58, negTotal: 42 }),
      v({ judgeSystem: 'three_votes', impressionVote: 'neg', decisionVote: 'neg', affTotal: 40, negTotal: 60 }),
      v({ judgeSystem: 'three_votes', impressionVote: 'aff', decisionVote: 'aff', affTotal: 55, negTotal: 45 })
    ]
    const r = computeResult('m1', [], votes)
    // 每名裁判：印象1 + 环节1(分高者) + 决胜1
    // J1 投 aff(印象) + aff(环节58>42) + neg(决胜) => aff2 neg1
    // J2 投 neg + neg + neg => neg3
    // J3 投 aff + aff + aff => aff3
    // 合计 aff=5 neg=4
    expect(r.winner).toBe('aff')
    expect(r.votes).toBeTruthy()
    expect(r.votes!.aff).toBe(5)
    expect(r.votes!.neg).toBe(4)
    expect(r.votes!.impression).toEqual({ aff: 2, neg: 1 })
    expect(r.votes!.stage).toEqual({ aff: 2, neg: 1 })
    expect(r.votes!.decision).toEqual({ aff: 1, neg: 2 })
    expect(r.affScore).toBeCloseTo((58 + 40 + 55) / 3, 5)
  })

  it('三票制：总票持平，决胜票多者胜', () => {
    const votes = [
      v({ judgeSystem: 'three_votes', impressionVote: 'aff', decisionVote: 'aff', affTotal: 60, negTotal: 40 }), // aff3 neg0
      v({ judgeSystem: 'three_votes', impressionVote: 'neg', decisionVote: 'neg', affTotal: 40, negTotal: 60 })  // neg3 aff0
    ]
    const r = computeResult('m1', [], votes)
    // 合计 aff3 neg3（平）→ 决胜票 aff1 neg1 仍平 → draw
    expect(r.winner).toBe('draw')
  })

  it('百分制：按各裁判分数多数决，平均分展示', () => {
    const votes = [
      v({ judgeSystem: 'percentage', affTotal: 80, negTotal: 75 }),
      v({ judgeSystem: 'percentage', affTotal: 70, negTotal: 72 }),
      v({ judgeSystem: 'percentage', affTotal: 82, negTotal: 78 })
    ]
    const r = computeResult('m1', [], votes)
    expect(r.winner).toBe('aff') // 2 名判 aff 赢，1 名判 neg 赢
    // 平均分展示保留 1 位小数（round1）
    expect(r.affScore).toBeCloseTo(Math.round((80 + 70 + 82) / 3 * 10) / 10, 5)
    expect(r.negScore).toBeCloseTo(Math.round((75 + 72 + 78) / 3 * 10) / 10, 5)
  })

  it('最佳辩手：各裁判票数众数', () => {
    const votes = [
      v({ judgeSystem: 'three_votes', bestSpeaker: '张三' }),
      v({ judgeSystem: 'three_votes', bestSpeaker: '李四' }),
      v({ judgeSystem: 'three_votes', bestSpeaker: '张三' })
    ]
    const r = computeResult('m1', [], votes)
    expect(r.bestSpeaker).toBe('张三')
  })
})