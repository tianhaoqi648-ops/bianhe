import { useEffect, useState, useMemo } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Modal,
  Empty,
  Spin,
  Typography,
  Tag,
  Card,
  Tabs,
  Popconfirm,
  Alert,
  Row,
  Col,
  Progress,
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TrophyOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  Event,
  Round,
  Team,
  TeamHistory,
  EventCreateInput,
  EventUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput
} from '../../../shared/types';
import EventEditModal from '../components/EventEditModal';
import EventWizardModal from '../components/EventWizardModal';
import RoundEditModal from '../components/RoundEditModal';
import TeamEditModal from '../components/TeamEditModal';
import TeamHistoryModal from '../components/TeamHistoryModal';
import {
  toolbarStyle,
  cardStyle,
  primaryButtonStyle,
  titleBarStyle,
  selectedStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing, shadow, transition } from '../styles/tokens';

const { Content } = Layout;
const { Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  preparing: { color: 'default', label: '筹备中' },
  ongoing: { color: 'processing', label: '进行中' },
  finished: { color: 'success', label: '已结束' }
};

// 难度梯度一键预设方案
const DIFFICULTY_PRESETS: Array<{
  key: string;
  label: string;
  presets: Array<{ name: string; round_number: number; difficulty_override: string }>;
}> = [
  {
    key: 'standard',
    label: '标准赛制（分组赛→复赛→决赛）',
    presets: [
      { name: '分组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '复赛', round_number: 2, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 3, difficulty_override: '专业级' }
    ]
  },
  {
    key: 'compact',
    label: '紧凑赛制（初赛→决赛）',
    presets: [
      { name: '初赛', round_number: 1, difficulty_override: '入门级' },
      { name: '决赛', round_number: 2, difficulty_override: '进阶级' }
    ]
  },
  {
    key: 'extended',
    label: '长赛制（小组赛→淘汰赛→半决赛→决赛）',
    presets: [
      { name: '小组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '淘汰赛', round_number: 2, difficulty_override: '入门级' },
      { name: '半决赛', round_number: 3, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 4, difficulty_override: '专业级' }
    ]
  }
];

export default function EventManage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const [messageApi, contextHolder] = message.useMessage();

  // 选中的赛事（详情视图）
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  // 详情面板当前 Tab
  const [detailTab, setDetailTab] = useState<'teams' | 'rounds'>('teams');

  // 弹窗状态
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  // 新建赛事向导弹窗
  const [wizardOpen, setWizardOpen] = useState(false);
  const [roundModalOpen, setRoundModalOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<Round | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);
  // 当前队伍历史
  const [teamHistory, setTeamHistory] = useState<TeamHistory[]>([]);
  // 预设弹窗
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  // 预设选中态（最近应用的方案）
  const [appliedPresetKey, setAppliedPresetKey] = useState<string | null>(null);
  // 预设卡片 hover 态
  const [hoveredPresetKey, setHoveredPresetKey] = useState<string | null>(null);

  // 赛事卡片统计：每个赛事的轮次数与队伍数
  const [eventStats, setEventStats] = useState<Record<string, { rounds: number; teams: number }>>({});
  // 详情头部 Progress：已完成轮次（有抽取记录的轮次）/ 总轮次
  const [completedRoundIds, setCompletedRoundIds] = useState<Set<string>>(new Set());

  // ====== 数据加载 ======
  useEffect(() => {
    void eventStore.listEvents();
    // 拉取一批题库作为"历史辩题"下拉候选
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉取每个赛事的轮次/队伍数量（用于卡片显示）
  useEffect(() => {
    if (eventStore.events.length === 0) return;
    void (async () => {
      const stats: Record<string, { rounds: number; teams: number }> = {};
      await Promise.all(
        eventStore.events.map(async (e) => {
          try {
            const [roundsRes, teamsRes] = await Promise.all([
              window.eventAPI.listRoundsByEvent(e.id),
              window.eventAPI.listTeamsByEvent(e.id)
            ]);
            stats[e.id] = {
              rounds: roundsRes.success && roundsRes.data ? roundsRes.data.length : 0,
              teams: teamsRes.success && teamsRes.data ? teamsRes.data.length : 0
            };
          } catch {
            stats[e.id] = { rounds: 0, teams: 0 };
          }
        })
      );
      setEventStats(stats);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventStore.events]);

  // 选中赛事后加载详情
  useEffect(() => {
    if (selectedEvent) {
      void eventStore.listRoundsByEvent(selectedEvent.id);
      void eventStore.listTeamsByEvent(selectedEvent.id);
      // 拉取该赛事的抽取记录，统计已完成的轮次（有抽取记录即视为已完成）
      void (async () => {
        try {
          const res = await window.drawAPI.listSessions({ event_id: selectedEvent.id, pageSize: 1000 });
          if (res.success && res.data) {
            const ids = new Set<string>();
            (res.data.items ?? []).forEach((s) => {
              if (s.round_id) ids.add(s.round_id);
            });
            setCompletedRoundIds(ids);
          } else {
            setCompletedRoundIds(new Set());
          }
        } catch {
          setCompletedRoundIds(new Set());
        }
      })();
    } else {
      setCompletedRoundIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id]);

  // 队伍历史相关：需要题库候选 + 赛事候选
  const eventOptions = useMemo(
    () => eventStore.events.map((e) => ({ id: e.id, name: e.name })),
    [eventStore.events]
  );

  // 状态分布统计
  const statusDistribution = useMemo(() => {
    const dist: Record<string, number> = { preparing: 0, ongoing: 0, finished: 0 };
    eventStore.events.forEach((e) => {
      const s = e.status ?? 'preparing';
      if (dist[s] !== undefined) dist[s] += 1;
    });
    return dist;
  }, [eventStore.events]);

  // ====== 赛事 CRUD ======
  const handleCreateEvent = () => {
    setWizardOpen(true);
  };
  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEventModalOpen(true);
  };
  const handleSubmitEvent = async (
    data: EventCreateInput | EventUpdateInput,
    isEdit: boolean
  ) => {
    try {
      if (isEdit && editingEvent) {
        await eventStore.updateEvent(editingEvent.id, data as EventUpdateInput);
        messageApi.success('赛事已更新');
        // 同步 selectedEvent
        if (selectedEvent?.id === editingEvent.id) {
          setSelectedEvent({ ...editingEvent, ...(data as EventUpdateInput) } as Event);
        }
      } else {
        const created = await eventStore.createEvent(data as EventCreateInput);
        messageApi.success('赛事已创建');
        if (created) setSelectedEvent(created);
      }
      setEventModalOpen(false);
      setEditingEvent(null);
      await eventStore.listEvents();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '操作失败');
    }
  };
  const handleDeleteEvent = (event: Event) => {
    Modal.confirm({
      title: `确认删除赛事"${event.name}"？`,
      content: '将同时删除该赛事下的所有轮次、队伍及历史记录',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await eventStore.deleteEvent(event.id);
          messageApi.success('赛事已删除');
          if (selectedEvent?.id === event.id) setSelectedEvent(null);
          await eventStore.listEvents();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // ====== 轮次 CRUD ======
  const handleCreateRound = () => {
    setEditingRound(null);
    setRoundModalOpen(true);
  };
  const handleEditRound = (round: Round) => {
    setEditingRound(round);
    setRoundModalOpen(true);
  };
  const handleSubmitRound = async (
    data: RoundCreateInput | RoundUpdateInput,
    isEdit: boolean
  ) => {
    if (!selectedEvent) return;
    try {
      if (isEdit && editingRound) {
        await eventStore.updateRound(editingRound.id, data as RoundUpdateInput);
        messageApi.success('轮次已更新');
      } else {
        await eventStore.createRound({
          ...(data as RoundCreateInput),
          event_id: selectedEvent.id
        });
        messageApi.success('轮次已创建');
      }
      setRoundModalOpen(false);
      setEditingRound(null);
      await eventStore.listRoundsByEvent(selectedEvent.id);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '操作失败');
    }
  };
  const handleDeleteRound = (round: Round) => {
    Modal.confirm({
      title: `确认删除轮次"${round.name ?? round.id.slice(0, 8)}"？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await eventStore.deleteRound(round.id);
          messageApi.success('轮次已删除');
          if (selectedEvent) {
            await eventStore.listRoundsByEvent(selectedEvent.id);
          }
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // 一键应用难度梯度预设
  const handleApplyPreset = async (presetKey: string) => {
    if (!selectedEvent) return;
    const preset = DIFFICULTY_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    Modal.confirm({
      title: `确认应用"${preset.label}"？`,
      content: '将清空当前赛事的所有轮次并按预设重建',
      okText: '应用',
      okType: 'primary',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 删除现有轮次
          for (const r of eventStore.rounds) {
            await eventStore.deleteRound(r.id);
          }
          // 创建预设轮次
          for (const p of preset.presets) {
            await eventStore.createRound({
              event_id: selectedEvent.id,
              name: p.name,
              round_number: p.round_number,
              difficulty_override: p.difficulty_override,
              topic_count: 4
            });
          }
          messageApi.success('难度梯度已应用');
          setAppliedPresetKey(presetKey);
          setPresetModalOpen(false);
          await eventStore.listRoundsByEvent(selectedEvent.id);
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '应用失败');
        }
      }
    });
  };

  // ====== 队伍 CRUD ======
  const handleCreateTeam = () => {
    setEditingTeam(null);
    setTeamModalOpen(true);
  };
  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamModalOpen(true);
  };
  const handleSubmitTeam = async (
    data: TeamCreateInput | TeamUpdateInput,
    isEdit: boolean
  ) => {
    if (!selectedEvent) return;
    try {
      if (isEdit && editingTeam) {
        await eventStore.updateTeam(editingTeam.id, data as TeamUpdateInput);
        messageApi.success('队伍已更新');
      } else {
        await eventStore.createTeam({
          ...(data as TeamCreateInput),
          event_id: selectedEvent.id
        });
        messageApi.success('队伍已添加');
      }
      setTeamModalOpen(false);
      setEditingTeam(null);
      await eventStore.listTeamsByEvent(selectedEvent.id);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '操作失败');
    }
  };
  const handleDeleteTeam = (team: Team) => {
    Modal.confirm({
      title: `确认删除队伍"${team.name}"？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await eventStore.deleteTeam(team.id);
          messageApi.success('队伍已删除');
          if (selectedEvent) {
            await eventStore.listTeamsByEvent(selectedEvent.id);
          }
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // ====== 队伍历史 ======
  const handleManageHistory = async (team: Team) => {
    setHistoryTeam(team);
    setHistoryModalOpen(true);
    try {
      const res = await window.eventAPI.listTeamHistory(team.id);
      if (res.success && res.data) {
        setTeamHistory(res.data as TeamHistory[]);
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '加载历史失败');
    }
  };
  const handleAddHistory = async (data: {
    team_id: string;
    topic_id: string;
    event_id: string;
    played_at?: string | null;
  }) => {
    const res = await window.eventAPI.addTeamHistory(data);
    if (!res.success) throw new Error(res.error || '添加失败');
    // 刷新
    const list = await window.eventAPI.listTeamHistory(data.team_id);
    if (list.success && list.data) setTeamHistory(list.data as TeamHistory[]);
  };
  const handleDeleteHistory = async (id: string) => {
    if (!historyTeam) return;
    const res = await window.eventAPI.deleteTeamHistory(id);
    if (!res.success) throw new Error(res.error || '删除失败');
    const list = await window.eventAPI.listTeamHistory(historyTeam.id);
    if (list.success && list.data) setTeamHistory(list.data as TeamHistory[]);
  };

  // ====== 前往抽取 ======
  const handleGotoDraw = (event: Event, round?: Round) => {
    navigate('/draw', {
      state: { eventId: event.id, roundId: round?.id }
    });
  };

  // ====== 表格列定义 ======
  const roundColumns: ColumnsType<Round> = [
    {
      title: '#',
      dataIndex: 'round_number',
      key: 'round_number',
      width: 50,
      render: (v: number | null) => v ?? '-'
    },
    {
      title: '轮次名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null) => v ?? <Text type="secondary">未命名</Text>
    },
    {
      title: '难度梯度',
      dataIndex: 'difficulty_override',
      key: 'difficulty_override',
      width: 120,
      render: (v: string | null) =>
        v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">不限</Text>
    },
    {
      title: '题量',
      dataIndex: 'topic_count',
      key: 'topic_count',
      width: 80,
      render: (v: number | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: Round) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => selectedEvent && handleGotoDraw(selectedEvent, record)}
          >
            前往抽取
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditRound(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该轮次？"
            onConfirm={() => handleDeleteRound(record)}
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

  const teamColumns: ColumnsType<Team> = [
    {
      title: '队伍名称',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: any, record: Team) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<CalendarOutlined />}
            onClick={() => handleManageHistory(record)}
          >
            历史辩题
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditTeam(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该队伍？"
            onConfirm={() => handleDeleteTeam(record)}
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

  // ====== 渲染：赛事卡片 ======
  const renderEventCard = (event: Event) => {
    const stats = eventStats[event.id] ?? { rounds: 0, teams: 0 };
    const statusInfo = event.status ? STATUS_TAG[event.status] : null;
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={event.id}>
        <Card
          size="small"
          hoverable
          style={{
            ...cardStyle,
            height: '100%',
            transition: transition.base,
            cursor: 'pointer'
          }}
          styles={{ body: { padding: spacing.lg } }}
          onClick={() => setSelectedEvent(event)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
            <Text strong style={{ fontSize: 15, flex: 1, marginRight: spacing.sm }} ellipsis={{ tooltip: event.name }}>
              {event.name}
            </Text>
            {statusInfo && <Tag color={statusInfo.color}>{statusInfo.label}</Tag>}
          </div>
          <div style={{ display: 'flex', gap: spacing.lg, marginBottom: spacing.md, color: token.colorTextSecondary }}>
            <span>
              <CalendarOutlined style={{ marginRight: 4 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>轮次 </Text>
              <Text strong>{stats.rounds}</Text>
            </span>
            <span>
              <TeamOutlined style={{ marginRight: 4 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>队伍 </Text>
              <Text strong>{stats.teams}</Text>
            </span>
          </div>
          {event.start_date && (
            <div style={{ marginBottom: spacing.sm }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {event.start_date}{event.end_date ? ` ~ ${event.end_date}` : ''}
              </Text>
            </div>
          )}
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => handleGotoDraw(event)}
            >
              抽取
            </Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEditEvent(event)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该赛事？"
              onConfirm={() => handleDeleteEvent(event)}
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
  };

  // ====== 渲染 ======
  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, padding: '0 16px 16px', overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div style={toolbarStyle}>
            <Space>
              <TrophyOutlined style={{ color: '#1677ff' }} />
              <Text strong>赛事管理</Text>
              <Tag color="blue">共 {eventStore.events.length} 场</Tag>
              <Tag color="default">筹备中 {statusDistribution.preparing}</Tag>
              <Tag color="processing">进行中 {statusDistribution.ongoing}</Tag>
              <Tag color="success">已结束 {statusDistribution.finished}</Tag>
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => eventStore.listEvents()}>
                刷新
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateEvent}
                style={primaryButtonStyle}
              >
                新建赛事
              </Button>
            </Space>
          </div>

          {/* 赛事列表 — 卡片网格视图 */}
          <Card
            size="small"
            style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}
            title={
              <Space>
                <Text strong>赛事列表</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {eventStore.events.length} 项
                </Text>
              </Space>
            }
          >
            <Spin spinning={eventStore.loading}>
              {eventStore.events.length === 0 ? (
                <Empty description="暂无赛事">
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateEvent}>
                    创建第一场赛事
                  </Button>
                </Empty>
              ) : (
                <Row gutter={[spacing.lg, spacing.lg]}>
                  {eventStore.events.map(renderEventCard)}
                </Row>
              )}
            </Spin>
          </Card>

          {/* 赛事详情 */}
          {selectedEvent && (
            <Card
              size="small"
              style={{ marginTop: spacing.lg, background: token.colorBgContainer, ...cardStyle }}
              title={
                <div style={titleBarStyle}>
                  <Text strong>{selectedEvent.name}</Text>
                  {selectedEvent.status && (
                    <Tag color={STATUS_TAG[selectedEvent.status]?.color ?? 'default'}>
                      {STATUS_TAG[selectedEvent.status]?.label ?? selectedEvent.status}
                    </Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    详情
                  </Text>
                </div>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => setPresetModalOpen(true)}
                  >
                    难度梯度预设
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => handleGotoDraw(selectedEvent)}
                  >
                    前往抽取
                  </Button>
                </Space>
              }
            >
              {/* Progress：已完成轮次 / 总轮次 */}
              <div style={{ marginBottom: spacing.lg, padding: `${spacing.sm} ${spacing.md}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    赛事进度：已完成 {completedRoundIds.size} / {eventStore.rounds.length} 轮次
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {eventStore.rounds.length > 0
                      ? `${Math.round((completedRoundIds.size / eventStore.rounds.length) * 100)}%`
                      : '0%'}
                  </Text>
                </div>
                <Progress
                  percent={
                    eventStore.rounds.length > 0
                      ? Math.round((completedRoundIds.size / eventStore.rounds.length) * 100)
                      : 0
                  }
                  size="small"
                  status={completedRoundIds.size === eventStore.rounds.length && eventStore.rounds.length > 0 ? 'success' : 'active'}
                />
              </div>

              <Tabs
                activeKey={detailTab}
                onChange={(k) => setDetailTab(k as 'teams' | 'rounds')}
                items={[
                  {
                    key: 'teams',
                    label: (
                      <Space>
                        <TeamOutlined />
                        <span>队伍管理</span>
                        <Tag color="blue" style={{ marginInlineStart: 4 }}>
                          {eventStore.teams.length}
                        </Tag>
                      </Space>
                    ),
                    children: (
                      <div>
                        <div style={{ marginBottom: spacing.md }}>
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={handleCreateTeam}
                          >
                            添加队伍
                          </Button>
                        </div>
                        <Table
                          columns={teamColumns}
                          dataSource={eventStore.teams}
                          rowKey="id"
                          size="small"
                          pagination={
                            eventStore.teams.length > 10
                              ? {
                                  pageSize: 10,
                                  showSizeChanger: false,
                                  showTotal: (t) => `共 ${t} 支队伍`
                                }
                              : false
                          }
                          locale={{ emptyText: <Empty description="暂无队伍" /> }}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'rounds',
                    label: (
                      <Space>
                        <CalendarOutlined />
                        <span>轮次设置</span>
                        <Tag color="blue" style={{ marginInlineStart: 4 }}>
                          {eventStore.rounds.length}
                        </Tag>
                      </Space>
                    ),
                    children: (
                      <div>
                        <div style={{ marginBottom: spacing.md }}>
                          <Space>
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={handleCreateRound}
                            >
                              新建轮次
                            </Button>
                            <Button onClick={() => setPresetModalOpen(true)}>
                              难度梯度预设
                            </Button>
                          </Space>
                        </div>
                        <Table
                          columns={roundColumns}
                          dataSource={eventStore.rounds}
                          rowKey="id"
                          size="small"
                          pagination={
                            eventStore.rounds.length > 10
                              ? {
                                  pageSize: 10,
                                  showSizeChanger: false,
                                  showTotal: (t) => `共 ${t} 个轮次`
                                }
                              : false
                          }
                          locale={{ emptyText: <Empty description="暂无轮次" /> }}
                        />
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          )}
        </Content>
      </Layout>

      {/* 赛事编辑弹窗 */}
      <EventEditModal
        open={eventModalOpen}
        event={editingEvent}
        onOk={handleSubmitEvent}
        onCancel={() => {
          setEventModalOpen(false);
          setEditingEvent(null);
        }}
      />

      {/* 新建赛事向导弹窗 */}
      <EventWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={async (eventId) => {
          setWizardOpen(false);
          await eventStore.listEvents();
          // 选中新创建的赛事
          const created = eventStore.events.find((e) => e.id === eventId);
          if (created) setSelectedEvent(created);
          else {
            // events 可能还没刷新完，再查一次
            const fresh = await window.eventAPI.getEvent(eventId);
            if (fresh.success && fresh.data) setSelectedEvent(fresh.data);
          }
        }}
      />

      {/* 轮次编辑弹窗 */}
      <RoundEditModal
        open={roundModalOpen}
        round={editingRound}
        eventId={selectedEvent?.id}
        nextRoundNumber={eventStore.rounds.length + 1}
        onOk={handleSubmitRound}
        onCancel={() => {
          setRoundModalOpen(false);
          setEditingRound(null);
        }}
      />

      {/* 队伍编辑弹窗 */}
      <TeamEditModal
        open={teamModalOpen}
        team={editingTeam}
        eventId={selectedEvent?.id}
        onOk={handleSubmitTeam}
        onCancel={() => {
          setTeamModalOpen(false);
          setEditingTeam(null);
        }}
      />

      {/* 队伍历史辩题弹窗 */}
      <TeamHistoryModal
        open={historyModalOpen}
        team={historyTeam}
        history={teamHistory}
        topicOptions={topicStore.items}
        eventOptions={eventOptions}
        onClose={() => {
          setHistoryModalOpen(false);
          setHistoryTeam(null);
          setTeamHistory([]);
        }}
        onAdd={handleAddHistory}
        onDelete={handleDeleteHistory}
      />

      {/* 难度梯度预设弹窗 */}
      <Modal
        title="难度梯度预设"
        open={presetModalOpen}
        onCancel={() => setPresetModalOpen(false)}
        footer={
          <Button onClick={() => setPresetModalOpen(false)}>关闭</Button>
        }
        width={520}
      >
        <Alert
          message="应用预设将清空当前赛事的所有轮次并按预设重建"
          type="warning"
          showIcon
          banner
        />
        <Space direction="vertical" style={{ width: '100%', marginTop: spacing.md }}>
          {DIFFICULTY_PRESETS.map((p) => {
            const isSelected = appliedPresetKey === p.key;
            const isHovered = hoveredPresetKey === p.key;
            return (
              <Card
                key={p.key}
                size="small"
                hoverable
                onClick={() => handleApplyPreset(p.key)}
                onMouseEnter={() => setHoveredPresetKey(p.key)}
                onMouseLeave={() => setHoveredPresetKey(null)}
                style={{
                  cursor: 'pointer',
                  transition: transition.base,
                  transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                  boxShadow: isHovered ? shadow.cardHover : shadow.sm,
                  ...(isSelected ? selectedStyle : {})
                }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text strong>{p.label}</Text>
                  <Space wrap>
                    {p.presets.map((s, i) => (
                      <Tag key={i} color="blue">
                        {s.name}: {s.difficulty_override}
                      </Tag>
                    ))}
                  </Space>
                </Space>
              </Card>
            );
          })}
        </Space>
      </Modal>
    </>
  );
}
