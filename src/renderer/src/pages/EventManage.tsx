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
  Tabs,
  Popconfirm,
  Alert,
  Row,
  Col,
  Progress,
  Radio,
  Badge,
  Select,
  Tooltip,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import BrandSpin from '../components/common/BrandSpin';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import WorkflowCard from '../components/onboarding/WorkflowCard';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  TrophyOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  GroupOutlined,
  ImportOutlined,
  ExportOutlined,
  DatabaseOutlined,
  BookOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import AccentCard from '../components/common/AccentCard';
import StatCard from '../components/common/StatCard';
import DonutChart from '../components/common/DonutChart';
import ProgressRing from '../components/common/ProgressRing';
import { safeIpc } from '../lib/ipc';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import { useAgentStore } from '../stores/agentStore';
import type {
  Event,
  Round,
  Team,
  TeamHistory,
  TeamGroup,
  TeamGroupCreateInput,
  TeamGroupUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  DrawSessionDetail
} from '../../../shared/types';
import EventDrawsTab from '../components/events/EventDrawsTab';
import EventMatchesTab from '../components/events/EventMatchesTab';
import ImportEventModal from '../components/events/ImportEventModal';
import EventWizardModal from '../components/EventWizardModal';
import GroupEditModal from '../components/events/GroupEditModal';
import RandomGroupAssignModal from '../components/events/RandomGroupAssignModal';
import TopicGroupManagerModal from '../components/TopicGroupManagerModal';
import EventTopicBankModal from '../components/EventTopicBankModal';
import RoundEditModal from '../components/RoundEditModal';
import TeamEditModal from '../components/TeamEditModal';
import TeamHistoryModal from '../components/TeamHistoryModal';
import BadgePickerModal, { BadgeThumbSmall } from '../components/events/BadgePickerModal';
import {
  cardStyle,
  primaryButtonStyle,
  titleBarStyle,
  selectedStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing, shadow, transition, radius, fontSize } from '../styles/tokens';
import { useToast } from '../hooks/useToast';
// P4-18 修复：提取公共常量到 shared/difficulty-presets.ts，避免与 EventWizardModal 重复定义
import { DIFFICULTY_PRESETS } from '../../../shared/difficulty-presets';

const { Content } = Layout;
const { Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  preparing: { color: 'default', label: '筹备中' },
  ongoing: { color: 'processing', label: '进行中' },
  finished: { color: 'success', label: '已结束' }
};

// 视图模式持久化 key（列表 / 看板）
const EVENT_VIEW_MODE_STORAGE_KEY = 'bianhe-event-view-mode';

// 看板三列的状态 → 主题色映射（筹备=蓝、进行=金、已结束=灰）
const BOARD_COLUMN_COLOR: Record<'preparing' | 'ongoing' | 'finished', string> = {
  preparing: '#1677ff',
  ongoing: '#faad14',
  finished: '#8c8c8c'
};

export default function EventManage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const toast = useToast();

  // 选中的赛事（详情视图）
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  // 详情面板当前 Tab
  const [detailTab, setDetailTab] = useState<'teams' | 'rounds' | 'groups' | 'draws' | 'matches'>('teams');

  // 视图模式：列表 / 看板（默认列表，持久化到 localStorage）
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() => {
    try {
      const saved = localStorage.getItem(EVENT_VIEW_MODE_STORAGE_KEY);
      return saved === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  // 视图模式变化时同步到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(EVENT_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // 忽略写入失败（如禁用 localStorage）
    }
  }, [viewMode]);

  // 弹窗状态
  // 新建/编辑赛事向导弹窗（编辑模式 = editingWizardEvent 非 null）
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingWizardEvent, setEditingWizardEvent] = useState<Event | null>(null);
  const [roundModalOpen, setRoundModalOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<Round | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);
  // 分组编辑弹窗
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TeamGroup | null>(null);
  // 随机分组弹窗
  const [randomGroupModalOpen, setRandomGroupModalOpen] = useState(false);
  // 队伍分组筛选（'__none__' = 未分组；undefined = 全部）
  const [teamGroupFilter, setTeamGroupFilter] = useState<string | undefined>(undefined);
  // 队伍多选（批量分配分组）
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  // 批量分配分组弹窗
  const [batchAssignGroupId, setBatchAssignGroupId] = useState<string | null | undefined>(undefined);
  // 当前队伍历史
  const [teamHistory, setTeamHistory] = useState<TeamHistory[]>([]);
  // 队伍 → 队徽绑定（P1-6）：teamId → badgeId
  const [teamBadges, setTeamBadges] = useState<Record<string, string | null>>({});
  // 队徽选择弹窗（P1-6）
  const [badgePickerTeam, setBadgePickerTeam] = useState<Team | null>(null);
  // 预设弹窗
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  // 赛事导入弹窗
  const [importModalOpen, setImportModalOpen] = useState(false);
  // 题组管理（题库）弹窗
  const [topicGroupManagerOpen, setTopicGroupManagerOpen] = useState(false);
  // 赛事题库（T4）弹窗
  const [eventTopicBankOpen, setEventTopicBankOpen] = useState(false);
  // 赛事导出 loading
  const [exporting, setExporting] = useState(false);
  // 预设选中态（最近应用的方案）
  const [appliedPresetKey, setAppliedPresetKey] = useState<string | null>(null);
  // 预设卡片 hover 态
  const [hoveredPresetKey, setHoveredPresetKey] = useState<string | null>(null);

  // 赛事卡片统计：每个赛事的轮次数、队伍数与已完成轮次数
  // 已完成轮次 = 有抽取记录（DrawSession.round_id 命中）的轮次数
  const [eventStats, setEventStats] = useState<
    Record<string, { rounds: number; teams: number; completedRounds: number }>
  >({});
  // 详情头部 Progress：已完成轮次（有抽取记录的轮次）/ 总轮次
  const [completedRoundIds, setCompletedRoundIds] = useState<Set<string>>(new Set());
  // 本周抽取次数（顶部 StatCard 展示）
  const [weekDrawCount, setWeekDrawCount] = useState<number>(0);
  // 当前选中赛事的抽取会话（详情「抽取结果」Tab 用）
  const [eventSessions, setEventSessions] = useState<DrawSessionDetail[]>([]);
  const [eventSessionsLoading, setEventSessionsLoading] = useState(false);

  // ====== 数据加载 ======
  useEffect(() => {
    void eventStore.listEvents();
    // 拉取一批题库作为"历史辩题"下拉候选
    if (topicStore.items.length === 0) {
      void topicStore.fetchList({ pageSize: 1000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉取本周抽取次数（顶部 StatCard 展示）
  // 按本周一 00:00 至当前时间过滤 draw sessions
  useEffect(() => {
    void (async () => {
      try {
        const now = new Date();
        // 周日 getDay()=0，转为 7 以便统一计算「本周一」偏移
        const dayOfWeek = now.getDay() || 7;
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const res = await window.drawAPI.listSessions({
          startTime: monday.toISOString(),
          endTime: now.toISOString(),
          pageSize: 1000
        });
        if (res.success && res.data) {
          setWeekDrawCount(res.data.total ?? res.data.items.length);
        }
      } catch {
        setWeekDrawCount(0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉取每个赛事的轮次/队伍数量 + 已完成轮次（用于卡片进度环显示）
  // 已完成轮次的判定方式与详情视图一致：抽取会话列表中出现的 round_id 视为已完成
  useEffect(() => {
    if (eventStore.events.length === 0) return;
    void (async () => {
      const stats: Record<string, { rounds: number; teams: number; completedRounds: number }> = {};
      await Promise.all(
        eventStore.events.map(async (e) => {
          try {
            const [roundsRes, teamsRes, sessionsRes] = await Promise.all([
              window.eventAPI.listRoundsByEvent(e.id),
              window.eventAPI.listTeamsByEvent(e.id),
              window.drawAPI.listSessions({ event_id: e.id, pageSize: 1000 })
            ]);
            const rounds = roundsRes.success && roundsRes.data ? roundsRes.data : [];
            const sessions =
              sessionsRes.success && sessionsRes.data ? (sessionsRes.data.items ?? []) : [];
            // 用 Set 对 round_id 去重，得到已完成轮次数量
            const completedSet = new Set<string>();
            sessions.forEach((s) => {
              if (s.round_id) completedSet.add(s.round_id);
            });
            stats[e.id] = {
              rounds: rounds.length,
              teams: teamsRes.success && teamsRes.data ? teamsRes.data.length : 0,
              completedRounds: completedSet.size
            };
          } catch {
            stats[e.id] = { rounds: 0, teams: 0, completedRounds: 0 };
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
      void eventStore.fetchGroups(selectedEvent.id);
      // 切换赛事时重置筛选与多选
      setTeamGroupFilter(undefined);
      setSelectedTeamIds([]);
      // 拉取该赛事的抽取记录，统计已完成的轮次（有抽取记录即视为已完成）
      // 同时把会话列表存入 eventSessions state，供「抽取结果」Tab 使用
      void (async () => {
        try {
          setEventSessionsLoading(true);
          const res = await window.drawAPI.listSessions({ event_id: selectedEvent.id, pageSize: 1000 });
          if (res.success && res.data) {
            const items = res.data.items ?? [];
            setEventSessions(items);
            const ids = new Set<string>();
            items.forEach((s) => {
              if (s.round_id) ids.add(s.round_id);
            });
            setCompletedRoundIds(ids);
          } else {
            setEventSessions([]);
            setCompletedRoundIds(new Set());
          }
        } catch {
          setEventSessions([]);
          setCompletedRoundIds(new Set());
        } finally {
          setEventSessionsLoading(false);
        }
      })();
    } else {
      setEventSessions([]);
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

  // 赛事总数（StatCard + DonutChart 中心标签共用）
  const totalCount = eventStore.events.length;

  // DonutChart 数据：按赛事 status 聚合（Event 无 type 字段，以状态分布替代）
  // 颜色与看板三列主题色保持一致，中心展示赛事总数
  const donutData = useMemo(
    () => [
      { label: '筹备中', value: statusDistribution.preparing, color: BOARD_COLUMN_COLOR.preparing },
      { label: '进行中', value: statusDistribution.ongoing, color: BOARD_COLUMN_COLOR.ongoing },
      { label: '已结束', value: statusDistribution.finished, color: BOARD_COLUMN_COLOR.finished }
    ],
    [statusDistribution]
  );

  // 根据赛事 status 字段映射到看板分组（preparing / ongoing / finished）
  // null / undefined / 'preparing' / 'draft' 等都归入「筹备中」
  const getStatusGroup = (status: string | null): 'preparing' | 'ongoing' | 'finished' => {
    if (status === 'ongoing') return 'ongoing';
    if (status === 'finished') return 'finished';
    return 'preparing';
  };

  // 看板分组数据：三列分别持有对应状态的赛事
  const groupedEvents = useMemo(() => {
    const groups: { preparing: Event[]; ongoing: Event[]; finished: Event[] } = {
      preparing: [],
      ongoing: [],
      finished: []
    };
    eventStore.events.forEach((e) => {
      groups[getStatusGroup(e.status)].push(e);
    });
    return groups;
  }, [eventStore.events]);

  // ====== 看板拖拽：使用原生 HTML5 drag-and-drop API ======
  // 卡片开始拖拽时，把赛事 ID 写入 dataTransfer
  const handleCardDragStart = (e: React.DragEvent<HTMLDivElement>, eventId: string) => {
    e.dataTransfer.setData('text/plain', eventId);
    e.dataTransfer.effectAllowed = 'move';
  };
  // 列容器允许 drop（必须 preventDefault 才能触发 drop 事件）
  const handleColumnDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  // 列容器接收 drop：读取赛事 ID，调用 store 更新赛事状态
  const handleColumnDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    newStatus: 'preparing' | 'ongoing' | 'finished'
  ) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain');
    if (!eventId) return;
    const event = eventStore.events.find((x) => x.id === eventId);
    if (!event) return;
    // 同组不重复更新
    if (getStatusGroup(event.status) === newStatus) return;
    try {
      await eventStore.updateEvent(eventId, { status: newStatus });
      toast.success(`已移至「${STATUS_TAG[newStatus].label}」`);
      await eventStore.listEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '状态更新失败');
    }
  };

  // ====== 赛事 CRUD ======
  const handleCreateEvent = () => {
    setEditingWizardEvent(null);
    setWizardOpen(true);
  };
  // 向导编辑（主入口）：打开 EventWizardModal 编辑模式
  const handleWizardEditEvent = (event: Event) => {
    setEditingWizardEvent(event);
    setWizardOpen(true);
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
          toast.success('赛事已删除');
          if (selectedEvent?.id === event.id) {
            setSelectedEvent(null);
            // Task 24.5: 清除选中赛事时同步清除 Agent 上下文
            useAgentStore.getState().setContext({ currentEvent: null });
          }
          await eventStore.listEvents();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // Task 24.5: 选中赛事时同步 Agent 上下文
  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event);
    useAgentStore.getState().setContext({
      currentEvent: { id: event.id, name: event.name }
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
        toast.success('轮次已更新');
      } else {
        await eventStore.createRound({
          ...(data as RoundCreateInput),
          event_id: selectedEvent.id
        });
        toast.success('轮次已创建');
      }
      setRoundModalOpen(false);
      setEditingRound(null);
      await eventStore.listRoundsByEvent(selectedEvent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
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
          toast.success('轮次已删除');
          if (selectedEvent) {
            await eventStore.listRoundsByEvent(selectedEvent.id);
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '删除失败');
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
          toast.success('难度梯度已应用');
          setAppliedPresetKey(presetKey);
          setPresetModalOpen(false);
          await eventStore.listRoundsByEvent(selectedEvent.id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '应用失败');
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
        toast.success('队伍已更新');
      } else {
        await eventStore.createTeam({
          ...(data as TeamCreateInput),
          event_id: selectedEvent.id
        });
        toast.success('队伍已添加');
      }
      setTeamModalOpen(false);
      setEditingTeam(null);
      await eventStore.listTeamsByEvent(selectedEvent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
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
          toast.success('队伍已删除');
          if (selectedEvent) {
            await eventStore.listTeamsByEvent(selectedEvent.id);
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // ====== 队徽绑定（P1-6） ======
  const handleOpenBadgePicker = async (team: Team) => {
    setBadgePickerTeam(team);
    const res = await window.badgeAPI.getTeam(team.id);
    if (res.success) {
      setTeamBadges((prev) => ({ ...prev, [team.id]: res.data ?? null }));
    }
  };
  const handleSaveBadge = async (badgeId: string | null) => {
    const team = badgePickerTeam;
    if (!team) return;
    try {
      if (badgeId) {
        const res = await window.badgeAPI.setTeam(team.id, badgeId);
        if (!res.success) {
          toast.error(res.error ?? '绑定失败');
          return;
        }
        setTeamBadges((prev) => ({ ...prev, [team.id]: badgeId }));
        toast.success('已绑定队徽');
      } else {
        await window.badgeAPI.clearTeam(team.id);
        setTeamBadges((prev) => ({ ...prev, [team.id]: null }));
        toast.success('已取消队徽');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBadgePickerTeam(null);
    }
  };

  // 进入赛事时预载队伍→队徽绑定，便于列表直接展示（P1-6）
  useEffect(() => {
    const teams = eventStore.teams;
    if (!selectedEvent || teams.length === 0) return;
    let alive = true;
    Promise.all(teams.map((t) => window.badgeAPI.getTeam(t.id))).then((results) => {
      if (!alive) return;
      const m: Record<string, string | null> = {};
      teams.forEach((t, i) => {
        const r = results[i];
        if (r?.success) m[t.id] = r.data ?? null;
      });
      setTeamBadges((prev) => ({ ...prev, ...m }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id, eventStore.teams.length]);

  // ====== 分组 CRUD ======
  const handleCreateGroup = () => {
    setEditingGroup(null);
    setGroupModalOpen(true);
  };
  const handleEditGroup = (group: TeamGroup) => {
    setEditingGroup(group);
    setGroupModalOpen(true);
  };
  const handleSubmitGroup = async (
    data: TeamGroupCreateInput | TeamGroupUpdateInput,
    isEdit: boolean
  ) => {
    if (!selectedEvent) return;
    try {
      if (isEdit && editingGroup) {
        await eventStore.updateGroup(editingGroup.id, data as TeamGroupUpdateInput);
        toast.success('分组已更新');
      } else {
        await eventStore.createGroup({
          ...(data as TeamGroupCreateInput),
          event_id: selectedEvent.id
        });
        toast.success('分组已创建');
      }
      setGroupModalOpen(false);
      setEditingGroup(null);
      await eventStore.fetchGroups(selectedEvent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };
  const handleDeleteGroup = (group: TeamGroup) => {
    Modal.confirm({
      title: `确认删除分组"${group.name}"？`,
      content: '该分组下的队伍 group_id 将自动置为空（未分组）',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await eventStore.deleteGroup(group.id);
          toast.success('分组已删除');
          if (selectedEvent) {
            await Promise.all([
              eventStore.fetchGroups(selectedEvent.id),
              eventStore.listTeamsByEvent(selectedEvent.id)
            ]);
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  // ====== 队伍分组分配 ======
  // 单支队伍分配到分组（行内 Select）
  const handleAssignTeamGroup = async (teamId: string, groupId: string | null) => {
    try {
      await eventStore.assignTeamToGroup(teamId, groupId);
      if (selectedEvent) {
        await eventStore.listTeamsByEvent(selectedEvent.id);
      }
      toast.success('分组已更新');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分配失败');
    }
  };
  // 批量分配选中队伍到分组
  const handleBatchAssignGroup = async () => {
    if (!selectedEvent) return;
    if (selectedTeamIds.length === 0) {
      toast.error('请先勾选要分配的队伍');
      return;
    }
    if (batchAssignGroupId === undefined) {
      toast.error('请选择目标分组');
      return;
    }
    try {
      for (const tid of selectedTeamIds) {
        await eventStore.assignTeamToGroup(tid, batchAssignGroupId);
      }
      toast.success(`已分配 ${selectedTeamIds.length} 支队伍`);
      setSelectedTeamIds([]);
      setBatchAssignGroupId(undefined);
      await eventStore.listTeamsByEvent(selectedEvent.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量分配失败');
    }
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
      toast.error(e instanceof Error ? e.message : '加载历史失败');
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

  // ====== 导出赛事数据包 ======
  const handleExportEvent = async () => {
    if (!selectedEvent) return;
    setExporting(true);
    try {
      const res = await window.exportAPI.exportEventPackage({
        eventId: selectedEvent.id
      });
      if (!res.success || !res.data) {
        // 用户取消保存不算错误，静默处理
        if (res.error && res.error.includes('取消')) return;
        toast.error(res.error || '导出失败');
        return;
      }
      toast.success(`已导出到 ${res.data.filePath}，共 ${res.data.count} 项`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // ====== 导入赛事成功回调 ======
  const handleImportSuccess = async (eventId: string) => {
    await eventStore.listEvents();
    // P3.4 Task 19：用 safeIpc 包装 IPC 调用，统一错误 Toast
    // 选中刚导入的赛事（失败时返回 undefined，setSelectedEvent 跳过）
    const fresh = await safeIpc<Event | undefined>(
      window.eventAPI.getEvent(eventId),
      undefined
    );
    if (fresh) {
      setSelectedEvent(fresh);
    }
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
      title: '队徽',
      key: 'badge',
      width: 120,
      render: (_: any, record: Team) => {
        const bid = teamBadges[record.id] ?? null;
        return (
          <Space size={6}>
            {bid ? <BadgeThumbSmall id={bid} /> : <Text type="secondary">—</Text>}
            <Button size="small" onClick={() => void handleOpenBadgePicker(record)}>
              {bid ? '更换' : '绑定'}
            </Button>
          </Space>
        );
      }
    },
    {
      title: '所属分组',
      dataIndex: 'group_id',
      key: 'group_id',
      width: 200,
      render: (groupId: string | null | undefined, record: Team) => {
        return (
          <Select
            size="small"
            allowClear
            placeholder="未分组"
            value={groupId ?? undefined}
            onChange={(v) => handleAssignTeamGroup(record.id, v ?? null)}
            style={{ width: '100%' }}
            options={eventStore.groups.map((g) => ({ label: g.name, value: g.id }))}
            notFoundContent={<Text type="secondary">暂无分组</Text>}
          />
        );
      }
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

  // 分组列表：每行展示名称 / 队伍数 / 排序 / 操作
  const groupColumns: ColumnsType<TeamGroup> = [
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      render: (v: number) => v
    },
    {
      title: '分组名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: '队伍数',
      key: 'team_count',
      width: 100,
      render: (_: any, record: TeamGroup) => {
        const count = eventStore.teams.filter((t) => t.group_id === record.id).length;
        return <Tag color="blue">{count}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, record: TeamGroup) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditGroup(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该分组？"
            description="该分组下队伍将变为未分组"
            onConfirm={() => handleDeleteGroup(record)}
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

  // 队伍 Tab 数据：根据 teamGroupFilter 过滤
  const filteredTeams = useMemo(() => {
    if (teamGroupFilter === undefined) return eventStore.teams;
    if (teamGroupFilter === '__none__') {
      return eventStore.teams.filter((t) => !t.group_id);
    }
    return eventStore.teams.filter((t) => t.group_id === teamGroupFilter);
  }, [eventStore.teams, teamGroupFilter]);

  // ====== 渲染：赛事卡片 ======
  const renderEventCard = (event: Event) => {
    const stats = eventStats[event.id] ?? { rounds: 0, teams: 0, completedRounds: 0 };
    const statusInfo = event.status ? STATUS_TAG[event.status] : null;
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={event.id}>
        <Card
          size="small"
          hoverable
          style={{
            ...cardStyle,
            minHeight: '100%',
            transition: transition.base,
            cursor: 'pointer'
          }}
          styles={{ body: { padding: spacing.lg } }}
          onClick={() => handleSelectEvent(event)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text strong style={{ fontSize: fontSize.h4, flex: 1, marginRight: spacing.sm }} ellipsis={{ tooltip: event.name }}>
              {event.name}
            </Text>
            <Space size={6} align="center" style={{ flexShrink: 0 }}>
              {statusInfo && <Tag color={statusInfo.color} style={{ margin: 0 }}>{statusInfo.label}</Tag>}
              {event.allow_repeat === 1 && (
                <Tag color="gold" style={{ margin: 0 }}>允许重复</Tag>
              )}
              <Tooltip title={`轮次进度：${stats.completedRounds}/${stats.rounds}`}>
                <ProgressRing current={stats.completedRounds} total={stats.rounds} size={40} />
              </Tooltip>
            </Space>
          </div>
          <div style={{ display: 'flex', gap: spacing.lg, marginBottom: spacing.md, color: token.colorTextSecondary }}>
            <span>
              <CalendarOutlined style={{ marginRight: 4 }} />
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>轮次 </Text>
              <Text strong>{stats.rounds}</Text>
            </span>
            <span>
              <TeamOutlined style={{ marginRight: 4 }} />
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>队伍 </Text>
              <Text strong>{stats.teams}</Text>
            </span>
          </div>
          {event.start_date && (
            <div style={{ marginBottom: spacing.sm }}>
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>
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
            <Button
              size="small"
              type="primary"
              icon={<EditOutlined />}
              onClick={() => handleWizardEditEvent(event)}
            >
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

  // ====== 看板视图：单张赛事卡片（可拖拽） ======
  const renderBoardEventCard = (event: Event) => {
    const stats = eventStats[event.id] ?? { rounds: 0, teams: 0 };
    const group = getStatusGroup(event.status);
    const barColor = BOARD_COLUMN_COLOR[group];
    return (
      <div
        key={event.id}
        draggable
        onDragStart={(e) => handleCardDragStart(e, event.id)}
        style={{
          background: token.colorBgContainer,
          borderRadius: radius.md,
          padding: `${spacing.sm} ${spacing.md}`,
          marginBottom: spacing.sm,
          borderLeft: `4px solid ${barColor}`,
          boxShadow: shadow.sm,
          cursor: 'grab',
          transition: transition.base
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: spacing.xs
          }}
        >
          <Text
            strong
            ellipsis={{ tooltip: event.name }}
            style={{ fontSize: fontSize.body, flex: 1, marginRight: spacing.xs }}
          >
            {event.name}
          </Text>
          {event.allow_repeat === 1 && (
            <Tag color="gold" style={{ margin: 0, flexShrink: 0 }}>允许重复</Tag>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: spacing.md,
            marginBottom: spacing.xs,
            color: token.colorTextSecondary,
            fontSize: fontSize.caption
          }}
        >
          <span>
            <CalendarOutlined style={{ marginRight: 4 }} />
            轮次 <Text strong>{stats.rounds}</Text>
          </span>
          <span>
            <TeamOutlined style={{ marginRight: 4 }} />
            队伍 <Text strong>{stats.teams}</Text>
          </span>
        </div>
        {event.start_date && (
          <div style={{ marginBottom: spacing.xs, fontSize: fontSize.caption }}>
            <Text type="secondary" style={{ fontSize: fontSize.caption }}>
              {event.start_date}
              {event.end_date ? ` ~ ${event.end_date}` : ''}
            </Text>
          </div>
        )}
        <Space size={4} wrap>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => handleGotoDraw(event)}
          >
            抽取
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<EditOutlined />}
            onClick={() => handleWizardEditEvent(event)}
          >
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
      </div>
    );
  };

  // ====== 看板视图：单列容器（接收拖拽） ======
  const renderBoardColumn = (
    status: 'preparing' | 'ongoing' | 'finished',
    events: Event[]
  ) => {
    const barColor = BOARD_COLUMN_COLOR[status];
    return (
      <Col span={8} key={status}>
        <Card
          size="small"
          style={{
            ...cardStyle,
            background: token.colorBgContainer,
            minHeight: 'calc(100vh - 220px)',
            display: 'flex',
            flexDirection: 'column'
          }}
          styles={{
            body: {
              padding: spacing.sm,
              overflowY: 'auto',
              flex: 1,
              minHeight: 0
            }
          }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: barColor
                }}
              />
              <span>{STATUS_TAG[status].label}</span>
              <Tag style={{ marginInlineStart: 4 }}>{events.length}</Tag>
            </div>
          }
          onDragOver={handleColumnDragOver}
          onDrop={(e) => handleColumnDrop(e, status)}
        >
          {events.length === 0 ? (
            <div
              style={{
                padding: spacing.lg,
                textAlign: 'center',
                color: token.colorTextSecondary,
                fontSize: fontSize.caption
              }}
            >
              拖拽赛事卡片到此列
            </div>
          ) : (
            events.map(renderBoardEventCard)
          )}
        </Card>
      </Col>
    );
  };

  // ====== 渲染 ======
  return (
    <>
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, padding: `0 ${spacing.lg} ${spacing.lg}`, overflow: 'auto' }}>
          <PageHeader
            title="赛事管理"
            subtitle="组织赛事与抽取历史"
            extra={
              <Space>
                <Radio.Group
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                >
                  <Radio.Button value="list">
                    <UnorderedListOutlined /> 列表
                  </Radio.Button>
                  <Radio.Button value="board">
                    <AppstoreOutlined /> 看板
                  </Radio.Button>
                </Radio.Group>
                <Button
                  icon={<ImportOutlined />}
                  onClick={() => setImportModalOpen(true)}
                >
                  导入赛事
                </Button>
                <Button
                  icon={<DatabaseOutlined />}
                  onClick={() => setTopicGroupManagerOpen(true)}
                >
                  题组管理
                </Button>
                <Tooltip
                  title={selectedEvent ? '' : '请先在列表中选择要查看的赛事'}
                >
                  <Button
                    icon={<BookOutlined />}
                    disabled={!selectedEvent}
                    onClick={() => setEventTopicBankOpen(true)}
                  >
                    赛事题库
                  </Button>
                </Tooltip>
                <Tooltip
                  title={selectedEvent ? '' : '请先在列表中选择要导出的赛事'}
                >
                  <Button
                    icon={<ExportOutlined />}
                    disabled={!selectedEvent}
                    loading={exporting}
                    onClick={handleExportEvent}
                  >
                    导出赛事
                  </Button>
                </Tooltip>
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
            }
          />

          {/* 工作流引导卡（Task 10.1）：3 步上手，完成所有步骤后自动隐藏 */}
          <WorkflowCard />

          {/* 顶部统计卡片：赛事总数 / 进行中 / 已结束 / 本周抽取 */}
          <Row gutter={[spacing.lg, spacing.lg]} style={{ marginBottom: spacing.lg }}>
            <Col xs={12} sm={12} md={6}>
              <StatCard
                label="赛事总数"
                value={totalCount}
                icon={<TrophyOutlined />}
                color="gold"
              />
            </Col>
            <Col xs={12} sm={12} md={6}>
              <StatCard
                label="进行中"
                value={statusDistribution.ongoing}
                icon={<SyncOutlined spin />}
                color="primary"
              />
            </Col>
            <Col xs={12} sm={12} md={6}>
              <StatCard
                label="已结束"
                value={statusDistribution.finished}
                icon={<CheckCircleOutlined />}
                color="primary"
              />
            </Col>
            <Col xs={12} sm={12} md={6}>
              <StatCard
                label="本周抽取"
                value={weekDrawCount}
                icon={<HistoryOutlined />}
                color="purple"
              />
            </Col>
          </Row>

          {/* 赛事视图：列表模式 / 看板模式（受 viewMode 控制） */}
          {viewMode === 'list' ? (
            /* 列表视图：原卡片网格（保持原有逻辑不变） */
            <AccentCard
              size="small"
              style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}
              title={
                <Space>
                  <Text strong>赛事列表</Text>
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                    共 {eventStore.events.length} 项
                  </Text>
                </Space>
              }
            >
              <BrandSpin spinning={eventStore.loading}>
                {eventStore.events.length === 0 ? (
                  <EmptyState
                    type="default"
                    description="暂无赛事"
                    cta={[
                      {
                        text: '创建赛事',
                        icon: <PlusOutlined />,
                        onClick: handleCreateEvent
                      }
                    ]}
                  />
                ) : (
                  <Row gutter={[spacing.lg, spacing.lg]}>
                    {eventStore.events.map(renderEventCard)}
                  </Row>
                )}
              </BrandSpin>
            </AccentCard>
          ) : (
            /* 看板视图：按状态分三列，支持拖拽改变状态 */
            <AccentCard
              size="small"
              style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}
              title={
                <Space>
                  <AppstoreOutlined />
                  <Text strong>赛事看板</Text>
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                    拖拽卡片可改变赛事状态 · 共 {eventStore.events.length} 项
                  </Text>
                </Space>
              }
            >
              <BrandSpin spinning={eventStore.loading}>
                {eventStore.events.length === 0 ? (
                  <EmptyState
                    type="default"
                    description="暂无赛事"
                    cta={[
                      {
                        text: '创建赛事',
                        icon: <PlusOutlined />,
                        onClick: handleCreateEvent
                      }
                    ]}
                  />
                ) : (
                  <>
                    {/* 看板右上角：赛事状态分布环形图 */}
                    <Row justify="end" style={{ marginBottom: spacing.md }}>
                      <Col xs={24} sm={12} md={8} lg={6}>
                        <Card title="赛事分布" size="small">
                          <div style={{ display: 'flex', justifyContent: 'center', padding: `${spacing.sm}px 0` }}>
                            <DonutChart
                              data={donutData}
                              centerLabel={String(totalCount)}
                              centerSublabel="赛事总数"
                              size={140}
                            />
                          </div>
                        </Card>
                      </Col>
                    </Row>
                    <Row gutter={spacing.lg}>
                      {renderBoardColumn('preparing', groupedEvents.preparing)}
                      {renderBoardColumn('ongoing', groupedEvents.ongoing)}
                      {renderBoardColumn('finished', groupedEvents.finished)}
                    </Row>
                  </>
                )}
              </BrandSpin>
            </AccentCard>
          )}

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
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
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
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                    赛事进度：已完成 {completedRoundIds.size} / {eventStore.rounds.length} 轮次
                  </Text>
                  <Text type="secondary" style={{ fontSize: fontSize.caption }}>
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
                onChange={(k) => setDetailTab(k as 'teams' | 'rounds' | 'groups' | 'draws' | 'matches')}
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
                        {/* 工具栏：添加 / 筛选分组 / 批量分配 */}
                        <div
                          style={{
                            marginBottom: spacing.md,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: spacing.sm,
                            alignItems: 'center'
                          }}
                        >
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={handleCreateTeam}
                          >
                            添加队伍
                          </Button>
                          <Select
                            allowClear
                            placeholder="按分组筛选"
                            style={{ width: 180 }}
                            value={teamGroupFilter}
                            onChange={(v) => setTeamGroupFilter(v)}
                            options={[
                              { label: '未分组', value: '__none__' },
                              ...eventStore.groups.map((g) => ({
                                label: g.name,
                                value: g.id
                              }))
                            ]}
                          />
                          {selectedTeamIds.length > 0 && (
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
                                options={eventStore.groups.map((g) => ({
                                  label: g.name,
                                  value: g.id
                                }))}
                              />
                              <Popconfirm
                                title="确认批量分配分组？"
                                onConfirm={handleBatchAssignGroup}
                                okText="分配"
                                okType="primary"
                                cancelText="取消"
                              >
                                <Button type="primary" icon={<GroupOutlined />}>
                                  分配分组
                                </Button>
                              </Popconfirm>
                            </Space>
                          )}
                        </div>
                        <Table
                          columns={teamColumns}
                          dataSource={filteredTeams}
                          rowKey="id"
                          size="small"
                          rowSelection={{
                            selectedRowKeys: selectedTeamIds,
                            onChange: (keys) => setSelectedTeamIds(keys as string[])
                          }}
                          pagination={
                            filteredTeams.length > 10
                              ? {
                                  pageSize: 10,
                                  showSizeChanger: false,
                                  showTotal: (t) => `共 ${t} 支队伍`
                                }
                              : false
                          }
                          locale={{ emptyText: <EmptyState type="default" description="暂无队伍" /> }}
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
                          locale={{ emptyText: <EmptyState type="default" description="暂无轮次" /> }}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'groups',
                    label: (
                      <Space>
                        <GroupOutlined />
                        <span>分组设置</span>
                        <Tag color="blue" style={{ marginInlineStart: 4 }}>
                          {eventStore.groups.length}
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
                              onClick={handleCreateGroup}
                            >
                              新建分组
                            </Button>
                            <Button
                              icon={<ThunderboltOutlined />}
                              onClick={() => setRandomGroupModalOpen(true)}
                            >
                              随机分组
                            </Button>
                          </Space>
                        </div>
                        <Table
                          columns={groupColumns}
                          dataSource={eventStore.groups}
                          rowKey="id"
                          size="small"
                          pagination={
                            eventStore.groups.length > 10
                              ? {
                                  pageSize: 10,
                                  showSizeChanger: false,
                                  showTotal: (t) => `共 ${t} 个分组`
                                }
                              : false
                          }
                          locale={{ emptyText: <EmptyState type="default" description="暂无分组" /> }}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'draws',
                    label: (
                      <Badge count={eventSessions.length} showZero offset={[8, 0]}>
                        <Space>
                          <HistoryOutlined />
                          <span>抽取结果</span>
                        </Space>
                      </Badge>
                    ),
                    children: (
                      <EventDrawsTab
                        eventId={selectedEvent.id}
                        sessions={eventSessions}
                        loading={eventSessionsLoading}
                        onRefresh={async () => {
                          try {
                            setEventSessionsLoading(true);
                            const res = await window.drawAPI.listSessions({
                              event_id: selectedEvent.id,
                              pageSize: 1000
                            });
                            if (res.success && res.data) {
                              setEventSessions(res.data.items ?? []);
                            }
                          } catch {
                            // ignore
                          } finally {
                            setEventSessionsLoading(false);
                          }
                        }}
                      />
                    )
                  },
                  {
                    key: 'matches',
                    label: (
                      <Space>
                        <TrophyOutlined />
                        <span>比赛/赛果</span>
                      </Space>
                    ),
                    children: <EventMatchesTab eventId={selectedEvent.id} />
                  }
                ]}
              />
            </Card>
          )}
        </Content>
      </Layout>

      {/* 赛事导入弹窗 */}
      <ImportEventModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={handleImportSuccess}
      />

      {/* 题组管理（题库）独立入口 */}
      <TopicGroupManagerModal
        open={topicGroupManagerOpen}
        onClose={() => setTopicGroupManagerOpen(false)}
      />

      {/* 赛事题库（T4）：该赛事绑定题组下的辩题 + 已抽/未抽 + 允许重复开关 */}
      <EventTopicBankModal
        open={eventTopicBankOpen}
        event={selectedEvent}
        onClose={() => setEventTopicBankOpen(false)}
        onEventUpdated={async () => {
          if (selectedEvent) {
            const fresh = await window.eventAPI.getEvent(selectedEvent.id);
            if (fresh.success && fresh.data) setSelectedEvent(fresh.data);
          }
        }}
        onOpenGroupManager={() => {
          setEventTopicBankOpen(false);
          setTopicGroupManagerOpen(true);
        }}
      />

      {/* 新建/编辑赛事向导弹窗 */}
      <EventWizardModal
        open={wizardOpen}
        event={editingWizardEvent}
        onClose={() => {
          setWizardOpen(false);
          setEditingWizardEvent(null);
        }}
        onSuccess={async (eventId) => {
          setWizardOpen(false);
          setEditingWizardEvent(null);
          await eventStore.listEvents();
          // 同步 selectedEvent（新建选中刚创建的赛事；编辑更新当前选中）
          const fresh = await window.eventAPI.getEvent(eventId);
          if (fresh.success && fresh.data) {
            setSelectedEvent(fresh.data);
            // 编辑模式下同步 rounds/teams/groups
            if (selectedEvent?.id === eventId) {
              await Promise.all([
                eventStore.listRoundsByEvent(eventId),
                eventStore.listTeamsByEvent(eventId),
                eventStore.fetchGroups(eventId)
              ]);
            }
          }
        }}
      />

      {/* 分组编辑弹窗 */}
      <GroupEditModal
        open={groupModalOpen}
        group={editingGroup}
        eventId={selectedEvent?.id}
        nextSortOrder={eventStore.groups.length + 1}
        onOk={handleSubmitGroup}
        onCancel={() => {
          setGroupModalOpen(false);
          setEditingGroup(null);
        }}
      />

      {/* 随机分组弹窗 */}
      <RandomGroupAssignModal
        open={randomGroupModalOpen}
        eventId={selectedEvent?.id ?? ''}
        onCancel={() => setRandomGroupModalOpen(false)}
        onSuccess={() => {
          setRandomGroupModalOpen(false);
          if (selectedEvent) {
            void eventStore.fetchGroups(selectedEvent.id);
            void eventStore.listTeamsByEvent(selectedEvent.id);
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
        groupOptions={eventStore.groups}
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

      {/* 队徽库选择弹窗（P1-6） */}
      <BadgePickerModal
        open={!!badgePickerTeam}
        teamName={badgePickerTeam?.name ?? ''}
        currentBadgeId={badgePickerTeam ? (teamBadges[badgePickerTeam.id] ?? null) : null}
        onClose={() => setBadgePickerTeam(null)}
        onSaved={(badgeId) => void handleSaveBadge(badgeId)}
        onToast={{ success: (m) => toast.success(m), error: (m) => toast.error(m) }}
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
