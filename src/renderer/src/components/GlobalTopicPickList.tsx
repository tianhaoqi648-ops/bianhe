// ============================================================
// GlobalTopicPickList.tsx — 从全局题库勾选加入的候选列表（T3 复用）
//
// 用于「题组管理 · 加入辩题」「题库工作区 · 从全局导入」等处，
// 对全局题候选提供：
//   - 关键词搜索 + 类型/领域/难度/状态/标签筛选（复用 filterEventTopics 纯逻辑）
//   - 逐题展示 状态 / 类型 / 领域 / 难度 / 标签 Tag
//   - 多选（Checkbox.Group）或单选（点击选中）两种模式
// 筛选基于传入的完整候选集做，父组件负责先剔除已在目标组的题。
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  List,
  Tag,
  Space,
  Typography,
  Empty,
  Input,
  Select,
  Checkbox,
  Button,
  Tooltip
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { Topic } from '../../../shared/types';
import { filterEventTopics, type EventTopicFilter } from '../utils/eventTopicBank';

const { Text } = Typography;

/** 状态筛选候选（辩题 status）。 */
const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'favorited', label: '收藏' },
  { value: 'blacklisted', label: '拉黑' }
];

/** 单题展示时的状态徽标。 */
const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: '正常', color: 'green' },
  favorited: { label: '收藏', color: 'gold' },
  blacklisted: { label: '已拉黑', color: 'red' }
};

/**
 * 全局辩题候选选择列表（搜索 + 筛选 + 标签展示）。
 * 父组件传入完整候选 topics 与受控 selected/onChange；本组件内部管理筛选状态，
 * 并在 topics 引用变化时重置（每次打开弹窗重新拉取全量候选即会清空筛选）。
 */
export default function GlobalTopicPickList({
  topics,
  selected,
  onChange,
  multiple = true,
  listMaxHeight = 320
}: {
  /** 完整候选辩题集（应由父组件剔除已在目标组/库的题） */
  topics: Topic[];
  /** 当前选中 id 列表 */
  selected: string[];
  /** 选中变化回调 */
  onChange: (ids: string[]) => void;
  /** false 时切换为单选（点击行选中） */
  multiple?: boolean;
  /** 列表最大高度（超出滚动） */
  listMaxHeight?: number;
}) {
  const [filter, setFilter] = useState<EventTopicFilter>({});

  // topics 引用变化（打开弹窗重新拉取全量候选）时重置筛选
  useEffect(() => {
    setFilter({});
  }, [topics]);

  /** 筛选候选值（类型/领域/难度）从当前候选集提取 */
  const candidateOf = (key: 'type' | 'domain' | 'difficulty') => {
    const set = new Set<string>();
    for (const t of topics) {
      const v = t[key];
      if (v) set.add(v);
    }
    return [...set].sort();
  };
  const candidateTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics) for (const tag of t.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [topics]);

  // 复用 filterEventTopics 纯逻辑：基于全量候选做筛选
  const filteredTopics = useMemo(() => filterEventTopics(topics, filter), [topics, filter]);

  const hasFilter =
    !!filter.keyword ||
    !!filter.type ||
    !!filter.domain ||
    !!filter.difficulty ||
    !!filter.status ||
    !!filter.tag;

  const handleRowPick = (id: string) => {
    if (multiple) return; // 多选由 Checkbox 控制
    const ids = selected.includes(id) ? [] : [id];
    onChange(ids);
  };

  // 多选模式：全选（基于当前筛选结果）/ 判别是否全选 or 部分选中
  const filteredIds = useMemo(() => filteredTopics.map((t) => t.id), [filteredTopics]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.includes(id));
  const someFilteredSelected = filteredIds.some((id) => selected.includes(id));
  const toggleSelectAll = (checked: boolean) => {
    if (!multiple) return;
    if (checked) {
      const set = new Set(selected);
      for (const id of filteredIds) set.add(id);
      onChange([...set]);
    } else {
      const set = new Set(filteredIds);
      onChange(selected.filter((id) => !set.has(id)));
    }
  };

  const statusTag = (t: Topic) => {
    const meta = STATUS_META[t.status] ?? { label: t.status, color: 'default' };
    return <Tag color={meta.color}>{meta.label}</Tag>;
  };

  return (
    <div>
      {/* 搜索 / 筛选 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索辩题标题"
          style={{ width: 190 }}
          value={filter.keyword}
          onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 110 }}
          value={filter.type}
          options={candidateOf('type').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, type: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="领域"
          style={{ width: 110 }}
          value={filter.domain}
          options={candidateOf('domain').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, domain: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="难度"
          style={{ width: 100 }}
          value={filter.difficulty}
          options={candidateOf('difficulty').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, difficulty: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 100 }}
          value={filter.status}
          options={STATUS_OPTIONS}
          onChange={(v) => setFilter((f) => ({ ...f, status: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="标签"
          style={{ width: 120 }}
          value={filter.tag}
          options={candidateTags.map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, tag: v ?? undefined }))}
        />
        {hasFilter && (
          <Button size="small" onClick={() => setFilter({})}>
            重置筛选
          </Button>
        )}
      </div>

      {/* 统计 */}
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary">
          共 <Text strong>{topics.length}</Text> 题
          {hasFilter && (
            <>
              {' '}
              · 筛选后 <Text strong>{filteredTopics.length}</Text> 题
            </>
          )}
        </Text>
      </div>

      {topics.length === 0 ? (
        <Empty description="暂无候选辩题" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : filteredTopics.length === 0 ? (
        <Empty description="无符合搜索/筛选条件的辩题" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : multiple ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 8
            }}
          >
            <Checkbox
              indeterminate={someFilteredSelected && !allFilteredSelected}
              checked={allFilteredSelected}
              onChange={(e) => toggleSelectAll(e.target.checked)}
            >
              全选（当前筛选）
            </Checkbox>
            <Text type="secondary">
              已选 <Text strong>{selected.length}</Text> 题
            </Text>
          </div>
          <Checkbox.Group
          style={{ width: '100%' }}
          value={selected}
          onChange={(vals) => onChange(vals as string[])}
        >
          <List
            size="small"
            dataSource={filteredTopics}
            rowKey="id"
            style={{ width: '100%', maxHeight: listMaxHeight, overflow: 'auto' }}
            renderItem={(t) => (
              <List.Item>
                <Space wrap size={4} style={{ width: '100%' }}>
                  <Checkbox value={t.id} />
                  <Text
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {t.status === 'blacklisted' ? (
                      <Text type="secondary" delete>
                        {t.title}
                      </Text>
                    ) : (
                      t.title
                    )}
                  </Text>
                  {statusTag(t)}
                  {t.type && <Tag color="geekblue">{t.type}</Tag>}
                  {t.domain && <Tag color="purple">{t.domain}</Tag>}
                  {t.difficulty && <Tag color="cyan">{t.difficulty}</Tag>}
                  {(t.tags ?? []).slice(0, 3).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              </List.Item>
            )}
          />
        </Checkbox.Group>
        </>
      ) : (
        <List
          size="small"
          dataSource={filteredTopics}
          rowKey="id"
          style={{ width: '100%', maxHeight: listMaxHeight, overflow: 'auto' }}
          renderItem={(t) => {
            const selectedRow = selected.includes(t.id);
            return (
              <List.Item
                onClick={() => handleRowPick(t.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: selectedRow ? '1px solid #1677ff' : undefined,
                  background: selectedRow ? 'rgba(22,119,255,0.05)' : undefined
                }}
              >
                <Space wrap size={4} style={{ width: '100%' }}>
                  <Tooltip title="点击选中此题">
                    <Text strong>{t.title}</Text>
                  </Tooltip>
                  {statusTag(t)}
                  {t.type && <Tag color="geekblue">{t.type}</Tag>}
                  {t.domain && <Tag color="purple">{t.domain}</Tag>}
                  {t.difficulty && <Tag color="cyan">{t.difficulty}</Tag>}
                  {(t.tags ?? []).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}