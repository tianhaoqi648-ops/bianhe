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
import RoundEditModal from '../components/RoundEditModal';
import TeamEditModal from '../components/TeamEditModal';
import TeamHistoryModal from '../components/TeamHistoryModal';

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

  // ====== 数据加载 ======
  useEffect(() => {
    void eventStore.listEvents();
    // 拉取一批题库作为"历史辩题"下拉候选
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
  }, []);

  // 选中赛事后加载详情
  useEffect(() => {
    if (selectedEvent) {
      void eventStore.listRoundsByEvent(selectedEvent.id);
      void eventStore.listTeamsByEvent(selectedEvent.id);
    }
  }, [selectedEvent?.id]);

  // 队伍历史相关：需要题库候选 + 赛事候选
  const eventOptions = useMemo(
    () => eventStore.events.map((e) => ({ id: e.id, name: e.name })),
    [eventStore.events]
  );

  // ====== 赛事 CRUD ======
  const handleCreateEvent = () => {
    setEditingEvent(null);
    setEventModalOpen(true);
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
      messageApi.error('加载历史失败');
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
  const eventColumns: ColumnsType<Event> = [
    {
      title: '赛事名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Event) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => setSelectedEvent(record)}
        >
          {name}
        </Button>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string | null) => {
        const tag = status ? STATUS_TAG[status] : null;
        return tag ? <Tag color={tag.color}>{tag.label}</Tag> : <Text type="secondary">-</Text>;
      }
    },
    {
      title: '开始日期',
      dataIndex: 'start_date',
      key: 'start_date',
      width: 120,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '结束日期',
      dataIndex: 'end_date',
      key: 'end_date',
      width: 120,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: any, record: Event) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => handleGotoDraw(record)}
          >
            抽取
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditEvent(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该赛事？"
            onConfirm={() => handleDeleteEvent(record)}
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

  // ====== 渲染 ======
  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ padding: '0 16px 16px', overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              padding: 12,
              background: token.colorBgContainer,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            <Space>
              <TrophyOutlined style={{ color: '#1677ff' }} />
              <Text strong>赛事管理</Text>
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => eventStore.listEvents()}>
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateEvent}>
                新建赛事
              </Button>
            </Space>
          </div>

          {/* 赛事列表 */}
          <Card
            size="small"
            style={{ marginBottom: 12, background: token.colorBgContainer }}
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
                <Table
                  columns={eventColumns}
                  dataSource={eventStore.events}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              )}
            </Spin>
          </Card>

          {/* 赛事详情 */}
          {selectedEvent && (
            <Card
              size="small"
              style={{ background: token.colorBgContainer }}
              title={
                <Space>
                  <Text strong>{selectedEvent.name}</Text>
                  {selectedEvent.status && (
                    <Tag color={STATUS_TAG[selectedEvent.status]?.color ?? 'default'}>
                      {STATUS_TAG[selectedEvent.status]?.label ?? selectedEvent.status}
                    </Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    详情
                  </Text>
                </Space>
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
                        <Tag style={{ marginInlineStart: 4 }}>
                          {eventStore.teams.length}
                        </Tag>
                      </Space>
                    ),
                    children: (
                      <div>
                        <div style={{ marginBottom: 12 }}>
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
                          pagination={false}
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
                        <Tag style={{ marginInlineStart: 4 }}>
                          {eventStore.rounds.length}
                        </Tag>
                      </Space>
                    ),
                    children: (
                      <div>
                        <div style={{ marginBottom: 12 }}>
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
                          pagination={false}
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
          style={{ marginBottom: 12 }}
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          {DIFFICULTY_PRESETS.map((p) => (
            <Card
              key={p.key}
              size="small"
              hoverable
              onClick={() => handleApplyPreset(p.key)}
              style={{ cursor: 'pointer' }}
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
          ))}
        </Space>
      </Modal>
    </>
  );
}
