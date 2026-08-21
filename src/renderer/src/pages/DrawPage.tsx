import { useEffect, useMemo, useState } from 'react';
import { Typography, Breadcrumb, Space, Card, Button, Alert } from 'antd';
import AccentCard from '../components/common/AccentCard';
import PageHeader from '../components/common/PageHeader';
import KbdHint from '../components/common/KbdHint';
import {
  ThunderboltOutlined,
  TrophyOutlined,
  ControlOutlined,
  RocketOutlined,
  GiftOutlined,
  ReloadOutlined,
  DesktopOutlined,
  DownloadOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDrawStore } from '../stores/drawStore';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  DrawParams,
  TopicFilter,
  Team,
  DrawPageLocationState,
  ExportFormat,
  DrawSessionDetail
} from '../../../shared/types';
import DrawConfigPanel, { type DrawConfigState } from '../components/draw/DrawConfigPanel';
import DrawResultList from '../components/draw/DrawResultList';
import InsufficientTopicsModal from '../components/draw/InsufficientTopicsModal';
import BigScreen from '../components/draw/BigScreen';
import DrawAnimation from '../components/draw/DrawAnimation';
import DrawCeremony from '../components/draw/DrawCeremony';
import { safeIpc } from '../lib/ipc';
import { emptyStateStyle, kbdStyle } from '../styles/shared';
import { spacing, shadow, gradient, colorGold, zIndex, fontSize, radius, gray } from '../styles/tokens';
import { cardEnter, staggered } from '../styles/motion';
import { useHotkeys, useHotkeyScope } from '../hooks/useHotkeys';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useToast } from '../hooks/useToast';
import { useStickyBg, useThemeMode } from '../hooks/useThemeMode';

/** 浅色背景下的 kbd 按键样式（shared.ts 的 kbdStyle 为深色背景设计，此处不适用） */
const kbdLightStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  background: gray[100],
  border: `1px solid ${gray[200]}`,
  borderRadius: radius.sm,
  fontFamily: 'monospace',
  fontSize: fontSize.caption,
  color: gray[700],
  margin: '0 2px',
  lineHeight: 1.4
};

/** 结果卡片样式：金色色条 + 过渡（hover 状态由 onMouseEnter/Leave 控制） */
const resultCardStyle: React.CSSProperties = {
  borderLeft: `4px solid ${colorGold}`,
  transition: 'box-shadow 0.2s, transform 0.2s'
};

const DEFAULT_CONFIG: DrawConfigState = {
  eventId: null,
  roundId: null,
  topicCount: 4,
  includeStance: false,
  stanceMode: 'versus',
  teamPairs: [],
  soloTeamId: null,
  filter: {},
  includeKeywords: [],
  excludeKeywords: [],
  sourceMixEnabled: false,
  officialRatio: 70,
  drawMode: 'versus',
  groupIds: [],
  teamsPerTopic: 2,
  revealMode: 'flip'
};

/** 引导步骤卡片 */
function GuideSteps() {
  // 暗色模式下内容区背景为深色（#0a0f1a），使用 shared.ts 的 kbdStyle（白字半透明白底）更协调；
  // 亮色模式下内容区为浅色背景，沿用 kbdLightStyle（gray 浅底深字）保证对比度。
  const { resolvedMode } = useThemeMode();
  const kbdVisualStyle = resolvedMode === 'dark' ? kbdStyle : kbdLightStyle;

  const steps = [
    {
      icon: <TrophyOutlined />,
      title: '1. 选择赛事',
      desc: '从左侧配置面板选择目标赛事和轮次',
      color: gradient.sourceOfficial
    },
    {
      icon: <ControlOutlined />,
      title: '2. 配置条件',
      desc: '设置题量、持方、筛选条件和题源比例',
      color: gradient.sourceCustom
    },
    {
      icon: <RocketOutlined />,
      title: '3. 开始抽取',
      desc: '点击主按钮启动随机抽取，可投屏展示',
      color: gradient.difficultyMid
    }
  ];

  return (
    <div style={emptyStateStyle}>
      <div style={{ marginBottom: spacing.xxxl }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            background: gradient.brand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            boxShadow: shadow.primary,
            marginBottom: spacing.lg
          }}
        >
          <ThunderboltOutlined style={{ fontSize: 48, color: '#fff' }} />
        </div>
        <Typography.Title level={3} style={{ marginBottom: 8 }}>
          准备开始抽取辩题
        </Typography.Title>
        <Typography.Text type="secondary">
          按以下三步操作，快速完成一场辩题抽取
        </Typography.Text>
      </div>

      <Space size={spacing.xl} wrap>
        {steps.map((s, idx) => (
          <Card
            key={idx}
            style={{
              width: 240,
              borderRadius: radius.xl,
              border: `1px solid ${gray[100]}`,
              boxShadow: shadow.sm,
              transition: 'all 0.2s ease',
              cursor: 'default',
              position: 'relative',
              overflow: 'hidden',
              // SubTask 18.2：依次淡入动效（cardEnter + staggered 延迟 0.1s/0.2s/0.3s）
              ...cardEnter,
              ...staggered(idx, 100)
            }}
            className="btn-lift"
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: s.color
              }}
            />
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: s.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  color: '#fff',
                  fontSize: fontSize.h2,
                  marginBottom: spacing.md
                }}
              >
                {s.icon}
              </div>
              <Typography.Title level={5} style={{ marginBottom: 4 }}>
                {s.title}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: fontSize.body }}>
                {s.desc}
              </Typography.Text>
            </div>
          </Card>
        ))}
      </Space>

      <Typography.Text type="secondary" style={{ marginTop: spacing.xl, fontSize: fontSize.body }}>
        提示：抽取完成后可按 <kbd style={kbdVisualStyle}>R</kbd> 重抽 · <kbd style={kbdVisualStyle}>F</kbd> 投屏 · <kbd style={kbdVisualStyle}>Esc</kbd> 退出
      </Typography.Text>
    </div>
  );
}

export default function DrawPage() {
  const drawStore = useDrawStore();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  // SubTask 3.1：底部 sticky 操作栏背景（亮/暗模式自适应）
  const stickyBg = useStickyBg();

  const [config, setConfig] = useState<DrawConfigState>(DEFAULT_CONFIG);
  const [animating, setAnimating] = useState(false);
  // P0-4：全屏抽取仪式是否开启（js 全屏沉浸态覆盖整个应用视口）
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);
  // 大屏已揭晓题数（提升到 DrawPage，便于小屏同步进度文字）
  const [revealedCount, setRevealedCount] = useState(0);
  // 结果卡片 hover 状态：用于应用 shadow.cardHover
  const [resultHover, setResultHover] = useState(false);
  // 移动端（<768px）自动堆叠为单列
  const isMobile = useMediaQuery('(max-width: 767px)');
  // 确定结果按钮加载态：调用 confirmDrawSession 期间为 true
  const [confirming, setConfirming] = useState(false);
  // Task 9.3：允许辩题重复提示条 state
  // 测试模式（is_test=true）隐含 allow_repeat=true；非测试模式的 allow_repeat 由 Task 6 buildParams 设置
  const [repeatUsed, setRepeatUsed] = useState(false);
  // 测试模式：开启后引擎跳过 applyExclusions、不写 team_history、自动 allow_repeat
  const [testMode, setTestMode] = useState(false);
  // 允许辩题重复：默认值在 event 加载后由 event.allow_repeat 决定
  const [allowRepeat, setAllowRepeat] = useState(false);
  // SubTask 5.1：题池不足弹窗信息（null 时 Modal 关闭）
  const [insufficientInfo, setInsufficientInfo] = useState<{
    candidateCount: number;
    requiredCount: number;
  } | null>(null);
  // 额外要求（与 Task 9 协调）：降级抽取警告条信息，实际渲染由 Task 9 完成
  const [downgradeInfo, setDowngradeInfo] = useState<{
    actualCount: number;
    originalCount: number;
  } | null>(null);

  // 拉取赛事列表（仅一次）
  useEffect(() => {
    eventStore.listEvents();
  }, []);

  // 接收来自 EventManage 的跳转上下文：eventId / roundId
  // P2-41 修复：消费后清除 location.state，避免重复跳转触发多次 toast
  useEffect(() => {
    const state = location.state as DrawPageLocationState | null;
    if (state && (state.eventId || state.roundId)) {
      setConfig((c) => ({
        ...c,
        eventId: state.eventId ?? c.eventId,
        roundId: state.roundId ?? c.roundId
      }));
      // 提示用户已带入上下文
      if (state.eventId) {
        toast.info('已从赛事详情带入赛事与轮次上下文');
      }
      // 消费后清除 state，防止后退/刷新时重复触发
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, navigate, location.pathname]);

  // 赛事变更时拉取轮次+队伍+分组
  useEffect(() => {
    if (config.eventId) {
      eventStore.listRoundsByEvent(config.eventId);
      eventStore.listTeamsByEvent(config.eventId);
      eventStore.fetchGroups(config.eventId);
    }
  }, [config.eventId]);

  // SubTask 6.5：赛事加载完成后，按 event.allow_repeat 初始化 allowRepeat
  // 测试模式开启时不覆盖（测试模式强制 allowRepeat=true）
  useEffect(() => {
    if (testMode) return;
    const ev = eventStore.events.find((e) => e.id === config.eventId);
    if (ev) {
      setAllowRepeat(ev.allow_repeat === 1);
    }
  }, [config.eventId, eventStore.events, testMode]);

  // SubTask 6.4/6.5：测试模式开启时强制 allowRepeat=true
  // P2-39 修复：测试模式关闭时主动复原为 event.allow_repeat
  // 原实现关闭 testMode 后 allowRepeat 仍为 true，直到切换赛事才会被重置
  useEffect(() => {
    if (testMode) {
      setAllowRepeat(true);
    } else {
      const ev = eventStore.events.find((e) => e.id === config.eventId);
      if (ev) {
        setAllowRepeat(ev.allow_repeat === 1);
      }
    }
  }, [testMode]);

  // P2-38 修复：标签候选改用 topicAPI.listAllTags() 拉取全量标签
  // 原实现仅从 topicStore.items（默认 20 条）汇总，导致大题库下 tag 候选严重不全
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.topicAPI.listAllTags().then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setTagOptions(res.data.map((t) => t.value));
      }
    }).catch(() => {
      // 静默失败：标签候选仅用于筛选提示，不影响主流程
    });
    return () => { cancelled = true };
  }, []);

  // 初次进入拉取一批题用于 tag 候选（保留：listAllTags 不覆盖所有 topicStore 用途）
  useEffect(() => {
    if (topicStore.items.length === 0) {
      topicStore.fetchList();
    }
  }, []);

  // Task 9.3：根据抽取结果更新 repeatUsed
  // 测试模式（is_test=true）隐含 allow_repeat=true，引擎自动启用有放回抽样
  // 非测试模式下的 allow_repeat 由 Task 6 buildParams 设置，但 DrawSessionSettings 不持久化 allow_repeat，
  // 因此仅能从 is_test 推断（spec 推荐的简化方案）
  useEffect(() => {
    setRepeatUsed(!!drawStore.lastResult?.session.settings?.is_test);
  }, [drawStore.lastResult]);

  const updateConfig = (patch: Partial<DrawConfigState>) =>
    setConfig((c) => ({ ...c, ...patch }));

  // P0-4：开始抽取时进入全屏沉浸仪式；投屏（大屏）场景沿用原大屏三幕动画，不叠加仪式
  const beginCeremony = () => {
    if (!bigScreen) setCeremonyOpen(true);
  };

  // 仪式滚动候选题池（优先用本次抽取结果，结果未就绪时用题库）
  const candidateTitles = useMemo(() => {
    const drawn = drawStore.lastResult?.topics
      ?.map((t) => t.title)
      .filter((t): t is string => !!t) ?? [];
    if (drawn.length > 0) return drawn;
    return topicStore.items.map((t) => t.title);
  }, [drawStore.lastResult, topicStore.items]);

  // 组装 DrawParams
  const buildParams = (): DrawParams | null => {
    if (!config.eventId) return null;
    // 合并 teams（从 teamPairs 扁平化）
    const teams: Team[] = [];
    config.teamPairs.forEach((p) => {
      if (p.teamA) teams.push(p.teamA);
      if (p.teamB) teams.push(p.teamB);
    });

    // v6: 标记 teams 是否来自用户 TeamPairing 配置
    // teamPairs 非空且至少包含一对有效配对时，user_pairing = true
    const hasUserPairing =
      config.teamPairs.length > 0 && config.teamPairs.some((p) => p.teamA && p.teamB);

    const filter: TopicFilter = { ...config.filter, status: 'active' };

    const params: DrawParams = {
      event_id: config.eventId,
      round_id: config.roundId ?? undefined,
      topic_count: config.topicCount,
      include_stance: config.includeStance,
      teams: config.includeStance ? teams : undefined,
      filters: filter,
      operator: 'renderer',
      draw_mode: config.drawMode,
      group_ids: config.drawMode === 'group' ? config.groupIds : undefined,
      teams_per_topic: config.drawMode === 'multi_team' ? config.teamsPerTopic : undefined,
      user_pairing: hasUserPairing
    };

    // 单人持方模式：传 solo_team_id，引擎为每道题随机分配正反方
    if (config.includeStance && config.stanceMode === 'solo' && config.soloTeamId) {
      params.solo_team_id = config.soloTeamId;
      // 单人模式不传 teams（引擎根据 solo_team_id 查队伍）
      params.teams = undefined;
    }

    // multi_team 模式：保留 TeamPairing 用户配对关系（同 versus 模式）
    // teams 已在 buildParams 顶部从 teamPairs 扁平化，此处不再覆盖
    if (config.drawMode === 'multi_team') {
      params.include_stance = false; // multi_team 模式持方由引擎按配对分配
    }

    if (config.sourceMixEnabled) {
      params.source_mix_ratio = {
        official: config.officialRatio / 100,
        custom: (100 - config.officialRatio) / 100
      };
    }

    // SubTask 6.5：测试模式 + 允许辩题重复
    // 测试模式强制 allow_repeat=true（引擎跳过 applyExclusions、不写 team_history）
    params.test_mode = testMode;
    params.allow_repeat = testMode || allowRepeat;
    return params;
  };

  const handleDraw = async () => {
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    setRevealedCount(0);
    beginCeremony();
    try {
      // P3-17 修复：移除固定 600ms 延迟，动画跟随实际抽取耗时
      // 原 Promise.all([execute, setTimeout(600)]) 在 execute 快速完成时让用户空等 600ms
      const result = await drawStore.execute(params);
      if (result) {
        toast.success(`已抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      // SubTask 5.2：检测题池不足错误
      // 渲染层无法直接 import 主进程的 InsufficientTopicsError 类，
      // 通过 error.message 是否以"题池不足"开头判断（IPC 抛错时 message 会传递）
      if (isInsufficientTopicsError(e)) {
        const match = e instanceof Error ? e.message.match(/候选\s*(\d+)\s*道.*需要\s*(\d+)\s*道/) : null;
        if (match) {
          setInsufficientInfo({
            candidateCount: parseInt(match[1], 10),
            requiredCount: parseInt(match[2], 10)
          });
        } else {
          // P3-16 修复：正则匹配失败时仍调用 setInsufficientInfo，不 toast 原始错误
          // 由 Modal 引导用户处理（candidateCount 未知时用 0 占位）
          setInsufficientInfo({
            candidateCount: 0,
            requiredCount: params.topic_count
          });
        }
        // 失败：退出全屏仪式，由 Modal 引导用户处理；不显示 toast.error
        setCeremonyOpen(false);
        return;
      }
      // 失败：退出全屏仪式，回到结果页展示错误
      setCeremonyOpen(false);
      toast.error(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setAnimating(false);
    }
  };

  /**
   * SubTask 5.2 辅助函数：判断错误是否为 InsufficientTopicsError
   *
   * 渲染层无法用 `e instanceof InsufficientTopicsError` 判断（主进程模块无法直接 import），
   * 改为检查 error.message 是否以"题池不足"开头。
   * 引擎抛错时 message 格式："题池不足：候选 2 道，需要 4 道"
   */
  function isInsufficientTopicsError(e: unknown): boolean {
    return e instanceof Error && /^题池不足/.test(e.message);
  }

  /**
   * SubTask 5.3：题池不足弹窗用户选择处理
   *
   * 验证场景（SubTask 5.5）：
   *   - 候选 2 道、需要 4 道时弹窗显示（不显示 toast.error）✓
   *   - 选择"降级"：重新调用 drawTopics，topic_count 改为 candidateCount（=2）
   *     抽取成功后设置 downgradeInfo 由 Task 9 渲染警告条
   *   - 选择"重复"：重新调用 drawTopics，allow_repeat=true，从 2 道中有放回抽 4 道
   *   - 选择"取消"：关闭 Modal，跳转 /topics 题库管理页
   */
  const handleInsufficientSelect = async (action: 'downgrade' | 'repeat' | 'cancel') => {
    // 关闭 Modal
    const info = insufficientInfo;
    setInsufficientInfo(null);

    if (action === 'cancel') {
      navigate('/topics');
      return;
    }

    // 重新构建参数并抽取
    // downgrade: 修改 topic_count 为 candidateCount
    // repeat:    修改 allow_repeat 为 true
    const baseParams = buildParams();
    if (!baseParams) return;

    if (action === 'downgrade') {
      baseParams.topic_count = info?.candidateCount ?? baseParams.topic_count;
    } else if (action === 'repeat') {
      baseParams.allow_repeat = true;
    }

    setAnimating(true);
    setRevealedCount(0);
    beginCeremony();
    try {
      // P3-17 修复：移除固定 600ms 延迟，动画跟随实际抽取耗时
      const result = await drawStore.execute(baseParams);
      if (result) {
        toast.success(`已抽取 ${result.topics.length} 道辩题`);
        // 降级抽取成功：保留信息供 Task 9 渲染黄色警告条
        if (action === 'downgrade' && info) {
          setDowngradeInfo({
            actualCount: info.candidateCount,
            originalCount: info.requiredCount
          });
        } else {
          // 非降级场景清空警告条
          setDowngradeInfo(null);
        }
      }
    } catch (e) {
      setCeremonyOpen(false);
      toast.error(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setAnimating(false);
    }
  };

  const handleRedo = async () => {
    if (!drawStore.lastResult) return;
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    setRevealedCount(0);
    beginCeremony();
    try {
      // P3-17 修复：移除固定 600ms 延迟，动画跟随实际抽取耗时
      const result = await drawStore.redo(drawStore.lastResult.session.id, params);
      if (result) {
        toast.success(`已重新抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      setCeremonyOpen(false);
      toast.error(e instanceof Error ? e.message : '重抽失败');
    } finally {
      setAnimating(false);
    }
  };

  // 确定抽取结果：调用 confirmDrawSession 写入队伍历史 + 标记 session 已确认
  // 成功后 toast 提示 + 更新 store 中的 lastResult.session（confirmed=true）
  const handleConfirm = async () => {
    if (!drawStore.lastResult) return;
    const sessionId = drawStore.lastResult.session.id;
    setConfirming(true);
    try {
      // P3.4 Task 19：用 safeIpc 包装 IPC 调用，统一错误 Toast
      const updatedSession = await safeIpc<DrawSessionDetail | undefined>(
        window.drawAPI.confirmDrawSession(sessionId),
        undefined
      );
      if (!updatedSession) {
        throw new Error('确定结果失败');
      }
      drawStore.setLastResult({
        ...drawStore.lastResult,
        session: updatedSession
      });
      toast.success('已确定结果并写入队伍历史');
    } catch (e) {
      // safeIpc 已显示分类 Toast，此处仅兜底
      if (e instanceof Error && e.message !== '确定结果失败') {
        toast.error(e instanceof Error ? e.message : '确定结果失败');
      }
    } finally {
      setConfirming(false);
    }
  };

  // SubTask 18.4：导出当前赛事抽取记录（xlsx）
  const handleExport = async (format: ExportFormat = 'xlsx') => {
    if (!drawStore.lastResult) return;
    try {
      const res = await window.exportAPI.exportDrawSessions({
        filter: { event_id: drawStore.lastResult.session.event_id },
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

  // P2-43 修复：抽取完成后跳转计时器，并传递抽取结果上下文（第一道题作为计时对象）
  const handleStartTimer = () => {
    if (!drawStore.lastResult) return;
    const { session } = drawStore.lastResult;
    const firstItem = session.items[0];
    if (!firstItem) {
      toast.warning('抽取结果为空，无法开始计时');
      return;
    }
    // 队名优先用快照，其次用 eventStore.teams 查找
    const findTeamName = (teamId: string | null): string => {
      if (!teamId) return '';
      return eventStore.teams.find((t) => t.id === teamId)?.name ?? '';
    };
    navigate('/timer', {
      state: {
        sessionId: session.id,
        eventId: session.event_id,
        roundId: session.round_id,
        eventName: currentEvent?.name,
        topicId: firstItem.topic_id,
        topicTitle: firstItem.topic_title ?? '',
        teamAffId: firstItem.team_a_id,
        teamNegId: firstItem.team_b_id,
        teamAffName: firstItem.team_a_name ?? findTeamName(firstItem.team_a_id),
        teamNegName: firstItem.team_b_name ?? findTeamName(firstItem.team_b_id),
        stanceAff: firstItem.stance_a,
        stanceNeg: firstItem.stance_b
      }
    });
  };

  // 快捷键：R 重抽 / F 投屏 / Esc 退出大屏 / Space、PageDown（翻页笔）开始抽取
  // P0-4：ceremonyOpen 时这些页面级快捷键整体禁用，由仪式组件内的捕获监听接管
  useHotkeyScope('draw');
  useHotkeys([
    {
      combo: 'space',
      description: '开始抽取（翻页笔下一页）',
      scope: 'draw',
      handler: () => {
        if (!animating && !bigScreen && !ceremonyOpen) void handleDraw();
      },
      enabled: !animating && !bigScreen && !ceremonyOpen && !!config.eventId
    },
    {
      combo: 'pagedown',
      description: '开始抽取（翻页笔下一页）',
      scope: 'draw',
      handler: () => {
        if (!animating && !bigScreen && !ceremonyOpen) void handleDraw();
      },
      enabled: !animating && !bigScreen && !ceremonyOpen && !!config.eventId
    },
    {
      combo: 'r',
      description: '重新抽取',
      scope: 'draw',
      handler: () => {
        if (drawStore.lastResult && !animating && !ceremonyOpen) void handleRedo();
      },
      enabled: !!drawStore.lastResult && !animating && !ceremonyOpen
    },
    {
      combo: 'f',
      description: '进入大屏',
      scope: 'draw',
      handler: () => {
        if (drawStore.lastResult && !bigScreen && !ceremonyOpen) setBigScreen(true);
      },
      enabled: !!drawStore.lastResult && !bigScreen && !ceremonyOpen
    },
    {
      combo: 'escape',
      description: '退出大屏',
      scope: 'draw',
      handler: () => {
        if (bigScreen && !ceremonyOpen) setBigScreen(false);
      },
      enabled: bigScreen && !ceremonyOpen
    }
  ]);

  const currentRound = eventStore.rounds.find((r) => r.id === config.roundId) ?? null;
  const currentEvent = eventStore.events.find((e) => e.id === config.eventId);

  return (
    <>
      <PageHeader title="辩题抽取" subtitle="配置抽取规则并执行" />
      {/* 左右分栏布局：左栏 320px 配置面板，右栏 flex:1 预览/结果区 */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: spacing.sectionGap,
          minHeight: 'calc(100vh - 56px)',
          padding: spacing.lg,
          background: 'transparent'
        }}
      >
        {/* 左栏：配置面板（固定 320px，移动端 100%） */}
        <div style={{ width: isMobile ? '100%' : 320, flexShrink: 0 }}>
          <AccentCard
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                <GiftOutlined />
                <span>抽取配置</span>
              </div>
            }
            size="small"
            style={{ position: 'sticky', top: 16, maxHeight: 'calc(100vh - 56px - 32px)', overflowY: 'auto' }}
          >
            <DrawConfigPanel
              state={config}
              onChange={updateConfig}
              events={eventStore.events}
              rounds={eventStore.rounds}
              teams={eventStore.teams}
              groups={eventStore.groups}
              tagOptions={tagOptions}
              loading={drawStore.loading}
              onDraw={handleDraw}
              testMode={testMode}
              onTestModeChange={setTestMode}
              allowRepeat={allowRepeat}
              onAllowRepeatChange={setAllowRepeat}
              eventAllowRepeat={currentEvent?.allow_repeat}
            />
          </AccentCard>
        </div>

        {/* 右栏：预览/结果区（flex: 1） */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'visible' }}>
          {/* 顶部面包屑：当前赛事 / 轮次 / 难度 */}
          {(currentEvent || currentRound) && (
            <div style={{ marginBottom: spacing.md }}>
              <Breadcrumb
                items={[
                  { title: <span><TrophyOutlined /> {currentEvent?.name ?? '未选择赛事'}</span> },
                  currentRound ? { title: currentRound.name } : null,
                  // Critical-3 修复：Round.difficulty_override 是 string | null，
                  // 不是 DrawSessionSettings.difficulty_override 的 Record<string, number>。
                  // 直接显示字符串值即可。
                  currentRound?.difficulty_override
                    ? { title: `难度覆盖：${currentRound.difficulty_override}` }
                    : null
                ].filter(Boolean) as any}
              />
            </div>
          )}

          {drawStore.lastResult ? (
            <>
              {/* 抽取结果卡片：金色色条 + hover 阴影 */}
              <Card
                style={{
                  ...resultCardStyle,
                  boxShadow: resultHover ? shadow.cardHover : shadow.cardRest,
                  marginBottom: spacing.md
                }}
                onMouseEnter={() => setResultHover(true)}
                onMouseLeave={() => setResultHover(false)}
              >
                {/* 大屏开启且非抽取中：同步显示揭晓进度 */}
                {bigScreen && !animating && (
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', marginBottom: spacing.sm, fontSize: fontSize.body }}
                  >
                    {revealedCount}/{drawStore.lastResult.topics.length} 题已揭晓
                  </Typography.Text>
                )}
                {/* Task 9.2：降级抽取警告条（实际抽到题数 < 原需求题数） */}
                {downgradeInfo && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`本次仅抽到 ${downgradeInfo.actualCount} 道，原需 ${downgradeInfo.originalCount} 道`}
                    style={{ marginBottom: 12 }}
                    closable
                    onClose={() => setDowngradeInfo(null)}
                  />
                )}
                {/* Task 9.3：允许辩题重复提示条（测试模式或 allow_repeat=true 时显示） */}
                {repeatUsed && !downgradeInfo && (
                  <Alert
                    type="info"
                    showIcon
                    message="本次允许辩题重复，可能包含相同辩题"
                    style={{ marginBottom: 12 }}
                  />
                )}
                <DrawResultList
                  result={drawStore.lastResult}
                  teams={eventStore.teams}
                  onBigScreen={() => setBigScreen(true)}
                  onRedo={handleRedo}
                  onConfirm={handleConfirm}
                  confirming={confirming}
                  revealMode={config.revealMode}
                />
              </Card>

              {/* SubTask 18.4：底部操作栏（sticky + 毛玻璃），仅当抽取结果存在时显示 */}
              <div
                style={{
                  position: 'sticky',
                  bottom: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  gap: spacing.md,
                  padding: `${spacing.md} ${spacing.lg}`,
                  // SubTask 3.1：背景由 useStickyBg() 提供（亮/暗模式自适应 + 12px 毛玻璃）
                  ...stickyBg,
                  borderTop: `1px solid ${gray[100]}`,
                  borderRadius: `0 0 ${spacing.sm}px ${spacing.sm}px`,
                  zIndex: zIndex.sticky
                }}
              >
                <KbdHint kbd="R" description="重新抽取">
                  <Button
                    className="btn-press"
                    icon={<ReloadOutlined />}
                    onClick={handleRedo}
                    loading={animating}
                    disabled={animating}
                  >
                    重抽
                  </Button>
                </KbdHint>
                <KbdHint kbd="F" description="进入大屏">
                  <Button
                    type="primary"
                    icon={<DesktopOutlined />}
                    onClick={() => setBigScreen(true)}
                  >
                    投屏
                  </Button>
                </KbdHint>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => void handleExport('xlsx')}
                >
                  导出
                </Button>
                <Button
                  type="primary"
                  icon={<ClockCircleOutlined />}
                  onClick={handleStartTimer}
                >
                  开始计时
                </Button>
              </div>
            </>
          ) : (
            <GuideSteps />
          )}
        </div>
      </div>

      {/* 抽取动画：全屏仪式开启时不渲染小屏动画；大屏场景由大屏内三幕动画接管 */}
      <DrawAnimation open={animating && !bigScreen && !ceremonyOpen} mode="small" />

      {/* P0-4：全屏抽取仪式（深色沉浸 + 大字滚动 + 定格闪烁 + 音效），纯展示层，不改动抽取逻辑 */}
      <DrawCeremony
        open={ceremonyOpen}
        animating={animating}
        result={drawStore.lastResult}
        candidates={candidateTitles}
        eventName={currentEvent?.name ?? '辩题抽取'}
        roundName={currentRound?.name ?? ''}
        revealMode={config.revealMode}
        onStart={() => void handleDraw()}
        onExit={() => setCeremonyOpen(false)}
      />

      {/* 大屏模式 */}
      {bigScreen && drawStore.lastResult && (
        <BigScreen
          result={drawStore.lastResult}
          teams={eventStore.teams}
          round={currentRound}
          eventName={currentEvent?.name ?? '辩题抽取'}
          animating={animating}
          revealedCount={revealedCount}
          setRevealedCount={setRevealedCount}
          revealMode={config.revealMode}
          onClose={() => setBigScreen(false)}
        />
      )}

      {/* SubTask 5.4：题池不足处理弹窗（InsufficientTopicsError 捕获后渲染） */}
      <InsufficientTopicsModal
        open={insufficientInfo !== null}
        candidateCount={insufficientInfo?.candidateCount ?? 0}
        requiredCount={insufficientInfo?.requiredCount ?? 0}
        onSelect={handleInsufficientSelect}
      />
    </>
  );
}
