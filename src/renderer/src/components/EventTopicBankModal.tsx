import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  List,
  Tag,
  Space,
  Button,
  Typography,
  Switch,
  Alert,
  Spin,
  Empty,
  Divider,
  Tooltip,
  Input,
  Select,
  Checkbox,
  Popconfirm,
  Form
} from 'antd';
import {
  BookOutlined,
  ReloadOutlined,
  ImportOutlined,
  PlusOutlined,
  CopyOutlined,
  SwapOutlined,
  LinkOutlined,
  SlidersOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useEventStore } from '../stores/eventStore';
import { useToast } from '../hooks/useToast';
import { useTopicGroupStore } from '../stores/topicGroupStore';
import { useTopicGroupFileOps } from '../hooks/useTopicGroupFileOps';
import TopicGroupTargetPicker from './TopicGroupTargetPicker';
import EventBankConfigModal from './EventBankConfigModal';
import type { Event, TopicGroup } from '../../../shared/types';
import {
  mergeGroupTopics,
  markDrawn,
  countDrawn,
  allowRepeatFromEvent,
  allowRepeatToFlag,
  filterEventTopics,
  canUnbindEventGroup,
  computeBankBindConflicts,
  type EventTopicFilter,
  type EventTopicItem,
  type BankBindConflictReport
} from '../utils/eventTopicBank';

const { Text } = Typography;

/** 状态筛选候选（辩题 status）。 */
const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'favorited', label: '收藏' },
  { value: 'blacklisted', label: '拉黑' }
];

/** 页内新建辩题表单默认值。 */
const EMPTY_CREATE = {
  title: '',
  type: undefined as string | undefined,
  domain: undefined as string | undefined,
  difficulty: undefined as string | undefined,
  tagsInput: '',
  targetGroupId: undefined as string | undefined
};

/**
 * 赛事题库（Event Topic Bank）Modal（T4）。
 *
 * 从赛事详情进入，展示「本赛事绑定题组」下的辩题：
 *   - 合并多个绑定题组并按辩题 id 去重（groupAPI.listGroupsByEvent → 逐个 listTopicsByGroup）
 *   - 逐题标注「本赛事已抽/未抽」（drawAPI.listDrawnTopicIds 命中即已抽）
 *   - 顶部 Switch 切换事件级「允许重复再抽」（events.allow_repeat）
 *   - 绑定题库管理：添加题库（多选未绑定者）/ 解绑（至少保留一个）
 *   - 整体复制/移动：把某绑定题库全部题复制/移动到其他题库（复用 TopicGroupTargetPicker）
 *   - 页内快捷新建题：写全局题库（topicAPI.create）→ 加入所选绑定题库 → 刷新
 *   - 搜索 / 筛选（类型/领域/难度/状态/标签）+ 逐题标签 Tag
 */
export default function EventTopicBankModal({
  open,
  onClose,
  event,
  onEventUpdated,
  onOpenGroupManager
}: {
  open: boolean;
  onClose: () => void;
  /** 当前选中的赛事（含 allow_repeat） */
  event: Event | null;
  /** 重复开关等内容变更后通知父级刷新赛事对象 */
  onEventUpdated: () => void;
  /** 打开既有「题组管理（题库）」Modal 的入口回调 */
  onOpenGroupManager: () => void;
}) {
  const toast = useToast();
  const eventStore = useEventStore();

  // 全局题组（含全部可作目标/可绑定的库）
  const groups = useTopicGroupStore((s) => s.groups);
  const fetchGroups = useTopicGroupStore((s) => s.fetchGroups);
  const loadMemberMapping = useTopicGroupStore((s) => s.loadMemberMapping);
  const { copyWholeGroupToGroups, moveWholeGroupToGroups } = useTopicGroupFileOps();

  const [boundGroups, setBoundGroups] = useState<TopicGroup[]>([]);
  const [topics, setTopics] = useState<EventTopicItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [repeatSaving, setRepeatSaving] = useState(false);
  // 选题模式配置 Modal 开关
  const [bankCfgOpen, setBankCfgOpen] = useState(false);

  // 搜索 / 筛选
  const [filter, setFilter] = useState<EventTopicFilter>({});

  // 「添加题库」绑定选择
  const [bindOpen, setBindOpen] = useState(false);
  const [bindSelected, setBindSelected] = useState<string[]>([]);
  const [bindSaving, setBindSaving] = useState(false);

  // T6 换库重复提醒：确认绑定后弹窗告知新增题库中的已抽题冲突
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [bindConflictReport, setBindConflictReport] = useState<BankBindConflictReport>({
    conflicts: [],
    total: 0,
    hasConflict: false
  });

  // 整库复制 / 移动 目标选择
  const [wholeGroupOp, setWholeGroupOp] = useState<
    { mode: 'copy' | 'move'; group: TopicGroup } | null
  >(null);
  const [wholeGroupSaving, setWholeGroupSaving] = useState(false);

  // 页内快捷新建
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<
    typeof EMPTY_CREATE
  >(() => ({ ...EMPTY_CREATE }));
  const [createSaving, setCreateSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    try {
      const [groupRes, drawnRes] = await Promise.all([
        window.groupAPI.listGroupsByEvent(event.id),
        window.drawAPI.listDrawnTopicIds(event.id)
      ]);
      const groupsList = groupRes.success && groupRes.data ? groupRes.data : [];
      setBoundGroups(groupsList);
      const drawnIds = drawnRes.success && drawnRes.data ? drawnRes.data : [];

      const groupTopicLists = await Promise.all(
        groupsList.map((g) =>
          window.groupAPI
            .listTopicsByGroup(g.id)
            .then((r) => (r.success && r.data ? r.data : []))
            .catch(() => [] as never[])
        )
      );
      const merged = mergeGroupTopics(groupTopicLists);
      setTopics(markDrawn(merged, drawnIds ?? []));
      setAllowRepeat(allowRepeatFromEvent(event.allow_repeat));
    } catch {
      setBoundGroups([]);
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, [event]);

  useEffect(() => {
    if (open && event) {
      setAllowRepeat(allowRepeatFromEvent(event.allow_repeat));
      setFilter({});
      void fetchGroups();
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  const boundIds = useMemo(() => new Set(boundGroups.map((g) => g.id)), [boundGroups]);
  /** 可选绑定（全局未绑定者） */
  const bindCandidates = useMemo(
    () => groups.filter((g) => !boundIds.has(g.id)),
    [groups, boundIds]
  );

  /** 筛选候选值（从当前合并题集合提取，随刷新动态更新）。 */
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
  const drawnCount = useMemo(() => countDrawn(topics), [topics]);

  const handleToggleRepeat = async (checked: boolean) => {
    if (!event) return;
    const prev = allowRepeat;
    setAllowRepeat(checked); // 乐观更新
    setRepeatSaving(true);
    try {
      await eventStore.updateEvent(event.id, { allow_repeat: allowRepeatToFlag(checked) });
      toast.success(checked ? '已开启「允许重复再抽」' : '已关闭「允许重复再抽」');
      onEventUpdated();
    } catch (e) {
      setAllowRepeat(prev);
      toast.error(e instanceof Error ? e.message : '更新失败');
    } finally {
      setRepeatSaving(false);
    }
  };

  // ---- 绑定题库管理 ----
  const openBind = () => {
    setBindSelected([]);
    setBindOpen(true);
  };
  const handleBindOk = async () => {
    if (!event || bindSelected.length === 0) return;
    setBindSaving(true);
    try {
      // T6 换库重复提醒：先取已抽题 + 各新库题 id，计算冲突（不阻断绑定，仅告知）
      const drawnRes = await window.drawAPI.listDrawnTopicIds(event.id);
      const drawnIds = drawnRes.success && drawnRes.data ? drawnRes.data : [];
      const groupTopicResults = await Promise.all(
        bindSelected.map(async (groupId) => {
          const listRes = await window.groupAPI
            .listTopicsByGroup(groupId)
            .catch(() => null);
          return {
            id: groupId,
            name: groups.find((g) => g.id === groupId)?.name ?? groupId,
            topicIds: listRes?.success && listRes.data ? listRes.data.map((t) => t.id) : []
          };
        })
      );
      const report = computeBankBindConflicts(groupTopicResults, drawnIds);
      setBindConflictReport(report);

      const res = await window.groupAPI.bindEventGroups({
        eventId: event.id,
        groupIds: bindSelected
      });
      if (!res.success) throw new Error(res.error || '添加题库失败');
      toast.success(`已绑定 ${bindSelected.length} 个题库`);
      setBindOpen(false);
      setConflictModalOpen(report.hasConflict);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加题库失败');
    } finally {
      setBindSaving(false);
    }
  };
  const handleUnbind = async (group: TopicGroup) => {
    if (!event) return;
    if (!canUnbindEventGroup(boundGroups.map((g) => g.id), group.id)) {
      toast.warning('至少需保留一个绑定题库');
      return;
    }
    const res = await window.groupAPI.unbindEventGroup({
      eventId: event.id,
      groupId: group.id
    });
    if (res.success) {
      toast.success(`已解绑「${group.name}」`);
      await refresh();
      void loadMemberMapping();
    } else {
      toast.error(res.error || '解绑失败');
    }
  };

  // ---- 整库复制 / 移动 ----
  const handleWholeGroupConfirm = async (targetGroupIds: string[]) => {
    if (!wholeGroupOp) return;
    const src = wholeGroupOp.group;
    setWholeGroupSaving(true);
    try {
      if (wholeGroupOp.mode === 'copy') {
        const results = await copyWholeGroupToGroups(src.id, targetGroupIds);
        const added = results.reduce((sum, r) => sum + r.added, 0);
        toast.success(`已把「${src.name}」复制到 ${targetGroupIds.length} 个题库（新增 ${added} 题）`);
      } else {
        const results = await moveWholeGroupToGroups(src.id, targetGroupIds);
        const added = results.reduce((sum, r) => sum + r.added, 0);
        toast.success(`已把「${src.name}」移动到 ${targetGroupIds.length} 个题库（新增 ${added} 题）`);
      }
      setWholeGroupOp(null);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setWholeGroupSaving(false);
    }
  };

  // ---- 页内快捷新建 ----
  const openCreate = () => {
    setCreateForm({
      ...EMPTY_CREATE,
      // 默认加入当前第一个绑定题库
      targetGroupId: boundGroups[0]?.id
    });
    setCreateOpen(true);
  };
  const setCreate = (patch: Partial<typeof EMPTY_CREATE>) =>
    setCreateForm((prev) => ({ ...prev, ...patch }));
  const handleCreateOk = async () => {
    if (!event) return;
    const title = createForm.title.trim();
    if (!title) {
      toast.warning('请输入辩题标题');
      return;
    }
    setCreateSaving(true);
    try {
      const tags = createForm.tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.topicAPI.create({
        title,
        type: createForm.type || null,
        domain: createForm.domain || null,
        difficulty: createForm.difficulty || null,
        tags: tags.length ? tags : null
      });
      if (!res.success || !res.data) throw new Error(res.error || '创建辩题失败');
      const topicId = res.data.id;
      // 写入全局题库后，加入当前选中的绑定题库
      if (createForm.targetGroupId) {
        const addRes = await window.groupAPI.batchAddToGroups({
          topicIds: [topicId],
          groupIds: [createForm.targetGroupId]
        });
        if (!addRes.success) throw new Error(addRes.error || '加入题库失败');
      }
      toast.success('已新建辩题并加入题库');
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          <span>赛事题库</span>
          {event && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {event.name}
            </Text>
          )}
        </Space>
      }
      width={860}
      open={open}
      onCancel={onClose}
      footer={
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          刷新
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里展示本赛事绑定题组下的辩题，并标注每道题「本赛事已抽 / 未抽」；「允许重复再抽」控制重抽时是否可再次抽到已抽题。"
      />

      {/* 顶部：允许重复开关 + 绑定题库管理 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderRadius: 8,
          background: 'rgba(128,128,128,0.06)',
          marginBottom: 16
        }}
      >
        <Space size={8}>
          <Switch
            checked={allowRepeat}
            loading={repeatSaving}
            onChange={(v) => void handleToggleRepeat(v)}
          />
          <Text strong>允许重复再抽</Text>
        </Space>

        <Divider type="vertical" style={{ height: 24 }} />

        <Space size={8} wrap>
          <Text type="secondary" style={{ fontSize: 13 }}>
            绑定题库：
          </Text>
          {boundGroups.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 13 }}>
              未绑定题库
            </Text>
          ) : (
            boundGroups.map((g) => (
              <Tag key={g.id} color={g.isDefault ? 'gold' : 'blue'}>
                {g.name}
                {g.isDefault ? '（默认题库）' : ''}
              </Tag>
            ))
          )}
          <Button size="small" icon={<LinkOutlined />} onClick={openBind}>
            添加题库
          </Button>
          <Tooltip title="打开题组管理，可新建/重命名题组、把全局辩题加入题组">
            <Button size="small" icon={<BookOutlined />} onClick={onOpenGroupManager}>
              题组管理
            </Button>
          </Tooltip>
          <Button
            size="small"
            icon={<SlidersOutlined />}
            disabled={boundGroups.length === 0}
            onClick={() => setBankCfgOpen(true)}
          >
            选题模式
          </Button>
        </Space>
      </div>

      <Divider style={{ margin: '8px 0 12px' }} />

      {/* 绑定题库操作区：整体复制/移动 + 解绑 */}
      <div style={{ marginBottom: 12 }}>
        {boundGroups.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            暂无绑定题库，点击上方「添加题库」从全局题库中绑定；解绑需至少保留一个。
          </Text>
        ) : (
          <Space size={8} wrap>
            {boundGroups.map((g) => (
              <Space key={g.id} size={4}>
                <Tag color={g.isDefault ? 'gold' : 'blue'}>{g.name}</Tag>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  title={`把「${g.name}」全部题复制到其他题库`}
                  onClick={() => setWholeGroupOp({ mode: 'copy', group: g })}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<SwapOutlined />}
                  title={`把「${g.name}」全部题移动到其他题库`}
                  onClick={() => setWholeGroupOp({ mode: 'move', group: g })}
                />
                <Popconfirm
                  title={`解绑题库「${g.name}」？`}
                  description="解绑后该题库不再参与本赛事抽题；至少需保留一个绑定题库。"
                  okText="解绑"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleUnbind(g)}
                >
                  <Button
                    size="small"
                    danger
                    type="text"
                    title="解绑该题库"
                    disabled={!canUnbindEventGroup(boundGroups.map((x) => x.id), g.id)}
                  >
                    解绑
                  </Button>
                </Popconfirm>
              </Space>
            ))}
          </Space>
        )}
      </div>

      {/* 搜索 / 筛选 / 新建 */}
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
          style={{ width: 220 }}
          value={filter.keyword}
          onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 120 }}
          value={filter.type}
          options={candidateOf('type').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, type: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="领域"
          style={{ width: 120 }}
          value={filter.domain}
          options={candidateOf('domain').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, domain: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="难度"
          style={{ width: 110 }}
          value={filter.difficulty}
          options={candidateOf('difficulty').map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, difficulty: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 110 }}
          value={filter.status}
          options={STATUS_OPTIONS}
          onChange={(v) => setFilter((f) => ({ ...f, status: v ?? undefined }))}
        />
        <Select
          allowClear
          placeholder="标签"
          style={{ width: 130 }}
          value={filter.tag}
          options={candidateTags.map((v) => ({ value: v, label: v }))}
          onChange={(v) => setFilter((f) => ({ ...f, tag: v ?? undefined }))}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建辩题
        </Button>
      </div>

      {/* 统计 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12
        }}
      >
        <Space size={12}>
          <Text type="secondary">
            共 <Text strong>{topics.length}</Text> 题
          </Text>
          <Text type="secondary">
            已抽 <Text strong>{drawnCount}</Text> · 未抽{' '}
            <Text strong>{topics.length - drawnCount}</Text>
          </Text>
          {!!filter.keyword ||
          filter.type ||
          filter.domain ||
          filter.difficulty ||
          filter.status ||
          filter.tag ? (
            <Text type="secondary">
              筛选后 <Text strong>{filteredTopics.length}</Text> 题
            </Text>
          ) : null}
        </Space>
        <Text type="secondary" style={{ fontSize: 13 }}>
          <ImportOutlined style={{ marginRight: 4 }} />
          需要更多辩题？可到「题库」页全局导入，再通过「题组管理」把它们加入本赛事绑定的题库。
        </Text>
      </div>

      <Divider style={{ margin: '8px 0 12px' }} />

      <Spin spinning={loading}>
        {topics.length === 0 ? (
          <Empty
            description="该赛事绑定的题库暂无辩题，可在「题库」页导入后加入，或通过「题组管理」绑定更多题库"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : filteredTopics.length === 0 ? (
          <Empty
            description="无符合搜索/筛选条件的辩题"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <List
            size="small"
            dataSource={filteredTopics}
            renderItem={(t) => (
              <List.Item>
                <Space wrap size={4}>
                  {t.drawn ? (
                    <Tag color="gold">已抽</Tag>
                  ) : (
                    <Tag color="green">未抽</Tag>
                  )}
                  <Text style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </Text>
                  {t.type && <Tag color="geekblue">{t.type}</Tag>}
                  {t.domain && <Tag color="purple">{t.domain}</Tag>}
                  {t.difficulty && <Tag color="cyan">{t.difficulty}</Tag>}
                  {(t.tags ?? []).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Spin>

      {/* 添加题库（多选未绑定者） */}
      <Modal
        title="添加题库"
        open={bindOpen}
        onCancel={() => setBindOpen(false)}
        onOk={handleBindOk}
        okText={`绑定所选（${bindSelected.length}）`}
        cancelText="取消"
        confirmLoading={bindSaving}
        okButtonProps={{ disabled: bindSelected.length === 0 }}
      >
        {bindCandidates.length === 0 ? (
          <Empty description="已绑定全部题库，或暂无全局题库可绑定" />
        ) : (
          <Checkbox.Group
            style={{ width: '100%' }}
            value={bindSelected}
            onChange={(vals) => setBindSelected(vals as string[])}
          >
            <Space direction="vertical" size={4} style={{ width: '100%', maxHeight: 300, overflow: 'auto' }}>
              {bindCandidates.map((g) => (
                <Checkbox key={g.id} value={g.id}>
                  {g.name}
                  {g.isDefault && <Tag style={{ marginLeft: 4 }} color="gold">默认题库</Tag>}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        )}
      </Modal>

      {/* T6 换库重复提醒：确认绑定后提示新库含本赛事已抽题（不阻断，仅告知） */}
      <Modal
        title="绑定完成 · 检测到已抽辩题"
        open={conflictModalOpen}
        onCancel={() => setConflictModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setConflictModalOpen(false)}>
            知道了
          </Button>
        }
        width={520}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`新增绑定题库中共有 ${bindConflictReport.total} 道题在本赛事已抽过。`}
          description="这些题能否再次抽取由「允许重复再抽」开关决定；本开关位于赛事题库页顶部，可随时调整。"
        />
        {bindConflictReport.conflicts.length > 0 && (
          <List
            size="small"
            dataSource={bindConflictReport.conflicts}
            renderItem={(c) => (
              <List.Item>
                <Space wrap size={4}>
                  <Tag color="gold">{c.groupName}</Tag>
                  <Text type="secondary">
                    含本赛事已抽 {c.count} 题
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Modal>

      {/* 整库复制 / 移动 到多目标题库 */}
      <TopicGroupTargetPicker
        open={wholeGroupOp !== null}
        title={wholeGroupOp?.mode === 'copy' ? '复制题库到…' : '移动题库到…'}
        description={
          wholeGroupOp
            ? `${wholeGroupOp.mode === 'copy' ? '复制' : '移动'}「${wholeGroupOp.group.name}」的全部题到以下题库（多选；同库自动跳过）`
            : undefined
        }
        groups={groups}
        disabledGroupIds={wholeGroupOp ? [wholeGroupOp.group.id] : []}
        confirmLoading={wholeGroupSaving}
        onCancel={() => setWholeGroupOp(null)}
        onConfirm={handleWholeGroupConfirm}
      />

      {/* 页内快捷新建辩题 */}
      <Modal
        title="新建辩题（写入全局题库并加入所选绑定题库）"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateOk}
        okText="新建并加入题库"
        cancelText="取消"
        confirmLoading={createSaving}
      >
        <Form layout="vertical">
          <Form.Item label="标题" required>
            <Input
              placeholder="请输入辩题标题"
              value={createForm.title}
              maxLength={200}
              onChange={(e) => setCreate({ title: e.target.value })}
            />
          </Form.Item>
          <Space size={8} style={{ width: '100%' }} align="start">
            <Form.Item label="类型" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="（可选）"
                value={createForm.type}
                options={candidateOf('type').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ type: v ?? undefined })}
              />
            </Form.Item>
            <Form.Item label="领域" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="（可选）"
                value={createForm.domain}
                options={candidateOf('domain').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ domain: v ?? undefined })}
              />
            </Form.Item>
            <Form.Item label="难度" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="（可选）"
                value={createForm.difficulty}
                options={candidateOf('difficulty').map((v) => ({ value: v, label: v }))}
                onChange={(v) => setCreate({ difficulty: v ?? undefined })}
              />
            </Form.Item>
          </Space>
          <Form.Item label="标签（多个用逗号分隔）">
            <Input
              placeholder="如：热点, 社会"
              value={createForm.tagsInput}
              onChange={(e) => setCreate({ tagsInput: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="添加到的绑定题库">
            <Select
              placeholder="选择本赛事绑定题库"
              value={createForm.targetGroupId}
              options={boundGroups.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(v) => setCreate({ targetGroupId: v })}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 选题模式配置 */}
      {event && (
        <EventBankConfigModal
          open={bankCfgOpen}
          onClose={() => setBankCfgOpen(false)}
          event={event}
          boundGroups={boundGroups}
          onSaved={() => void refresh()}
        />
      )}
    </Modal>
  );
}