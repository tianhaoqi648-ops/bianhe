// ============================================================
// matchRecordingKit.ts — AI 裁判工作台「录音」相关的纯函数工具（T3/T4/T5）
//
// 覆盖：多录音归一化（新 recordings / 旧 recordingMeta 迁移）、
//       缺失态判定（exists 逐份校验后的可用/全部缺失）、
//       多段归并组装（transcription tracks → timeline 片段）、
//       绑定动作构造（add/remove/replace/set）。
// 均为无 electron DOM 依赖的纯函数，可在 vitest 中直接单测，
// 供 JudgeArena.tsx 与 RecordingBindPanel.tsx 复用。
// ============================================================

import type {
  BoundRecording,
  MatchRecordingMeta,
  RecordingBindAction,
  SttSegment
} from '../../../shared/types'
import { boundRecordingsFromMeta } from '../../../shared/match-recording'

/** 一场比赛的录音来源快照（新 recordings 数组最高优先，旧 recordingMeta 兜底迁移） */
export interface MatchRecordingLike {
  recordings?: BoundRecording[] | null
  recordingMeta?: MatchRecordingMeta | null
}

/**
 * 归一化有序录音列表。
 * - recordings 数组非空 → 直接采用（新多录音模型）；
 * - 否则回退 boundRecordingsFromMeta 迁移旧 recordingMeta（whole/split → BoundRecording[]）；
 * - 均无 → 空数组。
 */
export function resolveMatchRecordings(m: MatchRecordingLike | null | undefined): BoundRecording[] {
  if (!m) return []
  if (Array.isArray(m.recordings)) return m.recordings
  return boundRecordingsFromMeta(m.recordingMeta)
}

/** 存在性映射：BoundRecording.id → 文件是否存在（未登记的键视为存在，由 UI 的 checked 态兜底） */
export type RecordingExistsMap = Readonly<Record<string, boolean>>

/** 带存在性标注的录音 */
export interface RecordingWithExists {
  recording: BoundRecording
  id: string
  exists: boolean
}

/** 为每份录音标注其文件是否存在（缺省视为 true，UI 层用 checked 态区分"尚未校验"） */
export function withExists(recordings: BoundRecording[], exists: RecordingExistsMap): RecordingWithExists[] {
  return (recordings ?? []).map((r) => ({ recording: r, id: r.id, exists: exists[r.id] !== false }))
}

/** 可用（文件存在）的录音 */
export function availableRecordings(list: RecordingWithExists[]): RecordingWithExists[] {
  return list.filter((x) => x.exists)
}

/** 缺失（文件不存在）的录音 */
export function missingRecordings(list: RecordingWithExists[]): RecordingWithExists[] {
  return list.filter((x) => !x.exists)
}

/** 是否存在至少一份可用录音（可作为"录音相关入口是否可用"的门槛） */
export function hasAvailableRecording(list: RecordingWithExists[]): boolean {
  return list.some((x) => x.exists)
}

/** 全部缺失：有录音（非空）但无任何一份可用。空列表不视为全部缺失（无从谈起） */
export function allRecordingsMissing(list: RecordingWithExists[]): boolean {
  return list.length > 0 && !list.some((x) => x.exists)
}

/** 录音转写需要的环节/发言人标记（复用 SttRequest.markers 形态） */
export type SttMarkers = Array<{ stage: string; speaker?: string; atMs: number }>

/** 由一份录音构造其转写标记；无 markers 返回 undefined（整段转写） */
export function markersForRecording(r: BoundRecording): SttMarkers | undefined {
  const marks = r.markers ?? []
  if (marks.length === 0) return undefined
  return marks.map((m) => ({
    stage: m.stageName ?? m.stageId ?? '未命名环节',
    speaker: m.speaker ?? undefined,
    atMs: m.tsMs ?? 0
  }))
}

/** 取路径最后一段文件名（双分隔符兼容，无 path 依赖） */
export function filenameOf(filePath: string): string {
  const p = filePath || ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 一份录音的可读标签（整场/环节 + 文件名） */
export function labelOfRecording(r: BoundRecording): string {
  const base = filenameOf(r.filePath)
  return r.kind === 'whole' ? (base ? `整场 · ${base}` : '整场录音') : base ? `环节 · ${base}` : '环节录音'
}

/** 组装时间线的片段（JudgeArena / 复盘 / 历史展示共用） */
export interface AssembleSeg {
  stage?: string
  stageName?: string
  side?: string | null
  speaker?: string | null
  tsMs?: number
  content: string
  /** 该片段来源缺失录音（缺失占位，不阻塞其余段评审） */
  missing?: boolean
  /** 来源录音 id */
  sourceId?: string
}

/** 一份已转写（或缺失占位）的录音轨道 */
export interface TranscribedTrack {
  recording: BoundRecording
  missing?: boolean
  /** 该份录音的转写结果；null/空数组可表示"已尝试但无有效内容" */
  segs?: SttSegment[] | null
}

/**
 * 多段归并组装：把多份录音（含缺失占位的缺失份）的顺序转写结果合并成时间线片段。
 * - 缺失份 → 插入一条 missing 占位（标注缺失，不阻塞其余段评审）；
 * - 可用份 → 展平其转写 segs（stage/speaker/atMs/text）；
 * - 保持入参顺序（即录音绑定顺序），供时间线有序展示。
 */
export function assembleSegsFromTracks(tracks: TranscribedTrack[]): AssembleSeg[] {
  const out: AssembleSeg[] = []
  for (const tr of tracks ?? []) {
    if (tr.missing) {
      out.push({
        stageName: labelOfRecording(tr.recording),
        missing: true,
        sourceId: tr.recording.id,
        content: ''
      })
      continue
    }
    const segs = tr.segs ?? []
    if (segs.length === 0) continue
    for (const s of segs) {
      out.push({
        stage: s.stage ?? tr.recording.stageId ?? undefined,
        stageName: s.stage ?? tr.recording.stageId ?? undefined,
        side: null,
        speaker: s.speaker ?? null,
        tsMs: s.atMs ?? undefined,
        content: s.text,
        sourceId: tr.recording.id
      })
    }
  }
  return out
}

/** 由录音取排序参考时间（whole 取首个 marker；stage 取自身 tsMs；无则 null） */
function tsOfRecording(r: BoundRecording): number | null {
  if (r.kind === 'stage') return r.tsMs ?? null
  return r.markers?.[0]?.tsMs ?? null
}

/** 按参考时间升序稳定归并（用于按环节/时间组装）；无时间的保持原顺序靠后 */
export function orderByTs(list: RecordingWithExists[]): RecordingWithExists[] {
  return list
    .map((x, idx) => ({ x, idx, ts: tsOfRecording(x.recording) ?? Infinity }))
    .sort((a, b) => a.ts - b.ts || a.idx - b.idx)
    .map((y) => y.x)
}

// ---------- 绑定动作构造（T4：recordingAPI.bind 入参，纯函数便于单测） ----------

export function bindAdd(matchId: string, recording: BoundRecording): RecordingBindAction {
  return { kind: 'add', matchId, recording }
}

export function bindRemove(matchId: string, id: string): RecordingBindAction {
  return { kind: 'remove', matchId, id }
}

export function bindReplace(matchId: string, id: string, recording: BoundRecording): RecordingBindAction {
  return { kind: 'replace', matchId, id, recording }
}

export function bindSet(matchId: string, recordings: BoundRecording[] | null): RecordingBindAction {
  return { kind: 'set', matchId, recordings }
}