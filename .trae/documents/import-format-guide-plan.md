# 题库导入页面格式提示 实施计划

> **目标：** 在导入辩题弹窗中补充完整的格式要求说明、提供 Excel 模板下载、并在解析失败/警告时给出针对性诊断建议。

**架构：** 新增独立可复用的「格式说明面板」组件与「模板下载」工具函数；改造 `ImportTopicsModal` 在所有步骤显示格式说明（折叠面板形式），并在解析失败/警告 Alert 中追加诊断建议。

**技术栈：** React 18 + TypeScript + Ant Design 5 + xlsx 0.18.5（前端直接生成 .xlsx Blob）

---

## 现状分析

### 当前实现（`src/renderer/src/components/ImportTopicsModal.tsx`）
- 4 步流程：选择文件 → 解析预览 → 确认导入 → 完成
- Step 0 仅一行文字 `支持 .xlsx / .csv / .docx 格式`
- Step 1 解析失败仅显示"请检查文件格式后重试"，无具体诊断
- Step 2 解析警告直接显示后端 warnings 数组原文，无可读化处理
- 无模板下载入口

### 后端解析规则（`src/main/services/import-engine.ts`）
- **表头映射**（HEADER_MAPPING，含中文别名）：
  - `title`：标题 / 题目 / 辩题 / 辩题标题 / 名称（必填，缺失则全部跳过）
  - `type`：类型 / 辩题类型
  - `domain`：领域 / 主题领域 / 分类
  - `difficulty`：难度 / 难度等级
  - `source`：来源 / 出处
  - `tags`：标签 / 标记（按 `,，、;；` 分隔）
- **xlsx/csv**：第一张工作表，第一行为表头
- **docx**：自动检测三种结构（表格 / 编号列表 `1. / 1、 / 1) / 一、 / 壹、` / 纯文本段落每行一道）
- **编码**：CSV 自动识别 UTF-8 / UTF-16 / GBK
- **source_type**：导入时自动标记为 `自定义`

### 已有依赖
- `xlsx@0.18.5`（已在 dependencies，renderer 可用）
- `antd` Collapse / Alert / Button / Table 组件可用

---

## 提议变更

### 文件结构
| 文件 | 类型 | 职责 |
|------|------|------|
| `src/renderer/src/components/import/ImportFormatGuide.tsx` | 新建 | 可折叠的格式说明面板组件，列出文件类型/列名映射/docx 三种结构/标签分隔符/编码说明 |
| `src/renderer/src/utils/downloadImportTemplate.ts` | 新建 | 生成 .xlsx 模板 Blob 并触发浏览器下载（含表头 + 2 行示例） |
| `src/renderer/src/utils/__tests__/downloadImportTemplate.test.ts` | 新建 | 测试模板生成函数（aoa 数据结构、字段顺序） |
| `src/renderer/src/components/ImportTopicsModal.tsx` | 修改 | 全步骤插入 `<ImportFormatGuide />`（Step 0 默认展开，1/2/3 折叠）；Step 1 解析失败 Alert 增加诊断建议；Step 2 警告 Alert 增加诊断建议；Step 0 增加"下载模板"按钮 |

---

## 任务分解

### Task 1：创建 `ImportFormatGuide` 组件

**Files:**
- Create: `src/renderer/src/components/import/ImportFormatGuide.tsx`

**职责：** 可折叠的格式说明面板，受控 `defaultCollapsed` 属性。内容包含：
1. 支持文件类型：`.xlsx` / `.csv` / `.docx`
2. Excel/CSV 列名表（6 列：字段 / 中文别名 / 是否必填 / 示例值 / 说明）
3. docx 三种结构说明（表格 / 编号列表 / 纯文本段落）
4. 标签分隔符：`, ， 、 ; ；`
5. CSV 编码：自动识别 UTF-8 / UTF-16 / GBK
6. source_type 自动标记为「自定义」

**关键代码骨架：**

```tsx
import { Collapse, Table, Typography, Tag, Space, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { spacing } from '../../styles/tokens';

const { Text, Paragraph } = Typography;

interface FieldRow {
  field: string;
  aliases: string[];
  required: boolean;
  example: string;
  note: string;
}

const FIELD_ROWS: FieldRow[] = [
  { field: 'title', aliases: ['标题', '题目', '辩题', '辩题标题', '名称'], required: true, example: '金钱是/不是万恶之源', note: '必填，缺失则该行跳过' },
  { field: 'type', aliases: ['类型', '辩题类型'], required: false, example: '价值辩', note: '可选' },
  { field: 'domain', aliases: ['领域', '主题领域', '分类'], required: false, example: '社会热点', note: '可选' },
  { field: 'difficulty', aliases: ['难度', '难度等级'], required: false, example: '入门级', note: '可选' },
  { field: 'source', aliases: ['来源', '出处'], required: false, example: '新国辩', note: '可选' },
  { field: 'tags', aliases: ['标签', '标记'], required: false, example: '成长,伦理', note: '可选，按 , ， 、 ; ； 分隔' }
];

export interface ImportFormatGuideProps {
  /** 默认是否折叠 */
  defaultCollapsed?: boolean;
}

export default function ImportFormatGuide({ defaultCollapsed = false }: ImportFormatGuideProps) {
  const columns: ColumnsType<FieldRow> = [
    { title: '字段', dataIndex: 'field', key: 'field', width: 100, render: (v) => <code>{v}</code> },
    { title: '中文表头别名', dataIndex: 'aliases', key: 'aliases', render: (v: string[]) => (
      <Space size={4} wrap>{v.map((a) => <Tag key={a}>{a}</Tag>)}</Space>
    ) },
    { title: '必填', dataIndex: 'required', key: 'required', width: 60, render: (v) => v ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
    { title: '示例', dataIndex: 'example', key: 'example', render: (v) => <Text type="secondary">{v}</Text> },
    { title: '说明', dataIndex: 'note', key: 'note', render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> }
  ];

  return (
    <Collapse
      defaultActiveKey={defaultCollapsed ? [] : ['guide']}
      size="small"
      items={[{
        key: 'guide',
        label: <Text strong>格式要求（点击展开/折叠）</Text>,
        children: (
          <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              banner
              message="支持文件类型：.xlsx / .csv / .docx"
            />
            <div>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>Excel / CSV 列名映射</Text>
              <Table
                columns={columns}
                dataSource={FIELD_ROWS}
                rowKey="field"
                size="small"
                pagination={false}
                scroll={{ x: 500 }}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Word（.docx）三种结构自动识别</Text>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                <li><Text strong>表格</Text>：第一行为表头，规则同 Excel</li>
                <li><Text strong>编号列表</Text>：支持 <code>1.</code> / <code>1、</code> / <code>1)</code> / <code>一、</code> / <code>壹、</code>，每项作为一条 title</li>
                <li><Text strong>纯文本</Text>：每个非空行作为一条 title</li>
              </ul>
            </div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              <Text strong>其他规则：</Text>
              标签按 <code>, ， 、 ; ；</code> 任一分隔符拆分；CSV 自动识别 UTF-8 / UTF-16 / GBK 编码；
              导入辩题的「来源类型」自动标记为「自定义」。
            </Paragraph>
          </Space>
        )
      }]}
    />
  );
}
```

---

### Task 2：创建 `downloadImportTemplate` 工具函数 + 测试

**Files:**
- Create: `src/renderer/src/utils/downloadImportTemplate.ts`
- Create: `src/renderer/src/utils/__tests__/downloadImportTemplate.test.ts`

**职责：** 生成包含表头行 + 2 行示例的 .xlsx 文件并触发浏览器下载。

**核心实现：**

```typescript
import * as XLSX from 'xlsx';

/** 模板的表头行（中文别名 + 字段名备注） */
export const TEMPLATE_HEADERS = ['标题', '类型', '领域', '难度', '来源', '标签'];

/** 2 行示例数据 */
export const TEMPLATE_SAMPLE_ROWS: string[][] = [
  ['金钱是/不是万恶之源', '价值辩', '社会热点', '入门级', '新国辩', '伦理,成长'],
  ['社交媒体对青少年利大于弊/弊大于利', '政策辩', '科技伦理', '进阶级', '华语辩论世界杯', '青少年;科技']
];

/**
 * 生成 .xlsx 模板文件的 ArrayBuffer
 */
export function buildTemplateWorkbook(): ArrayBuffer {
  const aoa: string[][] = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 设置列宽
  ws['!cols'] = [
    { wch: 40 }, // 标题
    { wch: 12 }, // 类型
    { wch: 14 }, // 领域
    { wch: 10 }, // 难度
    { wch: 20 }, // 来源
    { wch: 18 }  // 标签
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '辩题模板');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * 触发浏览器下载 .xlsx 模板文件
 */
export function downloadImportTemplate(filename = '辩题导入模板.xlsx'): void {
  const buffer = buildTemplateWorkbook();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放，避免下载未完成就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

**测试代码：**

```typescript
import { describe, it, expect } from 'vitest';
import { buildTemplateWorkbook, TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS } from '../downloadImportTemplate';
import * as XLSX from 'xlsx';

describe('downloadImportTemplate', () => {
  describe('TEMPLATE_HEADERS', () => {
    it('包含 6 个字段，顺序与 HEADER_MAPPING 一致', () => {
      expect(TEMPLATE_HEADERS).toEqual(['标题', '类型', '领域', '难度', '来源', '标签']);
    });
  });

  describe('TEMPLATE_SAMPLE_ROWS', () => {
    it('每行字段数与表头一致', () => {
      TEMPLATE_SAMPLE_ROWS.forEach((row, i) => {
        expect(row.length).toBe(TEMPLATE_HEADERS.length);
      });
    });
    it('第一行 title 非空', () => {
      expect(TEMPLATE_SAMPLE_ROWS[0][0].length).toBeGreaterThan(0);
    });
  });

  describe('buildTemplateWorkbook', () => {
    it('生成可被 XLSX 重新读取的 ArrayBuffer，含表头 + 示例行', () => {
      const buf = buildTemplateWorkbook();
      expect(buf).toBeInstanceOf(ArrayBuffer);
      expect(buf.byteLength).toBeGreaterThan(0);

      const wb = XLSX.read(buf, { type: 'array' });
      expect(wb.SheetNames).toContain('辩题模板');
      const ws = wb.Sheets['辩题模板'];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      expect(rows[0]).toEqual(TEMPLATE_HEADERS);
      expect(rows.length).toBe(1 + TEMPLATE_SAMPLE_ROWS.length);
    });
  });
});
```

---

### Task 3：改造 `ImportTopicsModal` 接入格式说明 + 模板下载 + 错误诊断

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

**变更点：**

1. **新增 import：**
   ```tsx
   import { Collapse } from 'antd'; // 已有则不重复
   import { DownloadOutlined } from '@ant-design/icons';
   import ImportFormatGuide from './import/ImportFormatGuide';
   import { downloadImportTemplate } from '../utils/downloadImportTemplate';
   ```

2. **Step 0（选择文件）改造：**
   - 在「选择文件」按钮下方插入 `<ImportFormatGuide defaultCollapsed={false} />`
   - 在 ImportFormatGuide 上方加「下载 Excel 模板」按钮
   - 移除原"支持 .xlsx / .csv / .docx 格式"那行 Text（已被 ImportFormatGuide 取代）

3. **Step 1（解析失败）改造：**
   - 在 Alert description 中根据 `parsed` 是否为 null、warnings 内容给出诊断建议：
     - 若 warnings 含 "未识别到 title 列" → "请检查表头第一行是否包含：「标题」「题目」「辩题」「辩题标题」「名称」之一"
     - 若 warnings 含 "工作表为空" → "请检查文件是否包含数据"
     - 其他 → "请检查文件格式后重试，可点击下方「查看格式要求」展开说明"
   - Alert action 区加「查看格式要求」按钮，点击展开 ImportFormatGuide
   - Step 1 中也显示 `<ImportFormatGuide defaultCollapsed />`

4. **Step 2（解析预览）改造：**
   - 在解析警告 Alert（已有 warnings 列表）下方追加友好提示：「常见问题：表头别名不在映射表内 / title 列缺失 / 标签分隔符不正确」
   - Step 2 顶部显示 `<ImportFormatGuide defaultCollapsed />`

5. **Step 3（完成）：** 不显示格式说明（避免干扰结果展示）

**关键代码片段（Step 0 改造）：**

```tsx
case 0:
  return (
    <div style={{ textAlign: 'center', padding: `${spacing.xxxl} 0` }}>
      <UploadOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: spacing.lg }} />
      <div style={{ marginBottom: spacing.sm }}>
        <Text strong>选择要导入的文件</Text>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: spacing.lg }}>
        支持 .xlsx / .csv / .docx 格式
      </Text>
      <Space direction="vertical" size={spacing.sm} style={{ marginBottom: spacing.lg }}>
        <Button
          size="middle"
          type="primary"
          icon={<UploadOutlined />}
          onClick={handlePickFile}
          style={primaryButtonStyle}
        >
          选择文件
        </Button>
        <Button
          size="small"
          type="link"
          icon={<DownloadOutlined />}
          onClick={() => downloadImportTemplate()}
        >
          下载 Excel 模板
        </Button>
      </Space>
      <ImportFormatGuide defaultCollapsed={false} />
    </div>
  );
```

**关键代码片段（Step 1 诊断建议）：**

```tsx
case 1:
  return (
    <div style={{ padding: `${spacing.xxl} 0` }}>
      <Space style={{ marginBottom: spacing.lg }}>
        {fileIcon}
        <Text strong>{fileName}</Text>
      </Space>
      {parsing ? (
        <div style={{ textAlign: 'center', padding: spacing.xxl }}>
          <Spin tip="正在解析文件..." />
        </div>
      ) : (
        <>
          <Alert
            message="解析失败"
            description={parseErrorMessage}
            type="error"
            showIcon
            action={
              <Button size="middle" onClick={() => setStep(0)}>
                重新选择
              </Button>
            }
            style={{ marginBottom: spacing.md }}
          />
          <ImportFormatGuide defaultCollapsed={false} />
        </>
      )}
    </div>
  );
```

> 注：Step 1 当前不保存 warnings（解析失败时只显示通用错误）。需要扩展：在 parseFile catch 中保留后端返回的 warnings（如果有）。但当前 `window.importAPI.parseFile` 失败时直接 throw，无法获取 warnings。

**简化方案：** Step 1 失败时，由于无法获取具体 warnings，仅展示 ImportFormatGuide 让用户对照格式自查。Step 2 的 warnings 已有，做可读化处理即可。

**关键代码片段（Step 2 警告可读化）：**

```tsx
{parsed.warnings.length > 0 && (
  <Alert
    message="解析警告"
    type="warning"
    showIcon
    style={{ marginBottom: spacing.md }}
    description={
      <div>
        <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 120, overflow: 'auto' }}>
          {parsed.warnings.slice(0, 20).map((w, i) => (
            <li key={i}>
              <Text type="secondary" style={{ fontSize: 12 }}>{w}</Text>
            </li>
          ))}
          {parsed.warnings.length > 20 && (
            <li>
              <Text type="secondary" style={{ fontSize: 12 }}>
                ... 还有 {parsed.warnings.length - 20} 条警告
              </Text>
            </li>
          )}
        </ul>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          常见原因：表头别名不在映射表内（仅识别 标题/题目/辩题/辩题标题/名称 等）、title 列缺失、标签分隔符不正确（应用 , ， 、 ; ；）
        </Text>
      </div>
    }
  />
)}
```

---

## 假设与决策

### 假设
1. `xlsx` 库在 renderer 进程可用（已确认在 dependencies）
2. 浏览器 `Blob` + `URL.createObjectURL` + `<a download>` 在 Electron renderer 可用（标准 Web API）
3. Ant Design `Collapse` 组件已可用（已在 antd 5 中）

### 决策
1. **不使用主进程 dialog.showSaveDialog**：浏览器原生下载即可，无需 IPC 往返，简化实现
2. **不修改后端 parseFile 失败时返回 warnings**：当前架构失败即 throw，改造影响面大；前端通过展示 ImportFormatGuide 让用户自查已足够
3. **格式说明在 Step 3 不显示**：完成步骤只展示导入结果，避免干扰
4. **错误诊断不引入 NLP/AI**：仅基于关键字匹配 warnings 文本，给出固定提示文案
5. **模板只生成 .xlsx**：CSV 用户可直接用 Excel 另存；docx 用户参考格式说明手工编辑

---

## 验证步骤

### 自动化验证
1. `npm test -- src/renderer/src/utils/__tests__/downloadImportTemplate.test.ts --run`
   - 验证 `buildTemplateWorkbook` 返回合法 ArrayBuffer
   - 验证生成的 .xlsx 含 6 列表头 + 2 行示例
2. `npm run typecheck`
   - 验证类型定义正确
3. `npm test -- --run`
   - 验证全部测试通过（不破坏既有 240 个测试）

### 端到端验证清单
1. 打开「设置 → 数据管理 → 导入辩题」→ 弹窗 Step 0 显示完整格式说明（默认展开）
2. 点击「下载 Excel 模板」→ 浏览器下载 `辩题导入模板.xlsx`
3. 打开模板 → 含 6 列表头（标题/类型/领域/难度/来源/标签）+ 2 行示例
4. 用模板填入数据后导入 → 解析预览正常
5. 故意删除 title 列再导入 → Step 1 失败，显示 ImportFormatGuide 供对照
6. 导入含未识别列名的文件 → Step 2 警告下方显示"常见原因"提示
7. 切换到 Step 2 → 顶部仍可见折叠的格式说明
8. Step 3 完成 → 不显示格式说明
