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
import type { TopicCreateInput } from '../db/repository/topic.repo'

// ============================================================
// 类型定义
// ============================================================

export type FileType = 'xlsx' | 'csv' | 'docx'

export interface ParsedResult {
  /** 解析出的辩题列表（未入库） */
  topics: TopicCreateInput[]
  /** 实际使用的表头映射：原始表头 → Topic 字段名 */
  mapping: Record<string, string>
  /** 警告信息（如某行 title 缺失） */
  warnings: string[]
}

/**
 * 中文表头 → Topic 字段的映射规则。
 * 同一字段可有多个中文别名。
 */
export const HEADER_MAPPING: Record<string, string[]> = {
  title: ['标题', '题目', '辩题', '辩题标题', '名称'],
  type: ['类型', '辩题类型'],
  domain: ['领域', '主题领域', '分类'],
  difficulty: ['难度', '难度等级'],
  source: ['来源', '出处'],
  tags: ['标签', '标记']
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 反向映射：中文表头 → Topic 字段名。
 * 遍历 HEADER_MAPPING，构建 { '标题': 'title', '题目': 'title', ... }。
 */
const HEADER_REVERSE_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(HEADER_MAPPING)) {
    for (const alias of aliases) {
      m[alias] = field
    }
  }
  return m
})()

/**
 * 根据表头行构建本次解析用的字段映射。
 * @param headers 表头单元格数组
 * @returns { mapping: Record<原始表头, 字段名>, titleField: 找到的 title 列名 }
 */
function buildFieldMapping(
  headers: string[]
): { mapping: Record<string, string>; titleField: string | null } {
  const mapping: Record<string, string> = {}
  let titleField: string | null = null

  for (const h of headers) {
    const trimmed = String(h ?? '').trim()
    if (!trimmed) continue
    const field = HEADER_REVERSE_MAP[trimmed]
    if (field) {
      mapping[trimmed] = field
      if (field === 'title' && !titleField) {
        titleField = trimmed
      }
    }
  }

  return { mapping, titleField }
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
 */
function rowToTopic(
  row: any[],
  headers: string[],
  mapping: Record<string, string>,
  titleField: string | null,
  rowIndex: number,
  warnings: string[]
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

  for (const [header, field] of Object.entries(mapping)) {
    if (field === 'title') continue
    const idx = headers.indexOf(header)
    if (idx < 0) continue
    const value = String(row[idx] ?? '').trim()
    if (!value) continue

    if (field === 'tags') {
      topic.tags = parseTags(value)
    } else {
      ;(topic as any)[field] = value
    }
  }

  return topic
}

// ============================================================
// Excel/CSV 解析
// ============================================================

/**
 * 用 xlsx 库读取 Excel/CSV 文件并解析为辩题列表。
 *
 * - 第一张工作表
 * - 第一行视为表头
 * - 按 HEADER_MAPPING 自动映射字段
 * - title 列缺失的行跳过并加入 warnings
 *
 * 注：CSV 是 UTF-8 文本，XLSX 库默认用 Latin1 解码会导致中文乱码，
 *     因此显式指定 codepage=65001 (UTF-8)。对 .xlsx 文件无影响（内部是 XML）。
 */
function parseExcelOrCsv(filePath: string): ParsedResult {
  const workbook = XLSX.readFile(filePath, { type: 'file', codepage: 65001 })
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

  if (!titleField) {
    return {
      topics: [],
      mapping,
      warnings: ['未识别到 title 列（标题/题目/辩题），无法解析']
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

  return { topics, mapping, warnings }
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
      return { topics, mapping, warnings }
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
    return parseExcelOrCsv(filePath)
  }
  if (fileType === 'docx') {
    return parseDocx(filePath)
  }

  // 理论不可达
  throw new Error(`不支持的文件类型: ${fileType}`)
}
