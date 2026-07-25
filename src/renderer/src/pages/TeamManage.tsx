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
  Input,
  Select,
  Popconfirm,
  Segmented,
  Row,
  Col,
  Collapse,
  Form,
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  TeamOutlined,
  ReloadOutlined,
  SearchOutlined,
  CalendarOutlined,
  DeleteOutlined,
  PlusOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  Event,
  Team,
  TeamHistory,
  TeamCreateInput,
  TeamUpdateInput
} from '../../../shared/types';
import TeamHistoryModal from '../components/TeamHistoryModal';
import TeamEditModal from '../components/TeamEditModal';
import {
  toolbarStyle,
  cardStyle,
  primaryButtonStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing, transition } from '../styles/tokens';

const { Content } = Layout;
const { Text } = Typography;

// 扁平化后的队伍视图项
interface TeamView {
  team: Team;
  eventName: string;
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
  const [messageApi, contextHolder] = message.useMessage();

  // 全部赛事（用于拉取各赛事下的队伍）
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  // 全部队伍（扁平化）
  const [allTeams, setAllTeams] = useState<TeamView[]>([]);
  // 各队伍历史辩题数量缓存
  const [historyMap, setHistoryMap] = useState<Record<string, TeamHistory[]>>({});
  // 加载状态
  const [loading, setLoading] = useState(false);
  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterEventId, setFilterEventId] = useState<string | undefined>(undefined);
  // 视图切换：list = 卡片网格视图，group = 按赛事分组视图
  const [viewMode, setViewMode] = useState<'list' | 'group'>('list');

  // 弹窗
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);
  const [currentHistory, setCurrentHistory] = useState<TeamHistory[]>([]);
  // 添加队伍弹窗（无 event 上下文）
  const [teamModalOpen, setTeamModalOpen] = useState(false);

  // 批量导入弹窗
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchEventId, setBatchEventId] = useState<string | undefined>(undefined);
  const [batchImporting, setBatchImporting] = useState(false);

  // ====== 数据加载 ======
  const loadAll = async () => {
    setLoading(true);
    try {
      const events = await eventStore.listEvents();
      setAllEvents(events);

      // 拉取每个赛事下的队伍
      const teamsByEvent = await Promise.all(
        events.map((e) => window.eventAPI.listTeamsByEvent(e.id))
      );
      const teamList: TeamView[] = [];
      const historyPromises: Promise<void>[] = [];
      const newHistoryMap: Record<string, TeamHistory[]> = {};
      events.forEach((e, idx) => {
        const res = teamsByEvent[idx];
        if (res.success && res.data) {
          const teams = res.data as Team[];
          teams.forEach((t) => {
            teamList.push({ team: t, eventName: e.name, historyCount: 0 });
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
      messageApi.error(e instanceof Error ? e.message : '加载失败');
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
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (tv) =>
          tv.team.name.toLowerCase().includes(kw) ||
          tv.eventName.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [allTeams, keyword, filterEventId]);

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
          messageApi.success('队伍已删除');
          await loadAll();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // 添加队伍提交（无 event 上下文，由 TeamEditModal 内部选赛事）
  const handleSubmitTeam = async (
    data: TeamCreateInput | TeamUpdateInput,
    _isEdit: boolean
  ) => {
    try {
      const createData = data as TeamCreateInput;
      const res = await window.eventAPI.createTeam(createData);
      if (!res.success) throw new Error(res.error || '添加失败');
      messageApi.success('队伍已添加');
      setTeamModalOpen(false);
      await loadAll();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  // "保存并继续"回调：连续添加多支队伍，不关闭弹窗
  const handleContinueCreate = async (data: TeamCreateInput) => {
    const res = await window.eventAPI.createTeam(data);
    if (!res.success) throw new Error(res.error || '创建失败');
    messageApi.success(`已添加：${data.name}`);
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
      messageApi.error('请选择所属赛事');
      return;
    }
    const lines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      messageApi.error('请输入至少一支队伍名');
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
    messageApi.success(`导入完成：成功 ${success} 支，失败 ${fail} 支`);
    await loadAll();
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
      width: 200,
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
  const renderTeamCard = (tv: TeamView) => (
    <Col xs={24} sm={12} md={8} lg={6} key={tv.team.id}>
      <Card
        size="small"
        hoverable
        style={{
          ...cardStyle,
          height: '100%',
          transition: transition.base
        }}
        styles={{ body: { padding: spacing.lg } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
          <Text strong style={{ fontSize: 15, flex: 1, marginRight: spacing.sm }} ellipsis={{ tooltip: tv.team.name }}>
            {tv.team.name}
          </Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
          <Tag color="blue">{tv.eventName}</Tag>
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>历史</Text>
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
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, padding: '0 16px 16px', overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div style={toolbarStyle}>
            <Space>
              <TeamOutlined style={{ color: '#1677ff' }} />
              <Text strong>队伍管理</Text>
              <Tag color="blue">共 {filteredTeams.length} 支</Tag>
              <Segmented
                value={viewMode}
                onChange={(v) => setViewMode(v as 'list' | 'group')}
                options={[
                  { label: '列表视图', value: 'list', icon: <AppstoreOutlined /> },
                  { label: '分组视图', value: 'group', icon: <UnorderedListOutlined /> }
                ]}
                size="small"
              />
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
                刷新
              </Button>
              <Button icon={<TeamOutlined />} onClick={handleOpenBatch}>
                批量导入
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setTeamModalOpen(true)}
                style={primaryButtonStyle}
              >
                添加队伍
              </Button>
            </Space>
          </div>

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
            </Space>
          </Card>

          {/* 队伍列表 */}
          <Card
            size="small"
            style={{ background: token.colorBgContainer, ...cardStyle }}
            title={<Text strong>队伍列表</Text>}
          >
            <Spin spinning={loading}>
              {filteredTeams.length === 0 ? (
                <Empty description={loading ? '加载中...' : '暂无队伍'}>
                  {!loading && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      请点击右上角"添加队伍"或前往"赛事管理"页面为赛事添加队伍
                    </Text>
                  )}
                </Empty>
              ) : viewMode === 'list' ? (
                /* 列表视图 — 卡片网格 */
                <Row gutter={[spacing.lg, spacing.lg]}>
                  {filteredTeams.map(renderTeamCard)}
                </Row>
              ) : (
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
                        {g.teams.map(renderTeamCard)}
                      </Row>
                    )
                  }))}
                />
              )}

              {/* 隐藏的 Table 仅供排序/分页备用（保留 columns 引用避免 TS 未使用） */}
              <div style={{ display: 'none' }}>
                <Table
                  columns={columns}
                  dataSource={filteredTeams}
                  rowKey={(item) => item.team.id}
                  size="small"
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                />
              </div>
            </Spin>
          </Card>
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

      {/* 添加队伍弹窗（无 event 上下文，需选赛事） */}
      <TeamEditModal
        open={teamModalOpen}
        team={null}
        eventId={undefined}
        eventOptions={eventOptions}
        onOk={handleSubmitTeam}
        onCancel={() => setTeamModalOpen(false)}
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
