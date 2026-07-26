import { describe, it, expect, vi } from 'vitest'

// 模拟 Electron 主进程 ESM 加载 xlsx 时 readFile 命名导出丢失的情况
// （cjs-module-lexer 无法识别 xlsx.js 中 `XLSX.readFile = readFileSync` 动态赋值）
// 此 mock 确保所有测试都在 readFile 不可用的前提下运行，
// 任何回退到 XLSX.readFile 的代码都会立即失败
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>()
  return {
    ...actual,
    readFile: undefined as unknown as typeof actual.readFile
  }
})

import path from 'path'
import fs from 'fs'
import os from 'os'
import * as XLSX from 'xlsx'
import { parseFile, HEADER_MAPPING, applyFieldMapping } from '../import-engine'
import type { FieldMapping } from '../../../shared/types'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')

// ============================================================
// 测试工具：动态构造临时 xlsx 文件
// ============================================================

/**
 * 写一个临时 xlsx 文件，返回路径。可选多 sheet。
 * 调用方负责用 try/finally 删除临时文件。
 */
function writeTmpXlsx(sheets: { name: string; rows: any[][] }[]): string {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const tmpPath = path.join(
    os.tmpdir(),
    `test-import-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
  )
  fs.writeFileSync(tmpPath, buf)
  return tmpPath
}

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

// ============================================================
// 表头识别（中英文 + 大小写不敏感 + 诊断提示 + 多 sheet + 字段值警告）
// ============================================================

describe('表头识别（中英文 + 大小写不敏感）', () => {
  it('识别英文小写表头 title/type/domain/difficulty/source/tags', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['title', 'type', 'domain', 'difficulty', 'source', 'tags'],
          ['测试辩题', '价值辩', '社会热点', '入门级', '新国辩', '伦理,成长']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].title).toBe('测试辩题')
      expect(result.topics[0].type).toBe('价值辩')
      expect(result.topics[0].domain).toBe('社会热点')
      expect(result.topics[0].difficulty).toBe('入门级')
      expect(result.topics[0].source).toBe('新国辩')
      expect(result.topics[0].tags).toEqual(['伦理', '成长'])
      // mapping 的 key 保留原始表头（小写英文）
      expect(result.mapping['title']).toBe('title')
      expect(result.mapping['type']).toBe('type')
      expect(result.mapping['tags']).toBe('tags')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('识别大小写混合表头 Title / TYPE / Domain', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['Title', 'TYPE', 'Domain', 'Difficulty', 'Source', 'Tags'],
          ['混合大小写辩题', '政策辩', '科技伦理', '进阶级', '华语辩论世界杯', '科技']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].title).toBe('混合大小写辩题')
      expect(result.topics[0].type).toBe('政策辩')
      expect(result.topics[0].domain).toBe('科技伦理')
      // mapping 的 key 保留原始表头（混合大小写）
      expect(result.mapping['Title']).toBe('title')
      expect(result.mapping['TYPE']).toBe('type')
      expect(result.mapping['Domain']).toBe('domain')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

describe('title 列未识别的诊断提示', () => {
  it('warnings 包含实际表头列表与别名提示', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['题目名称', '类别', '难度等级'], // 都不在映射表内
          ['测试辩题1', 'A', 'B'],
          ['测试辩题2', 'C', 'D']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(0)
      expect(result.warnings.length).toBeGreaterThan(0)
      const allWarnings = result.warnings.join('\n')
      // 包含「未识别到 title 列」+ 别名提示
      expect(allWarnings).toContain('未识别到 title 列')
      expect(allWarnings).toContain('title')
      expect(allWarnings).toContain('topic')
      expect(allWarnings).toContain('大小写不敏感')
      // 包含实际检测到的表头
      expect(allWarnings).toContain('题目名称')
      expect(allWarnings).toContain('类别')
      expect(allWarnings).toContain('难度等级')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

describe('字段值不匹配警告（非阻断）', () => {
  it('difficulty 写 1-入门 仍入库，但 warnings 中提示不在系统候选值内', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['title', 'type', 'domain', 'difficulty', 'source', 'tags'],
          ['测试辩题', '价值辩', '社会热点', '1-入门', '自定义', '伦理']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      // 不阻断导入：topics 仍正常返回
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].difficulty).toBe('1-入门')
      // warnings 中包含字段值不匹配提示
      const allWarnings = result.warnings.join('\n')
      expect(allWarnings).toContain('1-入门')
      expect(allWarnings).toContain('不在系统候选值内')
      expect(allWarnings).toContain('难度')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

describe('多 sheet 文件提示', () => {
  it('含 2 张 sheet 时 warnings 提示当前导入的是第 1 张', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: '华语辩论辩题库',
        rows: [
          ['title', 'type', 'difficulty'],
          ['辩题 A', '价值辩', '入门级']
        ]
      },
      {
        name: '赛事概况',
        rows: [
          ['赛事名称', '创办年份'],
          ['新国辩', 2013]
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].title).toBe('辩题 A')
      // warnings 中包含多 sheet 提示
      const allWarnings = result.warnings.join('\n')
      expect(allWarnings).toContain('当前导入的是第 1 张工作表')
      expect(allWarnings).toContain('华语辩论辩题库')
      expect(allWarnings).toContain('赛事概况')
      expect(allWarnings).toContain('共 2 张')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

// ============================================================
// buffer 读取路径（修复 readFile 命名导出丢失）
// ============================================================

describe('parseFile XLSX buffer 读取路径（修复 readFile 缺失）', () => {
  it('XLSX.readFile 不可用时（模拟 ESM 加载）仍能正确解析 xlsx', async () => {
    // 由文件顶部 vi.mock 确保 XLSX.readFile === undefined
    expect((XLSX as any).readFile).toBeUndefined()

    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['title', 'type', 'difficulty'],
          ['buffer 路径辩题', '价值辩', '入门级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].title).toBe('buffer 路径辩题')
      expect(result.topics[0].type).toBe('价值辩')
      expect(result.topics[0].difficulty).toBe('入门级')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('大文件 xlsx（1000 行）仍能正确解析', async () => {
    const rows: any[][] = [['title', 'type']]
    for (let i = 0; i < 1000; i++) {
      rows.push([`测试辩题${i}-${'测试'.repeat(20)}`, '价值辩'])
    }
    const tmpPath = writeTmpXlsx([{ name: 'Sheet1', rows }])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1000)
      expect(result.topics[0].title).toContain('测试辩题0')
      expect(result.topics[999].title).toContain('测试辩题999')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

// ============================================================
// unmatchedColumns + applyFieldMapping
// ============================================================

describe('unmatchedColumns 收集', () => {
  it('含「赛事」列的 xlsx → unmatchedColumns 含「赛事」', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '类型', '赛事'],
          ['AI 是否应被禁止', '价值辩', '新国辩'],
          ['死刑应否废除', '政策辩', '世锦赛']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unmatchedColumns).toContain('赛事')
      expect(result.mapping['标题']).toBe('title')
      expect(result.mapping['类型']).toBe('type')
      // 系统字段不被误判为 unmatched
      expect(result.unmatchedColumns).not.toContain('标题')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('全部列都已识别 → unmatchedColumns 为空数组', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '类型', '难度'],
          ['测试题1', '价值辩', '入门级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unmatchedColumns).toEqual([])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

describe('applyFieldMapping', () => {
  it('kind=create → 值写入 custom_data', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩'],
          ['题2', '世锦赛']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'create' as const, fieldLabel: '赛事', fieldType: 'string' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics).toHaveLength(2)
      expect(result.topics[0].custom_data?.['赛事']).toBe('新国辩')
      expect(result.topics[1].custom_data?.['赛事']).toBe('世锦赛')
      expect(result.unmatchedColumns).toEqual([])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=bind → 值绑定到系统字段', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'bind' as const, fieldKey: 'source' }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].source).toBe('新国辩')
      expect(result.topics[0].custom_data).toBeUndefined()
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=ignore → 该列值被丢弃', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'ignore' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].source).toBeNull()
      expect(result.topics[0].custom_data).toBeUndefined()
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=create + fieldType=tags → custom_data 为字符串数组', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '主题词'],
          ['题1', 'AI,伦理,科技']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        主题词: { kind: 'create' as const, fieldLabel: '主题词', fieldType: 'tags' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].custom_data?.['主题词']).toEqual(['AI', '伦理', '科技'])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

// ============================================================
// unknownValues 收集：解析后 ParsedResult.unknownValues 应正确填充
// 用于驱动前端 ValueMappingPanel 显示（如「高阶级→进阶级」映射）
// ============================================================
describe('unknownValues 收集', () => {
  it('difficulty 含「高阶级」→ unknownValues 中 difficulty 字段含「高阶级」及计数', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '难度'],
          ['测试辩题1', '高阶级'],
          ['测试辩题2', '入门级'],
          ['测试辩题3', '高阶级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unknownValues).toBeDefined()
      const diff = result.unknownValues?.find((u) => u.field === 'difficulty')
      expect(diff).toBeDefined()
      expect(diff!.values.find((v) => v.value === '高阶级')).toEqual({
        value: '高阶级',
        count: 2
      })
      // 入门级 在系统候选内，不应被收集
      expect(diff!.values.find((v) => v.value === '入门级')).toBeUndefined()
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('所有字段值都在系统候选内 → unknownValues 为空数组', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '类型', '难度'],
          ['测试辩题1', '价值辩', '入门级'],
          ['测试辩题2', '政策辩', '专业级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unknownValues).toEqual([])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('applyFieldMapping 后 unknownValues 重新计算', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['测试辩题1', '新国辩A'],
          ['测试辩题2', '华语辩论世界杯B']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      // 「赛事」列未识别，绑定到 source 系统字段
      const fieldMapping: FieldMapping = {
        赛事: { kind: 'bind', fieldKey: 'source' }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      // 绑定后 source 字段值=新国辩A / 华语辩论世界杯B，都不在系统候选内
      expect(result.unknownValues).toBeDefined()
      const src = result.unknownValues?.find((u) => u.field === 'source')
      expect(src).toBeDefined()
      expect(src!.values.length).toBe(2)
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})
