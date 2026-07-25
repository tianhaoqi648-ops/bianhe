import { useEffect, useState, useMemo } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Empty,
  Skeleton,
  Typography,
  Tag,
  Card,
  Tabs,
  Input,
  Select,
  DatePicker,
  Popconfirm,
  Modal,
  Segmented,
  Row,
  Col,
  Statistic,
  Badge,
  Avatar,
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HistoryOutlined,
  ReloadOutlined,
  SearchOutlined,
  AuditOutlined,
  DeleteOutlined,
  CalendarOutlined,
  DownloadOutlined,
  DownOutlined,
  RightOutlined,
  ThunderboltOutlined,
  RedoOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDrawStore } from '../stores/drawStore';
import { useAuditStore } from '../stores/auditStore';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  DrawSession,
  DrawSessionDetail,
  AuditLog,
  SessionFilter,
  AuditLogFilter,
  ExportFormat
} from '../../../shared/types';
import {
  cardStyle,
  statCardStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing } from '../styles/tokens';

const { Content } = Layout;
const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// 抽取记录展开行（明细）的类型
interface DrawnItemRow {
  key: string;
  topic_title: string;
  team_a: string;
  team_b: string;
  stance_a: string | null;
  stance_b: string | null;
}

// 操作日志的 action 标签
const ACTION_TAG: Record<string, { color: string; label: string }> = {
  draw: { color: 'blue', label: '抽取' },
  redraw: { color: 'orange', label: '重抽' },
  create: { color: 'green', label: '新增' },
  update: { color: 'cyan', label: '更新' },
  delete: { color: 'red', label: '删除' },
  import: { color: 'purple', label: '导入' },
  export: { color: 'geekblue', label: '导出' },
  system: { color: 'default', label: '系统' },
  dedup_delete: { color: 'magenta', label: '去重删除' }
};

// 赛事状态 → Tag 颜色
const EVENT_STATUS_TAG: Record<string, string> = {
  preparing: 'default',
  ongoing: 'processing',
  finished: 'success'
};

type TimeRange = 'today' | 'week' | 'month' | 'all';

export default function History() {
  const { token } = theme.useToken();
  const drawStore = useDrawStore();
  const auditStore = useAuditStore();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const [messageApi, contextHolder] = message.useMessage();

  const [activeTab, setActiveTab] = useState<'sessions' | 'logs'>('sessions');

  // 抽取记录筛选
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>({
    page: 1,
    pageSize: 15
  });
  const [sessionKeyword, setSessionKeyword] = useState('');

  // 操作日志筛选
  const [logFilter, setLogFilter] = useState<AuditLogFilter>({
    page: 1,
    pageSize: 15
  });

  // 时间范围快捷筛选
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  // 导出格式选择（先选格式再点导出）
  const [sessionExportFormat, setSessionExportFormat] = useState<ExportFormat>('xlsx');
  const [logExportFormat, setLogExportFormat] = useState<'csv' | 'json'>('csv');

  // 展开行：每个 session 的明细缓存
  const [detailCache, setDetailCache] = useState<Record<string, DrawSessionDetail>>({});
  // 当前展开的 session 行 key 列表（用于 rowClassName 高亮）
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  // 题库与赛事映射
  const [topicMap, setTopicMap] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, string>>(new Map());
  const [eventNameMap, setEventNameMap] = useState<Map<string, string>>(new Map());
  const [eventStatusMap, setEventStatusMap] = useState<Map<string, string>>(new Map());

  // ====== 时间范围辅助 ======
  const getTimeRangeFilter = (range: TimeRange): { startTime?: string; endTime?: string } => {
    if (range === 'all') return {};
    const now = dayjs();
    let start: dayjs.Dayjs;
    if (range === 'today') {
      start = now.startOf('day');
    } else if (range === 'week') {
      start = now.startOf('week');
    } else {
      start = now.startOf('month');
    }
    return {
      startTime: start.toISOString(),
      endTime: now.endOf('day').toISOString()
    };
  };

  // ====== 数据加载 ======
  // zustand store 实例在组件生命周期内稳定，无需写入依赖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void eventStore.listEvents();
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
  }, []);

  // 构建 eventName / eventStatus 映射
  useEffect(() => {
    const names = new Map<string, string>();
    const statuses = new Map<string, string>();
    eventStore.events.forEach((e) => {
      names.set(e.id, e.name);
      if (e.status) statuses.set(e.id, e.status);
    });
    setEventNameMap(names);
    setEventStatusMap(statuses);
  }, [eventStore.events]);

  // 构建 topic 映射
  useEffect(() => {
    const m = new Map<string, string>();
    topicStore.items.forEach((t) => m.set(t.id, t.title));
    setTopicMap(m);
  }, [topicStore.items]);

  // 加载抽取记录
  const loadSessions = async () => {
    const rangeFilter = getTimeRangeFilter(timeRange);
    const filter: SessionFilter = {
      ...sessionFilter,
      ...rangeFilter
    };
    await drawStore.listSessions(filter);
    // 同时拉取各赛事下的队伍
    const eventIds = new Set<string>();
    eventStore.events.forEach((e) => eventIds.add(e.id));
    const teamM = new Map<string, string>();
    for (const eid of eventIds) {
      const res = await window.eventAPI.listTeamsByEvent(eid);
      if (res.success && res.data) {
        (res.data as any[]).forEach((t) => teamM.set(t.id, t.name));
      }
    }
    setTeamMap(teamM);
  };

  useEffect(() => {
    if (activeTab === 'sessions') {
      void loadSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sessionFilter, timeRange]);

  // 加载操作日志
  useEffect(() => {
    if (activeTab === 'logs') {
      const rangeFilter = getTimeRangeFilter(timeRange);
      void auditStore.listLogs({ ...logFilter, ...rangeFilter });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, logFilter, timeRange]);

  // ====== 统计数据 ======
  // 今日抽取 / 本周抽取 / 总抽取 / 重抽次数
  const stats = useMemo(() => {
    const now = dayjs();
    const todayStart = now.startOf('day');
    const weekStart = now.startOf('week');
    let todayCount = 0;
    let weekCount = 0;
    drawStore.sessions.forEach((s) => {
      if (!s.draw_time) return;
      const t = dayjs(s.draw_time);
      if (t.isAfter(todayStart)) todayCount += 1;
      if (t.isAfter(weekStart)) weekCount += 1;
    });
    const redrawCount = auditStore.items.filter((l) => l.action === 'redraw').length;
    return {
      today: todayCount,
      week: weekCount,
      total: drawStore.total,
      redraw: redrawCount
    };
  }, [drawStore.sessions, drawStore.total, auditStore.items]);

  // ====== 抽取记录操作 ======
  const handleViewSessionDetail = async (sessionId: string) => {
    if (detailCache[sessionId]) return;
    try {
      const detail = await drawStore.getSession(sessionId);
      if (detail) {
        setDetailCache((c) => ({ ...c, [sessionId]: detail }));
      }
    } catch (e) {
      // Bug 12 修复：catch 块异常变量 e 已被 console.error 消费
      console.error('加载明细失败', e);
      messageApi.error(e instanceof Error ? e.message : '加载明细失败');
    }
  };

  const handleDeleteSession = (session: DrawSession) => {
    Modal.confirm({
      title: '确认删除该抽取记录？',
      content: `时间：${session.draw_time ?? '-'}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await drawStore.deleteSession(session.id);
          messageApi.success('记录已删除');
          await loadSessions();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // 导出抽取记录
  const handleExportSessions = async (format: ExportFormat) => {
    try {
      const rangeFilter = getTimeRangeFilter(timeRange);
      const res = await window.exportAPI.exportDrawSessions({
        filter: { ...sessionFilter, ...rangeFilter },
        format
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || '导出失败');
      }
      messageApi.success(`已导出 ${res.data.count} 条记录到：${res.data.filePath}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  // 导出审计日志
  const handleExportLogs = async (format: 'csv' | 'json') => {
    try {
      const rangeFilter = getTimeRangeFilter(timeRange);
      const res = await window.auditAPI.exportLogs({
        filter: { ...logFilter, ...rangeFilter },
        format
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || '导出失败');
      }
      messageApi.success(`已导出 ${res.data.count} 条日志到：${res.data.filePath}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  // 清空日志
  const handleClearLogs = () => {
    Modal.confirm({
      title: '确认清空所有操作日志？',
      content: '此操作不可恢复，建议先导出备份',
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await auditStore.clearLogs();
          messageApi.success('日志已清空');
          const rangeFilter = getTimeRangeFilter(timeRange);
          void auditStore.listLogs({ ...logFilter, ...rangeFilter });
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : '清空失败');
        }
      }
    });
  };

  // ====== 表格列定义 ======
  // 关键词搜索过滤 sessions（本地过滤，因为后端不支持 keyword）
  const filteredSessions = useMemo(() => {
    if (!sessionKeyword.trim()) return drawStore.sessions;
    const kw = sessionKeyword.trim().toLowerCase();
    return drawStore.sessions.filter((s) => {
      const eventName = eventNameMap.get(s.event_id) ?? '';
      return (
        eventName.toLowerCase().includes(kw) ||
        (s.operator ?? '').toLowerCase().includes(kw) ||
        (s.draw_time ?? '').toLowerCase().includes(kw)
      );
    });
  }, [drawStore.sessions, sessionKeyword, eventNameMap]);

  const sessionColumns: ColumnsType<DrawSession> = [
    {
      title: '抽取时间',
      dataIndex: 'draw_time',
      key: 'draw_time',
      width: 200,
      render: (v: string | null) =>
        v ? (
          <Space size={4}>
            <CalendarOutlined style={{ color: token.colorTextSecondary }} />
            <span>{new Date(v).toLocaleString('zh-CN')}</span>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '所属赛事',
      dataIndex: 'event_id',
      key: 'event_id',
      render: (eventId: string) => {
        const status = eventStatusMap.get(eventId);
        const color = status ? EVENT_STATUS_TAG[status] ?? 'blue' : 'blue';
        return <Tag color={color}>{eventNameMap.get(eventId) ?? eventId.slice(0, 8)}</Tag>;
      }
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 140,
      render: (v: string | null) =>
        v ? (
          <Space size={6}>
            <Avatar size="small" style={{ background: '#1677ff', flexShrink: 0 }}>
              {v[0]?.toUpperCase() ?? '?'}
            </Avatar>
            <span>{v}</span>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '题目数',
      key: 'topic_count',
      width: 80,
      render: (_: any, record: DrawSession) => {
        const detail = detailCache[record.id];
        return detail ? (
          <Tag color="orange">{detail.items.length}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        );
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: DrawSession) => (
        <Space size={4}>
          <Button
            size="small"
            onClick={() => handleViewSessionDetail(record.id)}
          >
            查看明细
          </Button>
          <Popconfirm
            title="确认删除该记录？"
            onConfirm={() => handleDeleteSession(record)}
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

  const logColumns: ColumnsType<AuditLog> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v: string | null) =>
        v ? (
          <Space size={4}>
            <CalendarOutlined style={{ color: token.colorTextSecondary }} />
            <span>{new Date(v).toLocaleString('zh-CN')}</span>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 110,
      render: (action: string | null) => {
        if (!action) return <Text type="secondary">-</Text>;
        const tag = ACTION_TAG[action] ?? { color: 'default', label: action };
        return <Tag color={tag.color}>{tag.label}</Tag>;
      }
    },
    {
      title: '目标类型',
      dataIndex: 'target_type',
      key: 'target_type',
      width: 100,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 140,
      render: (v: string | null) =>
        v ? (
          <Space size={6}>
            <Avatar size="small" style={{ background: '#722ed1', flexShrink: 0 }}>
              {v[0]?.toUpperCase() ?? '?'}
            </Avatar>
            <span>{v}</span>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      render: (detail: Record<string, any> | null) => {
        if (!detail) return <Text type="secondary">-</Text>;
        const text = JSON.stringify(detail);
        return (
          <Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
          >
            {text}
          </Paragraph>
        );
      }
    }
  ];

  // 展开行渲染
  const renderSessionDetail = (session: DrawSession) => {
    const detail = detailCache[session.id];
    if (!detail) {
      return (
        <div style={{ padding: spacing.md }}>
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
      );
    }
    const rows: DrawnItemRow[] = detail.items.map((it, i) => ({
      key: `${it.id}-${i}`,
      topic_title: topicMap.get(it.topic_id) ?? `（已删除 ${it.topic_id.slice(0, 8)}）`,
      team_a: it.team_a_id ? teamMap.get(it.team_a_id) ?? it.team_a_id.slice(0, 8) : '-',
      team_b: it.team_b_id ? teamMap.get(it.team_b_id) ?? it.team_b_id.slice(0, 8) : '-',
      stance_a: it.stance_a,
      stance_b: it.stance_b
    }));
    const columns: ColumnsType<DrawnItemRow> = [
      {
        title: '辩题',
        dataIndex: 'topic_title',
        key: 'topic_title'
      },
      {
        title: '正方',
        dataIndex: 'team_a',
        key: 'team_a',
        width: 140,
        render: (v: string, record: DrawnItemRow) => (
          <Space direction="vertical" size={0}>
            <Text>{v}</Text>
            {record.stance_a && <Text type="secondary" style={{ fontSize: 12 }}>{record.stance_a}</Text>}
          </Space>
        )
      },
      {
        title: '反方',
        dataIndex: 'team_b',
        key: 'team_b',
        width: 140,
        render: (v: string, record: DrawnItemRow) => (
          <Space direction="vertical" size={0}>
            <Text>{v}</Text>
            {record.stance_b && <Text type="secondary" style={{ fontSize: 12 }}>{record.stance_b}</Text>}
          </Space>
        )
      }
    ];
    return (
      <Table
        columns={columns}
        dataSource={rows}
        size="small"
        pagination={false}
      />
    );
  };

  // ====== 渲染 ======
  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, overflow: 'auto' }}>
          {/* 顶部统计卡片 */}
          <Row gutter={[spacing.lg, spacing.lg]} style={{ marginBottom: spacing.md }}>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle('#1677ff')}>
                <Statistic
                  title="今日抽取"
                  value={stats.today}
                  prefix={<CalendarOutlined style={{ color: '#1677ff' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle('#52c41a')}>
                <Statistic
                  title="本周抽取"
                  value={stats.week}
                  prefix={<CalendarOutlined style={{ color: '#52c41a' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle('#722ed1')}>
                <Statistic
                  title="总抽取"
                  value={stats.total}
                  prefix={<ThunderboltOutlined style={{ color: '#722ed1' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle('#faad14')}>
                <Statistic
                  title="重抽次数"
                  value={stats.redraw}
                  prefix={<RedoOutlined style={{ color: '#faad14' }} />}
                />
              </Card>
            </Col>
          </Row>

          <Card
            size="small"
            style={{ background: token.colorBgContainer, ...cardStyle }}
            title={
              <Space>
                <HistoryOutlined style={{ color: '#1677ff' }} />
                <Text strong>历史记录</Text>
              </Space>
            }
            extra={
              <Segmented
                value={timeRange}
                onChange={(v) => setTimeRange(v as TimeRange)}
                options={[
                  { label: '今日', value: 'today' },
                  { label: '本周', value: 'week' },
                  { label: '本月', value: 'month' },
                  { label: '全部', value: 'all' }
                ]}
                size="small"
              />
            }
          >
            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as 'sessions' | 'logs')}
              items={[
                {
                  key: 'sessions',
                  label: (
                    <Badge count={drawStore.total} showZero offset={[8, 0]}>
                      <Space>
                        <HistoryOutlined />
                        <span>抽取记录</span>
                      </Space>
                    </Badge>
                  ),
                  children: (
                    <div>
                      {/* 抽取记录筛选条 — Card 内网格布局 */}
                      <Card size="small" style={{ marginBottom: spacing.md, background: token.colorFillQuaternary }}>
                        <Row gutter={[spacing.md, spacing.md]}>
                          <Col xs={24} sm={12} md={8} lg={6}>
                            <Input
                              allowClear
                              size="middle"
                              placeholder="搜索赛事/操作人/时间"
                              prefix={<SearchOutlined />}
                              value={sessionKeyword}
                              onChange={(e) => setSessionKeyword(e.target.value)}
                              style={{ width: '100%' }}
                            />
                          </Col>
                          <Col xs={24} sm={12} md={8} lg={6}>
                            <Select
                              allowClear
                              placeholder="按赛事筛选"
                              style={{ width: '100%' }}
                              value={sessionFilter.event_id}
                              onChange={(v) =>
                                setSessionFilter((f) => ({ ...f, event_id: v, page: 1 }))
                              }
                              options={eventStore.events.map((e) => ({
                                label: e.name,
                                value: e.id
                              }))}
                            />
                          </Col>
                          <Col xs={24} sm={24} md={8} lg={12}>
                            <Space wrap>
                              <RangePicker
                                showTime
                                style={{ width: 380 }}
                                onChange={(dates) => {
                                  const start = dates?.[0]?.toISOString();
                                  const end = dates?.[1]?.toISOString();
                                  setSessionFilter((f) => ({
                                    ...f,
                                    startTime: start,
                                    endTime: end,
                                    page: 1
                                  }));
                                }}
                              />
                              <Button
                                icon={<ReloadOutlined />}
                                onClick={() => void loadSessions()}
                                loading={drawStore.loading}
                              >
                                刷新
                              </Button>
                            </Space>
                          </Col>
                        </Row>
                      </Card>

                      {/* 导出操作行 */}
                      <Card size="small" style={{ marginBottom: spacing.md, background: token.colorFillQuaternary }}>
                        <Space wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>导出格式：</Text>
                          <Select
                            style={{ width: 140 }}
                            value={sessionExportFormat}
                            onChange={(v: ExportFormat) => setSessionExportFormat(v)}
                            options={[
                              { label: 'Excel (.xlsx)', value: 'xlsx' },
                              { label: 'CSV (.csv)', value: 'csv' },
                              { label: 'JSON (.json)', value: 'json' }
                            ]}
                          />
                          <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            onClick={() => void handleExportSessions(sessionExportFormat)}
                          >
                            导出抽取记录
                          </Button>
                        </Space>
                      </Card>

                      <Table
                        columns={sessionColumns}
                        dataSource={filteredSessions}
                        rowKey="id"
                        size="small"
                        loading={{
                          spinning: drawStore.loading,
                          indicator: undefined
                        }}
                        pagination={{
                          current: sessionFilter.page,
                          pageSize: sessionFilter.pageSize,
                          total: drawStore.total,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 15, 30, 50],
                          showTotal: (t) => `共 ${t} 条记录`,
                          onChange: (page, pageSize) =>
                            setSessionFilter((f) => ({ ...f, page, pageSize }))
                        }}
                        expandable={{
                          expandedRowKeys,
                          onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
                          expandedRowRender: (record) => renderSessionDetail(record),
                          rowExpandable: () => true,
                          expandIcon: ({ expanded, onExpand, record }) =>
                            expanded ? (
                              <DownOutlined
                                onClick={(e) => onExpand(record, e)}
                                style={{ cursor: 'pointer', color: '#1677ff' }}
                              />
                            ) : (
                              <RightOutlined
                                onClick={(e) => onExpand(record, e)}
                                style={{ cursor: 'pointer', color: token.colorTextSecondary }}
                              />
                            )
                        }}
                        rowClassName={(record) =>
                          expandedRowKeys.includes(record.id) ? 'history-row-expanded' : ''
                        }
                        locale={{
                          emptyText: <Empty description="暂无抽取记录" />
                        }}
                      />
                    </div>
                  )
                },
                {
                  key: 'logs',
                  label: (
                    <Badge count={auditStore.total} showZero offset={[8, 0]}>
                      <Space>
                        <AuditOutlined />
                        <span>操作日志</span>
                      </Space>
                    </Badge>
                  ),
                  children: (
                    <div>
                      {/* 操作日志筛选条 */}
                      <Card size="small" style={{ marginBottom: spacing.md, background: token.colorFillQuaternary }}>
                        <Row gutter={[spacing.md, spacing.md]}>
                          <Col xs={24} sm={12} md={6}>
                            <Select
                              allowClear
                              placeholder="按操作类型筛选"
                              style={{ width: '100%' }}
                              value={logFilter.action}
                              onChange={(v) =>
                                setLogFilter((f) => ({ ...f, action: v, page: 1 }))
                              }
                              options={Object.entries(ACTION_TAG).map(([k, v]) => ({
                                label: v.label,
                                value: k
                              }))}
                            />
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Select
                              allowClear
                              placeholder="按目标类型筛选"
                              style={{ width: '100%' }}
                              value={logFilter.target_type}
                              onChange={(v) =>
                                setLogFilter((f) => ({ ...f, target_type: v, page: 1 }))
                              }
                              options={[
                                { label: 'topic', value: 'topic' },
                                { label: 'event', value: 'event' },
                                { label: 'round', value: 'round' },
                                { label: 'team', value: 'team' },
                                { label: 'drawSession', value: 'drawSession' },
                                { label: 'system', value: 'system' }
                              ]}
                            />
                          </Col>
                          <Col xs={24} sm={24} md={12}>
                            <Space wrap>
                              <RangePicker
                                showTime
                                style={{ width: 380 }}
                                onChange={(dates) => {
                                  const start = dates?.[0]?.toISOString();
                                  const end = dates?.[1]?.toISOString();
                                  setLogFilter((f) => ({
                                    ...f,
                                    startTime: start,
                                    endTime: end,
                                    page: 1
                                  }));
                                }}
                              />
                              <Button
                                icon={<ReloadOutlined />}
                                onClick={() => {
                                  const rangeFilter = getTimeRangeFilter(timeRange);
                                  void auditStore.listLogs({ ...logFilter, ...rangeFilter });
                                }}
                                loading={auditStore.loading}
                              >
                                刷新
                              </Button>
                            </Space>
                          </Col>
                        </Row>
                      </Card>

                      {/* 导出 + 清空操作行 */}
                      <Card size="small" style={{ marginBottom: spacing.md, background: token.colorFillQuaternary }}>
                        <Space wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>导出格式：</Text>
                          <Select
                            style={{ width: 140 }}
                            value={logExportFormat}
                            onChange={(v: 'csv' | 'json') => setLogExportFormat(v)}
                            options={[
                              { label: 'CSV (.csv)', value: 'csv' },
                              { label: 'JSON (.json)', value: 'json' }
                            ]}
                          />
                          <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            onClick={() => void handleExportLogs(logExportFormat)}
                          >
                            导出日志
                          </Button>
                          <Popconfirm
                            title="确认清空所有操作日志？"
                            description="将永久删除全部操作日志记录，此操作不可恢复。建议先导出备份后再清空。"
                            onConfirm={handleClearLogs}
                            okText="清空"
                            okType="danger"
                            cancelText="取消"
                          >
                            <Button danger icon={<DeleteOutlined />}>
                              清空日志
                            </Button>
                          </Popconfirm>
                        </Space>
                      </Card>

                      <Table
                        columns={logColumns}
                        dataSource={auditStore.items}
                        rowKey="id"
                        size="small"
                        loading={{
                          spinning: auditStore.loading,
                          indicator: undefined
                        }}
                        pagination={{
                          current: logFilter.page,
                          pageSize: logFilter.pageSize,
                          total: auditStore.total,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 15, 30, 50],
                          showTotal: (t) => `共 ${t} 条日志`,
                          onChange: (page, pageSize) =>
                            setLogFilter((f) => ({ ...f, page, pageSize }))
                        }}
                        locale={{
                          emptyText: <Empty description="暂无操作日志" />
                        }}
                      />
                    </div>
                  )
                }
              ]}
            />
          </Card>
        </Content>
      </Layout>
    </>
  );
}
