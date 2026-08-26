// ============================================================
// golden/normalize.ts — 结果标准化层（Cross-End Golden Tests 共享）
//
// 目的：消除「表现形式不同」——浮点位数 / null-undefined / 顺序 / 枚举别名 /
//       平台字段——让两端输出可稳定比较。
// 铁律：只做表示层折叠，禁止删除 winner / actual_ratio / 分布值 / stance 分配 /
//       轮数等真实业务输出。任何「看起来不同但不应断言」的项一律走
//       KNOWN_DIVERGENCES.md，不得用 normalize 抹平。
// 随 sync-core 同步到小程序仓。
// ============================================================

/** 数值保留 4 位小数（覆盖 match-result 分数、draw actualRatio、difficulty 分布小数） */
export function round4(n: number | null | undefined): number | null {
  if (n == null) return null
  return Math.round(n * 1e4) / 1e4
}

/** 递归把 undefined 折叠为 null（JSON fixture 无 undefined，运行时可能有） */
export function foldNull(v: unknown): unknown {
  if (v === undefined) return null
  if (Array.isArray(v)) return v.map(foldNull)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = foldNull(val)
    }
    return out
  }
  return v
}

/** id 数组排序（比较集合而非顺序） */
export function sortedIds(items: Array<{ id: string }> | string[] | undefined | null): string[] {
  if (!items) return []
  return items.map((it) => (typeof it === 'string' ? it : it.id)).slice().sort()
}

// ---- match-result ----

/** MatchResultSummary 语义投影：winner / affScore / negScore / isDraw / bestSpeaker / votes */
export function normalizeMatchResult(r: unknown): unknown {
  const o = (r ?? {}) as {
    winner?: string | null
    affScore?: number | null
    negScore?: number | null
    bestSpeaker?: string | null
    votes?: unknown
  }
  return foldNull({
    winner: o.winner ?? null,
    affScore: round4(o.affScore),
    negScore: round4(o.negScore),
    isDraw: o.winner === 'draw',
    bestSpeaker: o.bestSpeaker ?? null,
    votes: o.votes ?? null
  })
}

// ---- draw ----

/**
 * 单条 DrawItem 规范化：
 * - versus/solo（无 team_ids）：保留 team_a/team_b + stance 直读（同种子下确定性）
 * - group/multi_team（有 team_ids）：team↔stance 位置对按队伍 id 排序后输出，
 *   消除洗牌/分块顺序影响，保留「题 → 队伍集合 + 各自持方」语义
 */
export function canonicalDrawItem(item: unknown): unknown {
  const o = (item ?? {}) as {
    topic_id?: string
    team_a_id?: string | null
    team_b_id?: string | null
    stance_a?: string | null
    stance_b?: string | null
    team_ids?: string[] | null
    team_stances?: string[] | null
    group_id?: string | null
  }
  if (o.team_ids && Array.isArray(o.team_ids)) {
    const pairs = o.team_ids.map((id, i) => ({ id, stance: o.team_stances?.[i] ?? null }))
    pairs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return {
      topic_id: o.topic_id ?? null,
      group_id: o.group_id ?? null,
      teams: pairs
    }
  }
  return {
    topic_id: o.topic_id ?? null,
    team_a_id: o.team_a_id ?? null,
    team_b_id: o.team_b_id ?? null,
    stance_a: o.stance_a ?? null,
    stance_b: o.stance_b ?? null
  }
}

/** drawFromPool 结果规范化：topics 按 id 排序；items 按 topic_id 排序 + canonical；比例 round4 */
export function normalizeDrawResult(r: unknown): unknown {
  const o = (r ?? {}) as {
    topics?: Array<{ id: string }>
    items?: unknown[]
    actual_ratio?: { official: number; custom: number }
    effective_topic_count?: number
  }
  const items = (o.items ?? []).map(canonicalDrawItem).sort((a, b) => {
    const ta = (a as { topic_id?: string | null }).topic_id ?? ''
    const tb = (b as { topic_id?: string | null }).topic_id ?? ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })
  return foldNull({
    topic_ids: sortedIds(o.topics),
    items,
    actual_ratio:
      o.actual_ratio != null
        ? { official: round4(o.actual_ratio.official), custom: round4(o.actual_ratio.custom) }
        : null,
    effective_topic_count: o.effective_topic_count ?? null
  })
}

// ---- difficulty ----

/** DIFFICULTY_ROUND_PRESETS 语义投影（按 key 组织，丢弃 label 展示文案，保留 presets 规则） */
export function normalizeDifficultyPreset(presets: unknown): Record<string, unknown> {
  const arr = (presets ?? []) as Array<{ key?: string; presets?: unknown }>
  const out: Record<string, unknown> = {}
  for (const p of arr) {
    if (p.key) out[p.key] = p.presets ?? []
  }
  return out
}

// ---- format ----

/** StageDef 语义字段投影（丢弃 name 标题类/主题/背景等） */
function canonicalStage(s: unknown): unknown {
  const o = (s ?? {}) as {
    id?: string
    side?: string
    durationMs?: number
    graceMs?: number
    bells?: Array<{ atMs: number; sound: string; customBellId?: string }>
    isFreeDebate?: boolean
    timingMode?: string
    isBellPreview?: boolean
    poolTeam?: string
    poolSuggestedMs?: number
    speaker?: string
    weight?: number
  }
  return foldNull({
    id: o.id ?? null,
    side: o.side ?? null,
    durationMs: o.durationMs ?? null,
    graceMs: o.graceMs ?? null,
    bells: (o.bells ?? []).map((b) => ({
      atMs: b.atMs ?? null,
      sound: b.sound ?? null,
      customBellId: b.customBellId ?? null
    })),
    isFreeDebate: o.isFreeDebate ?? null,
    timingMode: o.timingMode ?? null,
    isBellPreview: o.isBellPreview ?? null,
    poolTeam: o.poolTeam ?? null,
    poolSuggestedMs: o.poolSuggestedMs ?? null,
    speaker: o.speaker ?? null,
    weight: o.weight ?? null
  })
}

/** DebateFormatData 语义投影：只保留业务语义字段，丢弃主题/背景/标题类 */
export function normalizeFormatData(f: unknown): unknown {
  const o = (f ?? {}) as {
    stages?: unknown[]
    totalDurationMs?: number
    teamPoolMinutes?: { aff: number; neg: number }
  }
  return foldNull({
    stages: (o.stages ?? []).map(canonicalStage),
    totalDurationMs: o.totalDurationMs ?? null,
    teamPoolMinutes: o.teamPoolMinutes ?? null
  })
}
