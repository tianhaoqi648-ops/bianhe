// ============================================================
// match-recording.ts — 计时录音的纯函数工具（共享层）
//
// 与录音/计时相关的纯逻辑集中在此，供 main（recording-storage）
// 与 renderer（TimerPage / EventMatchesTab）两侧复用，且不含
// electron / node ABI 依赖，便于在 vitest 中直接单测。
// ============================================================

import type { MatchRecordingMarker, MatchRecordingMeta } from './types'
import type { StageDef, StageSide } from './debate-formats/types'
import { stageSpeakerLabel } from './debate-formats/utils'

/** 录音分段模式 */
export type RecordingSegmentMode = 'whole' | 'split'

/** 录音格式：'wav'（PCM，可拖动进度条 / 体积大）/ 'webm'（体积小，进度条不可拖）/ 'm4a'（AAC，体积小且可拖，需 MediaRecorder 支持 audio/mp4） */
export type RecordingFormat = 'webm' | 'wav' | 'm4a'

/** settings 表里录音存放目录的 key */
export const RECORDING_DIR_KEY = 'recording.dir'

/** settings 表里转写引擎（STT）存放目录的 key */
export const STT_DIR_KEY = 'stt.dir'

/** settings 表里录音分段模式的 key（缺失默认 'whole'） */
export const RECORDING_SEGMENT_KEY = 'recording.segmentMode'

/** settings 表里录音格式的 key（缺失默认 'wav'） */
export const RECORDING_FORMAT_KEY = 'recording.format'

/** 解析分段设置值 → 'whole' | 'split'（非 'split' 一律回退 'whole'） */
export function resolveSegmentMode(value: unknown): RecordingSegmentMode {
  return value === 'split' ? 'split' : 'whole'
}

/** 解析录音格式设置值 → 'm4a' | 'webm' | 'wav'（显式 m4a/webm 按其值，其余回退默认 'wav'） */
export function resolveRecordingFormat(value: unknown): RecordingFormat {
  return value === 'm4a' ? 'm4a' : value === 'webm' ? 'webm' : 'wav'
}

/**
 * 标记时间点格式化为 mm:ss（>= 1 小时显示 h:mm:ss）。
 * 用于录音标记时间线展示。
 */
export function formatMarkerTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 构造一条环节/发言人标记。
 * @param stage 当前环节（stage.speaker 优先，缺省按 side 兜底）
 * @param tsMs 距录音起点毫秒
 */
export function buildMarker(stage: StageDef, tsMs: number): MatchRecordingMarker {
  const speaker = stageSpeakerLabel(stage)
  return {
    tsMs,
    stageId: stage.id,
    stageName: stage.name,
    side: (stage.side as StageSide | null) ?? null,
    speaker: speaker || null
  }
}

/** 录音文件基础名：match-<matchId8>-<ts>[--<stageId>] */
export function buildRecordingBaseName(matchId: string | undefined, ts: number, stageId?: string): string {
  const id8 = (matchId || 'untracked').slice(0, 8)
  const core = `match-${id8}-${ts}`
  return stageId ? `${core}-${stageId}` : core
}

/** 依据 mimeType 生成录音文件名（含扩展名）。mimeType 如 'audio/webm'、'audio/webm;codecs=opus' */
export function buildRecordingFileName(
  matchId: string | undefined,
  ts: number,
  mimeType: string,
  stageId?: string,
  format?: RecordingFormat
): string {
  // 显式 format 优先以其扩展名为准；未传时回退旧逻辑由 mimeType 推导
  const ext =
    format === 'webm' ? 'webm'
      : format === 'wav' ? 'wav'
        : format === 'm4a' ? 'm4a'
          : (mimeType.split('/')[1] || 'webm').split(';')[0] || 'webm'
  return `${buildRecordingBaseName(matchId, ts, stageId)}.${ext}`
}

/**
 * 同名去重：若 safeName 已存在于 existing，追加时间戳后缀返回新名；
 * 否则原样返回。与 recording-storage.saveRecording 的唯一化语义一致。
 */
export function uniqueRecordingFileName(safeName: string, existing: string[]): string {
  if (!existing.includes(safeName)) return safeName
  const dot = safeName.lastIndexOf('.')
  const ext = dot >= 0 ? safeName.slice(dot) : ''
  const name = dot >= 0 ? safeName.slice(0, dot) : safeName
  return `${name}-${Date.now()}${ext}`
}

/**
 * 依据文件扩展名描述录音格式（供回放区提示用）。纯函数，无 DOM 依赖。
 * - `.wav` → 'WAV（可拖动进度条）'
 * - `.m4a` / `.mp4` → 'M4A（AAC）'
 * - 其它（`.webm` 或未知/无扩展名）→ 'WebM/未知，可能无法拖动进度条'
 */
export function describeRecordingFormatExt(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
  if (ext === 'wav') return 'WAV（可拖动进度条）'
  if (ext === 'm4a' || ext === 'mp4') return 'M4A（AAC）'
  return 'WebM/未知，可能无法拖动进度条'
}

/** 整场一轨（whole）的 recording_meta 组装 */
export function buildWholeMeta(filePath: string, markers: MatchRecordingMarker[]): MatchRecordingMeta {
  return { filePath, segmentMode: 'whole', markers }
}

/** 按环节分段（split）的 recording_meta 组装。
 *  分片文件路径记在各 markers.filePath 上；meta.filePath 取首个分片，无则留空 */
export function buildSplitMeta(markers: MatchRecordingMarker[]): MatchRecordingMeta {
  const first = markers.find((m) => m.filePath)
  return { filePath: first?.filePath ?? '', segmentMode: 'split', markers }
}