// ============================================================
// match.repo.ts — 比赛（matches）多裁判 CRUD + 赛果聚合
//
// 以「比赛」为中心，重建为真实辩论赛的多裁判评决模型：
//   赛事 → 轮次 下的一场对阵（正方/反方 + 辩题 + 若干裁判），
//   承载 抽题(→topic_id/draw_item_id) → 计时(→session_id/recording_meta) →
//   赛果(多裁判 votes → 亮牌 winner/best_speaker) → 可选 AI 评审(ai_review)。
//
// 评决制度（match.judge_system 可切换）：
//   - three_votes 三轮投票制：每位裁判 印象票 + 环节票(基于本方环节加权累计) + 决胜票，N 席×3 票汇总；
//   - percentage  百分制：每位裁判对双方给 0-100 分，取平均分高者胜。
// 环节权重可配置（来自赛事格式格式，缺省等权）。
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import { computeMatchResult, type MatchResultSummary } from '../../../shared/match-result'
import type {
  Match,
  MatchAiReview,
  MatchCreateInput,
  MatchJudge,
  MatchJudgeSystem,
  MatchJudgeVote,
  MatchJudgeVoteInput,
  MatchRecordingMeta,
  MatchSetResultInput,
  MatchStatus,
  MatchUpdateInput,
  MatchWinner
} from '../../../shared/types'

// ============================================================
// 行类型 & 映射
// ============================================================

interface MatchRow {
  id: string
  event_id: string
  round_id: string | null
  match_number: number | null
  team_a_id: string | null
  team_b_id: string | null
  topic_id: string | null
  stance_a: string | null
  stance_b: string | null
  format_id: string | null
  judge_system: string
  draw_item_id: string | null
  session_id: string | null
  recording_ref: string | null
  recording_meta: string | null
  status: string
  winner: string | null
  aff_score: number | null
  neg_score: number | null
  best_speaker: string | null
  notes: string | null
  ai_review: string | null
  created_at: string
  updated_at: string
  team_a_name: string | null
  team_b_name: string | null
  topic_title: string | null
  event_name: string | null
  round_name: string | null
}

interface JudgeRow {
  id: string
  match_id: string
  name: string
  sort_order: number
  is_ai: number
  created_at: string
}

interface VoteRow {
  id: string
  match_id: string
  judge_id: string
  judge_system: string
  impression_vote: string | null
  decision_vote: string | null
  aff_total: number | null
  neg_total: number | null
  stage_scores: string | null
  best_speaker: string | null
  comment: string | null
  created_at: string
  updated_at: string
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToMatch(row: MatchRow): Match {
  const recordingMeta = safeJsonParse<MatchRecordingMeta | null>(row.recording_meta, null)
  return {
    id: row.id,
    eventId: row.event_id,
    roundId: row.round_id,
    matchNumber: row.match_number,
    teamAffId: row.team_a_id,
    teamNegId: row.team_b_id,
    topicId: row.topic_id,
    stanceAff: row.stance_a,
    stanceNeg: row.stance_b,
    formatId: row.format_id,
    judgeSystem: (row.judge_system as MatchJudgeSystem) || 'three_votes',
    drawItemId: row.draw_item_id,
    sessionId: row.session_id,
    recordingRef: row.recording_ref,
    recordingMeta,
    status: row.status as MatchStatus,
    winner: row.winner as MatchWinner | null,
    affScore: row.aff_score,
    negScore: row.neg_score,
    bestSpeaker: row.best_speaker,
    notes: row.notes,
    aiReview: safeJsonParse<MatchAiReview | null>(row.ai_review, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    teamAffName: row.team_a_name ?? '正方',
    teamNegName: row.team_b_name ?? '反方',
    topicTitle: row.topic_title,
    eventName: row.event_name,
    roundName: row.round_name
  }
}

function rowToJudge(row: JudgeRow): MatchJudge {
  return {
    id: row.id,
    matchId: row.match_id,
    name: row.name,
    sortOrder: row.sort_order,
    isAi: !!row.is_ai,
    createdAt: row.created_at
  }
}

function rowToVote(row: VoteRow): MatchJudgeVote {
  return {
    id: row.id,
    matchId: row.match_id,
    judgeId: row.judge_id,
    judgeSystem: (row.judge_system as MatchJudgeSystem) || 'three_votes',
    impressionVote: (row.impression_vote as 'aff' | 'neg' | null) ?? null,
    decisionVote: (row.decision_vote as 'aff' | 'neg' | null) ?? null,
    affTotal: row.aff_total ?? null,
    negTotal: row.neg_total ?? null,
    stageScores: safeJsonParse(row.stage_scores, null),
    bestSpeaker: row.best_speaker,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const SELECT_SQL = `
  SELECT m.*,
    COALESCE(a.name, m.team_a_name) AS team_a_name,
    COALESCE(b.name, m.team_b_name) AS team_b_name,
    COALESCE(t.title, m.topic_title) AS topic_title,
    COALESCE(e.name, m.event_name) AS event_name,
    COALESCE(r.name, m.round_name) AS round_name
  FROM matches m
  LEFT JOIN teams a ON a.id = m.team_a_id
  LEFT JOIN teams b ON b.id = m.team_b_id
  LEFT JOIN topics t ON t.id = m.topic_id
  LEFT JOIN events e ON e.id = m.event_id
  LEFT JOIN rounds r ON r.id = m.round_id
`

function getMatchRow(id: string): MatchRow | undefined {
  return getDb().prepare(`${SELECT_SQL} WHERE m.id = ?`).get(id) as MatchRow | undefined
}

function listJudgeRows(matchId: string): JudgeRow[] {
  return getDb()
    .prepare('SELECT * FROM match_judges WHERE match_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(matchId) as JudgeRow[]
}

function listVoteRows(matchId: string): VoteRow[] {
  return getDb()
    .prepare('SELECT * FROM match_judge_votes WHERE match_id = ? ORDER BY created_at ASC')
    .all(matchId) as VoteRow[]
}

/** 组装完整比赛（含裁判 + 评决） */
function hydrate(match: Match): Match {
  return {
    ...match,
    judges: listJudgeRows(match.id).map(rowToJudge),
    votes: listVoteRows(match.id).map(rowToVote)
  }
}

function resolveNames(row: {
  team_a_id: string | null
  team_b_id: string | null
  topic_id: string | null
  event_id: string
  round_id: string | null
}): { team_a_name: string | null; team_b_name: string | null; topic_title: string | null; event_name: string; round_name: string | null } {
  const db = getDb()
  const teamA = row.team_a_id ? (db.prepare('SELECT name FROM teams WHERE id = ?').get(row.team_a_id) as { name: string } | undefined) : undefined
  const teamB = row.team_b_id ? (db.prepare('SELECT name FROM teams WHERE id = ?').get(row.team_b_id) as { name: string } | undefined) : undefined
  const topic = row.topic_id ? (db.prepare('SELECT title FROM topics WHERE id = ?').get(row.topic_id) as { title: string } | undefined) : undefined
  const event = db.prepare('SELECT name FROM events WHERE id = ?').get(row.event_id) as { name: string } | undefined
  const round = row.round_id ? (db.prepare('SELECT name FROM rounds WHERE id = ?').get(row.round_id) as { name: string } | undefined) : undefined
  return {
    team_a_name: teamA?.name ?? null,
    team_b_name: teamB?.name ?? null,
    topic_title: topic?.title ?? null,
    event_name: event?.name ?? row.event_id,
    round_name: round?.name ?? null
  }
}

// ============================================================
// 比赛 CRUD
// ============================================================

function createMatch(data: MatchCreateInput): Match {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  const names = resolveNames({ team_a_id: data.teamAffId ?? null, team_b_id: data.teamNegId ?? null, topic_id: data.topicId ?? null, event_id: data.eventId, round_id: data.roundId ?? null })

  db.prepare(`
    INSERT INTO matches (
      id, event_id, round_id, match_number, team_a_id, team_b_id, topic_id,
      stance_a, stance_b, format_id, judge_system, status, created_at, updated_at,
      team_a_name, team_b_name, topic_title, event_name, round_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.eventId, data.roundId ?? null, data.matchNumber ?? null,
    data.teamAffId ?? null, data.teamNegId ?? null, data.topicId ?? null,
    data.stanceAff ?? null, data.stanceNeg ?? null,
    data.formatId ?? null, data.judgeSystem ?? 'three_votes',
    now, now,
    names.team_a_name, names.team_b_name, names.topic_title, names.event_name, names.round_name
  )

  const row = getMatchRow(id)
  if (!row) throw new Error(`[matchRepo] createMatch: not found, id=${id}`)
  return hydrate(rowToMatch(row))
}

function updateMatch(id: string, data: MatchUpdateInput): Match | null {
  const db = getDb()
  const existing = getMatchRow(id)
  if (!existing) return null
  const map: Record<string, string> = {
    teamAffId: 'team_a_id',
    teamNegId: 'team_b_id',
    topicId: 'topic_id',
    stanceAff: 'stance_a',
    stanceNeg: 'stance_b',
    formatId: 'format_id',
    judgeSystem: 'judge_system',
    drawItemId: 'draw_item_id',
    recordingRef: 'recording_ref',
    recordingMeta: 'recording_meta'
  }
  const sets: string[] = []
  const vals: Array<string | number | null> = []
  for (const [key, col] of Object.entries(map)) {
    const v = data[key as keyof MatchUpdateInput]
    if (v === undefined) continue
    sets.push(`${col} = ?`)
    vals.push(typeof v === 'string' ? v : v === null ? null : JSON.stringify(v))
  }
  // 有队伍/辩题变更时刷新快照
  const refresh =
    data.teamAffId !== undefined || data.teamNegId !== undefined ||
    data.topicId !== undefined || data.stanceAff !== undefined || data.stanceNeg !== undefined
  const now = new Date().toISOString()
  if (refresh) {
    const names = resolveNames({
      team_a_id: (data.teamAffId ?? existing.team_a_id) as string | null,
      team_b_id: (data.teamNegId ?? existing.team_b_id) as string | null,
      topic_id: (data.topicId ?? existing.topic_id) as string | null,
      event_id: existing.event_id,
      round_id: existing.round_id
    })
    sets.push('team_a_name = ?', 'team_b_name = ?', 'topic_title = ?', 'event_name = ?', 'round_name = ?')
    vals.push(names.team_a_name, names.team_b_name, names.topic_title, names.event_name, names.round_name)
  }
  if (sets.length === 0) {
    // 无有效变更：仅更新时间戳触碰
    db.prepare('UPDATE matches SET updated_at = ? WHERE id = ?').run(now, id)
    const r = getMatchRow(id)
    return r ? hydrate(rowToMatch(r)) : null
  }
  sets.push('updated_at = ?')
  vals.push(now, id)
  db.prepare(`UPDATE matches SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  const r = getMatchRow(id)
  return r ? hydrate(rowToMatch(r)) : null
}

function deleteMatch(id: string): void {
  getDb().prepare('DELETE FROM matches WHERE id = ?').run(id)
}

/**
 * 计时启动时回写关联：matches.session_id 与 timer_sessions.match_id。
 */
function linkSession(matchId: string, sessionId: string): Match | null {
  const db = getDb()
  db.prepare('UPDATE matches SET session_id = ?, updated_at = ? WHERE id = ?').run(sessionId, new Date().toISOString(), matchId)
  // 幂等：timer_sessions.match_id 列存在则回写
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('timer_sessions')")
    .all() as Array<{ name: string }>
  if (cols.some((c) => c.name === 'match_id')) {
    db.prepare('UPDATE timer_sessions SET match_id = ? WHERE id = ? AND match_id IS NULL').run(matchId, sessionId)
  }
  return getMatchById(matchId)
}

/**
 * 抽题结果申领该轮对阵：同 (event, round, 双队) 且未计赛果的比赛已存在则更新，
 * 否则新建。实现"抽题结果计入那个轮次的相应比赛"。
 */
function upsertFromDraw(data: {
  eventId: string
  roundId: string | null
  teamAffId: string
  teamNegId: string
  topicId: string
  drawItemId: string
  stanceAff: string | null
  stanceNeg: string | null
}): Match {
  const db = getDb()
  const existing = db
    .prepare(
      `${SELECT_SQL} WHERE m.event_id = ? AND m.round_id IS ? AND m.team_a_id = ? AND m.team_b_id = ? AND m.status = 'planned' ORDER BY m.created_at ASC LIMIT 1`
    )
    .get(data.eventId, data.roundId, data.teamAffId, data.teamNegId) as MatchRow | undefined
  if (existing) {
    const updated = updateMatch(existing.id, {
      topicId: data.topicId,
      drawItemId: data.drawItemId,
      stanceAff: data.stanceAff,
      stanceNeg: data.stanceNeg
    })
    if (updated) return updated
  }
  const created = createMatch({
    eventId: data.eventId,
    roundId: data.roundId,
    teamAffId: data.teamAffId,
    teamNegId: data.teamNegId,
    topicId: data.topicId,
    stanceAff: data.stanceAff,
    stanceNeg: data.stanceNeg
  })
  if (data.drawItemId) {
    const linked = updateMatch(created.id, { drawItemId: data.drawItemId })
    if (linked) return linked
  }
  return created
}

function getMatchById(id: string): Match | null {
  const row = getMatchRow(id)
  return row ? hydrate(rowToMatch(row)) : null
}

function listMatchesByEvent(eventId: string): Match[] {
  const rows = getDb().prepare(`${SELECT_SQL} WHERE m.event_id = ? ORDER BY m.match_number ASC, m.created_at ASC`).all(eventId) as MatchRow[]
  return rows.map((r) => hydrate(rowToMatch(r)))
}

function listMatchesByRound(roundId: string): Match[] {
  const rows = getDb().prepare(`${SELECT_SQL} WHERE m.round_id = ? ORDER BY m.match_number ASC, m.created_at ASC`).all(roundId) as MatchRow[]
  return rows.map((r) => hydrate(rowToMatch(r)))
}

// ============================================================
// 裁判 & 评决 CRUD
// ============================================================

/** 重建某场比赛的裁判列表与评决（先删后插）。返回新的裁判+评决。 */
function replaceJudges(matchId: string, judges: Array<{ id?: string; name: string; isAi?: boolean; vote?: MatchJudgeVoteInput }>): { judges: MatchJudge[]; votes: MatchJudgeVote[] } {
  const db = getDb()
  const match = getMatchRow(matchId)
  if (!match) throw new Error(`[matchRepo] replaceJudges: match not found, id=${matchId}`)
  const system: MatchJudgeSystem = (match.judge_system as MatchJudgeSystem) || 'three_votes'

  // 先删旧
  db.prepare('DELETE FROM match_judge_votes WHERE match_id = ?').run(matchId)
  db.prepare('DELETE FROM match_judges WHERE match_id = ?').run(matchId)

  const now = new Date().toISOString()
  const judgeRows: MatchJudge[] = []
  const voteRows: MatchJudgeVote[] = []
  judges.forEach((j, idx) => {
    const jid = j.id ?? uuidv4()
    db.prepare('INSERT INTO match_judges (id, match_id, name, sort_order, is_ai, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(jid, matchId, j.name.trim() || `裁判${idx + 1}`, idx, j.isAi ? 1 : 0, now)
    judgeRows.push({ id: jid, matchId, name: j.name.trim() || `裁判${idx + 1}`, sortOrder: idx, isAi: !!j.isAi, createdAt: now })

    const v = j.vote
    const vid = uuidv4()
    const recordedSystem = v?.judgeSystem ?? system
    const stageScores = v?.stageScores ? JSON.stringify(v.stageScores) : null
    // 百分制：未显式给 affTotal 时用 stageScores 之和；否则取原始值
    let affTotal = v?.affTotal ?? null
    let negTotal = v?.negTotal ?? null
    if (stageScores && affTotal === null && negTotal === null) {
      const parsed = v?.stageScores ?? []
      affTotal = round1(parsed.reduce((s, x) => s + (x.aff ?? 0) * (x.weight || 1), 0))
      negTotal = round1(parsed.reduce((s, x) => s + (x.neg ?? 0) * (x.weight || 1), 0))
    }
    db.prepare(`
      INSERT INTO match_judge_votes (
        id, match_id, judge_id, judge_system, impression_vote, decision_vote,
        aff_total, neg_total, stage_scores, best_speaker, comment, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vid, matchId, jid, recordedSystem,
      v?.impressionVote ?? null, v?.decisionVote ?? null,
      affTotal, negTotal, stageScores, v?.bestSpeaker ?? null, v?.comment ?? null, now, now
    )
    voteRows.push({
      id: vid, matchId, judgeId: jid, judgeSystem: recordedSystem,
      impressionVote: v?.impressionVote ?? null, decisionVote: v?.decisionVote ?? null,
      affTotal, negTotal, stageScores: v?.stageScores ?? null,
      bestSpeaker: v?.bestSpeaker ?? null, comment: v?.comment ?? null, createdAt: now, updatedAt: now
    })
  })

  return { judges: judgeRows, votes: voteRows }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ============================================================
// 赛果聚合（评委亮牌：胜负 + 最佳辩手）
// ============================================================

export type MatchResult = MatchResultSummary

/**
 * 依据 match_judge_votes 聚合赛果，委托 shared/match-result.computeMatchResult
 * （与渲染端亮牌预览共用同一实现，避免两处口径不一致）。
 */
export function computeResult(matchId: string, _judges: MatchJudge[], votes: MatchJudgeVote[]): MatchResult {
  void matchId
  const system: MatchJudgeSystem = votes[0]?.judgeSystem ?? 'three_votes'
  return computeMatchResult(system, votes)
}

/** 计入赛果：写裁判+评决 → 聚合 → 落 winner/aff_score/neg_score/best_speaker/notes，status=resulted */
function setResult(matchId: string, data: MatchSetResultInput): Match | null {
  const db = getDb()
  const match = getMatchRow(matchId)
  if (!match) return null

  if (data.judges && data.judges.length) {
    const sys = data.judges[0]?.vote?.judgeSystem ?? ((match.judge_system as MatchJudgeSystem) || 'three_votes')
    // 显式指定个别裁判评决制度？统一用比赛制度。若 judges[0].vote.judgeSystem 为空，则沿用比赛制度。
    replaceJudges(matchId, data.judges)
    if (sys !== match.judge_system) {
      db.prepare('UPDATE matches SET judge_system = ? WHERE id = ?').run(sys, matchId)
    }
  }

  const jRows = listJudgeRows(matchId)
  const vRows = listVoteRows(matchId)
  const result = computeResult(matchId, jRows.map(rowToJudge), vRows.map(rowToVote))

  // 胜负判定：有裁判评决 → 多裁判聚合；无评决（如直接记弃赛）→ 采用显式 winner
  const finalWinner =
    vRows.length > 0
      ? (data.winner === 'abandoned' ? 'abandoned' : result.winner)
      : data.winner
  const finalAffScore = data.affScore ?? (vRows.length ? result.affScore : null)
  const finalNegScore = data.negScore ?? (vRows.length ? result.negScore : null)
  const finalBestSpeaker = data.bestSpeaker ?? result.bestSpeaker

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE matches SET
      winner = ?, aff_score = ?, neg_score = ?, best_speaker = ?, notes = ?,
      status = 'resulted', updated_at = ?
    WHERE id = ?
  `).run(
    finalWinner,
    finalAffScore,
    finalNegScore,
    finalBestSpeaker,
    data.notes ?? null,
    now,
    matchId
  )

  const r = getMatchRow(matchId)
  return r ? hydrate(rowToMatch(r)) : null
}

/** 保存 AI 评审（不回写人工赛果） */
function saveAiReview(matchId: string, review: MatchAiReview): Match | null {
  const db = getDb()
  const match = getMatchRow(matchId)
  if (!match) return null
  const now = new Date().toISOString()
  db.prepare('UPDATE matches SET ai_review = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(review), now, matchId)
  const r = getMatchRow(matchId)
  return r ? hydrate(rowToMatch(r)) : null
}

// ============================================================
// 导出
// ============================================================

export const matchRepo = {
  create: createMatch,
  update: updateMatch,
  delete: deleteMatch,
  getById: getMatchById,
  listByEvent: listMatchesByEvent,
  listByRound: listMatchesByRound,
  setResult,
  replaceJudges,
  computeResult,
  setAiReview: saveAiReview,
  linkSession,
  upsertFromDraw
}