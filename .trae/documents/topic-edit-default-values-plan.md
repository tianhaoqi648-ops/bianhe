# 辩题编辑弹窗默认值预填 实施计划

> **目标：** 在新增辩题时为所有字段预填合理默认值，减少用户输入成本；编辑模式保持现状（预填原值）。

**架构：** 在 `TopicEditModal.tsx` 新增分支中扩展 `form.setFieldsValue`，把所有 7 个字段（title/type/domain/difficulty/source/source_type/weight/status）都设置为合理默认值；tags 保持空数组。同时抽取默认值常量便于后续维护。

**技术栈：** React 18 + TypeScript + Ant Design 5 Form

---

## 现状分析

### 当前实现（`src/renderer/src/components/TopicEditModal.tsx:46-53`）
新增模式下仅预填 3 个字段：
```typescript
form.resetFields();
form.setFieldsValue({
  weight: 1.0,
  source_type: '自定义',
  status: 'active'
});
```

未预填的字段：`title`、`type`、`domain`、`difficulty`、`source`、`tags`，用户每次新增都需要手动从下拉框选择，重复劳动。

### 编辑模式（`src/renderer/src/components/TopicEditModal.tsx:34-45`）
已正确预填所有字段（`topic.xxx ?? undefined`），无需改动。

### 候选值来源（`src/renderer/src/components/FilterPanel.tsx:10-23`）
- `TYPE_OPTIONS = ['价值辩', '政策辩', '事实辩', '哲理辩', '娱乐辩']` → 第一项「价值辩」作默认
- `DOMAIN_OPTIONS = ['社会热点', '科技伦理', ...]` → 第一项「社会热点」作默认
- `DIFFICULTY_OPTIONS = ['入门级', '进阶级', '专业级']` → 第一项「入门级」作默认
- `SOURCE_OPTIONS = ['新国辩', '华语辩论世界杯', '老友赛', '世锦赛', '年度原创']` → 第一项「新国辩」作默认
- `SOURCE_TYPE_OPTIONS = ['官方', '自定义']` → 维持现状「自定义」

### 调用方
- 仅 `src/renderer/src/pages/TopicLibrary.tsx:695` 一处调用，无需改动调用方

---

## 提议变更

### 文件结构
| 文件 | 类型 | 职责 |
|------|------|------|
| `src/renderer/src/components/TopicEditModal.tsx` | 修改 | ① 抽取 `DEFAULT_NEW_TOPIC_VALUES` 常量；② 扩展新增模式 `setFieldsValue` 预填所有字段；③ title 字段 placeholder 文案微调以体现"必填" |

**不新建文件，不引入 settings 配置（YAGNI）。** 用户偏好"简化用户配置 with default settings to reduce user effort"，硬编码默认值即可。

---

## 任务分解

### Task 1：抽取默认值常量并扩展新增模式预填

**Files:**
- Modify: `src/renderer/src/components/TopicEditModal.tsx`

**变更点：**

1. **新增常量**（在 `TopicEditModalProps` 接口之前）：

```typescript
/**
 * 新增辩题时的默认值（用户偏好：减少手动输入）
 * 编辑模式不受影响，仍预填原值
 */
const DEFAULT_NEW_TOPIC_VALUES = {
  title: '',                  // 标题必填，预填空让 Ant Design 必填校验生效
  type: '价值辩',             // TYPE_OPTIONS 第一项，最常用
  domain: '社会热点',         // DOMAIN_OPTIONS 第一项
  difficulty: '入门级',       // DIFFICULTY_OPTIONS 第一项，新手友好
  source: '新国辩',           // SOURCE_OPTIONS 第一项
  source_type: '自定义',      // 用户手动新增默认为自定义
  tags: [] as string[],
  weight: 1.0,
  status: 'active'
} as const;
```

2. **改写 `useEffect` 新增分支**（第 46-53 行）：

```typescript
} else {
  form.resetFields();
  form.setFieldsValue(DEFAULT_NEW_TOPIC_VALUES);
}
```

3. **保持编辑模式不变**（第 34-45 行）：仍按 `topic.xxx ?? undefined` 预填原值。

**完整改动后的 useEffect：**

```typescript
useEffect(() => {
  if (open) {
    if (topic) {
      // 编辑模式：预填原值
      form.setFieldsValue({
        title: topic.title,
        type: topic.type ?? undefined,
        domain: topic.domain ?? undefined,
        difficulty: topic.difficulty ?? undefined,
        source: topic.source ?? undefined,
        source_type: topic.source_type ?? undefined,
        tags: topic.tags ?? [],
        weight: topic.weight,
        status: topic.status
      });
    } else {
      // 新增模式：预填默认值，减少用户输入
      form.resetFields();
      form.setFieldsValue(DEFAULT_NEW_TOPIC_VALUES);
    }
  }
}, [open, topic, form]);
```

---

## 假设与决策

### 假设
1. `TYPE_OPTIONS[0]` = '价值辩' 等第一项是合理默认值（符合用户偏好"减少手动输入"）
2. 用户偏好硬编码默认值而非"用户可配置"或"记忆上次值"（基于 user_profile: "simplified user configuration with default settings"）
3. 编辑模式当前预填逻辑正确，无需改动

### 决策
1. **不引入 Settings 配置项**：YAGNI，硬编码即可。若未来需要可配置，再扩展
2. **不引入"记忆上次值"**：localStorage 持久化增加复杂度，且硬编码默认值已能覆盖大部分场景
3. **title 预填空字符串**：让 Ant Design 必填校验正常生效（预填占位文本会导致校验通过）
4. **tags 预填空数组**：标签是高度个性化的字段，无合理默认值
5. **`DEFAULT_NEW_TOPIC_VALUES` 用 `as const`**：让 TS 推断字面量类型，避免 `string` 宽泛类型
6. **保持编辑模式不变**：用户明确"编辑辩题页面那预填写肯定是辩题原本的信息啊"

---

## 验证步骤

### 自动化验证
1. `npm run typecheck`
   - 验证 `DEFAULT_NEW_TOPIC_VALUES as const` 类型推断正确
   - 验证 `form.setFieldsValue` 参数类型兼容
2. `npm test -- --run`
   - 验证全部测试通过（不破坏既有 244 个测试）

### 端到端验证清单
1. 打开「题库 → 新增辩题」→ 弹窗中所有字段已预填：
   - 类型 = 价值辩
   - 领域 = 社会热点
   - 难度 = 入门级
   - 来源 = 新国辩
   - 来源类型 = 自定义
   - 权重 = 1.0
   - 状态 = 正常
   - 标题 = 空（必填校验仍生效）
   - 标签 = 空
2. 直接点「保存」→ 提示"请输入辩题标题"（必填校验生效）
3. 输入标题后保存 → 成功，新辩题带默认值入库
4. 修改任意预填字段后保存 → 保存修改后的值（预填值只是初始值，可改）
5. 打开「题库 → 编辑某辩题」→ 弹窗预填该辩题的原值（不受默认值影响）
6. 编辑后保存 → 保存编辑后的值
