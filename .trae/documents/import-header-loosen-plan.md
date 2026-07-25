# 放宽导入表头识别 + 改进失败提示 实施计划

> **目标：** 修复英文表头 Excel 文件导入失败的问题，扩展表头识别范围，并在解析失败时给出针对性诊断。

**架构：** ① 在 `HEADER_MAPPING` 中补充英文别名（小写+大小写不敏感匹配）；② 改造 `buildFieldMapping` 支持大小写不敏感；③ 改造 `parseExcelOrCsv` 在 title 列未识别时，把实际检测到的表头列表加入 warnings，让用户立即看出"表头不匹配"；④ 同步更新 ImportFormatGuide 文案；⑤ 补充单元测试。

**技术栈：** TypeScript + xlsx + Vitest

---

## 现状分析

### Bug 复现
用户提供文件 `新建文件夹/华语辩论经典赛事辩题库_整合版.xlsx`，表头为英文：
```
title, type, domain, difficulty, source, tags
```

后端 `src/main/services/import-engine.ts:39-46` 的 `HEADER_MAPPING` 仅含中文别名：
```typescript
export const HEADER_MAPPING: Record<string, string[]> = {
  title: ['标题', '题目', '辩题', '辩题标题', '名称'],
  type: ['类型', '辩题类型'],
  domain: ['领域', '主题领域', '分类'],
  difficulty: ['难度', '难度等级'],
  source: ['来源', '出处'],
  tags: ['标签', '标记']
}
```

`buildFieldMapping`（第 71-90 行）严格按 `HEADER_REVERSE_MAP[trimmed]` 精确匹配，英文 `title` 不在表内 → `titleField = null` → 整文件 0 条解析 → 仅返回 warning `'未识别到 title 列（标题/题目/辩题），无法解析'`，用户无从知道实际表头是什么、为何不匹配。

### 后端测试现状
`src/main/services/__tests__/import-engine.test.ts` 已有用例覆盖中文表头，但未覆盖英文表头与大小写不敏感场景。

### 前端导入弹窗
`src/renderer/src/components/import/ImportFormatGuide.tsx` 列名映射表也仅展示中文别名，未告知用户英文表头也支持。Step 1（解析失败）当前只显示 ImportFormatGuide 让用户自查，未展示后端 warnings 中"实际检测到的表头"信息（因为当前后端没生成该信息）。

---

## 提议变更

### 文件结构
| 文件 | 类型 | 职责 |
|------|------|------|
| `src/main/services/import-engine.ts` | 修改 | ① HEADER_MAPPING 补充英文别名；② buildFieldMapping 改为大小写不敏感；③ title 列未识别时 warnings 中列出实际表头供诊断 |
| `src/main/services/__tests__/import-engine.test.ts` | 修改 | 补充英文表头 / 大小写不敏感 / title 列未识别诊断提示 用例 |
| `src/renderer/src/components/import/ImportFormatGuide.tsx` | 修改 | 列名映射表"中文表头别名"列改为"表头别名（中英文均可）"，补充英文别名展示 |

**不新建文件，不引入新依赖。**

---

## 任务分解

### Task 1：扩展 HEADER_MAPPING 支持英文别名 + 大小写不敏感

**Files:**
- Modify: `src/main/services/import-engine.ts:39-90`

**变更点：**

1. **扩展 HEADER_MAPPING**（第 39-46 行），每个字段补充英文别名：

```typescript
export const HEADER_MAPPING: Record<string, string[]> = {
  title: ['标题', '题目', '辩题', '辩题标题', '名称', 'title', 'topic'],
  type: ['类型', '辩题类型', 'type', 'category'],
  domain: ['领域', '主题领域', '分类', 'domain'],
  difficulty: ['难度', '难度等级', 'difficulty', 'level'],
  source: ['来源', '出处', 'source'],
  tags: ['标签', '标记', 'tags', 'tag']
}
```

2. **改造 HEADER_REVERSE_MAP 构建逻辑**（第 56-64 行），统一转小写做反向映射：

```typescript
const HEADER_REVERSE_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(HEADER_MAPPING)) {
    for (const alias of aliases) {
      // 反向映射的 key 统一转小写，匹配时也用小写比较
      m[alias.toLowerCase()] = field
    }
  }
  return m
})()
```

3. **改造 buildFieldMapping**（第 71-90 行），用 `trimmed.toLowerCase()` 查表：

```typescript
function buildFieldMapping(
  headers: string[]
): { mapping: Record<string, string>; titleField: string | null } {
  const mapping: Record<string, string> = {}
  let titleField: string | null = null

  for (const h of headers) {
    const trimmed = String(h ?? '').trim()
    if (!trimmed) continue
    // 大小写不敏感匹配：表头转小写后查反向映射
    const field = HEADER_REVERSE_MAP[trimmed.toLowerCase()]
    if (field) {
      mapping[trimmed] = field  // mapping 的 key 保留原始表头（用户写啥就是啥）
      if (field === 'title' && !titleField) {
        titleField = trimmed
      }
    }
  }

  return { mapping, titleField }
}
```

> 注：`mapping` 的 key 仍保留原始表头（用户写的 `Title` 或 `title`），下游 `rowToTopic` 用 `headers.indexOf(header)` 查找列索引，行为不变。

---

### Task 2：改进解析失败的诊断提示

**Files:**
- Modify: `src/main/services/import-engine.ts:282-288`

**变更点：**

当 `titleField` 为 null 时，把实际检测到的表头列表加入 warnings，让用户立即看出问题：

```typescript
if (!titleField) {
  const actualHeaders = headers.filter((h) => h).join(' / ') || '(空)'
  return {
    topics: [],
    mapping,
    warnings: [
      `未识别到 title 列（标题/题目/辩题/title 等任一别名），无法解析`,
      `实际检测到的表头：${actualHeaders}`,
      `请检查表头第一行是否包含受支持的别名（中英文均可，大小写不敏感）`
    ]
  }
}
```

---

### Task 3：补充单元测试

**Files:**
- Modify: `src/main/services/__tests__/import-engine.test.ts`

**新增用例：**

```typescript
describe('表头识别（中英文+大小写不敏感）', () => {
  it('识别英文小写表头 title/type/domain/difficulty/source/tags', () => {
    // 构造一个内存 xlsx，表头用英文小写
    const ws = XLSX.utils.aoa_to_sheet([
      ['title', 'type', 'domain', 'difficulty', 'source', 'tags'],
      ['测试辩题', '价值辩', '社会热点', '入门级', '新国辩', '伦理,成长']
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const tmpPath = path.join(os.tmpdir(), `test-en-headers-${Date.now()}.xlsx`)
    fs.writeFileSync(tmpPath, buf)
    try {
      const result = parseFile(tmpPath, 'xlsx')
      expect(result.topics.length).toBe(1)
      expect(result.topics[0].title).toBe('测试辩题')
      expect(result.topics[0].type).toBe('价值辩')
      expect(result.topics[0].tags).toEqual(['伦理', '成长'])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('识别大小写混合表头 Title / TYPE / Domain', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Title', 'TYPE', 'Domain', 'Difficulty', 'Source', 'Tags'],
      ['混合大小写辩题', '政策辩', '科技伦理', '进阶级', '华语辩论世界杯', '科技']
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const tmpPath = path.join(os.tmpdir(), `test-mixed-case-${Date.now()}.xlsx`)
    fs.writeFileSync(tmpPath, buf)
    try {
      const result = parseFile(tmpPath, 'xlsx')
      expect(result.topics.length).toBe(1)
      expect(result.topics[0].title).toBe('混合大小写辩题')
      expect(result.topics[0].type).toBe('政策辩')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('title 列未识别时 warnings 包含实际表头列表', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['题目名称', '类别', '难度等级'],  // 都不在映射表内
      ['测试辩题1', 'A', 'B'],
      ['测试辩题2', 'C', 'D']
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const tmpPath = path.join(os.tmpdir(), `test-no-title-${Date.now()}.xlsx`)
    fs.writeFileSync(tmpPath, buf)
    try {
      const result = parseFile(tmpPath, 'xlsx')
      expect(result.topics.length).toBe(0)
      expect(result.warnings.length).toBeGreaterThan(0)
      const allWarnings = result.warnings.join('\n')
      expect(allWarnings).toContain('未识别到 title 列')
      expect(allWarnings).toContain('题目名称')  // 实际表头被列出
      expect(allWarnings).toContain('类别')
      expect(allWarnings).toContain('难度等级')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})
```

> 注：测试文件需在顶部 import `fs`、`os`、`path`、`XLSX`，若现有测试文件已 import 部分则不重复。

---

### Task 4：更新 ImportFormatGuide 文案

**Files:**
- Modify: `src/renderer/src/components/import/ImportFormatGuide.tsx`

**变更点：**

把 FIELD_ROWS 的 aliases 数组补充英文别名，并在表头说明区加一句"中英文均可，大小写不敏感"：

```typescript
const FIELD_ROWS: FieldRow[] = [
  { field: 'title', aliases: ['标题', '题目', '辩题', '辩题标题', '名称', 'title', 'topic'], required: true, example: '金钱是/不是万恶之源', note: '必填，缺失则该行跳过' },
  { field: 'type', aliases: ['类型', '辩题类型', 'type', 'category'], required: false, example: '价值辩', note: '可选' },
  { field: 'domain', aliases: ['领域', '主题领域', '分类', 'domain'], required: false, example: '社会热点', note: '可选' },
  { field: 'difficulty', aliases: ['难度', '难度等级', 'difficulty', 'level'], required: false, example: '入门级', note: '可选' },
  { field: 'source', aliases: ['来源', '出处', 'source'], required: false, example: '新国辩', note: '可选' },
  { field: 'tags', aliases: ['标签', '标记', 'tags', 'tag'], required: false, example: '成长,伦理', note: '可选，按 , ， 、 ; ； 分隔' }
];
```

并把"Excel / CSV 列名映射"标题改为"Excel / CSV 列名映射（中英文均可，大小写不敏感）"。

---

## 假设与决策

### 假设
1. `xlsx` 库在 main 进程可用（已有用法）
2. 大小写不敏感匹配不会破坏现有中文表头识别（中文本身无大小写概念）
3. 用户文件中 `domain` 值如 `伦理道德` / `社会民生` 不在系统候选 `DOMAIN_OPTIONS` 内，但后端导入不会因此拒绝，原样存入数据库（后续筛选时可能选不到，但不影响导入）

### 决策
1. **扩展英文别名而非放宽到任意字段名**：保留映射表，避免误识别（如某列叫 `name` 可能是辩题名也可能是其他含义）
2. **大小写不敏感**：用户可能写 `Title` / `TITLE` / `title`，统一处理
3. **保留 mapping 的 key 为原始表头**：下游 `rowToTopic` 用 `headers.indexOf(header)` 查找列索引，行为不变
4. **补充 `topic` / `category` / `level` 等同义词**：常见英文表头，提高识别率
5. **诊断提示同时列出实际表头**：让用户一眼看出"我写的是 X，系统要的是 Y"
6. **不修改 source_type 自动标记为「自定义」的逻辑**：用户文件无 source_type 列，自动设为「自定义」合理
7. **不规范化字段值**：如 `1-入门` vs `入门级` 不做转换，保持数据原貌，避免引入业务逻辑（用户可在导入后手动批量改）

---

## 验证步骤

### 自动化验证
1. `npm run typecheck`
2. `npm test -- --run`
   - 验证新增 3 个用例通过
   - 验证既有 244 个测试不破坏

### 端到端验证清单
1. 用 `新建文件夹/华语辩论经典赛事辩题库_整合版.xlsx` 重新导入
   - 期望：解析出 724 条辩题（725 行减去表头），title/type/domain/difficulty/source/tags 全部正确映射
   - tags 按 `,` 分隔解析为 `['第一届', '1993', '小组赛']`
2. 故意构造表头为 `Title / TYPE / Domain` 的 Excel 导入 → 正确识别（大小写不敏感）
3. 故意构造表头为 `题目名称 / 类别` 的 Excel 导入 → Step 1 失败，warnings 中列出"实际检测到的表头：题目名称 / 类别"
4. 打开「设置 → 数据管理 → 导入辩题」→ Step 0 格式说明中显示中英文别名，并标注"中英文均可，大小写不敏感"
5. 用标准中文表头（标题/类型/领域...）的 Excel 导入 → 仍正常工作（向后兼容）
