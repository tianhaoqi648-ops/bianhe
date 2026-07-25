// ============================================================
// import-engine.ts — 导入引擎
//
// 提供：
//   parseFile(filePath, fileType): ParsedResult
//
// 支持：
//   - xlsx / csv：用 xlsx 库读取，自动识别表头映射
//   - docx：用 mammoth 转 HTML，检测 table / 编号列表 / 段落三种结构
//
// 仅依赖 topic.repo 的 TopicCreateInput 类型。
// ============================================================

import fs from 'fs'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import * as iconv from 'iconv-lite'
import type { TopicCreateInput } from '../db/repository/topic.repo'
import {
  SYSTEM_CANDIDATES as SYSTEM_CANDIDATES_SRC,
  type CandidateField
} from '../../shared/constants'
import type { ParsedResult, UnknownValueItem, FieldMapping } from '../../shared/types'
import {
  SYSTEM_FIELD_DEFINITIONS,
  SYSTEM_FIELD_ALIAS_MAP
} from '../../shared/field-definitions'
import { labelToKey } from './custom-field-service'

// ============================================================
// 类型定义
// ============================================================

export type FileType = 'xlsx' | 'csv' | 'docx'

// ParsedResult 从 shared/types 引入并 re-export，保持 IPC 边界类型一致
export type { ParsedResult }

/**
 * 中文表头 → Topic 字段的映射规则。
 *
 * 从 SYSTEM_FIELD_DEFINITIONS 派生（单一来源），与 field-definitions.ts 保持一致。
 * 同一字段可有多个别名（中英文均可，大小写不敏感）。
 */
export const HEADER_MAPPING: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const f of SYSTEM_FIELD_DEFINITIONS) {
    m[f.key] = [...f.aliases]
  }
  return m
})()

/**
 * 系统候选值（引用 shared/constants.ts 单一来源）。
 * 用于在导入时检查字段值是否在系统候选内——
 * 不在候选内的值会原样入库（不阻断），但生成非阻断警告告知用户：
 * 后续在筛选面板中可能选不到这些值，建议导入后批量编辑。
 *
 * 暴露 5 个字段：type/domain/difficulty/source/source_type。
 */
export const SYSTEM_CANDIDATES: Record<CandidateField, string[]> = {
  type: [...SYSTEM_CANDIDATES_SRC.type],
  domain: [...SYSTEM_CANDIDATES_SRC.domain],
  difficulty: [...SYSTEM_CANDIDATES_SRC.difficulty],
  source: [...SYSTEM_CANDIDATES_SRC.source],
  source_type: [...SYSTEM_CANDIDATES_SRC.source_type]
}

/** 中文标签：字段 key → 显示名 */
const FIELD_LABEL: Record<CandidateField, string> = {
  type: '类型',
  domain: '领域',
  difficulty: '难度',
  source: '来源',
  source_type: '来源类型'
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 反向映射：表头 → Topic 字段名。
 * 直接复用 SYSTEM_FIELD_ALIAS_MAP（小写 → fieldKey），保持单一来源。
 * 匹配时表头转小写后查询，实现大小写不敏感。
 */
const HEADER_REVERSE_MAP: Record<string, string> = SYSTEM_FIELD_ALIAS_MAP

/**
 * 根据表头行构建本次解析用的字段映射。
 * 大小写不敏感：表头转小写后查反向映射。
 * mapping 的 key 保留原始表头（用户写啥就是啥），下游 rowToTopic 用 headers.indexOf 查找列索引。
 *
 * @param headers 表头单元格数组
 * @returns { mapping, titleField, unmatchedColumns }
 *   - mapping: 原始表头 → 系统字段名
 *   - titleField: 找到的 title 列名（原始表头形式）
 *   - unmatchedColumns: 未识别的表头列表（供 FieldMappingPanel 让用户绑定）
 */
function buildFieldMapping(
  headers: string[]
): { mapping: Record<string, string>; titleField: string | null; unmatchedColumns: string[] } {
  const mapping: Record<string, string> = {}
  const unmatchedColumns: string[] = []
  let titleField: string | null = null

  for (const h of headers) {
    const trimmed = String(h ?? '').trim()
    if (!trimmed) continue
    const field = HEADER_REVERSE_MAP[trimmed.toLowerCase()]
    if (field) {
      mapping[trimmed] = field
      if (field === 'title' && !titleField) {
        titleField = trimmed
      }
    } else {
      unmatchedColumns.push(trimmed)
    }
  }

  return { mapping, titleField, unmatchedColumns }
}

/**
 * 收集所有解析出的 topic 中，字段值不在 SYSTEM_CANDIDATES 内的项，
 * 生成非阻断性警告（不阻止导入，仅告知用户后续筛选可能选不到）。
 *
 * 每个字段一条警告，最多列前 10 个值，超过则附「等 N 个值」。
 */
function collectValueMismatchWarnings(topics: TopicCreateInput[]): string[] {
  const mismatches: Record<CandidateField, Set<string>> = {
    type: new Set(),
    domain: new Set(),
    difficulty: new Set(),
    source: new Set(),
    source_type: new Set()
  }
  for (const t of topics) {
    for (const key of Object.keys(SYSTEM_CANDIDATES) as CandidateField[]) {
      const v = (t as any)[key] as string | null | undefined
      if (v && !SYSTEM_CANDIDATES[key].includes(v)) {
        mismatches[key].add(v)
      }
    }
  }
  const warnings: string[] = []
  for (const key of Object.keys(mismatches) as CandidateField[]) {
    if (mismatches[key].size > 0) {
      const allValues = Array.from(mismatches[key])
      const shown = allValues.slice(0, 10).join('、')
      const more = allValues.length > 10 ? ` 等 ${allValues.length} 个值` : ''
      warnings.push(
        `${FIELD_LABEL[key]}「${shown}${more}」不在系统候选值内，已原样入库；后续在筛选面板中可能选不到这些值，建议导入后批量编辑`
      )
    }
  }
  return warnings
}

/**
 * 收集所有 topics 中字段值不在 SYSTEM_CANDIDATES 内的项。
 * 同值去重并累加出现次数。
 * null/空字符串跳过，不算"新值"。
 * 返回结构化数据，供渲染进程 ValueMappingPanel 展示与映射。
 */
export function collectUnknownValues(topics: TopicCreateInput[]): UnknownValueItem[] {
  const fields: CandidateField[] = ['type', 'domain', 'difficulty', 'source', 'source_type']
  const result: UnknownValueItem[] = []
  for (const field of fields) {
    const counter = new Map<string, number>()
    for (const t of topics) {
      const v = (t as any)[field] as string | null | undefined
      if (!v || typeof v !== 'string') continue
      if (SYSTEM_CANDIDATES[field].includes(v)) continue
      counter.set(v, (counter.get(v) ?? 0) + 1)
    }
    if (counter.size > 0) {
      result.push({
        field,
        values: Array.from(counter.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
      })
    }
  }
  return result
}

/**
 * 解析标签字符串：按中英文逗号/顿号分隔。
 */
function parseTags(value: string): string[] | null {
  if (!value) return null
  const tags = value
    .split(/[,，、;；]/)
    .map((t) => t.trim())
    .filter(Boolean)
  return tags.length > 0 ? tags : null
}

/**
 * 把表格行（按表头对齐的值数组）转换为 TopicCreateInput。
 * 未识别的字段忽略。
 *
 * 若传入 fieldMapping（用户在 FieldMappingPanel 配置的未识别列绑定），
 * 则对 unmatchedColumns 中的每列按 action 类型分发：
 *   - ignore：跳过
 *   - bind：把值赋给 topic[bind.fieldKey]（系统字段）或 topic.custom_data[fieldKey]（自定义字段已存在时）
 *   - create：把值赋给 topic.custom_data[fieldKey]（fieldKey 由 labelToKey(fieldLabel) 生成）
 *
 * 注意：fieldMapping 的 key 是原始表头（与 unmatchedColumns 中的项一致）。
 */
function rowToTopic(
  row: any[],
  headers: string[],
  mapping: Record<string, string>,
  titleField: string | null,
  rowIndex: number,
  warnings: string[],
  fieldMapping?: FieldMapping
): TopicCreateInput | null {
  if (!titleField) {
    warnings.push(`第 ${rowIndex + 1} 行：表头无 title 列，跳过所有行`)
    return null
  }

  const titleIdx = headers.indexOf(titleField)
  const titleRaw = row[titleIdx]
  const title = String(titleRaw ?? '').trim()
  if (!title) {
    warnings.push(`第 ${rowIndex + 1} 行：title 为空，跳过`)
    return null
  }

  const topic: TopicCreateInput = {
    title,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: '自定义',
    tags: null
  }

  // 系统字段（已识别表头）
  for (const [header, field] of Object.entries(mapping)) {
    if (field === 'title') continue
    const idx = headers.indexOf(header)
    if (idx < 0) continue
    const value = String(row[idx] ?? '').trim()
    if (!value) continue

    if (field === 'tags') {
      topic.tags = parseTags(value)
    } else if (field === 'weight') {
      const w = Number(value)
      if (!Number.isNaN(w)) topic.weight = w
    } else if (field === 'source_type' || field === 'status') {
      ;(topic as any)[field] = value
    } else {
      ;(topic as any)[field] = value
    }
  }

  // 用户配置的未识别列绑定
  if (fieldMapping) {
    let customData: Record<string, string | string[]> | undefined
    for (const [origHeader, action] of Object.entries(fieldMapping)) {
      const idx = headers.indexOf(origHeader)
      if (idx < 0) continue
      const value = String(row[idx] ?? '').trim()
      if (!value) continue

      if (action.kind === 'ignore') {
        continue
      }
      if (action.kind === 'bind') {
        // 绑定到已有字段：系统字段直接赋值；自定义字段写入 custom_data
        const targetKey = action.fieldKey
        const isSystem = ['title','type','domain','difficulty','source','source_type','status','tags','weight'].includes(targetKey)
        if (isSystem) {
          if (targetKey === 'tags') {
            topic.tags = parseTags(value)
          } else if (targetKey === 'weight') {
            const w = Number(value)
            if (!Number.isNaN(w)) topic.weight = w
          } else if (targetKey !== 'title') {
            ;(topic as any)[targetKey] = value
          }
        } else {
          customData = customData ?? {}
          customData[targetKey] = value
        }
      } else if (action.kind === 'create') {
        // 创建新自定义字段：fieldKey 由 labelToKey(fieldLabel) 生成
        const newKey = labelToKey(action.fieldLabel)
        if (action.fieldType === 'tags') {
          customData = customData ?? {}
          customData[newKey] = parseTags(value) ?? []
        } else {
          customData = customData ?? {}
          customData[newKey] = value
        }
      }
    }
    if (customData) topic.custom_data = customData
  }

  return topic
}

/**
 * 应用用户在 FieldMappingPanel 中配置的字段绑定，重新解析原始表格数据生成新 topics。
 *
 * 调用时机：用户处理完未识别列绑定后，ImportTopicsModal 调用此函数得到新 ParsedResult。
 * 若 parsed.rawTable 不存在（如 docx 编号列表/纯文本分支），直接返回原 parsed。
 *
 * @param parsed 原始解析结果（含 rawTable）
 * @param fieldMapping 用户配置的未识别列绑定
 * @returns 新 ParsedResult：topics 已重新生成，unmatchedColumns 清空
 */
export function applyFieldMapping(parsed: ParsedResult, fieldMapping: FieldMapping): ParsedResult {
  if (!parsed.rawTable) {
    // 无原始表格数据可重新解析（docx 编号/纯文本分支），直接返回
    return { ...parsed, unmatchedColumns: [] }
  }

  const { headers, rows } = parsed.rawTable
  const { mapping, titleField } = buildFieldMapping(headers)

  const topics: TopicCreateInput[] = []
  const warnings: string[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as any[]
    if (!row || row.every((c) => c === '' || c == null)) continue
    const topic = rowToTopic(row, headers, mapping, titleField, i, warnings, fieldMapping)
    if (topic) topics.push(topic)
  }

  return {
    ...parsed,
    topics,
    warnings: [...warnings, ...collectValueMismatchWarnings(topics)],
    unmatchedColumns: []
  }
}

// ============================================================
// Excel/CSV 解析
// ============================================================

/**
 * 自动检测文件 buffer 的文本编码：
 *   - UTF-8 BOM (EF BB BF) → 'utf-8'
 *   - UTF-16LE BOM (FF FE) → 'utf-16le'
 *   - UTF-16BE BOM (FE FF) → 'utf-16be'
 *   - 否则采样前 4KB，做 UTF-8 序列校验：若 > 30% 非 ASCII 字节处于无效 UTF-8
 *     序列位置（如孤立的续字节、0xC0/0xC1/0xF5-0xFF 非法首字节、首字节后续字节
 *     不符合 10xxxxxx），则判定为 GBK；否则默认 UTF-8
 *
 * 用于 CSV 文件解码，避免 GBK 编码文件中文乱码。
 * XLSX 文件本身是 ZIP+XML，内部固定 UTF-8，无需走此分支。
 */
function detectEncoding(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf-16le'
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf-16be'
  }
  // 采样前 4KB，逐字节扫描 UTF-8 多字节序列，统计无效位置占比
  const sample = buffer.slice(0, Math.min(buffer.length, 4096))
  let nonAscii = 0
  let invalidUtf8 = 0
  let i = 0
  while (i < sample.length) {
    const byte = sample[i]
    if (byte <= 0x7f) {
      i++
      continue
    }
    // 非 ASCII 字节
    nonAscii++
    // 期望的续字节数
    let expected = 0
    if ((byte & 0xe0) === 0xc0) {
      // 110xxxxx → 2 字节序列（排除 0xC0/0xC1，它们在 UTF-8 中非法）
      if (byte < 0xc2) {
        invalidUtf8++
        i++
        continue
      }
      expected = 1
    } else if ((byte & 0xf0) === 0xe0) {
      // 1110xxxx → 3 字节序列
      expected = 2
    } else if ((byte & 0xf8) === 0xf0) {
      // 11110xxx → 4 字节序列（排除 0xF5-0xFF，UTF-8 上限 U+10FFFF）
      if (byte > 0xf4) {
        invalidUtf8++
        i++
        continue
      }
      expected = 3
    } else {
      // 0x80-0xBF（孤立的续字节，无前置首字节）或 0xF8-0xFF（永不合法）
      invalidUtf8++
      i++
      continue
    }
    // 检查后续 expected 个字节是否都是 10xxxxxx
    let valid = true
    for (let k = 1; k <= expected; k++) {
      if (i + k >= sample.length || (sample[i + k] & 0xc0) !== 0x80) {
        valid = false
        break
      }
    }
    if (!valid) {
      invalidUtf8++
      i++
    } else {
      i += 1 + expected
    }
  }
  if (nonAscii > 0 && invalidUtf8 / nonAscii > 0.3) return 'gbk'
  return 'utf-8'
}

/**
 * 用 xlsx 库读取 Excel/CSV 文件并解析为辩题列表。
 *
 * - 第一张工作表
 * - 第一行视为表头
 * - 按 HEADER_MAPPING 自动映射字段
 * - title 列缺失的行跳过并加入 warnings
 *
 * 编码处理：
 *   - xlsx：ZIP+XML 二进制，用 fs 读取 buffer 后交给 XLSX.read（type: 'buffer'），
 *          规避 ESM 模式下 `import * as XLSX from 'xlsx'` 加载 CommonJS 版本时
 *          readFile 命名导出丢失（cjs-module-lexer 无法识别动态赋值）的问题
 *   - csv：先读 buffer，用 detectEncoding 自动识别 UTF-8 / UTF-16 / GBK，
 *          用 iconv-lite 解码后传给 XLSX.read（type: 'string'），
 *          替代旧的 codepage=65001 固定 UTF-8 写法，修复 GBK 文件中文乱码
 */
function parseExcelOrCsv(filePath: string, fileType: FileType): ParsedResult {
  let workbook: XLSX.WorkBook
  if (fileType === 'csv') {
    // CSV：buffer → 自动检测编码 → iconv-lite 解码 → 字符串传给 XLSX
    const buffer = fs.readFileSync(filePath)
    const encoding = detectEncoding(buffer)
    const text = iconv.decode(buffer, encoding)
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    // XLSX：fs 读 buffer 后交给 XLSX.read，规避 ESM 下 readFile 命名导出丢失
    const buffer = fs.readFileSync(filePath)
    workbook = XLSX.read(buffer, { type: 'buffer' })
  }
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    return { topics: [], mapping: {}, warnings: ['工作簿无任何工作表'] }
  }

  const sheet = workbook.Sheets[firstSheetName]
  // header:1 → 返回 [[h1,h2,...],[v1,v2,...],...]，便于按表头对齐
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
  if (rows.length === 0) {
    return { topics: [], mapping: {}, warnings: ['工作表为空'] }
  }

  const headers = (rows[0] as any[]).map((h) => String(h ?? '').trim())
  const { mapping, titleField } = buildFieldMapping(headers)

  // 多 sheet 文件信息性提示（不阻止导入，仅告知用户当前导入的是哪张表）
  const sheetCount = workbook.SheetNames.length
  const sheetNote =
    sheetCount > 1
      ? [
          `当前导入的是第 1 张工作表「${firstSheetName}」（共 ${sheetCount} 张：${workbook.SheetNames.join('、')}）。如需导入其他工作表，请单独保存为 xlsx 文件`
        ]
      : []

  if (!titleField) {
    const actualHeaders = headers.filter((h) => h).join(' / ') || '(空)'
    return {
      topics: [],
      mapping,
      warnings: [
        ...sheetNote,
        `未识别到 title 列（支持的别名：标题 / 题目 / 辩题 / 辩题标题 / 名称 / title / topic，大小写不敏感）`,
        `实际检测到的表头：${actualHeaders}`,
        `请检查表头第一行是否包含上述任一别名，或修改您的表头后重试`
      ]
    }
  }

  const topics: TopicCreateInput[] = []
  const warnings: string[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as any[]
    // 整行空跳过
    if (!row || row.every((c) => c === '' || c == null)) continue
    const topic = rowToTopic(row, headers, mapping, titleField, i, warnings)
    if (topic) topics.push(topic)
  }

  return {
    topics,
    mapping,
    warnings: [...sheetNote, ...warnings, ...collectValueMismatchWarnings(topics)]
  }
}

// ============================================================
// Word 解析
// ============================================================

/**
 * 检测编号格式：
 *   - 阿拉伯编号：1. / 1、 / 1)
 *   - 中文编号：一、 / 二、 / 壹、
 */
const NUMBERED_LIST_REGEX = /^(?:\d+[.、)]|[一二三四五六七八九十百千]+[、)])\s*(.+)$/

/**
 * 把 HTML <table> 解析为行数组。
 * 简化实现：用正则提取 <tr>...</tr> 与 <td>/<th>。
 */
function parseHtmlTable(html: string): string[][] | null {
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
  const rows: string[][] = []
  let trMatch: RegExpExecArray | null

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1]
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // 去 HTML 标签 + trim
      const cellText = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
      cells.push(cellText)
    }
    if (cells.length > 0) rows.push(cells)
  }

  return rows.length > 0 ? rows : null
}

/**
 * 用 mammoth 把 docx 转 HTML，检测三种结构：
 *   1. 表格 → 按列解析（同 Excel）
 *   2. 编号列表 → 按编号项解析 title
 *   3. 纯文本段落 → 按空行分段解析 title
 */
async function parseDocx(filePath: string): Promise<ParsedResult> {
  const result = await mammoth.convertToHtml({ path: filePath })
  const html = result.value || ''

  // 1. 检测表格
  const tableRows = parseHtmlTable(html)
  if (tableRows && tableRows.length >= 2) {
    // 第一行为表头
    const headers = tableRows[0].map((h) => h.trim())
    const { mapping, titleField } = buildFieldMapping(headers)

    if (titleField) {
      const topics: TopicCreateInput[] = []
      const warnings: string[] = []
      for (let i = 1; i < tableRows.length; i++) {
        const row = tableRows[i]
        const topic = rowToTopic(row, headers, mapping, titleField, i, warnings)
        if (topic) topics.push(topic)
      }
      return {
        topics,
        mapping,
        warnings: [...warnings, ...collectValueMismatchWarnings(topics)]
      }
    }

    // 表头无 title 列，但表格第一列可能是 title
    // 兜底：把第一列当 title，其他列忽略
    if (tableRows[0].length >= 1) {
      const topics: TopicCreateInput[] = tableRows
        .slice(1)
        .map((row) => row[0])
        .filter((t) => t && t.trim())
        .map((t) => ({
          title: t.trim(),
          type: null,
          domain: null,
          difficulty: null,
          source: null,
          source_type: '自定义' as const,
          tags: null
        }))
      return {
        topics,
        mapping: { [headers[0]]: 'title' },
        warnings: topics.length === 0 ? [] : ['表格无标准表头，按第一列作为 title 解析']
      }
    }
  }

  // 2. 检测编号列表 / 3. 纯文本段落
  // 先把 HTML 转为纯文本（去标签）
  const text = html
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // 检测是否大部分行都是编号格式
  const numberedLines = lines.filter((l) => NUMBERED_LIST_REGEX.test(l))
  const isNumberedList = lines.length > 0 && numberedLines.length >= lines.length * 0.5

  const topics: TopicCreateInput[] = []
  if (isNumberedList) {
    // 按编号项解析
    for (const line of lines) {
      const m = line.match(NUMBERED_LIST_REGEX)
      if (m) {
        const title = m[1].trim()
        if (title) {
          topics.push({
            title,
            type: null,
            domain: null,
            difficulty: null,
            source: null,
            source_type: '自定义',
            tags: null
          })
        }
      }
    }
    return {
      topics,
      mapping: {},
      warnings: topics.length === 0 ? ['未识别到编号列表项'] : []
    }
  }

  // 3. 纯文本：每个非空行视为一道辩题
  for (const line of lines) {
    if (line.length >= 2) {
      topics.push({
        title: line,
        type: null,
        domain: null,
        difficulty: null,
        source: null,
        source_type: '自定义',
        tags: null
      })
    }
  }

  return {
    topics,
    mapping: {},
    warnings: topics.length === 0 ? ['未解析到任何辩题'] : []
  }
}

// ============================================================
// parseFile 分发函数
// ============================================================

/**
 * 根据文件类型分发到对应的解析器。
 *
 * @param filePath 文件绝对路径
 * @param fileType 文件类型：'xlsx' | 'csv' | 'docx'
 * @throws 文件不存在、类型不支持
 */
export async function parseFile(filePath: string, fileType: FileType): Promise<ParsedResult> {
  // 校验文件存在
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`)
  }

  // 校验文件类型
  const supportedTypes: FileType[] = ['xlsx', 'csv', 'docx']
  if (!supportedTypes.includes(fileType)) {
    throw new Error(`不支持的文件类型: ${fileType}`)
  }

  // 按类型分发
  if (fileType === 'xlsx' || fileType === 'csv') {
    return parseExcelOrCsv(filePath, fileType)
  }
  if (fileType === 'docx') {
    return parseDocx(filePath)
  }

  // 理论不可达
  throw new Error(`不支持的文件类型: ${fileType}`)
}
