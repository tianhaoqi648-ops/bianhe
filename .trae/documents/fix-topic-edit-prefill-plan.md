# 修复编辑辩题弹窗预填值失效 实施计划

> **目标：** 修复「编辑某辩题」时弹窗字段全空的 bug，让编辑模式正确预填原值、新增模式正确预填默认值。

**架构：** 用 `Form` 的 `key` + `initialValues` 替代 `useEffect` + `setFieldsValue`，让 Form 在每次打开 Modal 时通过 `key` 变化强制重新挂载，并从 `initialValues` 一次性初始化所有字段值，绕开 `destroyOnClose` 导致的时机问题。

**技术栈：** React 18 + TypeScript + Ant Design 5.29

---

## 现状分析

### Bug 复现路径
1. 打开「题库」→ 点击某辩题的"编辑"按钮
2. 弹窗打开后所有字段为空（期望：预填该辩题原值）

### 根因分析

当前 `src/renderer/src/components/TopicEditModal.tsx` 实现存在时机问题：

```tsx
// 第 86 行：Modal 销毁子组件
<Modal ... destroyOnClose ...>

// 第 98 行：Form 不保留字段值
<Form form={form} layout="vertical" preserve={false}>

// 第 48-68 行：useEffect 在 open 变化时 setFieldsValue
useEffect(() => {
  if (open) {
    if (topic) {
      form.setFieldsValue({...topic});  // ← 此处 Form 还未挂载，调用失效
    } else {
      form.resetFields();
      form.setFieldsValue(DEFAULT_NEW_TOPIC_VALUES);
    }
  }
}, [open, topic, form]);
```

**问题流程：**
1. Modal 关闭时 `destroyOnClose` 销毁 Form 组件，form 实例内部 store 被清空
2. 重新打开 Modal 时，`open` 从 false → true，外层 TopicEditModal 重新渲染
3. React 调度顺序：useEffect 在 TopicEditModal 渲染完成后立即执行，但此时 Modal 的 children（Form）才开始挂载，还未完成
4. `form.setFieldsValue(...)` 在 Form 未挂载时调用，值无法注入到字段
5. Form 挂载完成后，字段值为空（因为 `preserve={false}` + form store 被清空）

### 同样影响新增模式
新增模式下 `setFieldsValue(DEFAULT_NEW_TOPIC_VALUES)` 也存在同样时机问题，但因 `form.resetFields()` 在前，可能部分场景下能生效（不确定性）。用户反馈聚焦在编辑模式，但应一并修复。

### 解决方案对比

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **A. key + initialValues（推荐）** | Form 加 `key={topic?.id ?? 'new'}` 强制重新挂载 + 用 `initialValues` 一次性初始化 | 不依赖 useEffect 时机；声明式；antd 官方推荐做法 | 需移除 useEffect 中的 setFieldsValue |
| B. setTimeout 延迟 | useEffect 中 `setTimeout(() => form.setFieldsValue(...), 0)` | 改动小 | hack 方案；时序依赖，不可靠 |
| C. 移除 destroyOnClose | 让 Form 不被销毁，useEffect 时机正确 | 改动最小 | Form 状态在关闭后残留，需手动 reset；不优雅 |

**选择方案 A：** 最干净、最可靠，符合 antd 设计意图。

---

## 提议变更

### 文件结构
| 文件 | 类型 | 职责 |
|------|------|------|
| `src/renderer/src/components/TopicEditModal.tsx` | 修改 | ① 给 Form 加 `key` 强制重新挂载；② 用 `initialValues` 替代 useEffect 中的 setFieldsValue；③ 移除冗余的 useEffect（仅保留必要时的 reset 逻辑，或完全移除） |

**不新建文件，不引入新依赖。**

---

## 任务分解

### Task 1：用 key + initialValues 替代 useEffect + setFieldsValue

**Files:**
- Modify: `src/renderer/src/components/TopicEditModal.tsx`

**变更点：**

1. **新增 helper 函数**（在 `DEFAULT_NEW_TOPIC_VALUES` 之后）：

```typescript
/**
 * 根据模式计算 Form 的 initialValues
 * - 编辑模式：预填 topic 原值
 * - 新增模式：预填 DEFAULT_NEW_TOPIC_VALUES
 */
function computeInitialValues(topic?: Topic | null) {
  if (topic) {
    return {
      title: topic.title,
      type: topic.type ?? undefined,
      domain: topic.domain ?? undefined,
      difficulty: topic.difficulty ?? undefined,
      source: topic.source ?? undefined,
      source_type: topic.source_type ?? undefined,
      tags: topic.tags ?? [],
      weight: topic.weight,
      status: topic.status
    };
  }
  return { ...DEFAULT_NEW_TOPIC_VALUES };
}
```

2. **移除 useEffect**（删除第 48-68 行）：

```typescript
// 删除整段 useEffect（不再需要手动 setFieldsValue）
```

3. **同时移除 useEffect 的 import**（第 2 行）：

```typescript
// 修改前
import { useEffect } from 'react';

// 修改后（删除该行）
```

4. **改造 Form 标签**（第 98 行）：

```tsx
<Form
  key={topic?.id ?? 'new-topic'}
  form={form}
  layout="vertical"
  initialValues={computeInitialValues(topic)}
>
```

**关键点：**
- `key` 变化（topic 切换或新增/编辑切换）会强制 Form 卸载并重新挂载
- Form 重新挂载时自动从 `initialValues` 初始化字段值，时机正确
- `destroyOnClose` 仍保留（关闭 Modal 时销毁 Form，下次打开时 Form 重新挂载，key 变化触发 initialValues）
- `preserve={false}` 可保留可移除（影响不大，保留更安全）

**完整改动后的 TopicEditModal 关键代码：**

```tsx
import { Modal, Form, Input, Select, InputNumber, Tag, Space, message } from 'antd';
import type { Topic, TopicCreateInput, TopicUpdateInput } from '../../../shared/types';
import {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from './FilterPanel';
import { spacing } from '../styles/tokens';
import { primaryButtonStyle } from '../styles/shared';

const DEFAULT_NEW_TOPIC_VALUES = {
  title: '',
  type: '价值辩',
  domain: '社会热点',
  difficulty: '入门级',
  source: '新国辩',
  source_type: '自定义',
  tags: [] as string[],
  weight: 1.0,
  status: 'active'
} as const;

function computeInitialValues(topic?: Topic | null) {
  if (topic) {
    return {
      title: topic.title,
      type: topic.type ?? undefined,
      domain: topic.domain ?? undefined,
      difficulty: topic.difficulty ?? undefined,
      source: topic.source ?? undefined,
      source_type: topic.source_type ?? undefined,
      tags: topic.tags ?? [],
      weight: topic.weight,
      status: topic.status
    };
  }
  return { ...DEFAULT_NEW_TOPIC_VALUES };
}

export interface TopicEditModalProps {
  open: boolean;
  topic?: Topic | null;
  onOk: (data: TopicCreateInput | TopicUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function TopicEditModal({
  open,
  topic,
  onOk,
  onCancel
}: TopicEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!topic;
  const [messageApi, contextHolder] = message.useMessage();

  // 不再需要 useEffect 设置字段值
  // Form 通过 key={topic?.id ?? 'new-topic'} 强制重新挂载
  // 配合 initialValues={computeInitialValues(topic)} 一次性初始化

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onOk(values as TopicCreateInput, isEdit);
    } catch (e: any) {
      if (e?.errorFields) {
        messageApi.error('请完善必填字段');
      } else {
        messageApi.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={isEdit ? '编辑辩题' : '新增辩题'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ size: 'middle', style: primaryButtonStyle }}
        cancelButtonProps={{ size: 'middle' }}
        width={560}
        destroyOnClose
      >
        <Form
          key={topic?.id ?? 'new-topic'}
          form={form}
          layout="vertical"
          initialValues={computeInitialValues(topic)}
        >
          {/* ...其余 Form.Item 不变... */}
        </Form>
      </Modal>
    </>
  );
}
```

---

## 假设与决策

### 假设
1. antd 5.29 的 Form 在 `key` 变化时会卸载并重新挂载，从 `initialValues` 初始化字段值（标准行为）
2. `destroyOnClose` 关闭 Modal 时销毁 Form，下次打开时 Form 重新挂载，`key` 变化确保不同 topic 之间也能重新初始化
3. 用户期望编辑模式预填原值、新增模式预填默认值（已在上轮澄清）

### 决策
1. **选方案 A（key + initialValues）**：最干净、最可靠，符合 antd 设计意图
2. **保留 `destroyOnClose`**：关闭时清理 Form 状态，下次打开是干净的初始状态
3. **移除 `preserve={false}`**：用 initialValues 后不再需要；保留也不会出错，但移除更简洁
4. **移除 useEffect**：不再需要手动 setFieldsValue，避免时机问题
5. **`computeInitialValues` 函数化**：纯函数，可测试，逻辑清晰

---

## 验证步骤

### 自动化验证
1. `npm run typecheck`
   - 验证 `computeInitialValues` 返回类型兼容 Form 的 `initialValues`
   - 验证移除 useEffect 后无未使用 import 警告
2. `npm test -- --run`
   - 验证全部测试通过（不破坏既有 244 个测试）

### 端到端验证清单
1. 打开「题库」→ 点击某辩题"编辑" → 弹窗中所有字段预填该辩题原值（title/type/domain/difficulty/source/source_type/tags/weight/status 全部正确）
2. 修改任意字段后保存 → 保存修改后的值
3. 关闭弹窗后再次打开同一条辩题编辑 → 仍正确预填原值
4. 关闭弹窗后点击"新增辩题" → 弹窗预填 DEFAULT_NEW_TOPIC_VALUES（type='价值辩' 等）
5. 关闭新增弹窗后再次点击编辑某辩题 → 正确预填原值（不会串到新增的默认值）
6. 连续编辑两条不同辩题 → 每次都正确预填当前辩题的原值（key 变化触发重新挂载）
7. 直接点「保存」不填标题 → 提示"请输入辩题标题"（必填校验仍生效）
