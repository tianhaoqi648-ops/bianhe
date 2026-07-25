import { useEffect, useState, useMemo } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Empty,
  Spin,
  Typography,
  Tag,
  Card,
  Tabs,
  Input,
  Select,
  DatePicker,
  Popconfirm,
  Modal,
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HistoryOutlined,
  ReloadOutlined,
  SearchOutlined,
  AuditOutlined,
  DeleteOutlined
} from '@ant-design/icons';
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

const { Content } = Layout;
const { Text } = Typography;
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

  // 展开行：每个 session 的明细缓存
  const [detailCache, setDetailCache] = useState<Record<string, DrawSessionDetail>>({});
  // 题库与赛事映射
  const [topicMap, setTopicMap] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, string>>(new Map());
  const [eventNameMap, setEventNameMap] = useState<Map<string, string>>(new Map());

  // ====== 数据加载 ======
  // zustand store 实例在组件生命周期内稳定，空依赖是正确写法
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void eventStore.listEvents();
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
  }, []);

  // 构建 eventName 映射
  useEffect(() => {
    const m = new Map<string, string>();
    eventStore.events.forEach((e) => m.set(e.id, e.name));
    setEventNameMap(m);
  }, [eventStore.events]);

  // 构建 topic 映射
  useEffect(() => {
    const m = new Map<string, string>();
    topicStore.items.forEach((t) => m.set(t.id, t.title));
    setTopicMap(m);
  }, [topicStore.items]);

  // 加载抽取记录
  const loadSessions = async () => {
    await drawStore.listSessions(sessionFilter);
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
  }, [activeTab, sessionFilter]);

  // 加载操作日志
  useEffect(() => {
    if (activeTab === 'logs') {
      void auditStore.listLogs(logFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, logFilter]);

  // ====== 抽取记录操作 ======
  const handleViewSessionDetail = async (sessionId: string) => {
    if (detailCache[sessionId]) return;
    try {
      const detail = await drawStore.getSession(sessionId);
      if (detail) {
        setDetailCache((c) => ({ ...c, [sessionId]: detail }));
      }
    } catch (e) {
      messageApi.error('加载明细失败');
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
      const res = await window.exportAPI.exportDrawSessions({
        filter: sessionFilter,
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
      const res = await window.auditAPI.exportLogs({
        filter: logFilter,
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
          void auditStore.listLogs(logFilter);
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
      width: 180,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN') : <Text type="secondary">-</Text>
    },
    {
      title: '所属赛事',
      dataIndex: 'event_id',
      key: 'event_id',
      render: (eventId: string) => (
        <Tag color="blue">{eventNameMap.get(eventId) ?? eventId.slice(0, 8)}</Tag>
      )
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 120,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
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
      width: 180,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN') : <Text type="secondary">-</Text>
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
      width: 120,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (detail: Record<string, any> | null) => {
        if (!detail) return <Text type="secondary">-</Text>;
        return (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {JSON.stringify(detail)}
          </Text>
        );
      }
    }
  ];

  // 展开行渲染
  const renderSessionDetail = (session: DrawSession) => {
    const detail = detailCache[session.id];
    if (!detail) {
      return (
        <div style={{ padding: 12 }}>
          <Spin tip="加载明细中..." />
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
        <Content style={{ padding: '0 16px 16px', overflow: 'auto' }}>
          <Card
            size="small"
            style={{ background: token.colorBgContainer }}
            title={
              <Space>
                <HistoryOutlined style={{ color: '#1677ff' }} />
                <Text strong>历史记录</Text>
              </Space>
            }
          >
            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as 'sessions' | 'logs')}
              items={[
                {
                  key: 'sessions',
                  label: (
                    <Space>
                      <HistoryOutlined />
                      <span>抽取记录</span>
                      <Tag style={{ marginInlineStart: 4 }}>{drawStore.total}</Tag>
                    </Space>
                  ),
                  children: (
                    <div>
                      {/* 抽取记录筛选条 */}
                      <Space wrap style={{ marginBottom: 12 }}>
                        <Input
                          allowClear
                          size="middle"
                          placeholder="搜索赛事/操作人/时间"
                          prefix={<SearchOutlined />}
                          value={sessionKeyword}
                          onChange={(e) => setSessionKeyword(e.target.value)}
                          style={{ width: 280 }}
                        />
                        <Select
                          allowClear
                          placeholder="按赛事筛选"
                          style={{ width: 200 }}
                          value={sessionFilter.event_id}
                          onChange={(v) =>
                            setSessionFilter((f) => ({ ...f, event_id: v, page: 1 }))
                          }
                          options={eventStore.events.map((e) => ({
                            label: e.name,
                            value: e.id
                          }))}
                        />
                        <RangePicker
                          showTime
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
                        <Select
                          placeholder="导出格式"
                          style={{ width: 120 }}
                          onChange={(v: ExportFormat) => void handleExportSessions(v)}
                          options={[
                            { label: '导出 Excel', value: 'xlsx' },
                            { label: '导出 CSV', value: 'csv' },
                            { label: '导出 JSON', value: 'json' }
                          ]}
                        />
                      </Space>

                      <Table
                        columns={sessionColumns}
                        dataSource={filteredSessions}
                        rowKey="id"
                        size="small"
                        loading={drawStore.loading}
                        pagination={{
                          current: sessionFilter.page,
                          pageSize: sessionFilter.pageSize,
                          total: drawStore.total,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 15, 30, 50],
                          onChange: (page, pageSize) =>
                            setSessionFilter((f) => ({ ...f, page, pageSize }))
                        }}
                        expandable={{
                          expandedRowRender: (record) => renderSessionDetail(record),
                          rowExpandable: () => true
                        }}
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
                    <Space>
                      <AuditOutlined />
                      <span>操作日志</span>
                      <Tag style={{ marginInlineStart: 4 }}>{auditStore.total}</Tag>
                    </Space>
                  ),
                  children: (
                    <div>
                      {/* 操作日志筛选条 */}
                      <Space wrap style={{ marginBottom: 12 }}>
                        <Select
                          allowClear
                          placeholder="按操作类型筛选"
                          style={{ width: 160 }}
                          value={logFilter.action}
                          onChange={(v) =>
                            setLogFilter((f) => ({ ...f, action: v, page: 1 }))
                          }
                          options={Object.entries(ACTION_TAG).map(([k, v]) => ({
                            label: v.label,
                            value: k
                          }))}
                        />
                        <Select
                          allowClear
                          placeholder="按目标类型筛选"
                          style={{ width: 160 }}
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
                        <RangePicker
                          showTime
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
                          onClick={() => void auditStore.listLogs(logFilter)}
                          loading={auditStore.loading}
                        >
                          刷新
                        </Button>
                        <Select
                          placeholder="导出格式"
                          style={{ width: 140 }}
                          onChange={(v: 'csv' | 'json') => void handleExportLogs(v)}
                          options={[
                            { label: '导出日志 CSV', value: 'csv' },
                            { label: '导出日志 JSON', value: 'json' }
                          ]}
                        />
                        <Popconfirm
                          title="确认清空所有操作日志？"
                          okText="清空"
                          okType="danger"
                          cancelText="取消"
                          onConfirm={handleClearLogs}
                        >
                          <Button danger icon={<DeleteOutlined />}>
                            清空日志
                          </Button>
                        </Popconfirm>
                      </Space>

                      <Table
                        columns={logColumns}
                        dataSource={auditStore.items}
                        rowKey="id"
                        size="small"
                        loading={auditStore.loading}
                        pagination={{
                          current: logFilter.page,
                          pageSize: logFilter.pageSize,
                          total: auditStore.total,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 15, 30, 50],
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
