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
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  TeamOutlined,
  ReloadOutlined,
  SearchOutlined,
  CalendarOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  Event,
  Team,
  TeamHistory
} from '../../../shared/types';
import TeamHistoryModal from '../components/TeamHistoryModal';

const { Content } = Layout;
const { Text } = Typography;

// 扁平化后的队伍视图项
interface TeamView {
  team: Team;
  eventName: string;
  historyCount: number;
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

  // 弹窗
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);
  const [currentHistory, setCurrentHistory] = useState<TeamHistory[]>([]);

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

  // 表格列
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
      render: (n: number) => (n > 0 ? <Tag color="orange">{n}</Tag> : <Text type="secondary">0</Text>)
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
              <TeamOutlined style={{ color: '#1677ff' }} />
              <Text strong>队伍管理</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {filteredTeams.length} 支队伍
              </Text>
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
                刷新
              </Button>
            </Space>
          </div>

          {/* 筛选条 */}
          <Card size="small" style={{ marginBottom: 12, background: token.colorBgContainer }}>
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
            style={{ background: token.colorBgContainer }}
            title={<Text strong>队伍列表</Text>}
          >
            <Spin spinning={loading}>
              {filteredTeams.length === 0 ? (
                <Empty description={loading ? '加载中...' : '暂无队伍'}>
                  {!loading && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      请前往"赛事管理"页面为赛事添加队伍
                    </Text>
                  )}
                </Empty>
              ) : (
                <Table
                  columns={columns}
                  dataSource={filteredTeams}
                  rowKey={(item) => item.team.id}
                  size="small"
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                />
              )}
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
    </>
  );
}
