import { useMemo, useState, useEffect } from 'react';
import { Button, Space, Typography, Tag, theme } from 'antd';
import {
  DesktopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  LeftOutlined,
  RightOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { DrawResult, Team, ExportFormat } from '../../../../shared/types';
import EmptyState from '../common/EmptyState';
import DrawResultCard from './DrawResultCard';
import MatchupTable from './MatchupTable';
import CompactDrawTable from './CompactDrawTable';
import DrawResultStyleSwitcher, {
  type DrawResultStyle,
  loadDrawResultStyle,
  saveDrawResultStyle
} from './DrawResultStyleSwitcher';
import RevealAnimation, { type RevealMode } from './RevealAnimation';
import { useHotkeys, useHotkeyScope } from '../../hooks/useHotkeys';
import { spacing, fontSize, radius, colorGold, colorGoldLight, immersiveBg } from '../../styles/tokens';

export interface DrawResultListProps {
  result: DrawResult;
  teams: Team[];
  onBigScreen: () => void;
  onRedo: () => void;
  /** 确定结果：写入队伍历史 + 标记 session 已确认 */
  onConfirm: () => void;
  /** 确定按钮加载态（写入历史中） */
  confirming?: boolean;
  /** 揭晓动画模式（P3.1 Task 6 全屏展示使用） */
  revealMode?: RevealMode;
  /** 导出抽取记录回调（全屏模式下的导出按钮） */
  onExport?: (format: ExportFormat) => void;
}

export default function DrawResultList({
  result,
  teams,
  onBigScreen,
  onRedo,
  onConfirm,
  confirming,
  revealMode = 'fade',
  onExport
}: DrawResultListProps) {
  const { token } = theme.useToken();
  const { session, topics, actual_ratio } = result;
  const confirmed = !!session.settings?.confirmed;

  // 风格状态：从 localStorage 初始化
  const [style, setStyle] = useState<DrawResultStyle>(() => loadDrawResultStyle());

  // P3.1 Task 6：全屏展示模式状态
  // fullscreenIdx === -1 表示未进入全屏模式；>= 0 表示当前展示的题目索引
  const [fullscreenIdx, setFullscreenIdx] = useState<number>(-1);
  const isFullscreen = fullscreenIdx >= 0;
  // needsReveal: 标记当前题目是否需要播放揭晓动画（下一题/进入时 true，上一题 false）
  const [needsReveal, setNeedsReveal] = useState<boolean>(false);

  // 进入全屏展示模式
  const enterFullscreen = () => {
    setFullscreenIdx(0);
    setNeedsReveal(true);
  };
  // 下一题（带揭晓动画）
  const handleNextFullscreen = () => {
    if (fullscreenIdx < topics.length - 1) {
      setFullscreenIdx(fullscreenIdx + 1);
      setNeedsReveal(true);
    }
  };
  // 上一题（不重新揭晓）
  const handlePrevFullscreen = () => {
    if (fullscreenIdx > 0) {
      setFullscreenIdx(fullscreenIdx - 1);
      setNeedsReveal(false);
    }
  };
  // 退出全屏
  const exitFullscreen = () => {
    setFullscreenIdx(-1);
    setNeedsReveal(false);
  };

  // 全屏模式快捷键作用域
  useHotkeyScope('draw-fullscreen');

  // 全屏模式快捷键：空格/→ 下一题，← 上一题，ESC 退出
  useHotkeys([
    {
      combo: 'escape',
      description: '退出全屏展示',
      scope: 'draw-fullscreen',
      handler: () => exitFullscreen(),
      enabled: isFullscreen
    },
    {
      combo: 'space',
      description: '下一题',
      scope: 'draw-fullscreen',
      handler: () => handleNextFullscreen(),
      enabled: isFullscreen && fullscreenIdx < topics.length - 1
    },
    {
      combo: 'arrowright',
      description: '下一题',
      scope: 'draw-fullscreen',
      handler: () => handleNextFullscreen(),
      enabled: isFullscreen && fullscreenIdx < topics.length - 1
    },
    {
      combo: 'arrowleft',
      description: '上一题',
      scope: 'draw-fullscreen',
      handler: () => handlePrevFullscreen(),
      enabled: isFullscreen && fullscreenIdx > 0
    }
  ]);

  // 全屏模式时锁定 body 滚动
  useEffect(() => {
    if (!isFullscreen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [isFullscreen]);

  const handleStyleChange = (next: DrawResultStyle) => {
    setStyle(next);
    saveDrawResultStyle(next);
  };

  // 构建映射表（供 MatchupTable / CompactDrawTable 使用）
  const topicsMap = useMemo(() => {
    const m = new Map<string, string>();
    topics.forEach((t) => m.set(t.id, t.title));
    return m;
  }, [topics]);

  const topicsMetaMap = useMemo(() => {
    const m = new Map<
      string,
      { type?: string; domain?: string; difficulty?: string; source?: string; tags?: string[] }
    >();
    topics.forEach((t) => {
      m.set(t.id, {
        type: t.type ?? undefined,
        domain: t.domain ?? undefined,
        difficulty: t.difficulty ?? undefined,
        source: t.source ?? undefined,
        tags: t.tags ?? undefined
      });
    });
    return m;
  }, [topics]);

  const teamsMap = useMemo(() => {
    const m = new Map<string, { name: string; group_id?: string | null }>();
    teams.forEach((t) => m.set(t.id, { name: t.name }));
    return m;
  }, [teams]);

  if (topics.length === 0) {
    return (
      <EmptyState
        type="topic"
        description="暂无抽取结果"
        style={{ marginTop: 80 }}
      >
        <Button type="primary" icon={<ReloadOutlined />} onClick={onRedo}>
          重新抽取
        </Button>
      </EmptyState>
    );
  }

  return (
    <div>
      {/* 测试模式徽章：session.settings.is_test=true 时显示 */}
      {session.settings?.is_test && (
        <Tag color="orange" style={{ marginBottom: 12 }}>
          <ExclamationCircleOutlined /> 测试
        </Tag>
      )}
      {/* 顶部操作栏 */}
      <div
        className="draw-result-no-print"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: spacing.md,
          background: token.colorBgContainer,
          borderRadius: radius.lg,
          border: `1px solid ${token.colorBorderSecondary}`,
          marginBottom: spacing.md,
          flexWrap: 'wrap',
          gap: spacing.sm
        }}
      >
        <Space wrap>
          {/* ✓ 圆形图标背景 */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(82, 196, 26, 0.12)',
              color: '#52c41a',
              fontSize: fontSize.h4
            }}
          >
            <CheckCircleOutlined />
          </span>
          <Typography.Text strong>抽取完成</Typography.Text>
          <Typography.Text type="secondary">
            共 {topics.length} 题 ·{' '}
            {session.draw_time ? dayjs(session.draw_time).format('YYYY-MM-DD HH:mm') : ''}
          </Typography.Text>
          {actual_ratio && (
            <Space size={4}>
              <Tag color="blue">
                官方 {Math.round(actual_ratio.official * 100)}%
              </Tag>
              <Tag color="purple">
                自定义 {Math.round(actual_ratio.custom * 100)}%
              </Tag>
            </Space>
          )}
        </Space>
        <Space wrap>
          {/* 风格切换器 */}
          <DrawResultStyleSwitcher value={style} onChange={handleStyleChange} />
          {/* 确定结果按钮：confirmed 时显示「已确认 ✓」禁用态 */}
          <Button
            type={confirmed ? 'default' : 'primary'}
            icon={<CheckOutlined />}
            onClick={onConfirm}
            disabled={confirmed}
            loading={confirming && !confirmed}
          >
            {confirmed ? '已确认 ✓' : '确定结果'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={onRedo}>
            重新抽取
          </Button>
          <Button type="primary" icon={<DesktopOutlined />} onClick={onBigScreen}>
            投屏模式
          </Button>
          {/* P3.1 Task 6：全屏展示模式按钮 */}
          <Button
            icon={<FullscreenOutlined />}
            onClick={enterFullscreen}
            disabled={topics.length === 0}
          >
            全屏展示
          </Button>
        </Space>
      </div>

      {/* 根据 style 渲染不同视图 */}
      {style === 'matchup-table' && (
        <MatchupTable
          items={session.items}
          session={session}
          topicsMap={topicsMap}
          teamsMap={teamsMap}
        />
      )}

      {style === 'topic-grid' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 12,
            alignItems: 'start'
          }}
        >
          {topics.map((topic, idx) => {
            const item = session.items.find((it) => it.topic_id === topic.id);
            if (!item) return null;
            return (
              <div
                key={topic.id}
                className="fade-in-up-staggered"
                style={{ animationDelay: `${idx * 0.08}s` }}
              >
                <DrawResultCard index={idx} topic={topic} item={item} teams={teams} />
              </div>
            );
          })}
        </div>
      )}

      {style === 'compact-table' && (
        <CompactDrawTable
          items={session.items}
          topicsMap={topicsMap}
          topicsMetaMap={topicsMetaMap}
          teamsMap={teamsMap}
        />
      )}

      {/* P3.1 Task 6：全屏展示模式覆盖层 */}
      {isFullscreen && fullscreenIdx < topics.length && (() => {
        const topic = topics[fullscreenIdx];
        const item = session.items.find((it) => it.topic_id === topic.id);
        const teamA = item ? teams.find((t) => t.id === item.team_a_id) : null;
        const teamB = item ? teams.find((t) => t.id === item.team_b_id) : null;

        // 题号大字水印
        const watermark = String(fullscreenIdx + 1).padStart(2, '0');

        // 题干内容（RevealAnimation 包裹的正文）
        const topicContent = (
          <div style={{ textAlign: 'center', width: '100%' }}>
            {/* 题号大字水印 */}
            <div
              style={{
                fontSize: 'clamp(120px, 22vw, 280px)',
                fontWeight: 900,
                color: 'rgba(255,214,102,0.08)',
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 0,
                pointerEvents: 'none',
                letterSpacing: '0.05em'
              }}
            >
              {watermark}
            </div>

            {/* 题号标签 */}
            <div
              style={{
                display: 'inline-block',
                padding: '4px 16px',
                borderRadius: radius.xxl,
                background: `linear-gradient(135deg, ${colorGold} 0%, ${colorGoldLight} 100%)`,
                color: '#fff',
                fontSize: 'clamp(14px, 1.5vw, 20px)',
                fontWeight: 600,
                marginBottom: 'clamp(16px, 3vh, 32px)',
                position: 'relative',
                zIndex: 1
              }}
            >
              第 {fullscreenIdx + 1} 题
            </div>

            {/* 题干 */}
            <div
              style={{
                fontSize: 'clamp(28px, 5vw, 64px)',
                fontWeight: 700,
                color: '#fff',
                maxWidth: '80vw',
                margin: '0 auto',
                lineHeight: 1.4,
                position: 'relative',
                zIndex: 1
              }}
            >
              {topic.title}
            </div>

            {/* 持方分配 */}
            {item && (teamA || teamB) && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 'clamp(24px, 4vw, 48px)',
                  marginTop: 'clamp(24px, 4vh, 48px)',
                  position: 'relative',
                  zIndex: 1,
                  flexWrap: 'wrap'
                }}
              >
                {teamA && (
                  <div
                    style={{
                      padding: 'clamp(16px, 2vw, 24px) clamp(24px, 3vw, 36px)',
                      borderRadius: radius.xxl,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(10px)',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: 'clamp(14px, 1.5vw, 18px)', color: colorGoldLight, fontWeight: 600, marginBottom: 4 }}>
                      {item.stance_a ?? '正方'}
                    </div>
                    <div style={{ fontSize: 'clamp(20px, 2.5vw, 32px)', fontWeight: 700, color: '#fff' }}>
                      {teamA.name}
                    </div>
                  </div>
                )}
                {teamA && teamB && (
                  <div style={{ fontSize: 'clamp(32px, 4vw, 48px)', color: colorGoldLight, fontWeight: 300 }}>
                    VS
                  </div>
                )}
                {teamB && (
                  <div
                    style={{
                      padding: 'clamp(16px, 2vw, 24px) clamp(24px, 3vw, 36px)',
                      borderRadius: radius.xxl,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(10px)',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: 'clamp(14px, 1.5vw, 18px)', color: colorGoldLight, fontWeight: 600, marginBottom: 4 }}>
                      {item.stance_b ?? '反方'}
                    </div>
                    <div style={{ fontSize: 'clamp(20px, 2.5vw, 32px)', fontWeight: 700, color: '#fff' }}>
                      {teamB.name}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: immersiveBg,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'clamp(16px, 3vw, 32px)'
            }}
          >
            {/* 顶部：进度指示器 + 退出按钮 */}
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
                marginBottom: 'clamp(8px, 2vh, 16px)'
              }}
            >
              <Typography.Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(14px, 1.5vw, 18px)' }}>
                {session.draw_time ? dayjs(session.draw_time).format('YYYY-MM-DD HH:mm') : ''}
              </Typography.Text>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12
                }}
              >
                {/* 进度圆点指示器 */}
                {topics.map((_, idx) => (
                  <span
                    key={idx}
                    style={{
                      width: idx === fullscreenIdx ? 14 : 10,
                      height: idx === fullscreenIdx ? 14 : 10,
                      borderRadius: '50%',
                      background: idx <= fullscreenIdx ? colorGoldLight : 'rgba(255,255,255,0.2)',
                      border: idx <= fullscreenIdx ? 'none' : '1px solid rgba(255,255,255,0.3)',
                      transition: 'all 0.3s ease',
                      boxShadow: idx === fullscreenIdx ? `0 0 10px ${colorGold}99` : 'none'
                    }}
                  />
                ))}
                <Typography.Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 'clamp(14px, 1.5vw, 18px)', marginLeft: 8 }}>
                  {fullscreenIdx + 1} / {topics.length}
                </Typography.Text>
              </div>
              <Button
                type="text"
                icon={<FullscreenExitOutlined />}
                onClick={exitFullscreen}
                style={{ color: '#fff', fontSize: fontSize.h3 }}
              />
            </div>

            {/* 中央：单题放大卡片（第 1 题和下一题用 RevealAnimation 揭晓） */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                minHeight: 0,
                position: 'relative'
              }}
            >
              {needsReveal ? (
                <RevealAnimation key={fullscreenIdx} mode={revealMode}>
                  {topicContent}
                </RevealAnimation>
              ) : (
                topicContent
              )}
            </div>

            {/* 底部：操作栏 */}
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 'clamp(16px, 2vw, 24px)',
                flexShrink: 0,
                paddingTop: 'clamp(8px, 2vh, 16px)'
              }}
            >
              <Button
                size="large"
                icon={<LeftOutlined />}
                onClick={handlePrevFullscreen}
                disabled={fullscreenIdx === 0}
                style={{ minWidth: 'clamp(100px, 10vw, 120px)' }}
              >
                上一题
              </Button>
              {fullscreenIdx < topics.length - 1 ? (
                <Button
                  type="primary"
                  size="large"
                  icon={<RightOutlined />}
                  onClick={handleNextFullscreen}
                  style={{
                    minWidth: 'clamp(140px, 15vw, 180px)',
                    height: 'clamp(44px, 5vw, 52px)',
                    fontSize: 'clamp(14px, 1.3vw, 18px)',
                    background: `linear-gradient(135deg, ${colorGoldLight} 0%, ${colorGold} 100%)`,
                    border: 'none',
                    boxShadow: `0 4px 16px ${colorGold}80`
                  }}
                >
                  下一题
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  icon={<CheckOutlined />}
                  onClick={exitFullscreen}
                  style={{
                    minWidth: 'clamp(140px, 15vw, 180px)',
                    height: 'clamp(44px, 5vw, 52px)',
                    fontSize: 'clamp(14px, 1.3vw, 18px)'
                  }}
                >
                  全部展示完成
                </Button>
              )}
              {onExport && (
                <Button
                  size="large"
                  icon={<DownloadOutlined />}
                  onClick={() => onExport('xlsx')}
                  style={{ minWidth: 'clamp(100px, 10vw, 120px)' }}
                >
                  导出
                </Button>
              )}
            </div>

            {/* 快捷键提示 */}
            <div style={{ textAlign: 'center', width: '100%', flexShrink: 0, marginTop: 8 }}>
              <Typography.Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 'clamp(11px, 1vw, 13px)' }}>
                按 <kbd style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>Space</kbd> / <kbd style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>→</kbd> 下一题 · <kbd style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>←</kbd> 上一题 · <kbd style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>Esc</kbd> 退出
              </Typography.Text>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
