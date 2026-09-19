// ============================================================
// recording-scan-service.ts — 录音维护扫描（Phase 1.3-fix Me1）
//
// 只读扫描：录音目录（双根）× DB 引用（matches + undo_log 快照）
// → 分类报告。零删除/零写入行为（不触碰 fs.rm/unlink/rename/UPDATE）。
//
// 双根语义：
//   - CURRENT：settings recording.dir 解析出的当前录音根（recordingsDir()）
//   - LEGACY：userData/recordings（缺省根）——仅当与 CURRENT 不同才扫描
//     （换根前的历史遗留文件，Phase 1.3-A 审计实证场景）
// ============================================================
import { app } from 'electron'
import { promises as fs } from 'fs'
import { basename, join, resolve as resolvePath } from 'path'
import type { BoundRecording, MatchRecordingMeta } from '../../shared/types'
import { filenameOf } from '../../shared/match-recording'
import {
  classifyRecordings,
  collectMatchRecordingReferences,
  collectUndoRecordingReferences,
  type RecordingFileEntry,
  type RecordingScanItem,
  type RecordingScanReport,
  type RecordingScanRootReport,
  type RecordingScanRootType
} from '../../shared/recording-scan'
import { matchRepo } from '../db/repository/match.repo'
import { undoLogRepo } from '../db/repository/undo-log.repo'
import { recordingsDir } from './recording-storage'

/** 单根目录只读文件收集（隐藏文件跳过；stat 失败 → UNKNOWN 项不中断）。 */
async function collectRootFiles(
  dir: string,
  rootType: RecordingScanRootType,
  matchRefs: Map<string, string[]>
): Promise<{ files: RecordingFileEntry[]; unknownItems: RecordingScanItem[]; error?: string }> {
  let entries: Array<{ name: string; isFile: boolean }> = []
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
      name: e.name,
      isFile: e.isFile()
    }))
  } catch (e) {
    return {
      files: [],
      unknownItems: [],
      error: e instanceof Error ? e.message : String(e)
    }
  }

  const files: RecordingFileEntry[] = []
  const unknownItems: RecordingScanItem[] = []
  for (const entry of entries) {
    if (!entry.isFile) continue
    if (entry.name.startsWith('.')) continue // 隐藏文件跳过
    const abs = join(dir, entry.name)
    const ext = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : ''
    try {
      const stat = await fs.stat(abs)
      files.push({
        basename: entry.name,
        path: abs,
        extension: ext,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      })
    } catch (e) {
      unknownItems.push({
        basename: entry.name,
        path: abs,
        rootType,
        extension: ext,
        sizeBytes: null,
        modifiedAt: null,
        referencedBy: matchRefs.get(entry.name) ?? [],
        classification: 'UNKNOWN',
        reasonCode: 'STAT_FAILED',
        reasonText: `文件状态读取失败：${e instanceof Error ? e.message : String(e)}`
      })
    }
  }
  return { files, unknownItems }
}

/** 路径等价判断（大小写不敏感的 Windows 与 POSIX 均覆盖：统一小写比较）。 */
function sameDir(a: string, b: string): boolean {
  return resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase()
}

/**
 * 只读扫描录音目录（双根）并生成维护报告。
 * 零写入行为：不删除/移动/重命名文件，不修改 DB——仅 readdir/stat/SELECT。
 */
export async function scanRecordingDirectories(): Promise<RecordingScanReport> {
  // 1. 引用收集：matches（recording_meta 双形态 + recording_ref）
  const matchRows = matchRepo.findAllForBackup().matches as Array<Record<string, unknown>>
  const matchRefs = collectMatchRecordingReferences(matchRows)

  // 2. 引用收集：undo_log 快照（event 聚合快照内嵌的 recording_meta/ref）
  let undoRows: Array<Record<string, unknown>> = []
  try {
    undoRows = undoLogRepo.findAllForBackup() as Array<Record<string, unknown>>
  } catch (e) {
    console.warn('[recording-scan] undo_log read failed (skip undo references):', e)
  }
  const undoRefs = collectUndoRecordingReferences(undoRows)

  // 3. 双根：CURRENT（配置解析）+ LEGACY（缺省 userData 根，仅当与 CURRENT 不同）
  const currentRoot = await recordingsDir()
  const legacyRoot = join(app.getPath('userData'), 'recordings')
  const roots: Array<{ dir: string; rootType: RecordingScanRootType }> = [
    { dir: currentRoot, rootType: 'CURRENT' }
  ]
  if (!sameDir(legacyRoot, currentRoot)) {
    roots.push({ dir: legacyRoot, rootType: 'LEGACY' })
  }

  // 4. 逐根收集文件（不分类），合并跨根已见全集后统一分类——
  //    避免 CURRENT 根存在的文件被 LEGACY 根报告误标 MISSING
  const rootReports: RecordingScanRootReport[] = []
  const allItems: RecordingScanItem[] = []
  const rootFileLists: Array<{ root: (typeof roots)[number]; files: RecordingFileEntry[] }> = []
  for (const root of roots) {
    const { files, unknownItems } = await collectRootFiles(root.dir, root.rootType, matchRefs)
    rootFileLists.push({ root, files })
    allItems.push(...unknownItems)
  }
  const allSeenBasenames = new Set(rootFileLists.flatMap(({ files }) => files.map((f) => f.basename)))
  // MISSING 按 basename 去重（同一 ghost 引用在多根报告中只呈现一次）
  const missingSeen = new Set<string>()
  for (const { root, files } of rootFileLists) {
    const items = classifyRecordings(files, matchRefs, undoRefs, root.rootType, allSeenBasenames)
    const deduped: RecordingScanItem[] = []
    for (const item of items) {
      if (item.classification === 'MISSING') {
        if (missingSeen.has(item.basename)) continue
        missingSeen.add(item.basename)
      }
      deduped.push(item)
    }
    rootReports.push({ rootPath: root.dir, rootType: root.rootType, items: deduped })
    allItems.push(...deduped)
  }

  return {
    roots: rootReports,
    missing: allItems.filter((i) => i.classification === 'MISSING'),
    scannedAt: new Date().toISOString()
  }
}

/** 供测试注入：解析 BoundRecording / 旧 Meta 的 filePath（与 M3 归一口径一致）。 */
export function recordingFilePathOf(rec: BoundRecording | MatchRecordingMeta): string {
  return filenameOf(rec.filePath)
}

// basename 变量保留引用（tree-shaking 防御：供未来扩展使用）
void basename
