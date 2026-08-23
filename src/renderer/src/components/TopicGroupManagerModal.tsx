import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  List,
  Button,
  Space,
  Tag,
  Tooltip,
  Input,
  Empty,
  Typography,
  Popconfirm,
  Divider,
  Alert,
  Spin
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InboxOutlined,
  CopyOutlined,
  SwapOutlined,
  FolderOpenOutlined
} from '@ant-design/icons';
import { useTopicGroupStore, canDeleteTopicGroup } from '../stores/topicGroupStore';
import { useTopicGroupFileOps } from '../hooks/useTopicGroupFileOps';
import TopicGroupTargetPicker from './TopicGroupTargetPicker';
import TopicBankWorkspaceModal from './TopicBankWorkspaceModal';
import GlobalTopicPickList from './GlobalTopicPickList';
import { useToast } from '../hooks/useToast';
import type { TopicGroup, GroupTopic, Topic } from '../../../shared/types';

const { Text } = Typography;

/**
 * 题组管理（题库）Modal（赛事题库 T3）。
 *
 * 能力：
 *   - 题组列表（默认题库置前，带「默认题库」标记）
 *   - 新建 / 重命名 / 删除题组（默认题库不可删除：禁用 + 提示）
 *   - 查看某题组成员（window.groupAPI.listTopicsByGroup）
 *   - 把全局辩题加入某题组（多选：window.groupAPI.addTopicsToGroup）
 */
export default function TopicGroupManagerModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const groups = useTopicGroupStore((s) => s.groups);
  const groupsLoading = useTopicGroupStore((s) => s.loading);
  const fetchGroups = useTopicGroupStore((s) => s.fetchGroups);
  const createGroup = useTopicGroupStore((s) => s.createGroup);
  const renameGroup = useTopicGroupStore((s) => s.renameGroup);
  const deleteGroup = useTopicGroupStore((s) => s.deleteGroup);
  const loadMemberMapping = useTopicGroupStore((s) => s.loadMemberMapping);
  const { copyWholeGroupToGroups, moveWholeGroupToGroups } = useTopicGroupFileOps();

  // 当前选中题组
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  // 题库工作区（T4）：点开某题库进入其工作区
  const [workspaceGroup, setWorkspaceGroup] = useState<TopicGroup | null>(null);
  const [members, setMembers] = useState<GroupTopic[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  // 全部全局辩题（用于「加入题组」多选）
  const [allTopics, setAllTopics] = useState<Topic[]>([]);

  // 整库复制 / 移动 目标选择
  const [wholeGroupOp, setWholeGroupOp] = useState<
    { mode: 'copy' | 'move'; group: TopicGroup } | null
  >(null);
  const [wholeGroupSaving, setWholeGroupSaving] = useState(false);

  // 新建 / 重命名对话框
  const [nameDialog, setNameDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; group: TopicGroup } | null
  >(null);
  const [nameInput, setNameInput] = useState('');

  // 「加入辩题」多选对话框
  const [addOpen, setAddOpen] = useState(false);
  const [addCandidates, setAddCandidates] = useState<Topic[]>([]);
  const [addSelected, setAddSelected] = useState<string[]>([]);
  const [addSaving, setAddSaving] = useState(false);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  // 打开时：刷新题组列表 + 拉取全量全局辩题
  useEffect(() => {
    if (!open) return;
    void fetchGroups();
    window.topicAPI
      .list({ page: 1, pageSize: 100000 })
      .then((res) => {
        if (res.success && res.data) setAllTopics(res.data.items);
        else setAllTopics([]);
      })
      .catch(() => setAllTopics([]));
  }, [open, fetchGroups]);

  // 默认选中第一个题组（默认题库在前）
  useEffect(() => {
    if (open && groups.length > 0 && !groups.some((g) => g.id === activeGroupId)) {
      setActiveGroupId(groups[0].id);
    }
  }, [open, groups, activeGroupId]);

  // 拉取当前题组成员
  const loadMembers = useCallback(async (groupId: string) => {
    setMembersLoading(true);
    try {
      const res = await window.groupAPI.listTopicsByGroup(groupId);
      setMembers(res.success && res.data ? res.data : []);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open || !activeGroupId) {
      setMembers([]);
      return;
    }
    void loadMembers(activeGroupId);
  }, [open, activeGroupId, loadMembers]);

  // ---- 新建 / 重命名 ----
  const openCreate = () => {
    setNameDialog({ mode: 'create' });
    setNameInput('');
  };
  const openRename = (g: TopicGroup) => {
    setNameDialog({ mode: 'rename', group: g });
    setNameInput(g.name);
  };
  const handleNameOk = async () => {
    const name = nameInput.trim();
    if (!name || !nameDialog) return;
    if (nameDialog.mode === 'create') {
      const g = await createGroup(name);
      if (g) {
        toast.success('题组已创建');
        setActiveGroupId(g.id);
      } else {
        toast.error(useTopicGroupStore.getState().error ?? '创建失败');
      }
    } else {
      const ok = await renameGroup(nameDialog.group.id, name);
      if (ok) toast.success('已重命名');
      else toast.error(useTopicGroupStore.getState().error ?? '重命名失败');
    }
    setNameDialog(null);
  };

  // ---- 删除 ----
  const handleDelete = async (g: TopicGroup) => {
    const ok = await deleteGroup(g.id);
    if (ok) {
      toast.success('题组已删除');
      if (activeGroupId === g.id) setActiveGroupId(null);
    } else {
      toast.error(useTopicGroupStore.getState().error ?? '删除失败');
    }
  };

  // ---- 加入辩题（多选） ----
  const openAdd = () => {
    if (!activeGroup) return;
    const memberIds = new Set(members.map((m) => m.id));
    setAddCandidates(allTopics.filter((t) => !memberIds.has(t.id)));
    setAddSelected([]);
    setAddOpen(true);
  };
  const handleAddOk = async () => {
    if (!activeGroup) return;
    setAddSaving(true);
    try {
      const res = await window.groupAPI.addTopicsToGroup({
        groupId: activeGroup.id,
        topicIds: addSelected
      });
      if (res.success) {
        toast.success(`已加入 ${res.data ?? 0} 道辩题`);
        await loadMembers(activeGroup.id);
      } else {
        toast.error(res.error ?? '添加失败');
      }
    } finally {
      setAddSaving(false);
      setAddOpen(false);
    }
  };

  // ---- 移除成员 ----
  const handleRemoveTopic = async (topicId: string) => {
    if (!activeGroup) return;
    const res = await window.groupAPI.removeTopicsFromGroup({
      groupId: activeGroup.id,
      topicIds: [topicId]
    });
    if (res.success) {
      toast.success('已移除');
      await loadMembers(activeGroup.id);
    } else {
      toast.error(res.error ?? '移除失败');
    }
  };

  // ---- 整库复制 / 移动（文件式：把一个题库全部题复制/移动到多目标库） ----
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
      // 刷新：本地当前组 + 全量成员映射（供题库页徽标/筛选同步）
      await loadMembers(src.id);
      void loadMemberMapping();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setWholeGroupSaving(false);
    }
  };

  return (
    <>
      <Modal
        title="题组管理（题库）"
        width={900}
        open={open}
        onCancel={onClose}
        footer={null}
        centered
        bodyStyle={{
          padding: 16,
          maxHeight: 'calc(100vh - 180px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, flexShrink: 0 }}
          message="题组是可复用的全局题库，可绑定到多个赛事；新赛事会自动绑定「默认题库」。"
        />
        <div style={{ display: 'flex', gap: 16, minWidth: 0, minHeight: 0, flex: 1 }}>
          {/* 左侧：题组列表 */}
          <div style={{ width: 300, flexShrink: 0, overflow: 'auto', minWidth: 0, borderRight: '1px solid rgba(128,128,128,0.15)', paddingRight: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>题组列表</Text>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建
              </Button>
            </div>
            <Spin spinning={groupsLoading}>
              <List
                size="small"
                dataSource={groups}
                locale={{ emptyText: <Empty description="暂无题组" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                renderItem={(g) => {
                  const deletable = canDeleteTopicGroup(g);
                  const selected = g.id === activeGroupId;
                  return (
                    <List.Item
                      style={{
                        cursor: 'pointer',
                        padding: '8px 6px',
                        borderRadius: 6,
                        background: selected ? 'rgba(22,119,255,0.08)' : 'transparent'
                      }}
                      onClick={() => setActiveGroupId(g.id)}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6, width: '100%' }}>
                        <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                          <span>{g.name}</span>
                          {g.isDefault && <Tag color="gold">默认题库</Tag>}
                        </span>
                        <Space wrap size={2} style={{ flexShrink: 0 }}>
                          <Button
                            key="enter"
                            type="text"
                            size="small"
                            icon={<FolderOpenOutlined />}
                            title="进入该题库工作区"
                            onClick={(e) => {
                              e.stopPropagation();
                              setWorkspaceGroup(g);
                            }}
                          />
                          <Button
                            key="rename"
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              openRename(g);
                            }}
                          />
                          {deletable ? (
                            <Popconfirm
                              key="del"
                              title="删除该题组？"
                              description="将同时移除其成员与赛事绑定关系。"
                              okText="删除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => void handleDelete(g)}
                              onCancel={() => undefined}
                            >
                              <Button
                                danger
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Popconfirm>
                          ) : (
                            <Tooltip key="del" title="默认题库不可删除">
                              <Button
                                danger
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                disabled
                              />
                            </Tooltip>
                          )}
                        </Space>
                      </div>
                    </List.Item>
                  );
                }}
              />
            </Spin>
          </div>

          {/* 右侧：成员查看 / 加入辩题 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeGroup ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', marginBottom: 8 }}>
                  <Space wrap>
                    <Text strong>{activeGroup.name}</Text>
                    {activeGroup.isDefault && <Tag color="gold">默认题库</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      共 {members.length} 题
                    </Text>
                  </Space>
                  <Space wrap size={4} style={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<FolderOpenOutlined />}
                      onClick={() => setWorkspaceGroup(activeGroup)}
                    >
                      进入工作区
                    </Button>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => setWholeGroupOp({ mode: 'copy', group: activeGroup })}
                    >
                      复制题库到…
                    </Button>
                    <Button
                      size="small"
                      icon={<SwapOutlined />}
                      onClick={() => setWholeGroupOp({ mode: 'move', group: activeGroup })}
                    >
                      移动题库到…
                    </Button>
                    <Button size="small" icon={<InboxOutlined />} onClick={openAdd}>
                      加入辩题
                    </Button>
                  </Space>
                </div>
                <Divider style={{ margin: '8px 0 12px' }} />
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Spin spinning={membersLoading}>
                    {members.length === 0 ? (
                      <Empty description="该题组暂无辩题，点击「加入辩题」从全局题库添加" />
                    ) : (
                    <List
                      size="small"
                      dataSource={members}
                      locale={{ emptyText: <Empty /> }}
                      renderItem={(t) => (
                        <List.Item
                          actions={[
                            <Popconfirm
                              key="rm"
                              title="移除该辩题？"
                              okText="移除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => void handleRemoveTopic(t.id)}
                            >
                              <Button danger type="text" size="small">
                                移除
                              </Button>
                            </Popconfirm>
                          ]}
                        >
                          <Text style={{ wordBreak: 'break-word' }}>
                            {t.title}
                          </Text>
                        </List.Item>
                      )}
                    />
                  )}
                </Spin>
                </div>
              </>
            ) : (
              <Empty description="请选择左侧一个题组" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </div>
      </Modal>

      {/* 新建 / 重命名题组 */}
      <Modal
        title={nameDialog?.mode === 'rename' ? '重命名题组' : '新建题组'}
        open={nameDialog !== null}
        onCancel={() => setNameDialog(null)}
        onOk={handleNameOk}
        okText="确定"
        cancelText="取消"
      >
        <Input
          placeholder="请输入题组名称"
          value={nameInput}
          maxLength={50}
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={handleNameOk}
          autoFocus
        />
      </Modal>

      {/* 加入辩题（多选） */}
      <Modal
        title={`把全局辩题加入「${activeGroup?.name ?? ''}」`}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAddOk}
        okText={`加入所选（${addSelected.length}）`}
        cancelText="取消"
        confirmLoading={addSaving}
        okButtonProps={{ disabled: addSelected.length === 0 }}
      >
        {addCandidates.length === 0 ? (
          <Empty description="全局辩题都已在该题组，或暂无全局辩题" />
        ) : (
          <GlobalTopicPickList
            topics={addCandidates}
            selected={addSelected}
            onChange={setAddSelected}
            multiple
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

      {/* 题库工作区下钻（T4）：点开某题库进入其工作区 */}
      <TopicBankWorkspaceModal
        open={workspaceGroup !== null}
        group={workspaceGroup}
        onClose={() => setWorkspaceGroup(null)}
      />
    </>
  );
}