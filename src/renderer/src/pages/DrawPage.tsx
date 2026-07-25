import { useEffect, useState, useMemo } from 'react';
import { Layout, Typography, message, Breadcrumb, Space, Card } from 'antd';
import {
  ThunderboltOutlined,
  TrophyOutlined,
  ControlOutlined,
  RocketOutlined
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useDrawStore } from '../stores/drawStore';
import { useEventStore } from '../stores/eventStore';
import { useTopicStore } from '../stores/topicStore';
import type {
  DrawParams,
  TopicFilter,
  Team,
  DrawPageLocationState
} from '../../../shared/types';
import DrawConfigPanel, { type DrawConfigState } from '../components/draw/DrawConfigPanel';
import DrawResultList from '../components/draw/DrawResultList';
import BigScreen from '../components/draw/BigScreen';
import DrawAnimation from '../components/draw/DrawAnimation';
import { siderStyle, emptyStateStyle, kbdStyle } from '../styles/shared';
import { spacing, shadow, gradient } from '../styles/tokens';

const { Sider, Content } = Layout;

const DEFAULT_CONFIG: DrawConfigState = {
  eventId: null,
  roundId: null,
  topicCount: 4,
  includeStance: false,
  teamPairs: [],
  filter: {},
  includeKeywords: [],
  excludeKeywords: [],
  sourceMixEnabled: false,
  officialRatio: 70
};

/** 引导步骤卡片 */
function GuideSteps() {
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
              borderRadius: 12,
              border: '1px solid #f0f0f0',
              boxShadow: shadow.sm,
              transition: 'all 0.2s ease',
              cursor: 'default',
              position: 'relative',
              overflow: 'hidden'
            }}
            className="btn-lift"
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
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
                  fontSize: 24,
                  marginBottom: spacing.md
                }}
              >
                {s.icon}
              </div>
              <Typography.Title level={5} style={{ marginBottom: 4 }}>
                {s.title}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {s.desc}
              </Typography.Text>
            </div>
          </Card>
        ))}
      </Space>

      <Typography.Text type="secondary" style={{ marginTop: spacing.xl, fontSize: 13 }}>
        提示：抽取完成后可按 <kbd style={kbdStyle}>R</kbd> 重抽 · <kbd style={kbdStyle}>F</kbd> 投屏 · <kbd style={kbdStyle}>Esc</kbd> 退出
      </Typography.Text>
    </div>
  );
}

export default function DrawPage() {
  const drawStore = useDrawStore();
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const location = useLocation();

  const [config, setConfig] = useState<DrawConfigState>(DEFAULT_CONFIG);
  const [animating, setAnimating] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);

  // 拉取赛事列表（仅一次）
  useEffect(() => {
    eventStore.listEvents();
  }, []);

  // 接收来自 EventManage 的跳转上下文：eventId / roundId
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
        message.info('已从赛事详情带入赛事与轮次上下文');
      }
    }
  }, [location.state]);

  // 赛事变更时拉取轮次+队伍
  useEffect(() => {
    if (config.eventId) {
      eventStore.listRoundsByEvent(config.eventId);
      eventStore.listTeamsByEvent(config.eventId);
    }
  }, [config.eventId]);

  // 标签候选（从题库拉取一批题的 tags 汇总）
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    topicStore.items.forEach((t) => (t.tags ?? []).forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [topicStore.items]);

  // 初次进入拉取一批题用于 tag 候选
  useEffect(() => {
    if (topicStore.items.length === 0) {
      topicStore.fetchList();
    }
  }, []);

  const updateConfig = (patch: Partial<DrawConfigState>) =>
    setConfig((c) => ({ ...c, ...patch }));

  // 组装 DrawParams
  const buildParams = (): DrawParams | null => {
    if (!config.eventId) return null;
    // 合并 teams（从 teamPairs 扁平化）
    const teams: Team[] = [];
    config.teamPairs.forEach((p) => {
      if (p.teamA) teams.push(p.teamA);
      if (p.teamB) teams.push(p.teamB);
    });

    const filter: TopicFilter = { ...config.filter, status: 'active' };

    const params: DrawParams = {
      event_id: config.eventId,
      round_id: config.roundId ?? undefined,
      topic_count: config.topicCount,
      include_stance: config.includeStance,
      teams: config.includeStance ? teams : undefined,
      filters: filter,
      operator: 'renderer'
    };

    if (config.sourceMixEnabled) {
      params.source_mix_ratio = {
        official: config.officialRatio / 100,
        custom: (100 - config.officialRatio) / 100
      };
    }
    return params;
  };

  const handleDraw = async () => {
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    try {
      // 动画至少显示 1.2s
      const [result] = await Promise.all([
        drawStore.execute(params),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      if (result) {
        message.success(`已抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setAnimating(false);
    }
  };

  const handleRedo = async () => {
    if (!drawStore.lastResult) return;
    const params = buildParams();
    if (!params) return;
    setAnimating(true);
    try {
      const [result] = await Promise.all([
        drawStore.redo(drawStore.lastResult.session.id, params),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      if (result) {
        message.success(`已重新抽取 ${result.topics.length} 道辩题`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重抽失败');
    } finally {
      setAnimating(false);
    }
  };

  // 快捷键：R 重抽 / F 投屏 / Esc 退出大屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && drawStore.lastResult && !animating) {
        void handleRedo();
      } else if (e.key.toLowerCase() === 'f' && drawStore.lastResult && !bigScreen) {
        setBigScreen(true);
      } else if (e.key === 'Escape' && bigScreen) {
        setBigScreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawStore.lastResult, animating, bigScreen]);

  const currentRound = eventStore.rounds.find((r) => r.id === config.roundId) ?? null;
  const currentEvent = eventStore.events.find((e) => e.id === config.eventId);

  return (
    <>
      <Layout style={{ background: 'transparent', height: 'calc(100vh - 56px)' }}>
        <Sider
          width={360}
          theme="light"
          style={{
            background: 'transparent',
            borderRight: '1px solid #f0f0f0',
            overflow: 'auto',
            ...siderStyle
          }}
        >
          <DrawConfigPanel
            state={config}
            onChange={updateConfig}
            events={eventStore.events}
            rounds={eventStore.rounds}
            teams={eventStore.teams}
            tagOptions={tagOptions}
            loading={drawStore.loading}
            onDraw={handleDraw}
          />
        </Sider>

        <Content style={{ padding: spacing.lg, overflow: 'auto' }}>
          {/* 顶部面包屑：当前赛事 / 轮次 / 难度 */}
          {(currentEvent || currentRound) && (
            <div style={{ marginBottom: spacing.md }}>
              <Breadcrumb
                items={[
                  { title: <span><TrophyOutlined /> {currentEvent?.name ?? '未选择赛事'}</span> },
                  currentRound ? { title: currentRound.name } : null,
                  currentRound?.difficulty_override
                    ? { title: `难度覆盖：${Object.entries(currentRound.difficulty_override).map(([k, v]) => `${k}:${v}`).join(' / ')}` }
                    : null
                ].filter(Boolean) as any}
              />
            </div>
          )}

          {drawStore.lastResult ? (
            <DrawResultList
              result={drawStore.lastResult}
              teams={eventStore.teams}
              onBigScreen={() => setBigScreen(true)}
              onRedo={handleRedo}
            />
          ) : (
            <GuideSteps />
          )}
        </Content>
      </Layout>

      {/* 抽取动画 */}
      <DrawAnimation open={animating} />

      {/* 大屏模式 */}
      {bigScreen && drawStore.lastResult && (
        <BigScreen
          result={drawStore.lastResult}
          teams={eventStore.teams}
          round={currentRound}
          eventName={currentEvent?.name ?? '辩题抽取'}
          onClose={() => setBigScreen(false)}
        />
      )}
    </>
  );
}
