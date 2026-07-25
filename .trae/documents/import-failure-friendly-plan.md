# 题库导入失败友好化方案

> **目标：** 解决用户在「新建文件夹/华语辩论经典赛事辩题库_整合版.xlsx」中遇到的导入失败问题。该文件表头为英文小写（`title, type, domain, difficulty, source, tags`），当前 `HEADER_MAPPING` 仅含中文别名 → 整文件 0 条解析 → 提示「未识别到 title 列」无诊断信息。

**两条改进方向同时落地：**
1. **放宽导入设置** — 表头识别支持中英文 + 大小写不敏感
2. **失败提示更清晰** — 列出实际检测到的表头、未识别列、字段值与系统候选值不匹配警告、多 sheet 文件提示

**技术栈：** TypeScript + xlsx + mammoth + Vitest

---

## 现状分析

### Bug 复现路径

1. 用户在「题库」或「设置」点「导入辩题」
2. 选择 `新建文件夹/华语辩论经典赛事辩题库_整合版.xlsx`
3. 前端 `ImportTopicsModal.tsx:97` 调用 `window.importAPI.parseFile(path, 'xlsx')`
4. 主进程 `import-engine.ts:255` 进入 `parseExcelOrCsv`
5. `XLSX.readFile` 读取工作簿，`SheetNames[0]` = `华语辩论辩题库`（数据表）✅
6. `buildFieldMapping(['title','type','domain','difficulty','source','tags'])` →
   每个 header 在 `HEADER_REVERSE_MAP` 中精确查找（无 toLowerCase）→ 全部 miss
7. `titleField = null` → 返回 `{ topics: [], mapping: {}, warnings: ['未识别到 title 列（标题/题目/辩题），无法解析'] }`
8. 前端 Step 1 显示「解析失败」Alert + ImportFormatGuide 展开
9. 用户看到「未识别到 title 列」，但**不知道自己的表头是 `title`、系统能识别哪些别名**，无从下手

### 当前严格点清单

| 严格点 | 文件:行号 | 当前行为 | 问题 |
|---|---|---|---|
| 表头别名仅中文 | `import-engine.ts:39-46` | `HEADER_MAPPING` 仅 5-6 个中文别名 | 英文表头 100% 失败 |
| 大小写敏感 | `import-engine.ts:71-90` | `HEADER_REVERSE_MAP[trimmed]` 精确匹配 | `Title` / `TITLE` 不识别 |
| 未识别列静默忽略 | `import-engine.ts:77-87` | 不在映射表的列直接丢弃 | 用户不知道哪些列被忽略了 |
| title 列未识别无诊断 | `import-engine.ts:282-288` | 只说"未识别到 title 列" | 不告诉用户实际表头是什么 |
| xlsx/csv 不兜底 | `import-engine.ts:282-288` | 直接返回空 | docx 有"第一列当 title"兜底，xlsx/csv 没有 |
| 多 sheet 不提示 | `import-engine.ts:267-271` | 只取第一张 | 用户不知道导入的是哪张表 |
| 字段值不匹配无警告 | 无 | `1-入门` vs 系统 `入门级` 静默入库 | 后续筛选选不到 |

### 已有计划文件状态

项目下已有 `.trae/documents/import-header-loosen-plan.md`，覆盖了表头放宽和诊断提示，但**未实施**（当前 `import-engine.ts` 仍是纯中文别名）。本计划在其基础上扩展，新增字段值匹配警告和多 sheet 提示。

---

## 提议变更

### 文件清单

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/main/services/import-engine.ts` | 修改 | ① HEADER_MAPPING 补英文别名；② buildFieldMapping 大小写不敏感；③ title 未识别时 warnings 列出实际表头；④ 新增字段值与候选值不匹配警告；⑤ 多 sheet 文件提示当前导入的 sheet 名 |
| `src/main/services/__tests__/import-engine.test.ts` | 修改 | 补英文表头 / 大小写不敏感 / 诊断提示 / 字段值警告 / 多 sheet 用例 |
| `src/renderer/src/components/import/ImportFormatGuide.tsx` | 修改 | 列名映射表补英文别名 + 标注「中英文均可，大小写不敏感」 |
| `src/renderer/src/components/ImportTopicsModal.tsx` | 修改 | warnings 展示区优化：分类展示（错误 / 警告 / 信息），区分阻断性和非阻断性提示 |

**不新建文件，不引入新依赖。**

---

## 任务分解

### Task 1：扩展 HEADER_MAPPING + 大小写不敏感匹配

**Files:** `src/main/services/import-engine.ts:39-90`

**变更点：**

1. **扩展 `HEADER_MAPPING`（第 39-46 行）**，每字段补英文同义词：

```typescript
export const HEADER_MAPPING: Record<string, string[]> = {
  title:      ['标题', '题目', '辩题', '辩题标题', '名称', 'title', 'topic'],
  type:       ['类型', '辩题类型', 'type', 'category'],
  domain:     ['领域', '主题领域', '分类', 'domain'],
  difficulty: ['难度', '难度等级', 'difficulty', 'level'],
  source:     ['来源', '出处', 'source'],
  tags:       ['标签', '标记', 'tags', 'tag']
}
```

2. **改造 `HEADER_REVERSE_MAP` 构建（第 56-64 行）**，统一转小写做反向映射：

```typescript
const HEADER_REVERSE_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(HEADER_MAPPING)) {
    for (const alias of aliases) {
      m[alias.toLowerCase()] = field
    }
  }
  return m
})()
```

3. **改造 `buildFieldMapping`（第 71-90 行）**，用 `trimmed.toLowerCase()` 查表：

```typescript
function buildFieldMapping(headers: string[]): {
  mapping: Record<string, string>;
  titleField: string | null;
  unmatchedHeaders: string[];  // 新增：未识别的表头列表，供诊断用
} {
  const mapping: Record<string, string> = {}
  const unmatchedHeaders: string[] = []
  let titleField: string | null = null

  for (const h of headers) {
    const trimmed = String(h ?? '').trim()
    if (!trimmed) continue
    const field = HEADER_REVERSE_MAP[trimmed.toLowerCase()]
    if (field) {
      mapping[trimmed] = field  // key 保留原始表头
      if (field === 'title' && !titleField) titleField = trimmed
    } else {
      unmatchedHeaders.push(trimmed)
    }
  }
  return { mapping, titleField, unmatchedHeaders }
}
```

> 注：`mapping` 的 key 仍保留原始表头，下游 `rowToTopic` 用 `headers.indexOf(header)` 查找列索引，行为不变。

---

### Task 2：增强 title 列未识别的诊断提示

**Files:** `src/main/services/import-engine.ts:282-288`

**变更点：**

`titleField` 为 null 时，warnings 中列出实际表头：

```typescript
const { mapping, titleField, unmatchedHeaders } = buildFieldMapping(headers)

if (!titleField) {
  const allHeaders = headers.filter((h) => String(h ?? '').trim()).join(' / ') || '(空)'
  return {
    topics: [],
    mapping,
    warnings: [
      `未识别到 title 列（支持的别名：标题 / 题目 / 辩题 / 辩题标题 / 名称 / title / topic，大小写不敏感）`,
      `实际检测到的表头：${allHeaders}`,
      `请检查表头第一行是否包含上述任一别名，或修改您的表头后重试`
    ]
  }
}
```

同样的诊断也加到 docx 表格路径（`import-engine.ts:362-372`）。

---

### Task 3：多 sheet 文件提示 + 字段值匹配警告

**Files:** `src/main/services/import-engine.ts:255-302`

**变更点 A：多 sheet 提示**

`parseExcelOrCsv` 顶部增加：当 `workbook.SheetNames.length > 1` 时，往最终 warnings 里加一条信息性提示：

```typescript
const sheetNameNote = workbook.SheetNames.length > 1
  ? [`当前导入的是第 1 张工作表「${firstSheetName}」（共 ${workbook.SheetNames.length} 张：${workbook.SheetNames.join('、')}）。如需导入其他工作表，请单独保存为 xlsx 文件`]
  : []
```

返回时合并：`warnings: [...sheetNameNote, ...warnings]`

**变更点 B：字段值匹配警告（非阻断）**

新增候选值常量与检查函数（放在文件顶部常量区）：

```typescript
/** 系统候选值（与前端 FilterPanel 的 OPTIONS 保持一致） */
const SYSTEM_CANDIDATES: Record<'type' | 'domain' | 'difficulty' | 'source', string[]> = {
  type:       ['价值辩', '政策辩', '事实辩', '哲理辩'],
  domain:     ['社会热点', '科技伦理', '校园生活', '文化教育', '政治法律', '经济民生', '生态环境'],
  difficulty: ['入门级', '进阶级', '中等级', '高级级', '专家级'],
  source:     ['新国辩', '老国辩', '华语辩论世界杯', '世界华语辩论锦标赛', '华语辩坛老友赛', '自定义']
}

/**
 * 收集所有解析出的 topic 中，字段值不在 SYSTEM_CANDIDATES 内的项，
 * 生成非阻断性警告（不阻止导入，仅告知用户后续筛选可能选不到）。
 */
function collectValueMismatchWarnings(topics: TopicCreateInput[]): string[] {
  const mismatches: Record<keyof typeof SYSTEM_CANDIDATES, Set<string>> = {
    type: new Set(), domain: new Set(), difficulty: new Set(), source: new Set()
  }
  for (const t of topics) {
    for (const key of Object.keys(SYSTEM_CANDIDATES) as (keyof typeof SYSTEM_CANDIDATES)[]) {
      const v = (t as any)[key] as string | null | undefined
      if (v && !SYSTEM_CANDIDATES[key].includes(v)) {
        mismatches[key].add(v)
      }
    }
  }
  const warnings: string[] = []
  for (const key of Object.keys(mismatches) as (keyof typeof mismatches)[]) {
    if (mismatches[key].size > 0) {
      const values = Array.from(mismatches[key]).slice(0, 10).join('、')
      const more = mismatches[key].size > 10 ? ` 等 ${mismatches[key].size} 个值` : ''
      warnings.push(
        `${key === 'type' ? '类型' : key === 'domain' ? '领域' : key === 'difficulty' ? '难度' : '来源'}「${values}${more}」不在系统候选值内，已原样入库；后续在筛选面板中可能选不到这些值，建议导入后批量编辑`
      )
    }
  }
  return warnings
}
```

在 `parseExcelOrCsv` 与 `parseDocx` 末尾返回前调用：

```typescript
return {
  topics,
  mapping,
  warnings: [...sheetNameNote, ...warnings, ...collectValueMismatchWarnings(topics)]
}
```

> 注：此警告**不阻止导入**，只让用户知情。例如本例的 `1-入门` / `2-基础` 会被原样入库，但用户在筛选面板中按 `入门级` 筛选时选不到——提前告知，避免后续困惑。

---

### Task 4：补充单元测试

**Files:** `src/main/services/__tests__/import-engine.test.ts`

**新增用例（最少 5 个）：**

1. **英文小写表头识别** — 构造 `['title','type','domain','difficulty','source','tags']` xlsx，断言解析出 N 条、字段正确映射
2. **大小写混合表头识别** — `['Title','TYPE','Domain','Difficulty','Source','Tags']`，断言同上
3. **title 列未识别时 warnings 包含实际表头** — 表头 `['题目名称','类别']`，断言 warnings 包含 `题目名称`、`类别`、`title` 别名提示
4. **字段值不匹配警告** — 构造 difficulty 为 `1-入门` 的 xlsx，断言 warnings 中包含 `1-入门` 与「不在系统候选值内」字样，但 topics 仍正常返回
5. **多 sheet 文件提示** — 构造含 2 张 sheet 的 xlsx，断言 warnings 中包含「当前导入的是第 1 张工作表」字样

> 测试文件需在顶部 import `fs`、`os`、`path`、`XLSX`（若已 import 则不重复）。

---

### Task 5：ImportFormatGuide 文案更新

**Files:** `src/renderer/src/components/import/ImportFormatGuide.tsx`

**变更点：**

1. `FIELD_ROWS` 的 `aliases` 数组补充英文别名：

```typescript
const FIELD_ROWS: FieldRow[] = [
  { field: 'title',      aliases: ['标题','题目','辩题','辩题标题','名称','title','topic'], required: true,  example: '金钱是/不是万恶之源', note: '必填，缺失则该行跳过' },
  { field: 'type',       aliases: ['类型','辩题类型','type','category'],                  required: false, example: '价值辩',              note: '可选' },
  { field: 'domain',     aliases: ['领域','主题领域','分类','domain'],                     required: false, example: '社会热点',            note: '可选' },
  { field: 'difficulty', aliases: ['难度','难度等级','difficulty','level'],                required: false, example: '入门级',              note: '可选' },
  { field: 'source',     aliases: ['来源','出处','source'],                                required: false, example: '新国辩',              note: '可选' },
  { field: 'tags',       aliases: ['标签','标记','tags','tag'],                            required: false, example: '成长,伦理',           note: '可选，按 , ， 、 ; ； 分隔' }
]
```

2. 表格标题从「Excel / CSV 列名映射」改为「Excel / CSV 列名映射（中英文均可，大小写不敏感）」

3. 在「其他规则」区块加一条：**「字段值若不在系统候选值内（如难度写 `1-入门` 而非 `入门级`），会原样入库但后续筛选可能选不到，建议导入后批量编辑」**

---

### Task 6：ImportTopicsModal warnings 展示优化

**Files:** `src/renderer/src/components/ImportTopicsModal.tsx:296-310`

**变更点：**

当前 warnings 一律以黄色 Alert 展示。优化为按内容前缀分类：

- 含「未识别到」「无法解析」「为空」 → `type="error"` 红色（阻断性）
- 含「不在系统候选值内」「当前导入的是第」 → `type="info"` 蓝色（信息性）
- 其他 → `type="warning"` 黄色（一般警告）

实现：在渲染 warnings 列表前做一次分类，分别用三个 Alert 区块展示，或单个 Alert 但根据内容选 type（更简单的方案）。

**采用更简单方案**：单个 Alert，type 取「最严重级别」（error > warning > info），描述区用 `<ul>` 列出所有 warnings，每条前用小图标区分级别。这样不破坏现有布局，又能让用户一眼看出严重程度。

---

## 假设与决策

### 假设
1. `xlsx` 库在 main 进程可用（已有用法）
2. 大小写不敏感匹配不会破坏中文表头识别（中文无大小写概念）
3. 用户文件中 `domain=伦理道德` / `difficulty=1-入门` 不在系统候选值内，但后端不拒绝，原样入库（不影响导入，只影响后续筛选）
4. 多 sheet 文件第一张表通常是数据表（本例确认是 `华语辩论辩题库`），无需让用户选择 sheet（避免引入复杂 UI）

### 决策
1. **扩展英文别名而非放宽到任意字段名** — 保留映射表，避免误识别（如 `name` 可能是辩题名也可能是其他含义）
2. **大小写不敏感** — `Title` / `TITLE` / `title` 统一处理
3. **保留 mapping 的 key 为原始表头** — 下游 `rowToTopic` 用 `headers.indexOf(header)` 查找列索引，行为不变
4. **字段值警告非阻断** — 仅提示，不阻止导入。用户可能确实想用自定义值
5. **多 sheet 仅提示不切换** — 让用户知情，复杂场景让他单独保存为 xlsx。引入 sheet 选择 UI 复杂度过高，YAGNI
6. **不规范化字段值** — `1-入门` → `入门级` 不做自动转换，避免引入业务逻辑误判（用户可能就是想要 `1-入门` 这个值）
7. **诊断提示列出实际表头** — 让用户一眼看出"我写的是 X，系统要的是 Y"
8. **docx 表格路径同步增强** — `parseDocx` 中的表格解析也享受 HEADER_MAPPING 扩展和诊断提示

---

## 验证步骤

### 自动化验证
1. `npm run typecheck`
2. `npm test -- --run`
   - 验证新增 5 个用例通过
   - 验证既有测试（244+）不破坏

### 端到端验证清单
1. **核心场景**：用 `新建文件夹/华语辩论经典赛事辩题库_整合版.xlsx` 重新导入
   - 期望：解析出 724 条辩题（725 行 - 1 表头）
   - title / type / domain / difficulty / source / tags 全部正确映射
   - tags 按 `,` 分隔解析为 `['第一届','1993','小组赛']`
   - warnings 中应包含：
     - 多 sheet 提示（共 2 张：华语辩论辩题库、赛事概况）
     - 字段值不匹配提示（domain `伦理道德` `社会民生`、difficulty `1-入门` `2-基础` `3-中等`、source `国际大学群英辩论会` 等）
2. **大小写混合**：构造 `Title / TYPE / Domain` 的 Excel 导入 → 正确识别
3. **诊断提示**：构造 `题目名称 / 类别` 的 Excel 导入 → Step 1 失败页 warnings 包含「实际检测到的表头：题目名称 / 类别」
4. **格式指南**：打开「设置 → 数据管理 → 导入辩题」→ Step 0 格式说明中显示中英文别名，并标注「中英文均可，大小写不敏感」
5. **向后兼容**：用标准中文表头（标题/类型/领域...）的 Excel 导入 → 仍正常工作
6. **CSV 编码**：GBK 编码的中文表头 CSV 仍能正确识别（已有 detectEncoding 逻辑不破坏）

---

## 不在范围内（Out of Scope）

- ❌ 文件夹批量导入（用户场景已澄清，只是文件存放位置）
- ❌ Sheet 切换 UI（复杂度过高，多 sheet 仅提示）
- ❌ 字段值自动规范化（如 `1-入门` → `入门级`，避免业务逻辑误判）
- ❌ 英文 docx 解析增强（mammoth 转 HTML 后走中文表头/编号/段落逻辑，英文 docx 暂不专门处理）
- ❌ 导入预览页表格分页（YAGNI，当前预览前 100 条足够）
