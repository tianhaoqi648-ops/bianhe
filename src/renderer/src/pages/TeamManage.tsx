import { useEffect, useState, useMemo } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Modal,
  Typography,
  Tag,
  Card,
  Input,
  Select,
  Popconfirm,
  Segmented,
  Row,
  Col,
  Collapse,
  Form,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BrandSpin from '../components/common/BrandSpin';
import EmptyState from '../components/common/EmptyState';
import AccentCard from '../components/common/AccentCard';
import PageHeader from '../components/common/PageHeader';
import {
  TeamOutlined,
  ReloadOutlined,
  SearchOutlined,
  CalendarOutlined,
  DeleteOutlined,
  PlusOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  EditOutlined,
  GroupOutlined
} from '@ant-design/icons';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  Event,
  Team,
  TeamGroup,
  TeamHistory,
  TeamCreateInput,
  TeamUpdateInput
} from '../../../shared/types';
import TeamHistoryModal from '../components/TeamHistoryModal';
import TeamEditModal from '../components/TeamEditModal';
import {
  cardStyle,
  primaryButtonStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing, transition, fontSize } from '../styles/tokens';
import { useToast } from '../hooks/useToast';

const { Content } = Layout;
const { Text } = Typography;

// 扁平化后的队伍视图项
interface TeamView {
  team: Team;
  eventName: string;
  groupName: string | null;
  historyCount: number;
}

// 历史辩题数 Tag 颜色：≥5 红、1-4 橙、0 灰
function getHistoryCountTag(n: number) {
  if (n >= 5) return <Tag color="red">{n}</Tag>;
  if (n >= 1) return <Tag color="orange">{n}</Tag>;
  return <Tag color="default">0</Tag>;
}

export default function TeamManage() {
  const { token } = theme.useToken();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const toast = useToast();

  // 全部赛事（用于拉取各赛事下的队伍）
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  // 全部队伍（扁平化）
  const [allTeams, setAllTeams] = useState<TeamView[]>([]);
  // 各赛事的分组缓存：eventId -> groups
  const [groupsByEvent, setGroupsByEvent] = useState<Record<string, TeamGroup[]>>({});
  // 各队伍历史辩题数量缓存
  const [historyMap, setHistoryMap] = useState<Record<string, TeamHistory[]>>({});
  // 加载状态
  const [loading, setLoading] = useState(false);
  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterEventId, setFilterEventId] = useState<string | undefined>(undefined);
  // 分组筛选：'__none__' = 未分组；undefined = 全部分组
  const [filterGroupId, setFilterGroupId] = useState<string | undefined>(undefined);
  // 视图切换：list = 卡片网格视图，group = 按赛事分组视图，table = 表格视图（支持批量分配）
  const [viewMode, setViewMode] = useState<'list' | 'group' | 'table'>('list');

  // 弹窗
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);
  const [currentHistory, setCurrentHistory] = useState<TeamHistory[]>([]);
  // 添加/编辑队伍弹窗（无 event 上下文）
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  // 编辑模式下的队伍（null 表示新建模式）
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // 批量导入弹窗
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchEventId, setBatchEventId] = useState<string | undefined>(undefined);
  const [batchImporting, setBatchImporting] = useState(false);

  // 批量分配分组（仅当筛选了赛事时启用）
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [batchAssignGroupId, setBatchAssignGroupId] = useState<string | null | undefined>(undefined);
  const [batchAssigning, setBatchAssigning] = useState(false);

  // ====== 数据加载 ======
  const loadAll = async () => {
    setLoading(true);
    try {
      const events = await eventStore.listEvents();
      setAllEvents(events);

      // 拉取每个赛事下的队伍 + 分组
      const [teamsByEvent, groupsByEventRes] = await Promise.all([
        Promise.all(events.map((e) => window.eventAPI.listTeamsByEvent(e.id))),
        Promise.all(events.map((e) => window.eventAPI.listGroups(e.id)))
      ]);
      // 分组缓存：eventId -> TeamGroup[]
      const newGroupsMap: Record<string, TeamGroup[]> = {};
      events.forEach((e, idx) => {
        const gres = groupsByEventRes[idx];
        if (gres.success && gres.data) {
          newGroupsMap[e.id] = gres.data as TeamGroup[];
        } else {
          newGroupsMap[e.id] = [];
        }
      });
      setGroupsByEvent(newGroupsMap);

      const teamList: TeamView[] = [];
      const historyPromises: Promise<void>[] = [];
      const newHistoryMap: Record<string, TeamHistory[]> = {};
      events.forEach((e, idx) => {
        const res = teamsByEvent[idx];
        if (res.success && res.data) {
          const teams = res.data as Team[];
          const groups = newGroupsMap[e.id] ?? [];
          teams.forEach((t) => {
            const g = t.group_id ? groups.find((x) => x.id === t.group_id) : null;
            teamList.push({
              team: t,
              eventName: e.name,
              groupName: g ? g.name : null,
              historyCount: 0
            });
            // 拉取每个队伍的历史辩题
            historyPromises.push(
              (async () => {
                const hres = await window.eventAPI.listTeamHistory(t.id);
                if (hres.success && hres.data) {
                  newHistoryMap[t.id] = hres.data as TeamHistory[];
                }
              })()
            );
          });
        }
      });
      await Promise.all(historyPromises);
      setHistoryMap(newHistoryMap);
      // 更新历史数量
      setAllTeams(
        teamList.map((tv) => ({
          ...tv,
          historyCount: newHistoryMap[tv.team.id]?.length ?? 0
        }))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // 拉取题库候选
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== 筛选 ======
  const filteredTeams = useMemo(() => {
    let list = allTeams;
    if (filterEventId) {
      list = list.filter((tv) => tv.team.event_id === filterEventId);
    }
    if (filterGroupId !== undefined) {
      if (filterGroupId === '__none__') {
        list = list.filter((tv) => !tv.team.group_id);
      } else {
        list = list.filter((tv) => tv.team.group_id === filterGroupId);
      }
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (tv) =>
          tv.team.name.toLowerCase().includes(kw) ||
          tv.eventName.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [allTeams, keyword, filterEventId, filterGroupId]);

  // 当前筛选赛事下的分组列表（用于分组筛选下拉与批量分配下拉）
  const groupsInFilter = useMemo<TeamGroup[]>(() => {
    if (!filterEventId) return [];
    return groupsByEvent[filterEventId] ?? [];
  }, [filterEventId, groupsByEvent]);

  // TeamEditModal 使用的分组列表：编辑模式下取该队伍所属赛事的分组；创建模式下跨赛事不显示分组选择器
  const teamModalGroupOptions = useMemo<TeamGroup[]>(() => {
    if (editingTeam) {
      return groupsByEvent[editingTeam.event_id] ?? [];
    }
    return [];
  }, [editingTeam, groupsByEvent]);

  // 切换赛事筛选时重置分组筛选
  useEffect(() => {
    setFilterGroupId(undefined);
  }, [filterEventId]);

  // 按赛事分组
  const groupedTeams = useMemo(() => {
    const map = new Map<string, { event: Event; teams: TeamView[] }>();
    allEvents.forEach((e) => {
      const teams = filteredTeams.filter((tv) => tv.team.event_id === e.id);
      if (teams.length > 0) {
        map.set(e.id, { event: e, teams });
      }
    });
    return Array.from(map.values());
  }, [allEvents, filteredTeams]);

  const eventOptions = useMemo(
    () => allEvents.map((e) => ({ id: e.id, name: e.name })),
    [allEvents]
  );

  // ====== 操作 ======
  // 打开编辑队伍弹窗：预填该队伍信息
  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamModalOpen(true);
  };

  const handleManageHistory = (team: Team) => {
    setHistoryTeam(team);
    setCurrentHistory(historyMap[team.id] ?? []);
    setHistoryModalOpen(true);
  };

  const handleAddHistory = async (data: {
    team_id: string;
    topic_id: string;
    event_id: string;
    played_at?: string | null;
  }) => {
    const res = await window.eventAPI.addTeamHistory(data);
    if (!res.success) throw new Error(res.error || '添加失败');
    // 刷新该队伍历史
    const list = await window.eventAPI.listTeamHistory(data.team_id);
    if (list.success && list.data) {
      const arr = list.data as TeamHistory[];
      setCurrentHistory(arr);
      setHistoryMap((m) => ({ ...m, [data.team_id]: arr }));
      // 更新列表中的 historyCount
      setAllTeams((all) =>
        all.map((tv) =>
          tv.team.id === data.team_id ? { ...tv, historyCount: arr.length } : tv
        )
      );
    }
  };

  const handleDeleteHistory = async (id: string) => {
    if (!historyTeam) return;
    const res = await window.eventAPI.deleteTeamHistory(id);
    if (!res.success) throw new Error(res.error || '删除失败');
    const list = await window.eventAPI.listTeamHistory(historyTeam.id);
    if (list.success && list.data) {
      const arr = list.data as TeamHistory[];
      setCurrentHistory(arr);
      setHistoryMap((m) => ({ ...m, [historyTeam.id]: arr }));
      setAllTeams((all) =>
        all.map((tv) =>
          tv.team.id === historyTeam.id ? { ...tv, historyCount: arr.length } : tv
        )
      );
    }
  };

  // 删除队伍
  const handleDeleteTeam = (team: Team) => {
    Modal.confirm({
      title: `确认删除队伍"${team.name}"？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.eventAPI.deleteTeam(team.id);
          toast.success('队伍已删除');
          await loadAll();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // 添加/编辑队伍提交（无 event 上下文，新建时由 TeamEditModal 内部选赛事）
  const handleSubmitTeam = async (
    data: TeamCreateInput | TeamUpdateInput,
    isEdit: boolean
  ) => {
    try {
      if (isEdit && editingTeam) {
        const res = await window.eventAPI.updateTeam(
          editingTeam.id,
          data as TeamUpdateInput
        );
        if (!res.success) throw new Error(res.error || '更新失败');
        toast.success('队伍已更新');
      } else {
        const createData = data as TeamCreateInput;
        const res = await window.eventAPI.createTeam(createData);
        if (!res.success) throw new Error(res.error || '添加失败');
        toast.success('队伍已添加');
      }
      setTeamModalOpen(false);
      setEditingTeam(null);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  // "保存并继续"回调：连续添加多支队伍，不关闭弹窗
  const handleContinueCreate = async (data: TeamCreateInput) => {
    const res = await window.eventAPI.createTeam(data);
    if (!res.success) throw new Error(res.error || '创建失败');
    toast.success(`已添加：${data.name}`);
    await loadAll();
  };

  // ====== 批量导入 ======
  const handleOpenBatch = () => {
    setBatchEventId(allEvents[0]?.id);
    setBatchText('');
    setBatchModalOpen(true);
  };

  const handleBatchImport = async () => {
    if (!batchEventId) {
      toast.error('请选择所属赛事');
      return;
    }
    const lines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error('请输入至少一支队伍名');
      return;
    }
    setBatchImporting(true);
    let success = 0;
    let fail = 0;
    for (const name of lines) {
      try {
        const res = await window.eventAPI.createTeam({ name, event_id: batchEventId });
        if (res.success) success++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBatchImporting(false);
    setBatchModalOpen(false);
    setBatchText('');
    toast.success(`导入完成：成功 ${success} 支，失败 ${fail} 支`);
    await loadAll();
  };

  // ====== 队伍分组分配 ======
  // 单支队伍分配到分组（行内 Select，使用该队伍所属赛事的分组列表）
  const handleAssignTeamGroup = async (teamId: string, groupId: string | null) => {
    try {
      const res = await window.eventAPI.assignTeamToGroup(teamId, groupId);
      if (!res.success) throw new Error(res.error || '分配失败');
      toast.success('分组已更新');
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分配失败');
    }
  };

  // 批量分配选中队伍到分组（要求先选赛事筛选 + 至少选 1 支队伍 + 选目标分组）
  const handleBatchAssignGroup = async () => {
    if (!filterEventId) {
      toast.error('请先按赛事筛选后再批量分配');
      return;
    }
    if (selectedTeamIds.length === 0) {
      toast.error('请先勾选要分配的队伍');
      return;
    }
    if (batchAssignGroupId === undefined) {
      toast.error('请选择目标分组');
      return;
    }
    setBatchAssigning(true);
    try {
      for (const tid of selectedTeamIds) {
        const res = await window.eventAPI.assignTeamToGroup(tid, batchAssignGroupId);
        if (!res.success) throw new Error(res.error || '分配失败');
      }
      toast.success(`已分配 ${selectedTeamIds.length} 支队伍`);
      setSelectedTeamIds([]);
      setBatchAssignGroupId(undefined);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量分配失败');
    } finally {
      setBatchAssigning(false);
    }
  };

  // 表格列（保留 Table 作为分组视图内部的可选展示方式）
  const columns: ColumnsType<TeamView> = [
    {
      title: '队伍名称',
      dataIndex: ['team', 'name'],
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: '所属赛事',
      dataIndex: 'eventName',
      key: 'eventName',
      render: (name: string) => <Tag color="blue">{name}</Tag>
    },
    {
      title: '所属分组',
      key: 'groupName',
      render: (_: any, record: TeamView) => {
        const groups = groupsByEvent[record.team.event_id] ?? [];
        return (
          <Select
            size="small"
            allowClear
            placeholder="未分组"
            value={record.team.group_id ?? undefined}
            onChange={(v) => handleAssignTeamGroup(record.team.id, v ?? null)}
            style={{ width: 150 }}
            options={groups.map((g) => ({ label: g.name, value: g.id }))}
            notFoundContent={<Text type="secondary">暂无分组</Text>}
          />
        );
      }
    },
    {
      title: '历史辩题数',
      dataIndex: 'historyCount',
      key: 'historyCount',
      width: 110,
      sorter: (a, b) => a.historyCount - b.historyCount,
      render: (n: number) => getHistoryCountTag(n)
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: any, record: TeamView) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<CalendarOutlined />}
            onClick={() => handleManageHistory(record.team)}
          >
            查看历史辩题
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditTeam(record.team)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该队伍？"
            onConfirm={() => handleDeleteTeam(record.team)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  // ====== 渲染：队伍卡片 ======
  const renderTeamCard = (tv: TeamView, index: number) => (
    <Col xs={24} sm={12} md={8} lg={6} key={tv.team.id}>
      <Card
        size="small"
        hoverable
        className={index < 8 ? 'fade-in-up-staggered' : undefined}
        style={{
          ...cardStyle,
          minHeight: '100%',
          transition: transition.base,
          ...(index < 8 ? ({ '--i': index } as React.CSSProperties) : {})
        }}
        styles={{ body: { padding: spacing.lg } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
          <Text strong style={{ fontSize: fontSize.h4, flex: 1, marginRight: spacing.sm }} ellipsis={{ tooltip: tv.team.name }}>
            {tv.team.name}
          </Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md, flexWrap: 'wrap', gap: 4 }}>
          <Space size={4} wrap>
            <Tag color="blue">{tv.eventName}</Tag>
            {tv.groupName ? (
              <Tag color="purple" icon={<GroupOutlined />}>{tv.groupName}</Tag>
            ) : (
              <Tag>未分组</Tag>
            )}
          </Space>
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: fontSize.caption }}>历史</Text>
            {getHistoryCountTag(tv.historyCount)}
          </Space>
        </div>
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<CalendarOutlined />}
            onClick={() => handleManageHistory(tv.team)}
          >
            历史辩题
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditTeam(tv.team)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该队伍？"
            onConfirm={() => handleDeleteTeam(tv.team)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </Card>
    </Col>
  );

  return (
    <>
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, padding: '0 16px 16px', overflow: 'auto' }}>
          <PageHeader
            title="队伍管理"
            subtitle="维护参赛队伍信息"
            extra={
              <Space>
                <Tag color="blue">共 {filteredTeams.length} 支</Tag>
                <Segmented
                  value={viewMode}
                  onChange={(v) => setViewMode(v as 'list' | 'group' | 'table')}
                  options={[
                    { label: '列表视图', value: 'list', icon: <AppstoreOutlined /> },
                    { label: '分组视图', value: 'group', icon: <UnorderedListOutlined /> },
                    { label: '表格视图', value: 'table', icon: <UnorderedListOutlined /> }
                  ]}
                  size="small"
                />
                <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
                  刷新
                </Button>
                <Button icon={<TeamOutlined />} onClick={handleOpenBatch}>
                  批量导入
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingTeam(null);
                    setTeamModalOpen(true);
                  }}
                  style={primaryButtonStyle}
                >
                  添加队伍
                </Button>
              </Space>
            }
          />

          {/* 筛选条 */}
          <Card size="small" style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}>
            <Space wrap>
              <Input
                allowClear
                size="middle"
                placeholder="搜索队伍名称 / 赛事名称"
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ width: 280 }}
              />
              <Select
                allowClear
                placeholder="按赛事筛选"
                style={{ width: 200 }}
                value={filterEventId}
                onChange={(v) => setFilterEventId(v)}
                options={eventOptions.map((e) => ({ label: e.name, value: e.id }))}
              />
              <Select
                allowClear
                placeholder="按分组筛选"
                style={{ width: 180 }}
                value={filterGroupId}
                onChange={(v) => setFilterGroupId(v)}
                disabled={!filterEventId || groupsInFilter.length === 0}
                options={[
                  { label: '未分组', value: '__none__' },
                  ...groupsInFilter.map((g) => ({ label: g.name, value: g.id }))
                ]}
              />
              {filterEventId && selectedTeamIds.length > 0 && (
                <Space>
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                    已选 {selectedTeamIds.length} 支
                  </Text>
                  <Select
                    allowClear
                    placeholder="选择目标分组"
                    style={{ width: 180 }}
                    value={batchAssignGroupId ?? undefined}
                    onChange={(v) => setBatchAssignGroupId(v ?? undefined)}
                    options={groupsInFilter.map((g) => ({ label: g.name, value: g.id }))}
                  />
                  <Popconfirm
                    title="确认批量分配分组？"
                    onConfirm={handleBatchAssignGroup}
                    okText="分配"
                    okType="primary"
                    cancelText="取消"
                  >
                    <Button
                      type="primary"
                      icon={<GroupOutlined />}
                      loading={batchAssigning}
                    >
                      分配分组
                    </Button>
                  </Popconfirm>
                </Space>
              )}
            </Space>
          </Card>

          {/* 队伍列表 */}
          <AccentCard
            size="small"
            style={{ background: token.colorBgContainer, ...cardStyle }}
            title={<Text strong>队伍列表</Text>}
          >
            <BrandSpin spinning={loading}>
              {filteredTeams.length === 0 ? (
                <EmptyState
                  type="default"
                  description={loading ? '加载中...' : '暂无队伍'}
                  cta={
                    loading
                      ? undefined
                      : [
                          {
                            text: '新建队伍',
                            icon: <PlusOutlined />,
                            onClick: () => {
                              setEditingTeam(null);
                              setTeamModalOpen(true);
                            }
                          },
                          {
                            text: '批量导入',
                            icon: <TeamOutlined />,
                            onClick: handleOpenBatch
                          }
                        ]
                  }
                />
              ) : viewMode === 'list' ? (
                /* 列表视图 — 卡片网格 */
                <Row gutter={[spacing.lg, spacing.lg]}>
                  {filteredTeams.map((tv, index) => renderTeamCard(tv, index))}
                </Row>
              ) : viewMode === 'group' ? (
                /* 分组视图 — Collapse 折叠面板 */
                <Collapse
                  defaultActiveKey={groupedTeams.map((g) => g.event.id)}
                  items={groupedTeams.map((g) => ({
                    key: g.event.id,
                    label: (
                      <Space>
                        <Text strong>{g.event.name}</Text>
                        <Tag color="blue">{g.teams.length} 支</Tag>
                      </Space>
                    ),
                    children: (
                      <Row gutter={[spacing.lg, spacing.lg]}>
                        {g.teams.map((tv, index) => renderTeamCard(tv, index))}
                      </Row>
                    )
                  }))}
                />
              ) : (
                /* 表格视图 — 支持 rowSelection 批量分配 */
                <Table
                  columns={columns}
                  dataSource={filteredTeams}
                  rowKey={(item) => item.team.id}
                  size="small"
                  rowSelection={{
                    selectedRowKeys: selectedTeamIds,
                    onChange: (keys) => setSelectedTeamIds(keys as string[])
                  }}
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                />
              )}
            </BrandSpin>
          </AccentCard>
        </Content>
      </Layout>

      {/* 队伍历史辩题弹窗 */}
      <TeamHistoryModal
        open={historyModalOpen}
        team={historyTeam}
        history={currentHistory}
        topicOptions={topicStore.items}
        eventOptions={eventOptions}
        onClose={() => {
          setHistoryModalOpen(false);
          setHistoryTeam(null);
          setCurrentHistory([]);
        }}
        onAdd={handleAddHistory}
        onDelete={handleDeleteHistory}
      />

      {/* 添加/编辑队伍弹窗（编辑模式预填名称；不允许修改 event_id） */}
      <TeamEditModal
        open={teamModalOpen}
        team={editingTeam}
        eventId={undefined}
        eventOptions={eventOptions}
        groupOptions={teamModalGroupOptions}
        onOk={handleSubmitTeam}
        onCancel={() => {
          setTeamModalOpen(false);
          setEditingTeam(null);
        }}
        onContinue={handleContinueCreate}
      />

      {/* 批量导入队伍弹窗 */}
      <Modal
        title="批量导入队伍"
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        onOk={handleBatchImport}
        okText="导入"
        cancelText="取消"
        width={520}
        destroyOnClose
        okButtonProps={{ style: primaryButtonStyle, loading: batchImporting }}
      >
        <Form layout="vertical">
          <Form.Item label="所属赛事" required>
            <Select
              value={batchEventId}
              onChange={setBatchEventId}
              placeholder="选择赛事"
              options={allEvents.map((e) => ({ label: e.name, value: e.id }))}
            />
          </Form.Item>
          <Form.Item label="队伍名称" help="每行输入一支队伍名，空行会被忽略">
            <Input.TextArea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={8}
              placeholder={'北京大学辩论队\n清华大学辩论队\n复旦大学辩论队'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
