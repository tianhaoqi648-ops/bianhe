// ============================================================
// EventDrawsTab.tsx — 赛事抽取结果 Tab
//
// 展示单个赛事下的抽取会话与统计：
// 1. 顶部 3 张统计卡片（总抽取次数 / 使用辩题数 / 涉及队伍数）
// 2. 右上角导出按钮区（xlsx/csv/json）
// 3. 中部小卡片列表视图（按日期分组 + 紧凑明细表格）
// 4. 底部走势图（DrawTrendChart）
// 5. 空状态：sessions 为空时显示「前往抽辩题」
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Select,
  Typography,
  Tag,
  Skeleton,
  Empty
} from 'antd';
import {
  DownloadOutlined,
  ReloadOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  CalendarOutlined,
  TeamOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import StatCard from '../common/StatCard';
import EmptyState from '../common/EmptyState';
import DrawTrendChart from './DrawTrendChart';
import DrawResultStyleSwitcher, {
  type DrawResultStyle,
  loadDrawResultStyle,
  saveDrawResultStyle
} from '../draw/DrawResultStyleSwitcher';
import MatchupTable from '../draw/MatchupTable';
import CompactDrawTable from '../draw/CompactDrawTable';
import DrawResultCard from '../draw/DrawResultCard';
import { useToast } from '../../hooks/useToast';
import { spacing, fontSize, shadow, transition, colorPrimary } from '../../styles/tokens';
import type { DrawSessionDetail, ExportFormat, Topic, Team } from '../../../../shared/types';

const { Text } = Typography;

/** localStorage 暂存预选赛事的 key（与 DrawPage 约定一致） */
const PRESELECT_EVENT_KEY = 'bianhe-draw-preselect-event';

export interface EventDrawsTabProps {
  eventId: string;
  sessions: DrawSessionDetail[];
  loading: boolean;
  onRefresh: () => void;
}

/** 按日期分组的会话组 */
interface SessionGroup {
  label: string;
  items: DrawSessionDetail[];
}

/**
 * 格式化日期组标题：YYYY-MM-DD 周X
 */
function formatDateGroupLabel(d: dayjs.Dayjs): string {
  const dateStr = d.format('YYYY-MM-DD');
  const weekday = new Date(d.toISOString()).toLocaleDateString('zh-CN', { weekday: 'short' });
  return `${dateStr} ${weekday}`;
}

export default function EventDrawsTab({
  eventId,
  sessions,
  loading,
  onRefresh
}: EventDrawsTabProps) {
  const navigate = useNavigate();
  const toast = useToast();

  // 导出格式
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');
  const [exporting, setExporting] = useState(false);

  // 展示风格（与 DrawResultList 共用 localStorage key）
  const [style, setStyle] = useState<DrawResultStyle>(() => loadDrawResultStyle());
  const handleStyleChange = (next: DrawResultStyle) => {
    setStyle(next);
    saveDrawResultStyle(next);
  };

  // 明细缓存：sessionId → DrawSessionDetail
  // sessions 数组中的元素已包含 items（DrawSessionDetail），通常无需再调 getSession；
  // 这里仍保留缓存以支持后续扩展（如重抽后单条刷新）。
  const [detailCache, setDetailCache] = useState<Record<string, DrawSessionDetail>>({});
  // 队伍 id → name 映射（fallback 用）
  const [teamMap, setTeamMap] = useState<Map<string, string>>(new Map());

  // teamsMap：供 MatchupTable / CompactDrawTable 使用（id → { name }）
  const teamsMap = useMemo(() => {
    const m = new Map<string, { name: string }>();
    teamMap.forEach((name, id) => m.set(id, { name }));
    return m;
  }, [teamMap]);

  // teams 数组：供 DrawResultCard 使用
  const teamsArr = useMemo<Team[]>(() => {
    return Array.from(teamMap.entries()).map(([id, name]) => ({
      id,
      name,
      event_id: eventId
    }));
  }, [teamMap, eventId]);

  // ====== 统计 ======
  const stats = useMemo(() => {
    let topicCount = 0;
    let teamCount = 0;
    if (sessions.length > 0) {
      const topicIds = new Set<string>();
      const teamIds = new Set<string>();
      sessions.forEach((s) => {
        (s.items ?? []).forEach((it) => {
          if (it.topic_id) topicIds.add(it.topic_id);
          if (it.team_a_id) teamIds.add(it.team_a_id);
          if (it.team_b_id) teamIds.add(it.team_b_id);
        });
      });
      topicCount = topicIds.size;
      teamCount = teamIds.size;
    }
    return {
      total: sessions.length,
      topicCount,
      teamCount
    };
  }, [sessions]);

  // ====== 队伍映射预拉（fallback 显示） ======
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.eventAPI.listTeamsByEvent(eventId);
        if (cancelled) return;
        if (res.success && res.data) {
          const m = new Map<string, string>();
          (res.data as Array<{ id: string; name: string }>).forEach((t) =>
            m.set(t.id, t.name)
          );
          setTeamMap(m);
        }
      } catch {
        // 忽略：fallback map 为空，显示快照或「（已删除队伍）」
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // ====== 异步获取辩题标题（snapshot 与 map 均未命中时） ======
  const fetchTopicTitleAsync = async (
    topicId: string,
    sessionId: string,
    itemId: string
  ) => {
    try {
      const res = await window.topicAPI.get(topicId);
      if (res.success && res.data) {
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
      // 辩题真的不存在，保持「（已删除辩题）」
    }
  };

  // 取 session 详情：优先 detailCache，其次 sessions 中的元素（已包含 items）
  const resolveSession = (sessionId: string): DrawSessionDetail | undefined => {
    return detailCache[sessionId] ?? sessions.find((s) => s.id === sessionId);
  };

  // 按日期分组 sessions（参考 History.tsx）
  const groupedSessions = useMemo<SessionGroup[]>(() => {
    const groups = new Map<string, SessionGroup>();
    sessions.forEach((s) => {
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
  }, [sessions]);

  // ====== 构建 session 的 topicsMap（含异步拉取缺失标题） ======
  const buildSessionTopicsMap = (session: DrawSessionDetail): Map<string, string> => {
    const m = new Map<string, string>();
    (session.items ?? []).forEach((it) => {
      if (it.topic_title) {
        m.set(it.topic_id, it.topic_title);
      } else {
        // snapshot 未命中，异步拉取
        m.set(it.topic_id, '（已删除辩题）');
        setTimeout(
          () => void fetchTopicTitleAsync(it.topic_id, session.id, it.id),
          0
        );
      }
    });
    return m;
  };

  // ====== 构建 session 的 minimal Topic[]（供 DrawResultCard 使用） ======
  const buildSessionTopics = (session: DrawSessionDetail): Topic[] => {
    return (session.items ?? []).map((it) => ({
      id: it.topic_id,
      title: it.topic_title ?? '（已删除辩题）',
      type: null,
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null,
      weight: 1,
      status: 'active',
      batch_id: null,
      created_at: '',
      updated_at: ''
    }));
  };

  // ====== 渲染明细（根据 style 切换） ======
  const renderSessionDetail = (session: DrawSessionDetail) => {
    const resolved = resolveSession(session.id);
    if (!resolved) {
      return (
        <div style={{ padding: spacing.md }}>
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
      );
    }

    const items = resolved.items ?? [];
    if (items.length === 0) {
      return <Empty description="暂无明细" />;
    }

    const topicsMap = buildSessionTopicsMap(resolved);

    if (style === 'matchup-table') {
      return (
        <MatchupTable
          items={items}
          session={resolved}
          topicsMap={topicsMap}
          teamsMap={teamsMap}
        />
      );
    }

    if (style === 'compact-table') {
      return (
        <CompactDrawTable
          items={items}
          topicsMap={topicsMap}
          teamsMap={teamsMap}
        />
      );
    }

    // topic-grid：辩题卡片网格
    const sessionTopics = buildSessionTopics(resolved);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 12,
          alignItems: 'start'
        }}
      >
        {sessionTopics.map((topic, idx) => {
          const item = items.find((it) => it.topic_id === topic.id);
          if (!item) return null;
          return (
            <DrawResultCard
              key={topic.id}
              index={idx}
              topic={topic}
              item={item}
              teams={teamsArr}
            />
          );
        })}
      </div>
    );
  };

  // ====== 导出 ======
  const handleExport = async () => {
    try {
      setExporting(true);
      const res = await window.exportAPI.exportDrawSessions({
        filter: { event_id: eventId },
        format: exportFormat
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || '导出失败');
      }
      toast.success(`已导出 ${res.data.count} 条记录到：${res.data.filePath}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // ====== 前往抽辩题 ======
  const handleGotoDraw = () => {
    try {
      localStorage.setItem(PRESELECT_EVENT_KEY, eventId);
    } catch {
      // 忽略 localStorage 写入失败
    }
    navigate('/draw', { state: { eventId } });
  };

  // ====== 空状态 ======
  if (!loading && sessions.length === 0) {
    return (
      <EmptyState type="default" description="暂无抽取记录">
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleGotoDraw}
        >
          前往抽辩题
        </Button>
      </EmptyState>
    );
  }

  return (
    <div>
      {/* 顶部统计卡片 + 导出按钮区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={24} sm={8}>
          <StatCard
            label="总抽取次数"
            value={stats.total}
            unit="次"
            icon={<HistoryOutlined />}
            color="primary"
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            label="使用辩题数"
            value={stats.topicCount}
            unit="道"
            icon={<FileTextOutlined />}
            color="gold"
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            label="涉及队伍数"
            value={stats.teamCount}
            unit="支"
            icon={<TeamOutlined />}
            color="purple"
          />
        </Col>
      </Row>

      {/* 导出 + 刷新 + 风格切换 操作行 */}
      <Card size="small" style={{ marginBottom: spacing.md }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: spacing.sm
          }}
        >
          <Space wrap>
            <Text type="secondary" style={{ fontSize: fontSize.caption }}>
              导出格式：
            </Text>
            <Select
              style={{ width: 140 }}
              value={exportFormat}
              onChange={(v: ExportFormat) => setExportFormat(v)}
              options={[
                { label: 'Excel (.xlsx)', value: 'xlsx' },
                { label: 'CSV (.csv)', value: 'csv' },
                { label: 'JSON (.json)', value: 'json' }
              ]}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              导出本赛事抽取结果
            </Button>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              刷新
            </Button>
          </Space>
          <DrawResultStyleSwitcher value={style} onChange={handleStyleChange} />
        </div>
      </Card>

      {/* 中部小卡片列表视图 */}
      <Skeleton
        active
        paragraph={{ rows: 4 }}
        loading={loading && groupedSessions.length === 0}
      />
      {!loading && groupedSessions.length === 0 ? (
        <EmptyState type="default" description="暂无抽取记录" />
      ) : (
        groupedSessions.map((group) => (
          <div key={group.label} style={{ marginBottom: spacing.lg }}>
            <Typography.Title
              level={5}
              style={{
                marginLeft: spacing.sm,
                marginBottom: spacing.sm,
                borderLeft: `4px solid ${colorPrimary}`,
                paddingLeft: 8
              }}
            >
              {group.label}
            </Typography.Title>
            {group.items.map((session) => {
              const resolved = resolveSession(session.id);
              const itemCount = resolved?.items?.length ?? 0;
              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  itemCount={itemCount}
                  detail={renderSessionDetail(session)}
                />
              );
            })}
          </div>
        ))
      )}

      {/* 底部走势图 */}
      <Card
        size="small"
        title={
          <Space>
            <CalendarOutlined />
            <Text strong>抽取走势</Text>
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        <DrawTrendChart sessions={sessions} />
      </Card>
    </div>
  );
}

// ============================================================
// SessionCard — 单个抽取会话卡片（内部子组件）
//
// 视觉精修要点：
// - hover 抬升：transition + cardHover 阴影
// - 信息层级：时间用 fontSize.h4 加粗醒目；操作人 caption 次要灰色；题数 Tag 用 gold 强调
// - 卡片更紧凑：marginBottom = spacing.xs
// ============================================================
function SessionCard({
  session,
  itemCount,
  detail
}: {
  session: DrawSessionDetail;
  itemCount: number;
  detail: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Card
      size="small"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        marginBottom: spacing.xs,
        transition: transition.base,
        boxShadow: hovered ? shadow.cardHover : shadow.cardRest
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.sm
        }}
      >
        <Space size={spacing.sm}>
          <Text strong style={{ fontSize: fontSize.h4 }}>
            {session.draw_time
              ? dayjs(session.draw_time).format('HH:mm')
              : '--:--'}
          </Text>
          {session.operator && (
            <Text
              type="secondary"
              style={{ fontSize: fontSize.caption }}
            >
              操作人：{session.operator}
            </Text>
          )}
        </Space>
        {itemCount > 0 && (
          <Tag color="gold">{itemCount} 道题</Tag>
        )}
      </div>
      {detail}
    </Card>
  );
}
