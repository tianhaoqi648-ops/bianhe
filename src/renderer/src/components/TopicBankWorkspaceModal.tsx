import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  List,
  Tag,
  Space,
  Button,
  Typography,
  Spin,
  Empty,
  Input,
  Select,
  Checkbox,
  Popconfirm,
  Divider,
  Form,
  Alert,
  Tooltip
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  ExportOutlined,
  ImportOutlined,
  CopyOutlined,
  SwapOutlined,
  DeleteOutlined,
  BookOutlined,
  ReloadOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';
import type { TopicGroup, GroupTopic, Topic } from '../../../shared/types';
import { useTopicGroupStore } from '../stores/topicGroupStore';
import { useTopicGroupFileOps } from '../hooks/useTopicGroupFileOps';
import TopicGroupTargetPicker from './TopicGroupTargetPicker';
import GlobalTopicPickList from './GlobalTopicPickList';
import { useToast } from '../hooks/useToast';
import { filterEventTopics, type EventTopicFilter, type EventTopicItem } from '../utils/eventTopicBank';
import {
  workspaceImportTarget,
  candidatesForBankImport,
  moveOutCandidates
} from '../utils/topicBankWorkspace';

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
  tagsInput: ''
};

/**
 * 题库工作区下钻 Modal（T4）。
 *
 * 从题组管理点开某个题库进入，对该库完成：
 *   - 列表展示该库的题（groupAPI.listTopicsByGroup）
 *   - 关键词搜索 + 筛选（类型/领域/难度/状态/标签，复用 filterEventTopics 纯逻辑）
 *   - 加入 / 移出：把库内题移出（batchRemoveFromGroup）；把全局题库勾选的题加入本库（batchAddToGroups）
 *   - 导入：从全局题库勾选加入本库；把一个题库全部题复制/移动到本库（整库复制/移动）
 *   - 移到其他题库：把本库若干题或全部题移动到其它库（多选目标）
 *   - 页内新建：在该库内直接新建一道题（topicAPI.create → 写全局 topics → batchAddToGroups 加入本库）
 */
export default function TopicBankWorkspaceModal({
  open,
  group,
  onClose
}: {
  open: boolean;
  /** 当前工作区题库（null 时为空态） */
  group: TopicGroup | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const groups = useTopicGroupStore((s) => s.groups);
  const fetchGroups = useTopicGroupStore((s) => s.fetchGroups);
  const loadMemberMapping = useTopicGroupStore((s) => s.loadMemberMapping);
  const {
    addTopicsToGroups,
    removeTopicsFromGroup,
    moveSelectedTopicsToGroups,
    copyWholeGroupToGroups,
    moveWholeGroupToGroups
  } = useTopicGroupFileOps();

  const [members, setMembers] = useState<GroupTopic[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  // 全部全局辩题（用于「从全局题库勾选导入」候选）
  const [allTopics, setAllTopics] = useState<Topic[]>([]);

  // 搜索 / 筛选
  const [filter, setFilter] = useState<EventTopicFilter>({});
  // 当前勾选（用于移出 / 移动选中）
  const [selected, setSelected] = useState<string[]>([]);

  // 全局导入对话框
  const [globalOpen, setGlobalOpen] = useState(false);
  const [globalSelected, setGlobalSelected] = useState<string[]>([]);
  // 整库导入（把另一题库复制/移动到本库）
  const [wholeImport, setWholeImport] = useState<{ mode: 'copy' | 'move' } | null>(null);
  // 移出到其他题库
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [moveAllOpen, setMoveAllOpen] = useState(false);
  // 页内新建
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CREATE>({ ...EMPTY_CREATE });
  const [saving, setSaving] = useState(false);

  const groupId = group?.id ?? '';

  // 打开时：刷新题组列表 + 拉取全量全局辩题
  useEffect(() => {
    if (!open) return;
    void fetchGroups();
    window.topicAPI
      .list({ page: 1, pageSize: 100000 })
      .then((res) => {
        setAllTopics(res.success && res.data ? res.data.items : []);
      })
      .catch(() => setAllTopics([]));
  }, [open, fetchGroups]);

  // 打开 / 切换题库时拉取成员并重置筛选与选择
  const loadMembers = useCallback(async (gid: string) => {
    setMembersLoading(true);
    try {
      const res = await window.groupAPI.listTopicsByGroup(gid);
      setMembers(res.success && res.data ? res.data : []);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open || !groupId) {
      setMembers([]);
      return;
    }
    setFilter({});
    setSelected([]);
    void loadMembers(groupId);
  }, [open, groupId, loadMembers]);

  // 筛选候选值（从当前库题提取，随刷新更新）
  const candidateOf = useCallback(
    (key: 'type' | 'domain' | 'difficulty') => {
      const set = new Set<string>();
      for (const t of members) {
        const v = t[key];
        if (v) set.add(v);
      }
      return [...set].sort();
    },
    [members]
  );
  const candidateTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of members) for (const tag of t.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [members]);

  // 复用 filterEventTopics 纯逻辑：成员 → EventTopicItem（无赛事上下文，drawn 置 false）
  const filteredItems: EventTopicItem[] = useMemo(
    () => filterEventTopics(members.map((m) => ({ ...m, drawn: false })), filter),
    [members, filter]
  );

  // 从全局题库导入候选（剔除已是本库成员）
  const globalCandidates = useMemo(
    () => candidatesForBankImport(allTopics, members.map((m) => m.id)),
    [allTopics, members]
  );
  // 移出到其他题库的可选目标
  const moveOutTargets = useMemo(
    () => moveOutCandidates(groups, groupId),
    [groups, groupId]
  );
  const moveOutTargetGroups = useMemo(
    () => groups.filter((g) => moveOutTargets.includes(g.id)),
    [groups, moveOutTargets]
  );

  const refresh = async () => {
    if (groupId) await loadMembers(groupId);
  };

  // ---- 从全局题库导入（把勾选题加入本库） ----
  const openGlobal = () => {
    setGlobalSelected([]);
    setGlobalOpen(true);
  };
  const handleGlobalOk = async () => {
    if (!groupId) return;
    setSaving(true);
    try {
      const n = await addTopicsToGroups(globalSelected, workspaceImportTarget(groupId));
      toast.success(`已把 ${globalSelected.length} 道题加入本库（新增 ${n} 道）`);
      setGlobalOpen(false);
      setGlobalSelected([]);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  // ---- 整库导入：把另一个题库全部题复制 / 移动到本库 ----
  const handleWholeImportConfirm = async (sourceGroupIds: string[]) => {
    if (!wholeImport || !groupId) return;
    setSaving(true);
    try {
      const target = workspaceImportTarget(groupId);
      let total = 0;
      for (const srcId of sourceGroupIds) {
        if (srcId === groupId) continue;
        const results =
          wholeImport.mode === 'copy'
            ? await copyWholeGroupToGroups(srcId, target)
            : await moveWholeGroupToGroups(srcId, target);
        total += results.reduce((s, r) => s + r.added, 0);
      }
      toast.success(`已把 ${sourceGroupIds.length} 个题库${wholeImport.mode === 'copy' ? '复制' : '移动'}到本库（新增 ${total} 道）`);
      setWholeImport(null);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  // ---- 移出本库（移除选中；题目保留在全局题库与其他题组） ----
  const handleRemoveSelected = async () => {
    if (!groupId || selected.length === 0) return;
    setSaving(true);
    try {
      const n = await removeTopicsFromGroup(groupId, selected);
      toast.success(`已移出 ${n} 道题`);
      setSelected([]);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移出失败');
    } finally {
      setSaving(false);
    }
  };
  const handleRemoveOne = async (topicId: string) => {
    if (!groupId) return;
    const n = await removeTopicsFromGroup(groupId, [topicId]);
    toast.success(`已移出 ${n} 道题`);
    await refresh();
    void loadMemberMapping();
  };

  // ---- 移到其他题库（选中若干题 / 全部题） ----
  const openMoveOut = () => {
    if (selected.length === 0) {
      toast.warning('请先勾选要移动的题');
      return;
    }
    setMoveOutOpen(true);
  };
  const handleMoveOutConfirm = async (targetGroupIds: string[]) => {
    if (!groupId) return;
    setSaving(true);
    try {
      const ids = selected;
      const n = await moveSelectedTopicsToGroups(ids, targetGroupIds, groupId);
      toast.success(`已把 ${ids.length} 道题移动到目标题库（新增 ${n} 道）`);
      setMoveOutOpen(false);
      setSelected([]);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移动失败');
    } finally {
      setSaving(false);
    }
  };
  const handleMoveAllConfirm = async (targetGroupIds: string[]) => {
    if (!groupId) return;
    setSaving(true);
    try {
      const results = await moveWholeGroupToGroups(groupId, targetGroupIds);
      const added = results.reduce((s, r) => s + r.added, 0);
      toast.success(`已把本库全部题移动到 ${targetGroupIds.length} 个题库（新增 ${added} 道）`);
      setMoveAllOpen(false);
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移动失败');
    } finally {
      setSaving(false);
    }
  };

  // ---- 页内新建 ----
  const openCreate = () => {
    setCreateForm({ ...EMPTY_CREATE });
    setCreateOpen(true);
  };
  const setCreate = (patch: Partial<typeof EMPTY_CREATE>) =>
    setCreateForm((prev) => ({ ...prev, ...patch }));
  const handleCreateOk = async () => {
    if (!groupId) return;
    const title = createForm.title.trim();
    if (!title) {
      toast.warning('请输入辩题标题');
      return;
    }
    setSaving(true);
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
      // 写全局 topics 后加入本库
      await addTopicsToGroups([topicId], workspaceImportTarget(groupId));
      toast.success('已新建辩题并加入本库');
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      await refresh();
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const hasFilter = !!(
    filter.keyword ||
    filter.type ||
    filter.domain ||
    filter.difficulty ||
    filter.status ||
    filter.tag
  );

  return (
    <Modal
      title={
        <Space>
          <BookOutlined />
          <Text strong>题库工作区</Text>
          {group && (
            <>
              <ArrowRightOutlined style={{ color: 'rgba(128,128,128,0.5)' }} />
              <Text>{group.name}</Text>
              {group.isDefault && <Tag color="gold">默认题库</Tag>}
            </>
          )}
        </Space>
      }
      width={880}
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
        message="在「题库工作区」可搜索/筛选本库辩题，把全局辩题导入本库、把其他题库整库复制/移动进来，或将本库题移出、移动到其他题库，也可在本库内直接新建辩题。"
      />

      {/* 工具栏：搜索 + 筛选 + 主要操作 */}
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
          placeholder="搜索本库辩题标题"
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

      {/* 操作区 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(128,128,128,0.06)'
        }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建辩题
        </Button>
        <Tooltip title="从全局题库勾选若干题加入本库">
          <Button icon={<ImportOutlined />} onClick={openGlobal}>
            从全局导入
          </Button>
        </Tooltip>
        <Tooltip title="把一个题库的全部题复制/移动到本库">
          <Button icon={<CopyOutlined />} onClick={() => setWholeImport({ mode: 'copy' })}>
            导入题库(复制)
          </Button>
        </Tooltip>
        <Tooltip title="把一个题库的全部题移动到本库">
          <Button icon={<SwapOutlined />} onClick={() => setWholeImport({ mode: 'move' })}>
            导入题库(移动)
          </Button>
        </Tooltip>
        <Divider type="vertical" style={{ height: 24 }} />
        <Popconfirm
          title="移出选中的题？"
          description="题目保留在全局题库与其他题组"
          okText="移出"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={selected.length === 0}
          onConfirm={() => void handleRemoveSelected()}
        >
          <Button danger icon={<DeleteOutlined />} disabled={selected.length === 0}>
            移出选中（{selected.length}）
          </Button>
        </Popconfirm>
        <Tooltip title="把本库勾选的题移到其他题库">
          <Button icon={<ExportOutlined />} disabled={selected.length === 0} onClick={openMoveOut}>
            移动选中到…
          </Button>
        </Tooltip>
        <Tooltip title="把本库全部题移到其他题库">
          <Button
            icon={<SwapOutlined />}
            disabled={members.length === 0 || moveOutTargetGroups.length === 0}
            onClick={() => setMoveAllOpen(true)}
          >
            移动全部到…
          </Button>
        </Tooltip>
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
        <Text type="secondary">
          共 <Text strong>{members.length}</Text> 题
          {hasFilter && (
            <>
              {' '}
              · 筛选后 <Text strong>{filteredItems.length}</Text> 题
            </>
          )}
        </Text>
      </div>

      <Divider style={{ margin: '8px 0 12px' }} />

      {/* 列表 */}
      <Spin spinning={membersLoading}>
        {members.length === 0 ? (
          <Empty
            description="本库暂无辩题，可「从全局导入」或「新建辩题」"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : filteredItems.length === 0 ? (
          <Empty description="无符合搜索/筛选条件的辩题" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Checkbox.Group
            style={{ width: '100%' }}
            value={selected}
            onChange={(vals) => setSelected(vals as string[])}
          >
            <List
              size="small"
              dataSource={filteredItems}
              locale={{ emptyText: <Empty /> }}
              renderItem={(t) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="rm"
                      title="移出该题？"
                      okText="移出"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleRemoveOne(t.id)}
                    >
                      <Button danger type="text" size="small">
                        移出
                      </Button>
                    </Popconfirm>
                  ]}
                >
                  <Space size={6} style={{ width: '100%' }}>
                    <Checkbox value={t.id} />
                    <Text
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {t.status === 'favorited' ? '★ ' : ''}
                      {t.status === 'blacklisted' ? (
                        <Text type="secondary" delete>
                          {t.title}
                        </Text>
                      ) : (
                        t.title
                      )}
                    </Text>
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
        )}
      </Spin>

      {/* 从全局题库导入 */}
      <Modal
        title={`把全局辩题加入「${group?.name ?? ''}」`}
        open={globalOpen}
        onCancel={() => setGlobalOpen(false)}
        onOk={() => void handleGlobalOk()}
        okText={`加入所选（${globalSelected.length}）`}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: globalSelected.length === 0 }}
      >
        {globalCandidates.length === 0 ? (
          <Empty description="全局辩题都已在本库，或暂无全局辩题" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <GlobalTopicPickList
            topics={globalCandidates}
            selected={globalSelected}
            onChange={setGlobalSelected}
            multiple
          />
        )}
      </Modal>

      {/* 整库导入：把另一题库复制/移动到本库 */}
      <TopicGroupTargetPicker
        open={wholeImport !== null}
        title={wholeImport?.mode === 'copy' ? '导入题库到本库（复制）…' : '导入题库到本库（移动）…'}
        description={
          wholeImport
            ? `把下列题库的全部题${wholeImport.mode === 'copy' ? '复制' : '移动'}到「${group?.name ?? ''}」`
            : undefined
        }
        groups={groups}
        disabledGroupIds={groupId ? [groupId] : []}
        confirmLoading={saving}
        onCancel={() => setWholeImport(null)}
        onConfirm={handleWholeImportConfirm}
      />

      {/* 移动选中到其他题库 */}
      <TopicGroupTargetPicker
        open={moveOutOpen}
        title="移动选中题到…"
        description={`把本库勾选的 ${selected.length} 道题加入以下目标题库，并从本库移除`}
        groups={moveOutTargetGroups}
        confirmLoading={saving}
        onCancel={() => setMoveOutOpen(false)}
        onConfirm={handleMoveOutConfirm}
      />

      {/* 移动全部到其他题库 */}
      <TopicGroupTargetPicker
        open={moveAllOpen}
        title="移动本库全部题到…"
        description={`把本库全部 ${members.length} 道题移动到以下目标题库（可多选）`}
        groups={moveOutTargetGroups}
        confirmLoading={saving}
        onCancel={() => setMoveAllOpen(false)}
        onConfirm={handleMoveAllConfirm}
      />

      {/* 页内新建辩题 */}
      <Modal
        title="新建辩题（写入全局题库并加入本库）"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreateOk()}
        okText="新建并加入本库"
        cancelText="取消"
        confirmLoading={saving}
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
        </Form>
      </Modal>
    </Modal>
  );
}