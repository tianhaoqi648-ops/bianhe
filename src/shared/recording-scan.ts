// ============================================================
// recording-scan.ts — 录音孤儿扫描：分类纯函数与类型（Phase 1.3-fix Me1）
//
// 核心原则：发现异常 ≠ 删除异常。
//   - UNREFERENCED ≠ ORPHAN（0 引用一律保守判 UNREFERENCED——系统无 provenance
//     区分异常遗留与解绑/待重绑/换根窗口，ORPHAN 为保留态不自动产生）
//   - MISSING ≠ ORPHAN（DB 有引用文件缺失 = Ghost Reference）
//   - UNKNOWN ≠ SAFE TO DELETE
//
// 本文件为纯函数（无 electron/repo 依赖），供 recording-scan-service
// 与测试复用；文件身份使用「含扩展名的完整 basename」（BoundRecording.id
// 为 stem，非 unique key，禁止用于引用比对——RA10）。
// ============================================================
import type { BoundRecording, MatchRecordingMeta } from './types'
import { filenameOf } from './match-recording'

export type RecordingScanClassification =
  | 'REFERENCED'
  | 'SHARED'
  | 'UNREFERENCED'
  | 'ORPHAN'
  | 'MISSING'
  | 'UNKNOWN'

export type RecordingScanRootType = 'CURRENT' | 'LEGACY'

export type RecordingScanReasonCode =
  | 'REFERENCED_BY_MATCH'
  | 'REFERENCED_BY_UNDO'
  | 'SHARED_BY_MATCHES'
  | 'FREE_PRACTICE'
  | 'NO_KNOWN_REFERENCE'
  | 'GHOST_REFERENCE_FILE_MISSING'
  | 'UNSUPPORTED_EXTENSION'
  | 'STAT_FAILED'
  | 'PARSE_FAILED'

export interface RecordingScanItem {
  /** 含扩展名的完整 basename（文件身份键） */
  basename: string
  /** 所在录音根的完整路径（仅展示用，不回写 DB） */
  path: string
  rootType: RecordingScanRootType
  extension: string
  sizeBytes: number | null
  modifiedAt: string | null
  /** 引用该文件的 match id 列表 */
  referencedBy: string[]
  classification: RecordingScanClassification
  reasonCode: RecordingScanReasonCode
  reasonText: string
}

export interface RecordingScanRootReport {
  rootPath: string
  rootType: RecordingScanRootType
  /** 该根 readdir 失败等根级错误（不影响其他根） */
  error?: string
  items: RecordingScanItem[]
}

export interface RecordingScanReport {
  roots: RecordingScanRootReport[]
  /** 引用侧：DB 有引用但任何根都未扫到文件（Ghost Reference） */
  missing: RecordingScanItem[]
  scannedAt: string
}

/** 项目支持的录音扩展名白名单（小写；录制格式 ∪ 外部 bind 允许格式） */
export const RECORDING_SCAN_EXTENSIONS = ['wav', 'webm', 'm4a', 'mp3', 'flac', 'mp4'] as const

/** 自由练习录音的确定性文件名前缀（buildRecordingFileName 对 matchId=null 的产物） */
export const FREE_PRACTICE_PREFIX = 'match-untracke-'

export interface RecordingFileEntry {
  basename: string
  path: string
  extension: string
  sizeBytes: number | null
  modifiedAt: string | null
}

export interface RecordingReferenceEntry {
  basename: string
  matchId: string
}

const CLASSIFICATION_ORDER: RecordingScanClassification[] = [
  'MISSING',
  'ORPHAN',
  'UNKNOWN',
  'SHARED',
  'REFERENCED',
  'UNREFERENCED'
]

/**
 * 从 matches 原始行（findAllForBackup）提取归一后的 basename 引用：
 * - recording_meta（JSON 字符串，BoundRecording[] 或旧 MatchRecordingMeta 双形态）
 * - recording_ref（旧单路径列）
 * 全部经 filenameOf 归一（兼容旧绝对路径）。
 * @returns Map<basename, matchId[]>（引用计数按 match 计）
 */
export function collectMatchRecordingReferences(
  matchRows: Array<Record<string, unknown>>
): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  const add = (basename: string, matchId: string): void => {
    if (!basename) return
    const list = refs.get(basename) ?? []
    if (!list.includes(matchId)) list.push(matchId)
    refs.set(basename, list)
  }
  for (const row of matchRows) {
    const matchId = String(row.id ?? '')
    const metaRaw = row.recording_meta
    if (typeof metaRaw === 'string' && metaRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(metaRaw)
        if (Array.isArray(parsed)) {
          for (const r of parsed as BoundRecording[]) {
            if (r && typeof r.filePath === 'string') add(filenameOf(r.filePath), matchId)
          }
        } else if (parsed && typeof parsed === 'object') {
          const meta = parsed as MatchRecordingMeta
          if (typeof meta.filePath === 'string') add(filenameOf(meta.filePath), matchId)
        }
      } catch {
        // 非法 JSON：跳过该行（不中断扫描）
      }
    }
    const refRaw = row.recording_ref
    if (typeof refRaw === 'string' && refRaw.trim()) add(filenameOf(refRaw), matchId)
  }
  return refs
}

/**
 * 从 undo_log 原始行（findAllForBackup）提取录音 basename 引用。
 * 双层 JSON：before_data/after_data（第 1 层）→ 可能含 matches[]（event 聚合快照）→
 * 每行 recording_meta 为 JSON 字符串（第 2 层）。防御式解析：坏行跳过。
 */
export function collectUndoRecordingReferences(
  undoRows: Array<Record<string, unknown>>
): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  const add = (basename: string): void => {
    if (!basename) return
    if (!refs.has(basename)) refs.set(basename, [])
  }
  const collectFromSnapshot = (snapshot: unknown): void => {
    if (!snapshot || typeof snapshot !== 'object') return
    const matches = (snapshot as { matches?: unknown }).matches
    if (!Array.isArray(matches)) return
    for (const row of matches) {
      if (!row || typeof row !== 'object') continue
      const metaRaw = (row as Record<string, unknown>).recording_meta
      if (typeof metaRaw === 'string' && metaRaw.trim()) {
        try {
          const parsed: unknown = JSON.parse(metaRaw)
          if (Array.isArray(parsed)) {
            for (const r of parsed as BoundRecording[]) {
              if (r && typeof r.filePath === 'string') add(filenameOf(r.filePath))
            }
          } else if (parsed && typeof parsed === 'object') {
            const meta = parsed as MatchRecordingMeta
            if (typeof meta.filePath === 'string') add(filenameOf(meta.filePath))
          }
        } catch {
          // 第 2 层解析失败：跳过
        }
      }
      const ref = (row as Record<string, unknown>).recording_ref
      if (typeof ref === 'string' && ref.trim()) add(filenameOf(ref))
    }
  }
  for (const row of undoRows) {
    for (const key of ['before_data', 'after_data']) {
      const raw = row[key]
      if (typeof raw !== 'string' || !raw.trim()) continue
      try {
        collectFromSnapshot(JSON.parse(raw))
      } catch {
        // 第 1 层解析失败：跳过该侧
      }
    }
  }
  return refs
}

/**
 * 单文件分类（0 引用文件——保守语义）。
 *
 * 系统当前不存在任何可区分「异常遗留」与「合法零引用」的 provenance：
 * Unbind = detach only（解绑后引用必然归零）、match 删除 CASCADE（meta 随删文件留盘）、
 * 换根窗口（旧根文件全部失联）——三者产生完全相同的磁盘/DB 状态。
 * 因此 0 引用一律判 UNREFERENCED（默认安全分类）；ORPHAN 枚举保留但
 * 扫描器**不自动产生**（未来需额外溯源证据源才可启用）。
 */
function classifyUnreferencedFile(entry: RecordingFileEntry): {
  classification: RecordingScanClassification
  reasonCode: RecordingScanReasonCode
  reasonText: string
} {
  const ext = entry.extension.toLowerCase()
  if (!RECORDING_SCAN_EXTENSIONS.includes(ext as (typeof RECORDING_SCAN_EXTENSIONS)[number])) {
    return {
      classification: 'UNKNOWN',
      reasonCode: 'UNSUPPORTED_EXTENSION',
      reasonText: `无法识别的文件类型（.${entry.extension}），请人工确认`
    }
  }
  if (entry.basename.startsWith(FREE_PRACTICE_PREFIX)) {
    return {
      classification: 'UNREFERENCED',
      reasonCode: 'FREE_PRACTICE',
      reasonText: '自由练习录音（无比赛关联），未发现引用，但属于合法录制产物'
    }
  }
  return {
    classification: 'UNREFERENCED',
    reasonCode: 'NO_KNOWN_REFERENCE',
    reasonText:
      '当前未发现有效业务引用，但不能仅据此判断为孤儿（可能是解绑、待重绑或历史遗留），建议人工确认'
  }
}

/**
 * 纯函数分类：文件系统条目 + 引用集合 → 扫描报告条目。
 * - 引用数 ≥2 → SHARED；=1 → REFERENCED
 * - 0 引用 → classifyUnreferencedFile（一律 UNREFERENCED/UNKNOWN——保守默认，
 *   扫描器不自动判 ORPHAN：无 provenance 区分异常遗留与合法零引用）
 * - 引用侧（refs 中存在但 files 无）→ MISSING（Ghost Reference）
 */
export function classifyRecordings(
  files: RecordingFileEntry[],
  matchRefs: Map<string, string[]>,
  undoRefs: Map<string, string[]>,
  rootType: RecordingScanRootType,
  /** 跨根已见 basename 全集（多根扫描时传入，避免他根文件被本根误标 MISSING） */
  allSeenBasenames?: Set<string>
): RecordingScanItem[] {
  const items: RecordingScanItem[] = []
  const referencedBasenames = new Set<string>()
  const seen = allSeenBasenames ?? new Set(files.map((f) => f.basename))

  for (const f of files) {
    const matchIds = matchRefs.get(f.basename) ?? []
    const hasUndoRef = undoRefs.has(f.basename)
    if (matchIds.length > 0) referencedBasenames.add(f.basename)
    if (hasUndoRef) referencedBasenames.add(f.basename)

    let classification: RecordingScanClassification
    let reasonCode: RecordingScanReasonCode
    let reasonText: string
    if (matchIds.length >= 2) {
      classification = 'SHARED'
      reasonCode = 'SHARED_BY_MATCHES'
      reasonText = `被 ${matchIds.length} 场比赛共同引用`
    } else if (matchIds.length === 1) {
      classification = 'REFERENCED'
      reasonCode = 'REFERENCED_BY_MATCH'
      reasonText = `被比赛 ${matchIds[0]} 引用`
    } else if (hasUndoRef) {
      // Phase 1.3-fix：undo 快照引用保护——match 引用虽为 0，但 undo 快照
      // 仍需该文件（event 删除后 undo 恢复场景），不得判 ORPHAN/MISSING
      classification = 'REFERENCED'
      reasonCode = 'REFERENCED_BY_UNDO'
      reasonText = '被撤销快照引用（event 删除后可通过撤销恢复）'
    } else {
      const unreferenced = classifyUnreferencedFile(f)
      classification = unreferenced.classification
      reasonCode = unreferenced.reasonCode
      reasonText = unreferenced.reasonText
    }
    items.push({ ...f, rootType, referencedBy: [...matchIds], classification, reasonCode, reasonText })
  }

  // 引用侧：DB 有引用但任何根都未扫到文件 → MISSING（Ghost Reference）。
  // 仅 undo 快照引用且文件缺失 → 不报告（undo 窗口内预期状态，启动即清）
  for (const [basename, matchIds] of matchRefs) {
    if (seen.has(basename)) continue
    items.push({
      basename,
      path: basename,
      rootType,
      extension: basename.includes('.') ? basename.split('.').pop()! : '',
      sizeBytes: null,
      modifiedAt: null,
      referencedBy: [...matchIds],
      classification: 'MISSING',
      reasonCode: 'GHOST_REFERENCE_FILE_MISSING',
      reasonText: '数据库存在引用，但录音文件在录音目录中不存在（可能是换机/换根后未迁移）'
    })
  }

  return sortScanItems(items)
}

/** 维护报告排序：MISSING → ORPHAN（保留态，当前不自动产生）→ UNKNOWN → SHARED → REFERENCED → UNREFERENCED。 */
export function sortScanItems(items: RecordingScanItem[]): RecordingScanItem[] {
  return [...items].sort((a, b) => {
    const rank = (c: RecordingScanClassification) => CLASSIFICATION_ORDER.indexOf(c)
    const d = rank(a.classification) - rank(b.classification)
    if (d !== 0) return d
    return a.basename.localeCompare(b.basename)
  })
}

/** 汇总统计（分根展示用）。 */
export function summarizeScanItems(items: RecordingScanItem[]): Record<RecordingScanClassification, number> {
  const summary: Record<RecordingScanClassification, number> = {
    REFERENCED: 0,
    SHARED: 0,
    UNREFERENCED: 0,
    ORPHAN: 0,
    MISSING: 0,
    UNKNOWN: 0
  }
  for (const i of items) summary[i.classification]++
  return summary
}
