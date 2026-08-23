// ============================================================
// TopicPickModal.tsx — 事件端「为该场配辩题 / 选择辩题」面板（T5）
//
// 替代原先 EventMatchesTab「配题」里裸 Select 的粗糙选择：
//   - 关键词搜索 + 按维度（类型/领域/难度/状态/标签）筛选（复用 filterEventTopics）
//   - 逐题标签显示，列表更可用
//   - 页面内快速新建：写全局题库 topicAPI.create，可选加入某绑定题库；创建后自动选中
// 数据源为全局辩题库 topicStore.items（与全局题库页同源）。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  List,
  Tag,
  Space,
  Button,
  Typography,
  Alert,
  Spin,
  Empty,
  Input,
  Select,
  Divider,
  Tooltip
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  SaveOutlined,
  BookOutlined
} from '@ant-design/icons';
import { useTopicStore } from '../../stores/topicStore';
import { useToast } from '../../hooks/useToast';
import { filterEventTopics, buildQuickCreateInput, type EventTopicFilter } from '../../utils/eventTopicBank';
import type { TopicGroup } from '../../../../shared/types';

const { Text } = Typography;

const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'favorited', label: '收藏' },
  { value: 'blacklisted', label: '拉黑' }
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: '正常', color: 'green' },
  favorited: { label: '收藏', color: 'gold' },
  blacklisted: { label: '已拉黑', color: 'red' }
};

const EMPTY_CREATE = {
  title: '',
  type: undefined as string | undefined,
  domain: undefined as string | undefined,
  difficulty: undefined as string | undefined,
  tagsInput: '',
  targetGroupId: undefined as string | undefined
};

export default function TopicPickModal({
  open,
  eventId,
  onClose,
  onConfirm
}: {
  open: boolean;
  eventId: string;
  onClose: () => void;
  /** 确认把某辩题计入该场（配题） */
  onConfirm: (topicId: string) => void;
}) {
  const toast = useToast();
  const topicStore = useTopicStore();

  const [filter, setFilter] = useState<EventTopicFilter>({});
  const [selectedId, setSelectedId] = useState<string | undefined>();

  // 快速新建
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CREATE>({ ...EMPTY_CREATE });
  const [creating, setCreating] = useState(false);

  // 当前赛事绑定的题库（新建题可选「加入」）
  const [boundGroups, setBoundGroups] = useState<TopicGroup[]>([]);

  // 打开时确保全局题库已加载，并拉取绑定题库
  useEffect(() => {
    if (open) {
      setFilter({});
      setSelectedId(undefined);
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      if (topicStore.items.length === 0) void topicStore.fetchList({ pageSize: 1000 });
      void window.groupAPI
        .listGroupsByEvent(eventId)
        .then((r) => setBoundGroups(r.success && r.data ? r.data : []))
        .catch(() => setBoundGroups([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  const topics = topicStore.items;

  /** 筛选候选值（类型/领域/难度）从当前题集合提取 */
  const candidateOf = useCallback(
    (key: 'type' | 'domain' | 'difficulty') => {
      const set = new Set<string>();
      for (const t of topics) {
        const v = t[key];
        if (v) set.add(v);
      }
      return [...set].sort();
    },
    [topics]
  );
  const candidateTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics) for (const tag of t.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [topics]);

  const filteredTopics = useMemo(
    () => filterEventTopics(topics, filter),
    [topics, filter]
  );

  const setCreate = (patch: Partial<typeof EMPTY_CREATE>) =>
    setCreateForm((prev) => ({ ...prev, ...patch }));

  const handleCreateOk = async () => {
    const title = createForm.title.trim();
    if (!title) {
      toast.warning('请输入辩题标题');
      return;
    }
    setCreating(true);
    try {
      const res = await window.topicAPI.create(
        buildQuickCreateInput({
          title,
          type: createForm.type,
          domain: createForm.domain,
          difficulty: createForm.difficulty,
          tags: createForm.tagsInput
        })
      );
      if (!res.success || !res.data) throw new Error(res.error || '创建辩题失败');
      const topicId = res.data.id;
      // 可选加入某个绑定题库
      if (createForm.targetGroupId) {
        const addRes = await window.groupAPI.batchAddToGroups({
          topicIds: [topicId],
          groupIds: [createForm.targetGroupId]
        });
        if (!addRes.success) throw new Error(addRes.error || '加入题库失败');
      }
      toast.success('已新建辩题到全局题库');
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      // 刷新全局题库并自动选中新建题，方便即刻确认配入该场
      await topicStore.fetchList({ pageSize: 1000 });
      setSelectedId(topicId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedId) {
      toast.warning('请选择一道辩题');
      return;
    }
    onConfirm(selectedId);
  };

  const hasFilter =
    !!filter.keyword ||
    filter.type ||
    filter.domain ||
    filter.difficulty ||
    filter.status ||
    filter.tag;

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          <span>为该场配辩题</span>
        </Space>
      }
      width={680}
      open={open}
      onCancel={onClose}
      onOk={() => void handleConfirm()}
      okText="计入该场"
      okButtonProps={{ disabled: !selectedId }}
      cancelText="取消"
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="从全局题库搜索/筛选并给当前比赛指定一道辩题；也可在下方直接「快速新建」一道到全局题库。"
      />

      {/* 搜索 / 筛选 / 快速新建 */}
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
          style={{ width: 200 }}
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
        <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => setCreateOpen((v) => !v)}>
          快速新建
        </Button>
      </div>

      {/* 快速新建面板：写全局题库，可选加入绑定题库 */}
      {createOpen && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(128,128,128,0.06)',
            marginBottom: 12
          }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Text strong>
              <PlusOutlined /> 快速新建辩题
            </Text>
            <Input
              placeholder="辩题标题（必填）"
              maxLength={200}
              value={createForm.title}
              onChange={(e) => setCreate({ title: e.target.value })}
            />
            <Space size={8} wrap>
              <Select
                allowClear
                placeholder="类型"
                style={{ width: 150 }}
                value={createForm.type}
                options={candidateOf('type').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ type: v ?? undefined })}
              />
              <Select
                allowClear
                placeholder="领域"
                style={{ width: 150 }}
                value={createForm.domain}
                options={candidateOf('domain').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ domain: v ?? undefined })}
              />
              <Select
                allowClear
                placeholder="难度"
                style={{ width: 130 }}
                value={createForm.difficulty}
                options={candidateOf('difficulty').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ difficulty: v ?? undefined })}
              />
            </Space>
            <Input
              placeholder="标签（多个用逗号分隔，如：热点, 社会）"
              value={createForm.tagsInput}
              onChange={(e) => setCreate({ tagsInput: e.target.value })}
            />
            <Select
              allowClear
              placeholder="【可选】一并加入某个绑定题库"
              style={{ width: '100%' }}
              value={createForm.targetGroupId}
              options={boundGroups.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(v) => setCreate({ targetGroupId: v })}
            />
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={creating}
              onClick={() => void handleCreateOk()}
            >
              新建并自动选中
            </Button>
          </Space>
        </div>
      )}

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

      <Divider style={{ margin: '8px 0 12px' }} />

      <Spin spinning={topicStore.loading} style={{ minHeight: 160 }}>
        {filteredTopics.length === 0 ? (
          <Empty
            description="无符合条件或暂无全局辩题；可点「快速新建」添加一道"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <List
            size="small"
            dataSource={filteredTopics}
            rowKey="id"
            style={{ maxHeight: 320, overflow: 'auto' }}
            renderItem={(t) => {
              const statusMeta = STATUS_META[t.status] ?? { label: t.status, color: 'default' };
              const selected = t.id === selectedId;
              return (
                <List.Item
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: selected ? '1px solid #1677ff' : undefined,
                    background: selected ? 'rgba(22,119,255,0.05)' : undefined
                  }}
                >
                  <Space wrap size={4} style={{ width: '100%' }}>
                    <Tooltip title="点击选中此题">
                      <Text strong>{t.title}</Text>
                    </Tooltip>
                    <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
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
      </Spin>
    </Modal>
  );
}