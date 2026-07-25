# 完善赛事/数量/队伍配置 — 默认值与批量创建

> 生成时间：2026-07-25
> 范围：5 个文件修改 + 2 个新组件
> 目标：通过合理默认值和批量操作，让用户从"创建赛事→配置轮次→添加队伍"的全流程从 10+ 步操作降到 3 步内

---

## 一、当前痛点分析

### 用户操作流程现状
1. 新建赛事：填名称、选状态、**手敲日期字符串**（YYYY-MM-DD 格式易错）、保存
2. 进入赛事详情：点击"应用难度预设"生成轮次（已有，OK）
3. 单支添加队伍：点"添加队伍"→ 输入名称 → 保存 → 再点"添加队伍" → 输入... **8 支队伍要 24 次点击**
4. 创建轮次：name 字段为空需手填、topic_count 默认 4（OK）
5. 抽取配置：topicCount 无默认值

### 痛点优先级
1. **P0**：队伍单支添加 — 8 支队伍 24 次点击
2. **P0**：赛事日期字符串输入 — 格式易错、无默认值
3. **P1**：缺少"一键创建完整赛事"向导
4. **P2**：轮次 name 无默认值、抽取 topicCount 无默认值

---

## 二、修改方案

### 方案 A：EventEditModal — DatePicker + 默认日期
**文件**：`src/renderer/src/components/EventEditModal.tsx`

**修改内容**：
1. 引入 `DatePicker` from antd 和 `dayjs`
2. 把 `start_date` / `end_date` 的 `<Input>` 替换为 `<DatePicker>`
3. 新建模式下默认值：`start_date = today`，`end_date = today + 7 天`
4. 编辑模式下，把字符串 `YYYY-MM-DD` 转为 dayjs 对象传给 DatePicker
5. 提交时用 `dayjs.format('YYYY-MM-DD')` 转回字符串保持后端兼容

**关键代码片段**：
```tsx
import { DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

// 默认值设置（新建分支）
form.setFieldsValue({
  status: 'preparing',
  start_date: dayjs(),
  end_date: dayjs().add(7, 'day')
});

// Form.Item
<Form.Item name="start_date" label="开始日期">
  <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
</Form.Item>

// 提交时转换
const data = {
  name: values.name,
  status: values.status,
  start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : null,
  end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : null
};
```

**注意**：antd 5 的 DatePicker 接受 dayjs 对象作为 value，无需额外引入 antd 4 的 moment。

---

### 方案 B：RoundEditModal — name 默认值
**文件**：`src/renderer/src/components/RoundEditModal.tsx`

**修改内容**：
新建模式下，根据 `nextRoundNumber` 自动填默认 name：
```tsx
form.setFieldsValue({
  round_number: nextRoundNumber ?? 1,
  topic_count: 4,
  name: `第 ${nextRoundNumber ?? 1} 轮`,
  difficulty_override: '入门级'  // 默认入门级，用户可改
});
```

---

### 方案 C：TeamEditModal — "继续添加下一支"按钮
**文件**：`src/renderer/src/components/TeamEditModal.tsx`

**修改内容**：
1. 新增 `onContinue?: (data: TeamCreateInput) => Promise<void>` 可选回调
2. 当 `onContinue` 提供且为新建模式时，Modal 底部加"保存并继续"按钮
3. 点击后：调用 onContinue 创建队伍 → 清空 name 输入框 → 自动聚焦回 name 输入框
4. 用 `Form.Item` 的 `ref` 或 `autoFocus` 实现自动聚焦

**关键代码片段**：
```tsx
export interface TeamEditModalProps {
  // ... 原有
  onContinue?: (data: TeamCreateInput) => Promise<void>;
}

// Modal footer 自定义
footer={
  isEdit ? undefined : (
    <Space>
      <Button onClick={onCancel}>取消</Button>
      <Button onClick={handleContinue} disabled={!onContinue}>保存并继续</Button>
      <Button type="primary" style={primaryButtonStyle} onClick={handleOk}>保存</Button>
    </Space>
  )
}

const handleContinue = async () => {
  const values = await form.validateFields();
  const data: TeamCreateInput = {
    name: values.name,
    event_id: values.event_id ?? eventId ?? ''
  };
  await onContinue?.(data);
  form.setFieldValue('name', '');
  // 自动聚焦
  setTimeout(() => nameInputRef.current?.focus(), 0);
};
```

---

### 方案 D：新建赛事向导组件（核心）
**新文件**：`src/renderer/src/components/EventWizardModal.tsx`

**功能**：一步完成"创建赛事 + 生成轮次 + 生成队伍"

**UI 结构**（单个 Modal 内分 3 个区块）：
```
┌─────────────────────────────────────┐
│ 新建赛事向导                          │
├─────────────────────────────────────┤
│ 📌 赛事信息                          │
│  赛事名称: [_________________]       │
│  开始日期: [📅 2026-07-25] 结束: [📅] │
│  状态: [筹备中 ▾]                    │
├─────────────────────────────────────┤
│ 🔄 轮次预设                          │
│  ○ 不创建轮次                        │
│  ● 标准赛制（分组赛→复赛→决赛）       │
│  ○ 紧凑赛制（初赛→决赛）             │
│  ○ 长赛制（小组赛→淘汰赛→半决赛→决赛）│
│  本轮题量: [4]                       │
├─────────────────────────────────────┤
│ 👥 队伍配置                          │
│  ○ 不创建队伍                        │
│  ● 自动生成 N 支占位队伍: [8]        │
│  ○ 自定义队伍名（每行一支）：        │
│    [北京大学辩论队          ]        │
│    [清华大学辩论队          ]        │
│    [                       ]        │
├─────────────────────────────────────┤
│              [取消]  [创建]          │
└─────────────────────────────────────┘
```

**Props**：
```tsx
export interface EventWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (eventId: string) => void;
}
```

**实现逻辑**：
1. 用户填完所有字段点"创建"
2. 调用 `window.eventAPI.createEvent(...)` 创建赛事
3. 如果选了轮次预设：循环调用 `window.eventAPI.createRound(...)` 创建每个轮次
4. 如果选"自动生成 N 支"：循环调用 `window.eventAPI.createTeam({ event_id, name: \`队伍 ${i+1}\` })` 创建 N 支占位队伍
5. 如果选"自定义队伍名"：按行分割文本，循环调用 createTeam
6. 全部成功后 `onSuccess(eventId)`，有任一失败显示错误但保留已创建的数据

**复用现有资源**：
- 轮次预设方案：直接复用 `EventManage.tsx` 中的 `DIFFICULTY_PRESETS` 常量（需提取到独立文件或 export）
- 日期默认值：复用方案 A 的 dayjs 逻辑

**EventManage 改动**：
- 顶部"新建赛事"按钮改为"新建赛事向导"，打开 `EventWizardModal`
- 保留原"编辑赛事"入口用 `EventEditModal`（编辑不走向导）

---

### 方案 E：TeamManage — 批量文本导入
**文件**：`src/renderer/src/pages/TeamManage.tsx`

**修改内容**：
1. 顶部工具栏加"批量导入"按钮
2. 点击后弹出 `Modal.confirm` 或自定义 Modal，含 `Input.TextArea`
3. 用户每行输入一支队伍名，可选下拉选择所属赛事
4. 点"导入"后循环调用 `window.eventAPI.createTeam(...)` 创建
5. 显示成功/失败计数

**关键代码片段**：
```tsx
const [batchModalOpen, setBatchModalOpen] = useState(false);
const [batchText, setBatchText] = useState('');
const [batchEventId, setBatchEventId] = useState<string | undefined>();

const handleBatchImport = async () => {
  const lines = batchText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0 || !batchEventId) return;
  let success = 0, fail = 0;
  for (const name of lines) {
    try {
      const res = await window.eventAPI.createTeam({ name, event_id: batchEventId });
      if (res.success) success++; else fail++;
    } catch { fail++; }
  }
  messageApi.success(`导入完成：成功 ${success} 支，失败 ${fail} 支`);
  setBatchModalOpen(false);
  setBatchText('');
  await loadAll();
};
```

---

### 方案 F：DrawConfigPanel — topicCount 默认值
**文件**：`src/renderer/src/components/draw/DrawConfigPanel.tsx`（只读确认，可能改 DrawPage）

**修改内容**：
在 `DrawPage.tsx` 的 `useState<DrawConfigState>` 初始化处，把 `topicCount` 默认值从 0 改为 4：
```tsx
const [state, setState] = useState<DrawConfigState>({
  eventId: null,
  roundId: null,
  topicCount: 4,  // 原 0 改 4
  includeStance: false,
  teamPairs: [],
  filter: {},
  includeKeywords: [],
  excludeKeywords: [],
  sourceMixEnabled: false,
  officialRatio: 50
});
```

---

## 三、文件修改清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `src/renderer/src/components/EventEditModal.tsx` | 修改 | DatePicker + 默认日期 |
| `src/renderer/src/components/RoundEditModal.tsx` | 修改 | name 默认值"第 N 轮" + 难度默认"入门级" |
| `src/renderer/src/components/TeamEditModal.tsx` | 修改 | 加"保存并继续"按钮 |
| `src/renderer/src/components/EventWizardModal.tsx` | **新建** | 向导式批量创建组件 |
| `src/renderer/src/pages/EventManage.tsx` | 修改 | 顶部按钮改打开向导 + export DIFFICULTY_PRESETS |
| `src/renderer/src/pages/TeamManage.tsx` | 修改 | 加"批量导入"按钮 + Modal |
| `src/renderer/src/pages/DrawPage.tsx` | 修改 | topicCount 默认值 0→4 |

---

## 四、实施顺序（按优先级）

### Phase 1：快速胜利（最小改动最大收益）
1. **方案 F**：DrawPage topicCount 默认值改 4（1 行改动）
2. **方案 B**：RoundEditModal name 默认值（3 行改动）
3. **方案 A**：EventEditModal DatePicker + 默认日期

### Phase 2：队伍批量操作
4. **方案 C**：TeamEditModal "保存并继续"按钮
5. **方案 E**：TeamManage 批量文本导入

### Phase 3：完整向导
6. **方案 D**：EventWizardModal 新建赛事向导 + EventManage 接入

---

## 五、验证步骤

### 步骤 1：typecheck + test
```bash
npm run typecheck
npm test -- --run
```
预期：通过

### 步骤 2：dev 启动功能验证

#### 赛事创建（向导）
- [ ] EventManage 顶部点"新建赛事"打开向导 Modal
- [ ] 填名称"测试赛事"，选"标准赛制"，队伍数填 8
- [ ] 点"创建"，3 秒内完成：1 个赛事 + 3 个轮次 + 8 支占位队伍
- [ ] 详情页显示 3 轮次 + 8 队伍

#### 赛事编辑（DatePicker）
- [ ] 编辑赛事时 DatePicker 显示原日期
- [ ] 修改日期后保存，列表显示正确

#### 轮次创建（默认值）
- [ ] 新建轮次时 name 自动填"第 N 轮"
- [ ] 难度默认"入门级"
- [ ] topic_count 默认 4

#### 队伍配置（保存并继续）
- [ ] TeamEditModal 新建模式显示"保存并继续"按钮
- [ ] 输入"队伍 A"→ 点"保存并继续"→ 输入框清空并自动聚焦
- [ ] 连续添加 3 支队伍只需 3 次回车

#### 队伍批量导入
- [ ] TeamManage 顶部"批量导入"按钮工作
- [ ] TextArea 粘贴 5 行队伍名，选择赛事，点导入
- [ ] 5 支队伍全部创建成功

#### 抽取配置
- [ ] DrawPage 打开后 topicCount 默认显示 4
- [ ] 选择赛事轮次后可直接点"开始抽取"

---

## 六、假设与决策

### 假设
1. `dayjs` 可用（已确认 antd 5 依赖）
2. 前端循环调用 `createTeam` 8 次性能可接受（IPC 单次 < 50ms，8 次 < 400ms）
3. 后端 `createTeam` 接口无需改动（已支持单条创建）

### 决策
1. **不新增批量 IPC 通道**：前端循环即可，避免增加 IPC 复杂度
2. **向导 Modal 独立组件**：不复用 EventEditModal，因为字段差异大
3. **保留原 EventEditModal**：编辑场景仍用原 Modal，向导只用于新建
4. **队伍占位名"队伍 1、队伍 2..."**：用户后续可在 TeamManage 批量改名
5. **轮次预设复用 DIFFICULTY_PRESETS**：从 EventManage 提取并 export

### 风险
1. **向导中途失败**：已创建的数据保留，错误信息明确告知"X 已创建，Y 失败"
2. **DatePicker 时区问题**：用 `dayjs().format('YYYY-MM-DD')` 避免 timezone 偏移
3. **dayjs 类型导入**：`import dayjs, { Dayjs } from 'dayjs'` 需确保 tsconfig 支持

---

## 七、实施清单

### Phase 1（3 个文件，~30 行改动）
- [ ] 修改 `DrawPage.tsx`：topicCount 默认值 0→4
- [ ] 修改 `RoundEditModal.tsx`：name 默认"第 N 轮"、difficulty_override 默认"入门级"
- [ ] 修改 `EventEditModal.tsx`：Input → DatePicker + 默认今天/一周后
- [ ] 运行 `npm run typecheck` 验证

### Phase 2（2 个文件，~80 行改动）
- [ ] 修改 `TeamEditModal.tsx`：加 onContinue prop + "保存并继续"按钮 + 自动聚焦
- [ ] 修改 `TeamManage.tsx`：加"批量导入"按钮 + TextArea Modal + 循环创建
- [ ] 运行 `npm run typecheck` 验证

### Phase 3（2 个文件，~250 行新增）
- [ ] 创建 `EventWizardModal.tsx`：3 区块表单 + 循环创建逻辑
- [ ] 修改 `EventManage.tsx`：export DIFFICULTY_PRESETS + 顶部按钮接向导
- [ ] 运行 `npm run typecheck` + `npm test` 验证
- [ ] 运行 `npm run dev` 启动应用做端到端验证
