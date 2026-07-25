import { describe, it, expect } from 'vitest'
import path from 'path'
import { parseFile, HEADER_MAPPING } from '../import-engine'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')

// ============================================================
// HEADER_MAPPING
// ============================================================

describe('HEADER_MAPPING', () => {
  it('包含 title 字段的多个别名', () => {
    expect(HEADER_MAPPING.title).toContain('标题')
    expect(HEADER_MAPPING.title).toContain('题目')
    expect(HEADER_MAPPING.title).toContain('辩题')
  })
})

// ============================================================
// parseFile - 错误处理
// ============================================================

describe('parseFile 错误处理', () => {
  it('文件不存在抛错', async () => {
    await expect(parseFile('nonexistent.xlsx', 'xlsx')).rejects.toThrow('文件不存在')
  })

  it('不支持的文件类型抛错', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics.csv')
    await expect(parseFile(filePath, 'pdf' as any)).rejects.toThrow('不支持的文件类型')
  })
})

// ============================================================
// parseFile - CSV
// ============================================================

describe('parseFile CSV', () => {
  it('解析 CSV 表头与数据行', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics.csv')
    const result = await parseFile(filePath, 'csv')

    expect(result.topics).toHaveLength(3)
    expect(result.topics[0].title).toBe('人工智能是否应该被禁止')
    expect(result.topics[0].type).toBe('价值辩')
    expect(result.topics[0].domain).toBe('科技伦理')
    expect(result.topics[0].difficulty).toBe('进阶级')
    expect(result.topics[0].source).toBe('新国辩')
    expect(result.topics[0].tags).toEqual(['AI', '伦理'])
    expect(result.topics[0].source_type).toBe('自定义')
  })

  it('识别表头映射', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics.csv')
    const result = await parseFile(filePath, 'csv')

    expect(result.mapping['标题']).toBe('title')
    expect(result.mapping['类型']).toBe('type')
    expect(result.mapping['领域']).toBe('domain')
    expect(result.mapping['难度']).toBe('difficulty')
    expect(result.mapping['来源']).toBe('source')
    expect(result.mapping['标签']).toBe('tags')
  })
})

// ============================================================
// parseFile - XLSX
// ============================================================

describe('parseFile XLSX', () => {
  it('解析 Excel 表头与数据行', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics.xlsx')
    const result = await parseFile(filePath, 'xlsx')

    // 第 4 行 title 为空 → 跳过
    expect(result.topics).toHaveLength(2)
    expect(result.topics[0].title).toBe('人工智能是否应该被禁止')
    expect(result.topics[0].tags).toEqual(['AI', '伦理'])
    expect(result.topics[1].title).toBe('环保政策是否应该立即执行')
  })

  it('title 缺失的行加入 warnings', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics.xlsx')
    const result = await parseFile(filePath, 'xlsx')

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('title 为空'))).toBe(true)
  })
})

// ============================================================
// parseFile - DOCX 表格
// ============================================================

describe('parseFile DOCX 表格', () => {
  it('解析 Word 表格结构', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics-table.docx')
    const result = await parseFile(filePath, 'docx')

    expect(result.topics.length).toBeGreaterThanOrEqual(2)
    expect(result.topics[0].title).toBe('人工智能是否应该被禁止')
    expect(result.topics[0].type).toBe('价值辩')
    expect(result.topics[0].difficulty).toBe('进阶级')
    expect(result.topics[1].title).toBe('环保政策是否应该立即执行')
  })
})

// ============================================================
// parseFile - DOCX 编号列表
// ============================================================

describe('parseFile DOCX 编号列表', () => {
  it('解析编号列表为 title', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics-numbered.docx')
    const result = await parseFile(filePath, 'docx')

    expect(result.topics.length).toBeGreaterThanOrEqual(3)
    expect(result.topics[0].title).toContain('人工智能')
    expect(result.topics[1].title).toContain('环保政策')
    expect(result.topics[2].title).toContain('大学生')
    // 其他字段为 null
    expect(result.topics[0].type).toBeNull()
    expect(result.topics[0].difficulty).toBeNull()
  })
})

// ============================================================
// parseFile - DOCX 纯文本
// ============================================================

describe('parseFile DOCX 纯文本', () => {
  it('解析纯文本段落为 title', async () => {
    const filePath = path.join(FIXTURES_DIR, 'topics-text.docx')
    const result = await parseFile(filePath, 'docx')

    expect(result.topics.length).toBeGreaterThanOrEqual(3)
    // 每条至少包含辩题相关关键词
    const titles = result.topics.map((t) => t.title)
    expect(titles.some((t) => t.includes('人工智能'))).toBe(true)
    expect(titles.some((t) => t.includes('环保政策'))).toBe(true)
    expect(titles.some((t) => t.includes('大学生'))).toBe(true)
  })
})
