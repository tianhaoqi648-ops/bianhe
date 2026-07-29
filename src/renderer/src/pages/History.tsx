import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Layout,
  Table,
  Button,
  Space,
  Skeleton,
  Typography,
  Tag,
  Card,
  Tabs,
  Input,
  Select,
  DatePicker,
  Descriptions,
  Popconfirm,
  Modal,
  Segmented,
  Row,
  Col,
  Badge,
  Avatar,
  Timeline,
  Pagination,
  Tooltip,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import EmptyState from '../components/common/EmptyState';
import AccentCard from '../components/common/AccentCard';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import LineChart from '../components/common/LineChart';
import DonutChart from '../components/common/DonutChart';
import {
  HistoryOutlined,
  ReloadOutlined,
  SearchOutlined,
  AuditOutlined,
  DeleteOutlined,
  CalendarOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  DatabaseOutlined
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
  pageContainerStyle
} from '../styles/shared';
import { spacing, fontSize, colorPrimary, colorGold, colorPurple, gray } from '../styles/tokens';
import { useToast } from '../hooks/useToast';
import { useMediaQuery } from '../hooks/useMediaQuery';

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

// 操作日志详情字段的中文映射
const DETAIL_KEY_LABELS: Record<string, string> = {
  topic_id: '辩题 ID',
  session_id: '抽取会话 ID',
  event_id: '赛事 ID',
  round_id: '轮次 ID',
  team_id: '队伍 ID',
  format_id: '赛制 ID',
  count: '数量',
  action: '操作',
  timestamp: '时间戳'
};

/**
 * 结构化格式化操作日志详情
 * - key 翻译为中文标签（未映射的 key 保持原样）
 * - value 智能格式化（时间戳、JSON 字符串、数组、对象等）
 */
function formatLogDetail(detail: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(detail).map(([key, value]) => {
    const label = DETAIL_KEY_LABELS[key] ?? key;
    let formatted: string;
    if (typeof value === 'number' && value > 1000000000000) {
      // 时间戳（毫秒级）
      formatted = new Date(value).toLocaleString('zh-CN');
    } else if (Array.isArray(value)) {
      formatted = value.join(', ');
    } else if (value !== null && typeof value === 'object') {
      formatted = JSON.stringify(value, null, 2);
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            formatted = parsed.join(', ');
          } else if (typeof parsed === 'object' && parsed !== null) {
            formatted = JSON.stringify(parsed, null, 2);
          } else {
            formatted = value;
          }
        } catch {
          formatted = value;
        }
      } else {
        formatted = value;
      }
    } else {
      formatted = String(value);
    }
    return { label, value: formatted };
  });
}

type TimeRange = 'today' | 'week' | 'month' | 'all';

export default function History() {
  const { token } = theme.useToken();
  const drawStore = useDrawStore();
  const auditStore = useAuditStore();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const toast = useToast();
  // 移动端（<768px）RangePicker 自适应整宽
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [activeTab, setActiveTab] = useState<'sessions' | 'logs'>('sessions');

  // 抽取记录筛选 — 默认最近 30 天
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>(() => ({
    page: 1,
    pageSize: 15,
    startTime: dayjs().subtract(30, 'day').startOf('day').toISOString(),
    endTime: dayjs().endOf('day').toISOString()
  }));
  // 日期范围筛选器受控值（与 sessionFilter.startTime/endTime 同步）
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day')
  ]);
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
  // 当前展开的 session id 集合（时间线视图展开明细）
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // P3-19 修复：记录已请求过的 topicId，避免 fetchTopicTitleAsync 重复请求导致渲染循环
  const loadedTopicIdsRef = useRef<Set<string>>(new Set());
  // 题库与赛事映射
  const [topicMap, setTopicMap] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, string>>(new Map());
  const [eventNameMap, setEventNameMap] = useState<Map<string, string>>(new Map());

  // ====== 顶部 StatCard 统计数据 ======
  const [monthDrawCount, setMonthDrawCount] = useState<number>(0);
  // P1-13 修复：原 duration_ms 字段不存在，改为统计「本月计时次数」
  const [monthTimerCount, setMonthTimerCount] = useState<number>(0);
  const [topicTotal, setTopicTotal] = useState<number>(0);
  // P2-34 修复：单独拉取一次全量 total（不应用筛选），用于「总抽取次数」StatCard
  // 避免 drawStore.total 随筛选条件变化导致语义错位
  const [totalDrawCount, setTotalDrawCount] = useState<number>(0);

  // ====== 近 7 天抽取次数（折线图） ======
  const [weekDailyCounts, setWeekDailyCounts] = useState<{ date: string; value: number }[]>([]);

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
      // 拉取全量辩题（不过滤 status），确保 topicMap 包含所有辩题
      void topicStore.fetchList({ pageSize: 10000 });
    }
  }, []);

  // ====== 顶部 StatCard 数据拉取 ======
  // 拉取本月抽取次数、本月计时次数、题库总量
  // P1-13 修复：原代码读取不存在的 duration_ms 字段导致「累计时长」永远显示「—」。
  // 现改为通过 timerAPI.listSessions 拉取计时器会话，统计本月计时次数。
  // P3-12 修复：依赖数组加入 activeTab/timeRange，切换标签页或时间范围时刷新统计数据
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const now = dayjs();
        const startTime = now.startOf('month').toISOString();
        const endTime = now.toISOString();

        // 并行拉取本月抽取 sessions、题库总数、计时器会话列表
        const [sessionRes, topicRes, timerRes] = await Promise.all([
          window.drawAPI.listSessions({
            startTime,
            endTime,
            page: 1,
            pageSize: 100
          }),
          window.topicAPI.list({ page: 1, pageSize: 1 }),
          window.timerAPI.listSessions(1000)
        ]);

        // 本月抽取次数：取 total
        let monthCount = 0;
        if (sessionRes.success && sessionRes.data) {
          monthCount = sessionRes.data.total;
        }

        // 题库总量：取 total
        let total = 0;
        if (topicRes.success && topicRes.data) {
          total = topicRes.data.total;
        }

        // 本月计时次数：筛选 startedAt 在本月的计时器会话
        // timerAPI.listSessions 仅支持 limit 参数，需在客户端按月份过滤
        let timerCount = 0;
        if (timerRes.success && timerRes.data) {
          const monthKey = now.format('YYYY-MM');
          timerRes.data.forEach((s) => {
            if (!s.startedAt) return;
            if (dayjs(s.startedAt).format('YYYY-MM') === monthKey) {
              timerCount += 1;
            }
          });
        }

        setMonthDrawCount(monthCount);
        setMonthTimerCount(timerCount);
        setTopicTotal(total);

        // P2-34 修复：单独拉取一次全量 total（不应用任何筛选）
        const totalRes = await window.drawAPI.listSessions({
          page: 1,
          pageSize: 1
        });
        if (totalRes.success && totalRes.data) {
          setTotalDrawCount(totalRes.data.total);
        }
      } catch (e) {
        console.error('加载顶部统计卡片数据失败', e);
      }
    };
    void fetchStats();
  }, [activeTab, timeRange]);

  // ====== 近 7 天抽取次数（折线图数据） ======
  // 拉取近 7 天的抽取会话，按日期聚合统计每日抽取次数
  // P3-12 修复：依赖数组加入 activeTab/timeRange，切换标签页或时间范围时刷新折线图
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fetchWeekDaily = async () => {
      try {
        const now = dayjs();
        const startTime = now.subtract(6, 'day').startOf('day').toISOString();
        const endTime = now.endOf('day').toISOString();
        const res = await window.drawAPI.listSessions({
          startTime,
          endTime,
          page: 1,
          pageSize: 10000
        });
        if (res.success && res.data) {
          // 初始化近 7 天日期，默认 0 次
          const countMap = new Map<string, number>();
          for (let i = 6; i >= 0; i--) {
            const d = now.subtract(i, 'day');
            countMap.set(d.format('YYYY-MM-DD'), 0);
          }
          // 按日期聚合统计
          res.data.items.forEach((s) => {
            if (!s.draw_time) return;
            const dateKey = dayjs(s.draw_time).format('YYYY-MM-DD');
            countMap.set(dateKey, (countMap.get(dateKey) ?? 0) + 1);
          });
          // 转为有序数组
          const arr = Array.from(countMap.entries()).map(([date, value]) => ({ date, value }));
          setWeekDailyCounts(arr);
        }
      } catch (e) {
        console.error('加载近7天抽取数据失败', e);
      }
    };
    void fetchWeekDaily();
  }, [activeTab, timeRange]);

  // 构建 eventName 映射
  useEffect(() => {
    const names = new Map<string, string>();
    eventStore.events.forEach((e) => {
      names.set(e.id, e.name);
    });
    setEventNameMap(names);
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
    // 清空 detailCache，避免重抽后看到旧数据
    setDetailCache({});
    // P3-14 修复：同时清空 expandedKeys，避免已删除/已过期的 session 仍处于展开状态
    setExpandedKeys(new Set());
    // P2-42 修复：原 for...of 串行 await 改为 Promise.all 并行拉取
    // 多赛事场景下可显著缩短加载时间
    const eventIds = new Set<string>();
    eventStore.events.forEach((e) => eventIds.add(e.id));
    const teamResults = await Promise.all(
      Array.from(eventIds).map((eid) => window.eventAPI.listTeamsByEvent(eid))
    );
    const teamM = new Map<string, string>();
    teamResults.forEach((res) => {
      if (res.success && res.data) {
        (res.data as any[]).forEach((t) => teamM.set(t.id, t.name));
      }
    });
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
  // 今日抽取 / 本周抽取 / 重抽次数
  // 注：总抽取次数已移至 totalDrawCount（独立拉取全量 total，不随筛选变化）
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
      redraw: redrawCount
    };
  }, [drawStore.sessions, auditStore.items]);

  // ====== 操作类型分布（饼图） ======
  // 按 action 聚合当前加载的操作日志，映射为 DonutChart 数据
  const actionDistribution = useMemo(() => {
    const countMap = new Map<string, number>();
    auditStore.items.forEach((log) => {
      const action = log.action ?? 'unknown';
      countMap.set(action, (countMap.get(action) ?? 0) + 1);
    });
    // action → CSS 颜色（复用 token + antd 主题色）
    const colorMap: Record<string, string> = {
      draw: colorPrimary,
      redraw: colorGold,
      create: token.colorSuccess,
      update: '#13c2c2',
      delete: token.colorError,
      import: colorPurple,
      export: '#2f54eb',
      system: gray[500],
      dedup_delete: '#eb2f96'
    };
    return Array.from(countMap.entries())
      .map(([action, value]) => ({
        label: ACTION_TAG[action]?.label ?? action,
        value,
        color: colorMap[action] ?? gray[500]
      }))
      .sort((a, b) => b.value - a.value);
    // token.colorSuccess/colorError 为原始字符串，作为稳定依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditStore.items, token.colorSuccess, token.colorError]);

  // ====== 抽取记录操作 ======
  /** 异步获取辩题标题并更新 detailCache（snapshot + topicMap 均未命中时调用） */
  const fetchTopicTitleAsync = async (topicId: string, sessionId: string, itemId: string) => {
    try {
      const res = await window.topicAPI.get(topicId);
      if (res.success && res.data) {
        // 更新 detailCache 中对应 session 的对应 item 的 topic_title
        setDetailCache((prev) => {
          const sessionDetail = prev[sessionId];
          if (!sessionDetail) return prev;
          const updatedItems = sessionDetail.items.map((it) =>
            it.id === itemId ? { ...it, topic_title: res.data!.title } : it
          );
          return {
            ...prev,
            [sessionId]: { ...sessionDetail, items: updatedItems }
          };
        });
      }
    } catch {
      // 辩题真的不存在，保持「（已删除辩题）」显示
    }
  };

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
      toast.error(e instanceof Error ? e.message : '加载明细失败');
    }
  };

  // P2-35 修复：将原 renderSessionDetail 渲染期间的 setTimeout 异步拉取逻辑移到 useEffect
  // 监听 detailCache / topicMap 变化时扫描未命中 item 并批量拉取（fetchTopicTitleAsync 内部
  // 会更新对应 item 的 topic_title，触发 detailCache 变化但已命中 item 不会再触发，无死循环）
  // P3-19 修复：用 loadedTopicIdsRef 记录已请求的 topicId，避免 fetchTopicTitleAsync 失败后
  // 重复触发（detailCache 变化时 effect 重新扫描，未命中的 item 会再次入队 → 无限循环）
  useEffect(() => {
    const missing: Array<{ topicId: string; sessionId: string; itemId: string }> = [];
    Object.entries(detailCache).forEach(([sessionId, detail]) => {
      detail.items.forEach((it) => {
        if (!it.topic_title && !topicMap.has(it.topic_id) && !loadedTopicIdsRef.current.has(it.topic_id)) {
          missing.push({ topicId: it.topic_id, sessionId, itemId: it.id });
        }
      });
    });
    if (missing.length === 0) return;
    missing.forEach(({ topicId, sessionId, itemId }) => {
      loadedTopicIdsRef.current.add(topicId);
      void fetchTopicTitleAsync(topicId, sessionId, itemId);
    });
  }, [detailCache, topicMap]);

  // ====== 删除抽取记录（分级确认） ======
  // 测试记录轻量确认即可；正式记录需在弹窗中输入"确认删除"四字才能激活删除按钮
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    session: DrawSession | null;
    confirmText: string;
  }>({
    open: false,
    session: null,
    confirmText: ''
  });

  const handleDeleteClick = (session: DrawSession) => {
    if (session.settings?.is_test) {
      // 测试记录：轻量确认
      Modal.confirm({
        title: '确认删除这条测试记录？',
        content: '删除后不可恢复，且该 session 抽过的辩题将不再被"本赛事已抽"排除。',
        okText: '确认删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            const res = await window.drawAPI.deleteSession(session.id);
            if (res.success) {
              toast.success('删除成功');
              void loadSessions();
            } else {
              toast.error(res.error || '删除失败');
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '删除失败');
          }
        }
      });
    } else {
      // 正式记录：强确认（需输入"确认删除"激活按钮）
      setDeleteModal({ open: true, session, confirmText: '' });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal.session) return;
    try {
      const res = await window.drawAPI.deleteSession(deleteModal.session.id);
      if (res.success) {
        toast.success('删除成功');
        setDeleteModal({ open: false, session: null, confirmText: '' });
        void loadSessions();
      } else {
        toast.error(res.error || '删除失败');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
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
      toast.success(`已导出 ${res.data.count} 条记录到：${res.data.filePath}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
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
      toast.success(`已导出 ${res.data.count} 条日志到：${res.data.filePath}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
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
          toast.success('日志已清空');
          const rangeFilter = getTimeRangeFilter(timeRange);
          void auditStore.listLogs({ ...logFilter, ...rangeFilter });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '清空失败');
        }
      }
    });
  };

  // ====== 表格列定义 ======
  // P3-13 限制说明：关键词搜索为本地过滤，仅覆盖当前页数据（drawStore.sessions）。
  // 后端 SessionFilter 不支持 keyword 参数，因此跨页搜索无法实现。
  // 如需全量搜索，需后端 listSessions 增加 keyword 参数并在此处传递。
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

  // ====== 时间线视图：按日期分组 ======
  // 格式化日期组标题：YYYY-MM-DD 周X
  const formatDateGroupLabel = (d: dayjs.Dayjs): string => {
    const dateStr = d.format('YYYY-MM-DD');
    const weekday = new Date(d.toISOString()).toLocaleDateString('zh-CN', { weekday: 'short' });
    return `${dateStr} ${weekday}`;
  };

  // 按日期分组，组内按时间倒序，日期组按倒序（最新在前）
  // P3-20 限制说明：draw_time 为 null 的 session 会被跳过，但 drawStore.total（后端返回）
  // 包含这些 session，导致 Pagination total 与实际展示条数可能不一致。
  // 此处不调整 total，因为跨页的 null draw_time session 数量未知，强行调整会导致分页计算错误。
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, { label: string; items: DrawSession[] }>();
    filteredSessions.forEach((s) => {
      if (!s.draw_time) return;
      const d = dayjs(s.draw_time);
      const dateKey = d.format('YYYY-MM-DD');
      if (!groups.has(dateKey)) {
        groups.set(dateKey, { label: formatDateGroupLabel(d), items: [] });
      }
      groups.get(dateKey)!.items.push(s);
    });
    const result = Array.from(groups.values());
    // 组内按时间倒序
    result.forEach((g) => {
      g.items.sort((a, b) => {
        const ta = a.draw_time ? new Date(a.draw_time).getTime() : 0;
        const tb = b.draw_time ? new Date(b.draw_time).getTime() : 0;
        return tb - ta;
      });
    });
    // 日期组按倒序排列（最新日期在前）
    result.sort((a, b) => {
      const da = a.items[0]?.draw_time ? new Date(a.items[0].draw_time).getTime() : 0;
      const db = b.items[0]?.draw_time ? new Date(b.items[0].draw_time).getTime() : 0;
      return db - da;
    });
    return result;
  }, [filteredSessions]);

  // 所有 session 的 key 集合（用于「全部展开/收起」）
  const allSessionKeys = useMemo(
    () => filteredSessions.map((s) => s.id),
    [filteredSessions]
  );

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
            <Avatar size="small" style={{ background: colorPurple, flexShrink: 0 }}>
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
      render: (detail: Record<string, unknown> | null) => {
        if (!detail || Object.keys(detail).length === 0) {
          return <Text type="secondary">-</Text>;
        }
        const items = formatLogDetail(detail);
        return (
          <Descriptions column={1} size="small" bordered>
            {items.map((it, idx) => (
              <Descriptions.Item key={`${it.label}-${idx}`} label={it.label}>
                {/* P4-21 修复：长文本默认折叠（2 行），点击展开 */}
                {it.value.length > 80 ? (
                  <Typography.Paragraph
                    ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                    style={{ marginBottom: 0 }}
                  >
                    {it.value}
                  </Typography.Paragraph>
                ) : (
                  it.value
                )}
              </Descriptions.Item>
            ))}
          </Descriptions>
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
    const rows: DrawnItemRow[] = detail.items.map((it, i) => {
      const hasSnapshot = !!it.topic_title;
      const hasMap = topicMap.has(it.topic_id);
      let topicTitle: string;
      if (hasSnapshot) {
        topicTitle = it.topic_title!;
      } else if (hasMap) {
        topicTitle = topicMap.get(it.topic_id)!;
      } else {
        // 快照与 map 均未命中：渲染占位文案，由下方 useEffect 异步拉取
        topicTitle = '加载中…';
      }
      return {
        key: `${it.id}-${i}`,
        topic_title: topicTitle,
        team_a: it.team_a_id
          ? (it.team_a_name ?? teamMap.get(it.team_a_id) ?? '（已删除队伍）')
          : '-',
        team_b: it.team_b_id
          ? (it.team_b_name ?? teamMap.get(it.team_b_id) ?? '（已删除队伍）')
          : '-',
        stance_a: it.stance_a,
        stance_b: it.stance_b
      };
    });
    const columns: ColumnsType<DrawnItemRow> = [
      {
        title: '辩题',
        dataIndex: 'topic_title',
        key: 'topic_title'
      },
      {
        title: 'A 方',
        dataIndex: 'team_a',
        key: 'team_a',
        width: 160,
        render: (v: string, record: DrawnItemRow) => (
          <Space direction="vertical" size={0}>
            <Text>{v}</Text>
            {record.stance_a && (
              <Tag color={record.stance_a === '正方' ? 'blue' : 'red'} style={{ marginInlineEnd: 0 }}>
                {record.stance_a}
              </Tag>
            )}
          </Space>
        )
      },
      {
        title: 'B 方',
        dataIndex: 'team_b',
        key: 'team_b',
        width: 160,
        render: (v: string, record: DrawnItemRow) => (
          <Space direction="vertical" size={0}>
            <Text>{v}</Text>
            {record.stance_b && (
              <Tag color={record.stance_b === '正方' ? 'blue' : 'red'} style={{ marginInlineEnd: 0 }}>
                {record.stance_b}
              </Tag>
            )}
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
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, overflow: 'auto' }}>
          <PageHeader title="抽取历史" subtitle="查看所有抽取记录与统计" />
          {/* 顶部 StatCard 统计卡片：总抽取次数 / 本月抽取 / 累计时长 / 题库总量 */}
          <Row gutter={[spacing.lg, spacing.lg]} style={{ marginBottom: spacing.md }}>
            <Col xs={24} sm={12} md={6}>
              <Tooltip title={`今日 ${stats.today} 次 / 本周 ${stats.week} 次`}>
                <StatCard
                  label="总抽取次数"
                  value={totalDrawCount}
                  icon={<ThunderboltOutlined />}
                  color="primary"
                />
              </Tooltip>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <StatCard
                label="本月抽取"
                value={monthDrawCount}
                icon={<HistoryOutlined />}
                color="gold"
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <StatCard
                label="本月计时次数"
                value={monthTimerCount}
                icon={<ClockCircleOutlined />}
                color="primary"
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <StatCard
                label="题库总量"
                value={topicTotal}
                icon={<DatabaseOutlined />}
                color="purple"
              />
            </Col>
          </Row>

          {/* 近 7 天抽取次数折线图 */}
          <Card
            title="近 7 天抽取次数"
            size="small"
            style={{ marginBottom: spacing.md }}
          >
            {weekDailyCounts.length > 0 ? (
              <LineChart data={weekDailyCounts} color={colorPrimary} height={200} />
            ) : (
              <EmptyState type="default" description="暂无数据" style={{ padding: spacing.xl }} />
            )}
          </Card>

          <AccentCard
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
                      {/* 筛选 + 导出操作行（合并单 Card 两行布局） */}
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
                                style={{ width: isMobile ? '100%' : 380 }}
                                value={dateRange}
                                onChange={(dates) => {
                                  const start = dates?.[0]?.toISOString();
                                  const end = dates?.[1]?.toISOString();
                                  setDateRange(dates ? [dates[0], dates[1]] : [null, null]);
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
                        <Row gutter={[spacing.md, spacing.md]} style={{ marginTop: spacing.md }}>
                          <Col span={24}>
                            <Space wrap>
                              <Text type="secondary" style={{ fontSize: fontSize.caption }}>导出格式：</Text>
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
                          </Col>
                        </Row>
                      </Card>

                      {/* 时间线视图：按日期分组 */}
                      {/* 全部展开 / 全部收起 工具栏 */}
                      {allSessionKeys.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            marginBottom: spacing.sm
                          }}
                        >
                          {expandedKeys.size === allSessionKeys.length ? (
                            <Button size="small" onClick={() => setExpandedKeys(new Set())}>
                              全部收起
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              onClick={() => setExpandedKeys(new Set(allSessionKeys))}
                            >
                              全部展开
                            </Button>
                          )}
                        </div>
                      )}
                      <Skeleton
                        active
                        paragraph={{ rows: 4 }}
                        loading={drawStore.loading && groupedSessions.length === 0}
                      />
                      {!drawStore.loading && groupedSessions.length === 0 ? (
                        <EmptyState type="topic" description="暂无抽取记录" style={{ padding: spacing.xxxl }} />
                      ) : (
                        groupedSessions.map((group) => (
                          <div key={group.label} style={{ marginBottom: spacing.lg }}>
                            <Typography.Title
                              level={5}
                              style={{ marginLeft: spacing.sm, marginBottom: spacing.sm }}
                            >
                              {group.label}
                            </Typography.Title>
                            <Timeline
                              items={group.items.map((session, index) => {
                                const eventName = eventNameMap.get(session.event_id);
                                const detail = detailCache[session.id];
                                const isExpanded = expandedKeys.has(session.id);
                                return {
                                  color: '#faad14',
                                  children: (
                                    <div
                                      className={index < 8 ? 'fade-in-up-staggered' : undefined}
                                      style={{
                                        ...(index < 8 ? ({ '--i': index } as React.CSSProperties) : {}),
                                        paddingBottom: spacing.sm
                                      }}
                                    >
                                      <Space size={spacing.sm} wrap>
                                        <Text strong>
                                          {session.draw_time
                                            ? dayjs(session.draw_time).format('HH:mm')
                                            : '--:--'}
                                        </Text>
                                        {eventName && (
                                          <Tag color="blue">{eventName}</Tag>
                                        )}
                                        {session.settings?.is_test && (
                                          <Tag color="orange">测试</Tag>
                                        )}
                                        {session.operator && (
                                          <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                                            操作人：{session.operator}
                                          </Text>
                                        )}
                                      </Space>
                                      <div style={{ marginTop: spacing.xs }}>
                                        {detail ? (
                                          <Text type="secondary">
                                            {detail.items.length} 道题
                                          </Text>
                                        ) : (
                                          <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                                            点击「查看明细」加载题数
                                          </Text>
                                        )}
                                      </div>
                                      <Space size={spacing.xs} style={{ marginTop: spacing.xs }}>
                                        <Button
                                          size="small"
                                          type="link"
                                          onClick={() => {
                                            void handleViewSessionDetail(session.id);
                                            if (!isExpanded) {
                                              setExpandedKeys(
                                                new Set([...expandedKeys, session.id])
                                              );
                                            } else {
                                              const next = new Set(expandedKeys);
                                              next.delete(session.id);
                                              setExpandedKeys(next);
                                            }
                                          }}
                                        >
                                          {isExpanded ? '收起明细' : '查看明细'}
                                        </Button>
                                        <Button
                                          size="small"
                                          type="text"
                                          danger
                                          icon={<DeleteOutlined />}
                                          onClick={() => handleDeleteClick(session)}
                                        />
                                      </Space>
                                      {isExpanded && (
                                        <div style={{ marginTop: spacing.sm }}>
                                          {detail
                                            ? renderSessionDetail(session)
                                            : (
                                              <Skeleton active paragraph={{ rows: 2 }} />
                                            )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                };
                              })}
                            />
                          </div>
                        ))
                      )}

                      {/* 分页（保留原有分页功能） */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          marginTop: spacing.md
                        }}
                      >
                        <Pagination
                          current={sessionFilter.page}
                          pageSize={sessionFilter.pageSize}
                          total={drawStore.total}
                          showSizeChanger
                          pageSizeOptions={[10, 15, 30, 50]}
                          showTotal={(t) => `共 ${t} 条记录`}
                          onChange={(page, pageSize) =>
                            setSessionFilter((f) => ({ ...f, page, pageSize }))
                          }
                        />
                      </div>
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
                      {/* 操作类型分布饼图 */}
                      <Card
                        title="操作类型分布"
                        size="small"
                        style={{ marginBottom: spacing.md }}
                      >
                        {actionDistribution.length > 0 ? (
                          <DonutChart
                            data={actionDistribution}
                            centerLabel={String(auditStore.items.length)}
                            centerSublabel="操作总数"
                          />
                        ) : (
                          <EmptyState type="default" description="暂无数据" style={{ padding: spacing.xl }} />
                        )}
                      </Card>
                      {/* 筛选 + 导出操作行（合并单 Card 两行布局） */}
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
                                style={{ width: isMobile ? '100%' : 380 }}
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
                        <Row gutter={[spacing.md, spacing.md]} style={{ marginTop: spacing.md }}>
                          <Col span={24}>
                            <Space wrap>
                              <Text type="secondary" style={{ fontSize: fontSize.caption }}>导出格式：</Text>
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
                          </Col>
                        </Row>
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
                          emptyText: <EmptyState type="topic" description="暂无操作日志" />
                        }}
                      />
                    </div>
                  )
                }
              ]}
            />
          </AccentCard>
        </Content>
      </Layout>

      {/* 正式记录删除强确认 Modal：需输入"确认删除"四字才能激活删除按钮 */}
      <Modal
        open={deleteModal.open}
        title="删除正式抽取记录"
        onCancel={() => setDeleteModal({ open: false, session: null, confirmText: '' })}
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeleteModal({ open: false, session: null, confirmText: '' })}
          >
            取消
          </Button>,
          <Button
            key="delete"
            type="primary"
            danger
            disabled={deleteModal.confirmText !== '确认删除'}
            onClick={handleConfirmDelete}
          >
            确认删除
          </Button>
        ]}
      >
        <Typography.Paragraph>
          此操作不可恢复。删除后该 session 抽过的辩题将不再被&ldquo;本赛事已抽&rdquo;排除，可再次抽出。
        </Typography.Paragraph>
        <Typography.Paragraph>
          请在下方输入框输入 <Typography.Text strong>确认删除</Typography.Text> 四字以激活删除按钮：
        </Typography.Paragraph>
        <Input
          value={deleteModal.confirmText}
          onChange={(e) => setDeleteModal((prev) => ({ ...prev, confirmText: e.target.value }))}
          placeholder="确认删除"
        />
      </Modal>
    </>
  );
}
