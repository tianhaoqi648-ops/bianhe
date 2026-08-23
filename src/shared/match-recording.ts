// ============================================================
// match-recording.ts — 计时录音的纯函数工具（共享层）
//
// 与录音/计时相关的纯逻辑集中在此，供 main（recording-storage）
// 与 renderer（TimerPage / EventMatchesTab）两侧复用，且不含
// electron / node ABI 依赖，便于在 vitest 中直接单测。
// ============================================================

import type { MatchRecordingMarker, MatchRecordingMeta, BoundRecording } from './types'
import type { StageDef, StageSide } from './debate-formats/types'
import { stageSpeakerLabel } from './debate-formats/utils'

/** 录音子目录名（数据根 /recordings） */
export const RECORDINGS_DIR_NAME = 'recordings'

/** 取路径最后一段文件名（无 path 依赖，双分隔符兼容） */
export function lastPathSegment(p: string): string {
  const s = String(p)
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

/** 拼接根与子目录名（无 path 依赖，去尾分隔符后用 '/' 连接） */
export function joinSegment(root: string, seg: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${seg}`
}

/**
 * 归一化录音目录（纯函数，可单测）：root 视为「数据根」，实际录音目录 = <根>/recordings。
 * - root 空 → defaultDataRoot/recordings；
 * - root 末段已是 `recordings`（大小写不敏感）→ 直接用 root（兼容旧设置直接存绝对录音目录，避免 recordings/recordings，旧录音不失联）；
 * - 否则 → root/recordings。
 * 与 recording-storage.resolveRecordingsDir 规则一致（后者用 electron app.getPath 提供默认根）。
 */
export function resolveRecordingsDirPlain(root: string | null | undefined, defaultDataRoot: string): string {
  const trimmed = (root || '').trim()
  if (!trimmed) return joinSegment(defaultDataRoot, RECORDINGS_DIR_NAME)
  if (lastPathSegment(trimmed).toLowerCase() === RECORDINGS_DIR_NAME.toLowerCase()) return trimmed
  return joinSegment(trimmed, RECORDINGS_DIR_NAME)
}

/**
 * 解析数据根（纯函数，可单测）：root 末段已是 `recordings` → 其上一级为数据根；否则 root 本身；空 → defaultDataRoot。
 * 与 recording-storage.resolveDataRoot 规则一致。
 */
export function resolveDataRootPlain(root: string | null | undefined, defaultDataRoot: string): string {
  const trimmed = (root || '').trim()
  if (!trimmed) return defaultDataRoot
  if (lastPathSegment(trimmed).toLowerCase() === RECORDINGS_DIR_NAME.toLowerCase()) {
    const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    return i <= 0 ? defaultDataRoot : trimmed.slice(0, i)
  }
  return trimmed
}

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

/** 依据文件绝对路径生成稳定的录音 id（basename 去扩展名；空路径用时间戳兜底）。 */
export function recordingIdForFile(filePath: string): string {
  const p = filePath || ''
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const base = idx >= 0 ? p.slice(idx + 1) : p
  const name = base.replace(/\.[^.]+$/, '')
  return name || `rec-${Date.now()}`
}

/**
 * 旧 MatchRecordingMeta → BoundRecording[] 迁移。
 * - segmentMode='whole'：单一 filePath + markers → 一份 kind='whole' 录音；
 * - segmentMode='split'：markers[].filePath 分片 → 每片一份 kind='stage' 录音（stageId/tsMs 取自对应 marker）。
 * - 无 meta 或无可解析路径 → 返回空数组。
 */
export function boundRecordingsFromMeta(meta: MatchRecordingMeta | null | undefined): BoundRecording[] {
  if (!meta) return []
  if (meta.segmentMode === 'split') {
    const list: BoundRecording[] = []
    for (const m of meta.markers || []) {
      if (!m.filePath) continue
      list.push({
        id: recordingIdForFile(m.filePath),
        kind: 'stage',
        filePath: m.filePath,
        stageId: m.stageId ?? null,
        tsMs: m.tsMs,
        markers: [m]
      })
    }
    return list
  }
  if (!meta.filePath) return []
  return [
    {
      id: recordingIdForFile(meta.filePath),
      kind: 'whole',
      filePath: meta.filePath,
      markers: meta.markers || []
    }
  ]
}

/**
 * BoundRecording[] → 旧 MatchRecordingMeta（兼容既有渲染进程读取）。
 * - 存在 stage 录音 → 组装校验 split 结构：拆分 markers 并回填各片 filePath；
 * - 否则取首份 whole → 单一 filePath + markers 的 whole 结构；
 * - 空列表 → null。
 */
export function metaFromBoundRecordings(recordings: BoundRecording[] | null | undefined): MatchRecordingMeta | null {
  const list = Array.isArray(recordings) ? recordings : []
  const stage = list.filter((r) => r.kind === 'stage')
  if (stage.length > 0) {
    const markers: MatchRecordingMarker[] = []
    for (const r of stage) {
      if (r.markers && r.markers.length) {
        for (const m of r.markers) markers.push({ ...m, filePath: m.filePath ?? r.filePath })
      } else {
        markers.push({
          tsMs: r.tsMs ?? 0,
          stageId: r.stageId ?? 'stage',
          stageName: '环节',
          side: null,
          speaker: null,
          filePath: r.filePath
        })
      }
    }
    const firstEdge = markers.find((mk) => mk.filePath)
    return { filePath: firstEdge?.filePath ?? stage[0].filePath, segmentMode: 'split', markers }
  }
  const whole = list.filter((r) => r.kind === 'whole')
  if (whole.length === 0) return null
  const w = whole[0]
  return { filePath: w.filePath, segmentMode: 'whole', markers: w.markers || [] }
}