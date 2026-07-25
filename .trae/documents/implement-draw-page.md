# 抽取页面（DrawPage）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use TodoWrite 跟踪任务进度，按以下任务顺序实现。每完成一个 Task 立即标记 completed。

**Goal:** 实现应用最核心的抽取页面，包含配置面板、抽取动画、标准/大屏双展示模式，并全局升级 FilterPanel 支持多选。

**Architecture:** DrawPage 采用左右分栏（左配置/右结果）。配置面板通过 `useEventStore` 加载赛事/轮次/队伍，组装 `DrawParams` 后调用 `useDrawStore.execute()`。结果区有标准列表模式与大屏全屏覆盖模式。抽取动画用纯 CSS keyframes 实现翻牌效果。多选筛选通过扩展 `TopicFilter` 数组字段 + `buildWhereClause` 的 `IN(?,?)` 实现，FilterPanel 全局升级。

**Tech Stack:** React 18 + TypeScript + Ant Design 5 + Zustand + 纯 CSS 动画（无新依赖）

---

## 文件结构

### 新增文件
- `src/renderer/src/components/draw/DrawConfigPanel.tsx` — 左侧抽取配置面板（赛事/轮次/数量/持方/比例/筛选）
- `src/renderer/src/components/draw/TeamPairing.tsx` — 队伍对阵配对编辑器
- `src/renderer/src/components/draw/DrawResultCard.tsx` — 单条抽取结果卡片（辩题+持方+对阵）
- `src/renderer/src/components/draw/DrawResultList.tsx` — 标准模式结果列表
- `src/renderer/src/components/draw/BigScreen.tsx` — 大屏全屏覆盖组件（逐题揭晓+ESC 退出）
- `src/renderer/src/components/draw/DrawAnimation.tsx` — 抽取瞬间翻牌动画覆盖层
- `src/renderer/src/styles/draw.css` — 翻牌/淡入/缩放 keyframes

### 修改文件
- `src/shared/types.ts` — `TopicFilter` 增加 `types?/domains?/difficulties?` 数组字段（保留单值字段向后兼容）
- `src/main/db/repository/topic.repo.ts` — `buildWhereClause` 处理数组字段生成 `IN (?,?,?)`
- `src/renderer/src/components/FilterPanel.tsx` — type/domain/difficulty 改为多选，绑定数组字段
- `src/renderer/src/pages/DrawPage.tsx` — 重写，编排配置+动画+结果+大屏
- `src/renderer/src/main.tsx` — 引入 `draw.css`

---

## Task 1: 扩展 TopicFilter 支持多选

**Files:**
- Modify: `src/shared/types.ts` (TopicFilter 接口)

**说明：** 在 `TopicFilter` 中新增 3 个数组字段（`types/domains/difficulties`），保留原单值字段（`type/domain/difficulty`）向后兼容。`buildWhereClause` 同时支持两种。

- [ ] **Step 1: 修改 TopicFilter 接口**

在 `src/shared/types.ts` 的 `TopicFilter` 接口中，在现有单值字段后新增数组字段：

```typescript
export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[]
  keyword?: string
  page?: number
  pageSize?: number
  // 多选字段（与上面单值字段二选一使用，数组优先）
  types?: string[]
  domains?: string[]
  difficulties?: string[]
}
```

- [ ] **Step 2: 同步修改 `src/main/db/repository/topic.repo.ts` 的 TopicFilter**

在 `topic.repo.ts` 顶部的 `TopicFilter` 接口同步新增相同 3 个数组字段（保持两侧类型一致）：

```typescript
export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[]
  keyword?: string
  page?: number
  pageSize?: number
  // 多选字段
  types?: string[]
  domains?: string[]
  difficulties?: string[]
}
```

- [ ] **Step 3: 运行 typecheck 确认无破坏**

Run: `npm run typecheck`
Expected: 通过（仅新增可选字段，不破坏现有代码）

---

## Task 2: buildWhereClause 支持数组字段

**Files:**
- Modify: `src/main/db/repository/topic.repo.ts` (`buildWhereClause` 函数)

**说明：** 在 `buildWhereClause` 中处理 `types/domains/difficulties` 数组，生成 `column IN (?, ?, ?)`。数组优先于单值字段（若同时存在，数组生效）。

- [ ] **Step 1: 修改 buildWhereClause**

在 `src/main/db/repository/topic.repo.ts` 的 `buildWhereClause` 函数中，在现有 scalarFields 循环之后新增数组处理逻辑：

```typescript
function buildWhereClause(filter?: TopicFilter): { where: string; params: any[] } {
  if (!filter) {
    return { where: 'WHERE 1=1', params: [] }
  }

  const conditions: string[] = []
  const params: any[] = []

  // 多选数组字段优先（types/domains/difficulties）
  const arrayFields: Array<{ key: keyof TopicFilter; column: string }> = [
    { key: 'types', column: 'type' },
    { key: 'domains', column: 'domain' },
    { key: 'difficulties', column: 'difficulty' }
  ]
  for (const { key, column } of arrayFields) {
    const arr = filter[key] as string[] | undefined
    if (arr && arr.length > 0) {
      const placeholders = arr.map(() => '?').join(', ')
      conditions.push(`${column} IN (${placeholders})`)
      params.push(...arr)
    }
  }

  // 单值标量字段（仅当对应数组字段未设置时生效）
  const scalarFields: Array<{ key: keyof TopicFilter; column: string }> = [
    { key: 'type', column: 'type' },
    { key: 'domain', column: 'domain' },
    { key: 'difficulty', column: 'difficulty' },
    { key: 'source', column: 'source' },
    { key: 'source_type', column: 'source_type' },
    { key: 'status', column: 'status' }
  ]
  for (const { key, column } of scalarFields) {
    // type/domain/difficulty 单值仅在对应数组未设置时生效
    if (column === 'type' && filter.types?.length) continue
    if (column === 'domain' && filter.domains?.length) continue
    if (column === 'difficulty' && filter.difficulties?.length) continue
    const value = filter[key]
    if (value !== undefined) {
      conditions.push(`${column} = ?`)
      params.push(value)
    }
  }

  if (filter.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map(() => 'tags LIKE ?')
    conditions.push(`(${tagConditions.join(' OR ')})`)
    for (const tag of filter.tags) {
      params.push(`%"${tag}"%`)
    }
  }

  if (filter.keyword !== undefined && filter.keyword !== '') {
    conditions.push('title LIKE ?')
    params.push(`%${filter.keyword}%`)
  }

  const where = `WHERE 1=1${conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''}`
  return { where, params }
}
```

- [ ] **Step 2: 运行 typecheck + 测试**

Run: `npm run typecheck && npm test`
Expected: 通过（67 个测试无回归）

---

## Task 3: 升级 FilterPanel 为多选

**Files:**
- Modify: `src/renderer/src/components/FilterPanel.tsx`

**说明：** 把 type/domain/difficulty 三个 Select 从单选改为多选（`mode="multiple"`），绑定到 `filter.types/domains/difficulties` 数组字段。其余字段（source/source_type/status）保持单选。

- [ ] **Step 1: 修改三个多选 Select**

在 `src/renderer/src/components/FilterPanel.tsx` 中，把"类型/领域/难度"三个 Field 的 Select 改为多选：

```typescript
<Field label="类型">
  <Select
    size="small"
    allowClear
    mode="multiple"
    maxTagCount="responsive"
    placeholder="全部"
    style={{ width: '100%' }}
    value={filter.types ?? []}
    onChange={(v) => onChange({ types: v as string[] | undefined, type: undefined })}
    options={TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
  />
</Field>
<Field label="领域">
  <Select
    size="small"
    allowClear
    mode="multiple"
    maxTagCount="responsive"
    placeholder="全部"
    style={{ width: '100%' }}
    value={filter.domains ?? []}
    onChange={(v) => onChange({ domains: v as string[] | undefined, domain: undefined })}
    options={DOMAIN_OPTIONS.map((v) => ({ label: v, value: v }))}
  />
</Field>
<Field label="难度">
  <Select
    size="small"
    allowClear
    mode="multiple"
    maxTagCount="responsive"
    placeholder="全部"
    style={{ width: '100%' }}
    value={filter.difficulties ?? []}
    onChange={(v) => onChange({ difficulties: v as string[] | undefined, difficulty: undefined })}
    options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
  />
</Field>
```

- [ ] **Step 2: 更新 countActiveFilters 函数**

```typescript
function countActiveFilters(f: TopicFilter): number {
  let n = 0;
  if (f.types?.length || f.type) n++;
  if (f.domains?.length || f.domain) n++;
  if (f.difficulties?.length || f.difficulty) n++;
  if (f.source) n++;
  if (f.source_type) n++;
  if (f.status) n++;
  if (f.keyword) n++;
  if (f.tags && f.tags.length > 0) n++;
  return n;
}
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 4: 创建抽取动画 CSS

**Files:**
- Create: `src/renderer/src/styles/draw.css`
- Modify: `src/renderer/src/main.tsx`

**说明：** 纯 CSS keyframes 实现翻牌、淡入、缩放、大屏背景渐变。无 JS 依赖。

- [ ] **Step 1: 创建 draw.css**

```css
/* 抽取页面动画样式 */

/* 翻牌动画：3D 翻转 */
@keyframes flip-card {
  0% {
    transform: rotateY(180deg) scale(0.8);
    opacity: 0;
  }
  50% {
    transform: rotateY(90deg) scale(1.1);
    opacity: 0.5;
  }
  100% {
    transform: rotateY(0deg) scale(1);
    opacity: 1;
  }
}

.draw-animation-card {
  animation: flip-card 0.8s ease-out forwards;
  transform-style: preserve-3d;
  perspective: 1000px;
}

/* 淡入上浮 */
@keyframes fade-up {
  0% {
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-up {
  animation: fade-up 0.5s ease-out forwards;
}

/* 序列延迟（每张卡片错开 0.15s） */
.fade-up-delay-1 { animation-delay: 0.15s; opacity: 0; }
.fade-up-delay-2 { animation-delay: 0.30s; opacity: 0; }
.fade-up-delay-3 { animation-delay: 0.45s; opacity: 0; }
.fade-up-delay-4 { animation-delay: 0.60s; opacity: 0; }
.fade-up-delay-5 { animation-delay: 0.75s; opacity: 0; }
.fade-up-delay-6 { animation-delay: 0.90s; opacity: 0; }

/* 抽取中遮罩旋转 */
@keyframes draw-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.draw-spin {
  animation: draw-spin 1.2s linear infinite;
}

/* 大屏模式背景渐变 */
.bigscreen-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background: linear-gradient(135deg, #0c1e3e 0%, #1a3a6c 50%, #0c1e3e 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

/* 大屏辩题大字 */
.bigscreen-topic-title {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
  margin: 40px 0;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  max-width: 1200px;
}

/* 大屏队伍对阵 */
.bigscreen-versus {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 60px;
  font-size: 32px;
  font-weight: 500;
  margin: 30px 0;
}

.bigscreen-team {
  padding: 20px 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  min-width: 240px;
  text-align: center;
}

.bigscreen-stance {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
}

.bigscreen-vs {
  font-size: 40px;
  font-weight: 700;
  color: #ffd666;
}

/* 大屏逐题揭晓（未揭晓时模糊） */
.bigscreen-reveal-hidden {
  filter: blur(20px);
  opacity: 0.3;
  transition: all 0.6s ease-out;
}

.bigscreen-reveal-shown {
  filter: blur(0);
  opacity: 1;
  transition: all 0.6s ease-out;
}

/* 抽取按钮脉冲 */
@keyframes pulse-primary {
  0%, 100% { box-shadow: 0 0 0 0 rgba(22, 119, 255, 0.7); }
  50% { box-shadow: 0 0 0 12px rgba(22, 119, 255, 0); }
}

.pulse-primary {
  animation: pulse-primary 2s infinite;
}
```

- [ ] **Step 2: 在 main.tsx 引入**

在 `src/renderer/src/main.tsx` 顶部 import 区追加：

```typescript
import './styles/draw.css';
```

放在 `import './index.css';` 之后。

---

## Task 5: 创建 TeamPairing 队伍对阵组件

**Files:**
- Create: `src/renderer/src/components/draw/TeamPairing.tsx`

**说明：** 当 `include_stance=true` 时显示。用户从赛事队伍中两两配对成 A vs B。要求队伍数为偶数。UI 用列表展示配对，支持"自动随机配对"和"手动调整"。

- [ ] **Step 1: 创建组件**

```typescript
import { Button, List, Select, Space, Tag, Typography, Empty } from 'antd';
import { SwapOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { Team } from '../../../shared/types';

export interface TeamPair {
  teamA: Team | null;
  teamB: Team | null;
}

export interface TeamPairingProps {
  teams: Team[];
  pairs: TeamPair[];
  onChange: (pairs: TeamPair[]) => void;
}

export default function TeamPairing({ teams, pairs, onChange }: TeamPairingProps) {
  // 自动随机配对
  const autoPair = () => {
    if (teams.length < 2 || teams.length % 2 !== 0) return;
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const newPairs: TeamPair[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      newPairs.push({ teamA: shuffled[i], teamB: shuffled[i + 1] });
    }
    onChange(newPairs);
  };

  const updatePair = (index: number, side: 'A' | 'B', team: Team | null) => {
    const next = [...pairs];
    next[index] = { ...next[index], [side === 'A' ? 'teamA' : 'teamB']: team };
    onChange(next);
  };

  if (teams.length === 0) {
    return <Empty description="该赛事暂无队伍，请先在赛事管理中添加队伍" />;
  }

  if (teams.length % 2 !== 0) {
    return (
      <div style={{ padding: 12, color: '#ff4d4f' }}>
        队伍数量为奇数（{teams.length}），需为偶数才能配对。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>对阵配对（{pairs.length} 组）</Typography.Text>
        <Button size="small" icon={<ThunderboltOutlined />} onClick={autoPair}>
          随机配对
        </Button>
      </div>
      <List
        size="small"
        dataSource={pairs}
        renderItem={(pair, idx) => (
          <List.Item>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Select
                size="small"
                style={{ width: 140 }}
                placeholder="队伍 A"
                value={pair.teamA?.id}
                onChange={(v) => updatePair(idx, 'A', teams.find((t) => t.id === v) ?? null)}
                options={teams.map((t) => ({ label: t.name, value: t.id }))}
              />
              <Tag color="red">正/反</Tag>
              <SwapOutlined />
              <Tag color="blue">反/正</Tag>
              <Select
                size="small"
                style={{ width: 140 }}
                placeholder="队伍 B"
                value={pair.teamB?.id}
                onChange={(v) => updatePair(idx, 'B', teams.find((t) => t.id === v) ?? null)}
                options={teams.map((t) => ({ label: t.name, value: t.id }))}
              />
            </Space>
          </List.Item>
        )}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
        持方（正方/反方）在抽取时随机分配，此处仅配置对阵双方。
      </Typography.Text>
    </div>
  );
}
```

---

## Task 6: 创建 DrawConfigPanel 配置面板

**Files:**
- Create: `src/renderer/src/components/draw/DrawConfigPanel.tsx`

**说明：** 左侧配置面板。包含：赛事选择、轮次联动、辩题数量、持方开关、队伍对阵（条件显示）、筛选条件（复用 FilterPanel）、题源比例滑块、开始抽取按钮。所有状态由父组件 DrawPage 通过 props 传入。

- [ ] **Step 1: 创建组件**

```typescript
import {
  Card,
  Form,
  Select,
  InputNumber,
  Switch,
  Slider,
  Button,
  Divider,
  Typography,
  Space,
  message,
  Collapse
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import type { TopicFilter, DrawParams, Team } from '../../../shared/types';
import FilterPanel from '../FilterPanel';
import TeamPairing, { type TeamPair } from './TeamPairing';

export interface DrawConfigState {
  eventId: string | null;
  roundId: string | null;
  topicCount: number;
  includeStance: boolean;
  teamPairs: TeamPair[];
  filter: TopicFilter;
  includeKeywords: string[];
  excludeKeywords: string[];
  sourceMixEnabled: boolean;
  officialRatio: number; // 0~100
}

export interface DrawConfigPanelProps {
  state: DrawConfigState;
  onChange: (patch: Partial<DrawConfigState>) => void;
  events: Array<{ id: string; name: string }>;
  rounds: Array<{ id: string; name: string | null; difficulty_override: string | null }>;
  teams: Team[];
  tagOptions: string[];
  loading: boolean;
  onDraw: () => void;
}

export default function DrawConfigPanel({
  state,
  onChange,
  events,
  rounds,
  teams,
  tagOptions,
  loading,
  onDraw
}: DrawConfigPanelProps) {
  // 当切换赛事时，重置轮次与队伍配对
  useEffect(() => {
    if (!state.eventId) {
      onChange({ roundId: null, teamPairs: [] });
    }
  }, [state.eventId]);

  const canDraw =
    !!state.eventId &&
    state.topicCount > 0 &&
    state.topicCount <= 20 &&
    (!state.includeStance || (state.teamPairs.length > 0 && state.teamPairs.every((p) => p.teamA && p.teamB)));

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          <span>抽取配置</span>
        </Space>
      }
      size="small"
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Form layout="vertical" size="small">
        <Form.Item label="赛事" required>
          <Select
            placeholder="选择赛事"
            value={state.eventId ?? undefined}
            onChange={(v) => onChange({ eventId: v, roundId: null })}
            options={events.map((e) => ({ label: e.name, value: e.id }))}
            allowClear
          />
        </Form.Item>

        <Form.Item label="轮次">
          <Select
            placeholder="选择轮次（可选，决定难度梯度）"
            value={state.roundId ?? undefined}
            onChange={(v) => onChange({ roundId: v ?? null })}
            options={rounds.map((r) => ({
              label: r.name ?? `轮次 ${r.id.slice(0, 4)}`,
              value: r.id
            }))}
            allowClear
            disabled={!state.eventId}
          />
          {rounds.find((r) => r.id === state.roundId)?.difficulty_override && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              该轮次难度梯度：{rounds.find((r) => r.id === state.roundId)?.difficulty_override}
            </Typography.Text>
          )}
        </Form.Item>

        <Form.Item label="辩题数量" required>
          <InputNumber
            min={1}
            max={20}
            value={state.topicCount}
            onChange={(v) => onChange({ topicCount: v ?? 1 })}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="同时抽取持方（正反方）">
          <Switch
            checked={state.includeStance}
            onChange={(v) => onChange({ includeStance: v })}
          />
        </Form.Item>

        {state.includeStance && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <TeamPairing
              teams={teams}
              pairs={state.teamPairs}
              onChange={(pairs) => onChange({ teamPairs: pairs })}
            />
          </>
        )}

        <Divider style={{ margin: '12px 0' }} />

        <Form.Item label="题库混合比例（官方 : 自定义）">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Switch
              size="small"
              checked={state.sourceMixEnabled}
              onChange={(v) => onChange({ sourceMixEnabled: v })}
            />
            {state.sourceMixEnabled && (
              <>
                <Slider
                  min={0}
                  max={100}
                  step={10}
                  value={state.officialRatio}
                  onChange={(v) => onChange({ officialRatio: v })}
                  marks={{ 0: '0:10', 30: '3:7', 50: '5:5', 70: '7:3', 100: '10:0' }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  官方 {state.officialRatio}% : 自定义 {100 - state.officialRatio}%
                </Typography.Text>
              </>
            )}
          </Space>
        </Form.Item>

        <Divider style={{ margin: '12px 0' }}>筛选条件</Divider>

        <FilterPanel
          filter={state.filter}
          onChange={(f) => onChange({ filter: { ...state.filter, ...f } })}
          onReset={() => onChange({ filter: {} })}
          tagOptions={tagOptions}
          includeKeywords={state.includeKeywords}
          excludeKeywords={state.excludeKeywords}
          onIncludeKeywordsChange={(v) => onChange({ includeKeywords: v })}
          onExcludeKeywordsChange={(v) => onChange({ excludeKeywords: v })}
        />

        <Divider style={{ margin: '12px 0' }} />

        <Button
          type="primary"
          size="large"
          block
          icon={<ThunderboltOutlined />}
          onClick={onDraw}
          disabled={!canDraw || loading}
          loading={loading}
          className={canDraw && !loading ? 'pulse-primary' : ''}
        >
          开始抽取
        </Button>
        {!canDraw && (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block', textAlign: 'center' }}>
            请完善赛事/数量/队伍配置
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}
```

---

## Task 7: 创建 DrawResultCard 结果卡片

**Files:**
- Create: `src/renderer/src/components/draw/DrawResultCard.tsx`

**说明：** 单条抽取结果展示。含辩题标题、类型/难度标签、持方分配（正方队伍 vs 反方队伍）、序号。

- [ ] **Step 1: 创建组件**

```typescript
import { Card, Tag, Space, Typography, theme } from 'antd';
import type { Topic, DrawSessionItem, Team } from '../../../shared/types';

const DIFFICULTY_COLOR: Record<string, string> = {
  入门级: 'green',
  进阶级: 'orange',
  专业级: 'red'
};

export interface DrawResultCardProps {
  index: number;
  topic: Topic;
  item: DrawSessionItem;
  teams: Team[];
}

export default function DrawResultCard({ index, topic, item, teams }: DrawResultCardProps) {
  const { token } = theme.useToken();
  const teamA = teams.find((t) => t.id === item.team_a_id);
  const teamB = teams.find((t) => t.id === item.team_b_id);

  return (
    <Card
      size="small"
      style={{
        borderColor: token.colorPrimary,
        borderWidth: 1,
        background: token.colorBgContainer
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 序号 */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: token.colorPrimary,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
            flexShrink: 0
          }}
        >
          {index + 1}
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            {topic.title}
          </Typography.Title>
          <Space size={4} wrap style={{ marginBottom: item.team_a_id ? 12 : 0 }}>
            {topic.type && <Tag color="geekblue">{topic.type}</Tag>}
            {topic.difficulty && (
              <Tag color={DIFFICULTY_COLOR[topic.difficulty] ?? 'default'}>{topic.difficulty}</Tag>
            )}
            {topic.source && <Tag>{topic.source}</Tag>}
          </Space>

          {/* 持方对阵 */}
          {item.team_a_id && teamA && teamB && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '8px 12px',
                background: token.colorBgLayout,
                borderRadius: 6
              }}
            >
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {item.stance_a}
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{teamA.name}</div>
              </div>
              <Typography.Text strong style={{ color: token.colorError, fontSize: 18 }}>
                VS
              </Typography.Text>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {item.stance_b}
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{teamB.name}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
```

---

## Task 8: 创建 DrawResultList 标准结果列表

**Files:**
- Create: `src/renderer/src/components/draw/DrawResultList.tsx`

**说明：** 标准模式结果展示。接收 `DrawResult`，把 `session.items` 与 `topics` 按 topic_id 对齐，渲染 DrawResultCard 列表。顶部有"投屏模式"与"重新抽取"按钮。

- [ ] **Step 1: 创建组件**

```typescript
import { Button, Space, Typography, Empty, Tag, message, theme } from 'antd';
import { DesktopOutlined, ReloadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { DrawResult, Team } from '../../../shared/types';
import DrawResultCard from './DrawResultCard';

export interface DrawResultListProps {
  result: DrawResult;
  teams: Team[];
  onBigScreen: () => void;
  onRedo: () => void;
}

export default function DrawResultList({ result, teams, onBigScreen, onRedo }: DrawResultListProps) {
  const { token } = theme.useToken();
  const { session, topics, actual_ratio } = result;

  if (topics.length === 0) {
    return <Empty description="暂无抽取结果" />;
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          background: token.colorBgContainer,
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
          marginBottom: 12
        }}
      >
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
          <Typography.Text strong>抽取完成</Typography.Text>
          <Typography.Text type="secondary">
            共 {topics.length} 题 · {session.draw_time ?? ''}
          </Typography.Text>
          {actual_ratio && (
            <Tag>
              题源 官方 {Math.round(actual_ratio.official * 100)}% : 自定义 {Math.round(actual_ratio.custom * 100)}%
            </Tag>
          )}
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRedo}>
            重新抽取
          </Button>
          <Button type="primary" icon={<DesktopOutlined />} onClick={onBigScreen}>
            投屏模式
          </Button>
        </Space>
      </div>

      {/* 结果卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {topics.map((topic, idx) => {
          const item = session.items.find((it) => it.topic_id === topic.id);
          if (!item) return null;
          return (
            <div key={topic.id} className={`fade-up fade-up-delay-${Math.min(idx + 1, 6)}`}>
              <DrawResultCard index={idx} topic={topic} item={item} teams={teams} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Task 9: 创建 BigScreen 大屏组件

**Files:**
- Create: `src/renderer/src/components/draw/BigScreen.tsx`

**说明：** 全屏覆盖层。深色渐变背景。逐题揭晓：默认全部模糊，点击"下一题"逐张揭示。ESC 退出。显示辩题大字、正反方对阵、轮次。支持左右箭头键切换。

- [ ] **Step 1: 创建组件**

```typescript
import { useEffect, useState } from 'react';
import { Button, Typography, Space } from 'antd';
import { LeftOutlined, RightOutlined, CloseOutlined, FullscreenOutlined } from '@ant-design/icons';
import type { DrawResult, Team, Round } from '../../../shared/types';

export interface BigScreenProps {
  result: DrawResult;
  teams: Team[];
  round: Round | null;
  eventName: string;
  onClose: () => void;
}

export default function BigScreen({ result, teams, round, eventName, onClose }: BigScreenProps) {
  const { topics, session } = result;
  const [revealedCount, setRevealedCount] = useState(0);

  // ESC 退出 + 左右切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && revealedCount < topics.length) {
        setRevealedCount((c) => c + 1);
      } else if (e.key === 'ArrowLeft' && revealedCount > 0) {
        setRevealedCount((c) => c - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealedCount, topics.length, onClose]);

  const allRevealed = revealedCount >= topics.length;
  const currentTopic = revealedCount > 0 ? topics[revealedCount - 1] : null;
  const currentItem = currentTopic
    ? session.items.find((it) => it.topic_id === currentTopic.id)
    : null;
  const teamA = currentItem ? teams.find((t) => t.id === currentItem.team_a_id) : null;
  const teamB = currentItem ? teams.find((t) => t.id === currentItem.team_b_id) : null;

  return (
    <div className="bigscreen-overlay">
      {/* 顶部：轮次 + 关闭 */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 40px'
        }}
      >
        <Space size={24} style={{ fontSize: 22, color: 'rgba(255,255,255,0.8)' }}>
          <span>{eventName}</span>
          {round?.name && <span>· {round.name}</span>}
          <span>· 第 {Math.min(revealedCount, topics.length)}/{topics.length} 题</span>
        </Space>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: '#fff', fontSize: 20 }}
        />
      </div>

      {/* 主体：辩题展示 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%' }}>
        {!currentTopic ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>准备抽取</div>
            <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }}>
              共 {topics.length} 道辩题待揭晓
            </div>
          </div>
        ) : (
          <div
            className={allRevealed || revealedCount > 0 ? 'bigscreen-reveal-shown' : 'bigscreen-reveal-hidden'}
            style={{ textAlign: 'center', width: '100%' }}
          >
            <div className="bigscreen-topic-title">{currentTopic.title}</div>

            {/* 持方对阵 */}
            {teamA && teamB && currentItem && (
              <div className="bigscreen-versus">
                <div className="bigscreen-team">
                  <div className="bigscreen-stance">{currentItem.stance_a}</div>
                  <div>{teamA.name}</div>
                </div>
                <div className="bigscreen-vs">VS</div>
                <div className="bigscreen-team">
                  <div className="bigscreen-stance">{currentItem.stance_b}</div>
                  <div>{teamB.name}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部：导航按钮 */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <Button
          size="large"
          icon={<LeftOutlined />}
          disabled={revealedCount === 0}
          onClick={() => setRevealedCount((c) => Math.max(0, c - 1))}
          style={{ minWidth: 120 }}
        >
          上一题
        </Button>
        {!allRevealed ? (
          <Button
            type="primary"
            size="large"
            icon={<RightOutlined />}
            onClick={() => setRevealedCount((c) => c + 1)}
            style={{ minWidth: 160, height: 56, fontSize: 18 }}
            className="pulse-primary"
          >
            {revealedCount === 0 ? '开始揭晓' : '下一题'}
          </Button>
        ) : (
          <Button
            size="large"
            type="primary"
            icon={<FullscreenOutlined />}
            onClick={onClose}
            style={{ minWidth: 160, height: 56, fontSize: 18 }}
          >
            全部揭晓，退出
          </Button>
        )}
        <Button
          size="large"
          icon={<RightOutlined />}
          disabled={allRevealed}
          onClick={() => setRevealedCount((c) => Math.min(topics.length, c + 1))}
          style={{ minWidth: 120 }}
        >
          下一题
        </Button>
      </div>

      <Typography.Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 16 }}>
        按 ESC 退出 · ← → 切换题目
      </Typography.Text>
    </div>
  );
}
```

---

## Task 10: 创建 DrawAnimation 抽取动画覆盖层

**Files:**
- Create: `src/renderer/src/components/draw/DrawAnimation.tsx`

**说明：** 点击"开始抽取"后短暂显示的翻牌动画覆盖层（约 1.5 秒）。显示旋转加载图标 + "正在抽取..."文字。动画结束后自动消失（由父组件控制 `open` 状态）。

- [ ] **Step 1: 创建组件**

```typescript
import { Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

export interface DrawAnimationProps {
  open: boolean;
}

export default function DrawAnimation({ open }: DrawAnimationProps) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff'
      }}
    >
      <ThunderboltOutlined
        className="draw-spin"
        style={{ fontSize: 80, color: '#1677ff', marginBottom: 24 }}
      />
      <Typography.Title level={2} style={{ color: '#fff' }}>
        正在抽取辩题...
      </Typography.Title>
      <Typography.Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>
        请稍候
      </Typography.Text>
    </div>
  );
}
```

---

## Task 11: 重写 DrawPage 主页面

**Files:**
- Modify: `src/renderer/src/pages/DrawPage.tsx`

**说明：** 编排所有子组件。管理本地状态（配置、动画、大屏）。组装 `DrawParams` 调用 `useDrawStore.execute()`。处理 `includeKeywords/excludeKeywords` 合并到 `filter.keyword`（简化：包含词用 OR 逻辑拼接，排除词不传给后端，客户端过滤候选——但 draw-engine 是服务端抽取，所以排除词需要扩展 TopicFilter 或在 buildCandidatePool 后过滤。**决策：v1 简化，关键词包含/排除仅在 DrawPage 客户端对结果二次校验，不传后端**）。

- [ ] **Step 1: 重写 DrawPage.tsx**

```typescript
import { useEffect, useState, useMemo } from 'react';
import { Layout, Empty, Spin, message, Typography, theme } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useDrawStore } from '../stores/drawStore';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type { DrawParams, TopicFilter, Team } from '../../../shared/types';
import DrawConfigPanel, { type DrawConfigState } from '../components/draw/DrawConfigPanel';
import DrawResultList from '../components/draw/DrawResultList';
import BigScreen from '../components/draw/BigScreen';
import DrawAnimation from '../components/draw/DrawAnimation';

const { Sider, Content } = Layout;

const DEFAULT_CONFIG: DrawConfigState = {
  eventId: null,
  roundId: null,
  topicCount: 4,
  includeStance: false,
  teamPairs: [],
  filter: {},
  includeKeywords: [],
  excludeKeywords: [],
  sourceMixEnabled: false,
  officialRatio: 70
};

export default function DrawPage() {
  const { token } = theme.useToken();
  const drawStore = useDrawStore();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();

  const [config, setConfig] = useState<DrawConfigState>(DEFAULT_CONFIG);
  const [animating, setAnimating] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);

  // 拉取赛事列表（仅一次）
  useEffect(() => {
    eventStore.listEvents();
  }, []);

  // 赛事变更时拉取轮次+队伍
  useEffect(() => {
    if (config.eventId) {
      eventStore.listRoundsByEvent(config.eventId);
      eventStore.listTeamsByEvent(config.eventId);
    }
  }, [config.eventId]);

  // 标签候选（从题库拉取一批题的 tags 汇总，简化处理）
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    topicStore.items.forEach((t) => (t.tags ?? []).forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [topicStore.items]);

  // 初次进入拉取一批题用于 tag 候选
  useEffect(() => {
    if (topicStore.items.length === 0) {
      topicStore.fetchList();
    }
  }, []);

  const updateConfig = (patch: Partial<DrawConfigState>) =>
    setConfig((c) => ({ ...c, ...patch }));

  // 组装 DrawParams
  const buildParams = (): DrawParams | null => {
    if (!config.eventId) return null;
    // 合并 teams（从 teamPairs 扁平化）
    const teams: Team[] = [];
    config.teamPairs.forEach((p) => {
      if (p.teamA) teams.push(p.teamA);
      if (p.teamB) teams.push(p.teamB);
    });

    const filter: TopicFilter = { ...config.filter, status: 'active' };

    const params: DrawParams = {
      event_id: config.eventId,
      round_id: config.roundId,
      topic_count: config.topicCount,
      include_stance: config.includeStance,
      teams: config.includeStance ? teams : undefined,
      filters: filter,
      operator: 'renderer'
    };

    if (config.sourceMixEnabled) {
      params.source_mix_ratio = {
        official: config.officialRatio / 100,
        custom: (100 - config.officialRatio) / 100
      };
    }
    return params;
  };

  const handleDraw = async () => {
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    try {
      // 动画至少显示 1.2s
      const [result] = await Promise.all([
        drawStore.execute(params),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      if (result) {
        message.success(`已抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setAnimating(false);
    }
  };

  const handleRedo = async () => {
    if (!drawStore.lastResult) return;
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    try {
      const [result] = await Promise.all([
        drawStore.redo(drawStore.lastResult.session.id, params),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      if (result) {
        message.success(`已重新抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重抽失败');
    } finally {
      setAnimating(false);
    }
  };

  const currentRound = eventStore.rounds.find((r) => r.id === config.roundId) ?? null;
  const currentEvent = eventStore.events.find((e) => e.id === config.eventId);

  return (
    <>
      <Layout style={{ background: 'transparent', height: 'calc(100vh - 64px)' }}>
        <Sider
          width={360}
          theme="light"
          style={{ background: 'transparent', borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: 'auto' }}
        >
          <DrawConfigPanel
            state={config}
            onChange={updateConfig}
            events={eventStore.events}
            rounds={eventStore.rounds}
            teams={eventStore.teams}
            tagOptions={tagOptions}
            loading={drawStore.loading}
            onDraw={handleDraw}
          />
        </Sider>

        <Content style={{ padding: '0 16px', overflow: 'auto' }}>
          {drawStore.lastResult ? (
            <DrawResultList
              result={drawStore.lastResult}
              teams={eventStore.teams}
              onBigScreen={() => setBigScreen(true)}
              onRedo={handleRedo}
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    <ThunderboltOutlined /> 配置抽取条件后点击"开始抽取"
                  </span>
                }
              />
            </div>
          )}
        </Content>
      </Layout>

      {/* 抽取动画 */}
      <DrawAnimation open={animating} />

      {/* 大屏模式 */}
      {bigScreen && drawStore.lastResult && (
        <BigScreen
          result={drawStore.lastResult}
          teams={eventStore.teams}
          round={currentRound}
          eventName={currentEvent?.name ?? '辩题抽取'}
          onClose={() => setBigScreen(false)}
        />
      )}
    </>
  );
}
```

---

## Task 12: 验证

**Files:** 无修改

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: node + web 双侧通过

- [ ] **Step 2: 单元测试**

Run: `npm test`
Expected: 67 个测试全部通过，无回归

- [ ] **Step 3: 启动应用**

Run: `npm run dev`
Expected:
- 应用启动，控制台输出 `[main] All IPC handlers registered`
- 访问 `http://localhost:5173/`，左侧导航到"抽取"页
- 配置面板渲染正常，赛事/轮次下拉可联动
- 点击"开始抽取"（需先在赛事管理创建赛事+队伍，但赛事管理页是占位，所以预期会显示"该赛事暂无队伍"或空列表）
- 无运行时报错

---

## 假设与决策

1. **多选筛选**：扩展 `TopicFilter` 增加 `types/domains/difficulties` 数组字段，保留单值字段向后兼容。`buildWhereClause` 数组优先。FilterPanel 全局升级 type/domain/difficulty 为多选，source/source_type/status 保持单选。
2. **动画**：纯 CSS keyframes（翻牌、淡入、旋转、脉冲），不引入 framer-motion。
3. **大屏模式**：fixed 定位全屏覆盖层（z-index 9999），ESC 退出，左右箭头切换。不用路由（避免新窗口复杂度）。
4. **抽取动画**：点击抽取后显示 1.2s 旋转加载遮罩，与 IPC 调用 Promise.all 同步。
5. **关键词包含/排除**：v1 简化，DrawPage 的 includeKeywords/excludeKeywords 不传后端（draw-engine 服务端抽取，TopicFilter 不支持排除词）。UI 保留输入框但仅作记录，后续可扩展。**注：FilterPanel 中的 keyword 单值字段仍传后端。**
6. **队伍配对**：用户手动或随机配对，持方（正/反）在 draw-engine 内随机分配（已有逻辑）。
7. **operator**：v1 固定为 `'renderer'`，后续接用户系统时扩展。
8. **题源混合比例**：滑块 0-100，对应 officialRatio 0%-100%，传给 draw-engine 的 `source_mix_ratio`。

## 自检清单

- [x] Task 1-2 覆盖多选筛选后端
- [x] Task 3 覆盖 FilterPanel 全局升级
- [x] Task 4 覆盖动画 CSS
- [x] Task 5-6 覆盖配置面板（含队伍对阵）
- [x] Task 7-8 覆盖标准结果展示
- [x] Task 9 覆盖大屏模式
- [x] Task 10 覆盖抽取动画
- [x] Task 11 编排主页面
- [x] Task 12 验证
- [x] 无占位符（所有代码块完整）
- [x] 类型一致（DrawParams/DrawResult/TopicFilter 跨任务一致）
