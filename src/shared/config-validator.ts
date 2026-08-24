// ============================================================
// config-validator.ts — 轻量 JSON 结构校验器（governance Task 12，Phase 4）
//
// 原则：
//   - 纯函数、不引任何大库（仅依赖 shared 类型常量），可被 main / renderer / vitest 直接引用；
//   - 不只做 typeof / Array.isArray，而是校验关键字段的类型与取值，给出明确（中文、可提示）错误；
//   - 校验结果统一为判别联合 ValidationResult<T>：ok=true 返回规范化 value；ok=false 返回友好 error；
//   - 对「缺失/旧/缺省结构」保持兼容：缺失 = 合理默认或降级，不破坏既有数据。
//
// 覆盖（governance 12.1）：
//   - events.bank_config：mode 枚举、priorityOrder:string[]、roundBanks:Record<string,string[]>
//   - recording_meta / BoundRecording（含旧 MatchRecordingMeta 两种形态）
//   - topic.custom_data
//   - undo payload（before/after 结构，含 topicGroup setBankConfig 内嵌 config）
//   - backup package（含类别/版本）
//
// 接入（governance 12.2）：
//   - topic-group.repo get/setEventBankConfig 与 set IPC：写时拒绝非法，读时缺省降级
//   - backup-service previewImport/importBackup：解析后校验结构
//   - 其余校验器作为共享守卫导出，调用方按需使用
// ============================================================

import type {
  EventBankConfig,
  DrawBankMode,
  CustomFieldValue,
  BoundRecording,
  MatchRecordingMeta,
  BackupPackage
} from './types'

// ---------- 通用结果类型 ----------

export interface ValidateError {
  ok: false
  error: string
}

export interface ValidateOk<T> {
  ok: true
  value: T
}

export type ValidationResult<T> = ValidateOk<T> | ValidateError

function err(error: string): ValidateError {
  return { ok: false, error }
}

/** 是否为普通对象（非 null / 非数组） */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ============================================================
// events.bank_config
// ============================================================

/** 合法选题模式枚举（对齐 shared/types.DrawBankMode） */
export const DRAW_BANK_MODES: readonly DrawBankMode[] = [
  'single',
  'union',
  'priority',
  'by_round'
]

/** bank_config 缺失/非法时回退的默认选题模式（与 topic-group.repo 语义对齐）。 */
export const DEFAULT_DRAW_BANK_MODE: DrawBankMode = 'single'
const DEFAULT_BANK_CONFIG: EventBankConfig = { mode: DEFAULT_DRAW_BANK_MODE }

/**
 * 校验并规范化 events.bank_config。
 * - 缺失/undefined/null（旧无配置）→ 兼容：返回默认 single；
 * - mode 缺失（旧空值）→ 兼容：回退默认 single；
 * - mode 存在但非法 → 拒绝；
 * - priorityOrder 存在但非 string[] → 拒绝；
 * - roundBanks 存在但非 Record<string, string[]> → 拒绝；
 * - 合法 → 返回剥离未知字段后的规范化结构。
 */
export function validateBankConfig(input: unknown): ValidationResult<EventBankConfig> {
  if (input === null || input === undefined) {
    return { ok: true, value: DEFAULT_BANK_CONFIG }
  }
  if (!isRecord(input)) {
    return err('参数 bank_config 必须为对象')
  }

  const mode = input.mode
  if (mode !== undefined && (typeof mode !== 'string' || !DRAW_BANK_MODES.includes(mode as DrawBankMode))) {
    return err(
      `参数 bank_config.mode 必须为 ${DRAW_BANK_MODES.join('|')} 之一，实际为 ${JSON.stringify(mode)}`
    )
  }

  if (
    input.priorityOrder !== undefined &&
    (!Array.isArray(input.priorityOrder) || !input.priorityOrder.every((x) => typeof x === 'string'))
  ) {
    return err('参数 bank_config.priorityOrder 必须为 string[]')
  }

  if (input.roundBanks !== undefined) {
    if (!isRecord(input.roundBanks)) {
      return err('参数 bank_config.roundBanks 必须为 Record<string, string[]>')
    }
    for (const [k, v] of Object.entries(input.roundBanks)) {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
        return err(`参数 bank_config.roundBanks["${k}"] 必须为 string[]`)
      }
    }
  }

  const out: EventBankConfig = {
    mode: (mode as DrawBankMode | undefined) ?? DEFAULT_DRAW_BANK_MODE
  }
  if (Array.isArray(input.priorityOrder)) out.priorityOrder = input.priorityOrder as string[]
  if (isRecord(input.roundBanks)) {
    out.roundBanks = input.roundBanks as Record<string, string[]>
  }
  return { ok: true, value: out }
}

// ============================================================
// recording_meta / BoundRecording
// ============================================================

const MARKER_KEYS = ['tsMs', 'stageId', 'stageName', 'side', 'speaker', 'filePath'] as const

/**
 * 校验单条 BoundRecording 的关键字段类型。
 */
function validateBoundRecording(item: unknown, index: number): ValidateError | null {
  if (!isRecord(item)) {
    return err(`参数 recording_meta[${index}] 必须为对象`)
  }
  if (typeof item.id !== 'string' || item.id.length === 0) {
    return err(`参数 recording_meta[${index}].id 必须为非空 string`)
  }
  if (item.kind !== 'whole' && item.kind !== 'stage') {
    return err(`参数 recording_meta[${index}].kind 必须为 'whole' 或 'stage'`)
  }
  if (typeof item.filePath !== 'string') {
    return err(`参数 recording_meta[${index}].filePath 必须为 string`)
  }
  for (const key of ['stageId', 'tsMs', 'durationMs'] as const) {
    const v = item[key]
    if (v !== undefined && v !== null && typeof v !== (key === 'stageId' ? 'string' : 'number')) {
      return err(`参数 recording_meta[${index}].${key} 类型错误`)
    }
  }
  if (item.markers !== undefined && item.markers !== null) {
    if (!Array.isArray(item.markers)) {
      return err(`参数 recording_meta[${index}].markers 必须为数组`)
    }
    for (let mi = 0; mi < item.markers.length; mi++) {
      const m = item.markers[mi]
      if (!isRecord(m)) {
        return err(`参数 recording_meta[${index}].markers[${mi}] 必须为对象`)
      }
      if (m.tsMs !== undefined && m.tsMs !== null && typeof m.tsMs !== 'number') {
        return err(`参数 recording_meta[${index}].markers[${mi}].tsMs 必须为 number`)
      }
      if (m.stageId !== undefined && m.stageId !== null && typeof m.stageId !== 'string') {
        return err(`参数 recording_meta[${index}].markers[${mi}].stageId 必须为 string`)
      }
      for (const key of MARKER_KEYS) {
        if (m[key] === undefined || m[key] === null) continue
        const okType =
          key === 'tsMs' ? typeof m[key] === 'number'
            : key === 'side' || key === 'speaker' ? typeof m[key] === 'string' || m[key] === null
              : typeof m[key] === 'string'
        if (!okType) {
          return err(`参数 recording_meta[${index}].markers[${mi}].${key} 类型错误`)
        }
      }
    }
  }
  return null
}

/**
 * 校验「新多录音」形态：BoundRecording[]。
 * 缺失 → 兼容：返回空数组（无录音）。
 */
export function validateBoundRecordings(input: unknown): ValidationResult<BoundRecording[]> {
  if (input === null || input === undefined) {
    return { ok: true, value: [] }
  }
  if (!Array.isArray(input)) {
    return err('参数 recording_meta 必须为录音数组')
  }
  for (let i = 0; i < input.length; i++) {
    const e = validateBoundRecording(input[i], i)
    if (e) return e
  }
  return { ok: true, value: input as BoundRecording[] }
}

/**
 * 校验「旧单结构」形态：MatchRecordingMeta（filePath + segmentMode + markers）。
 * 仅校验关键字段类型；缺失 markers 视为空数组（兼容旧数据）。
 */
export function validateMatchRecordingMeta(input: unknown): ValidationResult<MatchRecordingMeta> {
  if (!isRecord(input)) {
    return err('参数 recording_meta（旧结构）必须为对象')
  }
  if (typeof input.filePath !== 'string') {
    return err('参数 recording_meta.filePath 必须为 string')
  }
  if (input.segmentMode !== 'whole' && input.segmentMode !== 'split') {
    return err("参数 recording_meta.segmentMode 必须为 'whole' 或 'split'")
  }
  if (input.markers !== undefined && input.markers !== null && !Array.isArray(input.markers)) {
    return err('参数 recording_meta.markers 必须为数组')
  }
  return { ok: true, value: input as unknown as MatchRecordingMeta }
}

/**
 * 校验 recording_meta 列（可能是新 BoundRecording[] 或旧 MatchRecordingMeta）。
 * 兼容两种形态，返回原值透传；都不是 → 拒绝并给出明确错误。
 */
export function validateRecordingMeta(input: unknown): ValidationResult<unknown> {
  if (input === null || input === undefined) {
    return { ok: true, value: null }
  }
  if (Array.isArray(input)) {
    const r = validateBoundRecordings(input)
    return r.ok ? { ok: true, value: input } : r
  }
  if (isRecord(input) && 'segmentMode' in input) {
    const r = validateMatchRecordingMeta(input)
    return r.ok ? { ok: true, value: input } : r
  }
  return err('参数 recording_meta 既不是录音数组，也不是旧录音结构对象')
}

// ============================================================
// topic.custom_data
// ============================================================

/**
 * 校验 topic.custom_data：Record<string, string | string[]>。
 * 缺失 → 兼容：返回空对象。
 */
export function validateTopicCustomData(
  input: unknown
): ValidationResult<Record<string, CustomFieldValue>> {
  if (input === null || input === undefined) {
    return { ok: true, value: {} }
  }
  if (!isRecord(input)) {
    return err('参数 topic.custom_data 必须为对象')
  }
  for (const [k, v] of Object.entries(input)) {
    const valid = typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    if (!valid) {
      return err(`参数 topic.custom_data["${k}"] 必须为 string 或 string[]`)
    }
  }
  return { ok: true, value: input as Record<string, CustomFieldValue> }
}

// ============================================================
// undo payload（before/after 结构）
// ============================================================

/**
 * 通用 undo 快照结构校验：before/after 允许 null（无可撤销状态或纯新增），
 * 否则必须为对象或数组（各类快照的承载形态），拒绝原始类型。
 */
export function validateUndoSnapshot(payload: unknown): ValidationResult<unknown> {
  if (payload === null || payload === undefined) {
    return { ok: true, value: null }
  }
  if (typeof payload !== 'object') {
    return err('参数 undo 快照必须为对象、数组或 null')
  }
  return { ok: true, value: payload }
}

/**
 * 校验 undo 的整体 before/after 结构，并对关键 store 做内嵌结构校验：
 *   - topicGroup 的 setBankConfig 快照 { id, config } → 内嵌 config 需通过 validateBankConfig。
 * 返回 ok 时透传规范化 { before, after }。
 */
export function validateUndoPayload(payload: {
  storeName: string
  before: unknown
  after: unknown
}): ValidationResult<{ before: unknown; after: unknown }> {
  const b = validateUndoSnapshot(payload.before)
  if (!b.ok) return b
  const a = validateUndoSnapshot(payload.after)
  if (!a.ok) return a

  if (payload.storeName === 'topicGroup') {
    for (const snap of [payload.before, payload.after]) {
      if (isRecord(snap) && 'config' in snap) {
        const vc = validateBankConfig(snap.config)
        if (!vc.ok) return { ok: false, error: `参数 undo 快照.config 非法：${vc.error}` }
      }
    }
  }

  return { ok: true, value: { before: payload.before ?? null, after: payload.after ?? null } }
}

// ============================================================
// backup package（含类别/版本）
// ============================================================

/**
 * 校验备份包 BackupPackage 的关键字段类型（类别/版本/导出信息/tables）。
 * 保持兼容：categories 仅要求为字符串数组（未知类别导入时按需忽略，不拒绝旧包）。
 */
export function validateBackupPackage(input: unknown): ValidationResult<BackupPackage> {
  if (!isRecord(input)) {
    return err('参数 备份包 必须为对象')
  }
  if (typeof input.version !== 'string') {
    return err('参数 备份包.version 必须为 string')
  }
  if (typeof input.exportedAt !== 'string') {
    return err('参数 备份包.exportedAt 必须为 string')
  }
  if (typeof input.appVersion !== 'string') {
    return err('参数 备份包.appVersion 必须为 string')
  }
  if (
    !Array.isArray(input.categories) ||
    !input.categories.every((c) => typeof c === 'string')
  ) {
    return err('参数 备份包.categories 必须为 string[]')
  }
  if (!isRecord(input.tables)) {
    return err('参数 备份包.tables 必须为对象')
  }
  return { ok: true, value: input as unknown as BackupPackage }
}