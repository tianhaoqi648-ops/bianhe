import { useEffect, useState } from 'react';
import { Button, Typography, Space } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  CheckOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined
} from '@ant-design/icons';
import type { DrawResult, Team, Round } from '../../../../shared/types';
import { kbdStyle } from '../../styles/shared';
import { spacing, radius } from '../../styles/tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../../utils/tagDisplay';

export interface BigScreenProps {
  result: DrawResult;
  teams: Team[];
  round: Round | null;
  eventName: string;
  onClose: () => void;
}

export default function BigScreen({ result, teams, round, eventName, onClose }: BigScreenProps) {
  const { topics, session } = result;
  const [revealedCount, setRevealedCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const settings = useSettingsStore((s) => s.settings);

  // ESC 退出 + 左右切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && revealedCount < topics.length) {
        handleNext();
      } else if (e.key === 'ArrowLeft' && revealedCount > 0) {
        handlePrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealedCount, topics.length, onClose]);

  // 监听全屏状态
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const allRevealed = revealedCount >= topics.length;
  const currentTopic = revealedCount > 0 ? topics[revealedCount - 1] : null;
  const currentItem = currentTopic
    ? session.items.find((it) => it.topic_id === currentTopic.id)
    : null;
  const teamA = currentItem ? teams.find((t) => t.id === currentItem.team_a_id) : null;
  const teamB = currentItem ? teams.find((t) => t.id === currentItem.team_b_id) : null;

  const handleNext = () => {
    if (revealedCount >= topics.length) return;
    setTransitioning(true);
    setTimeout(() => {
      setRevealedCount((c) => c + 1);
      setTransitioning(false);
    }, 200);
  };

  const handlePrev = () => {
    if (revealedCount === 0) return;
    setTransitioning(true);
    setTimeout(() => {
      setRevealedCount((c) => c - 1);
      setTransitioning(false);
    }, 200);
  };

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  return (
    <div className="bigscreen-overlay">
      {/* 顶部：轮次 + 索引指示器 + 关闭/全屏 */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: `0 40px`,
          zIndex: 2
        }}
      >
        <Space size={16} style={{ fontSize: 22, color: 'rgba(255,255,255,0.85)' }}>
          <span>{eventName}</span>
          {round?.name && <span>· {round.name}</span>}
        </Space>

        {/* 题目索引圆点指示器 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {topics.map((_, idx) => (
            <span
              key={idx}
              style={{
                width: idx === revealedCount - 1 ? 14 : 10,
                height: idx === revealedCount - 1 ? 14 : 10,
                borderRadius: '50%',
                background: idx < revealedCount ? '#ffd666' : 'rgba(255,255,255,0.2)',
                border: idx < revealedCount ? 'none' : '1px solid rgba(255,255,255,0.3)',
                transition: 'all 0.3s ease',
                boxShadow: idx < revealedCount ? '0 0 10px rgba(255,214,102,0.6)' : 'none'
              }}
            />
          ))}
        </div>

        <Space size={8}>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={handleToggleFullscreen}
            style={{ color: '#fff', fontSize: 20 }}
          />
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
            style={{ color: '#fff', fontSize: 20 }}
          />
        </Space>
      </div>

      {/* 主体：辩题展示 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%'
        }}
      >
        {!currentTopic ? (
          <div style={{ textAlign: 'center' }} className="fade-in-up">
            <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>准备抽取</div>
            <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)', marginBottom: 24 }}>
              共 {topics.length} 道辩题待揭晓
            </div>
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>
              按 <kbd style={kbdStyle}>→</kbd> 开始揭晓
            </div>
          </div>
        ) : (
          <div
            key={revealedCount}
            className={`slide-in-from-right ${transitioning ? 'slide-out-left' : ''}`}
            style={{ textAlign: 'center', width: '100%' }}
          >
            {/* 题号大字水印 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 280,
                fontWeight: 900,
                color: 'rgba(255, 255, 255, 0.04)',
                pointerEvents: 'none',
                zIndex: 0
              }}
            >
              {String(revealedCount).padStart(2, '0')}
            </div>

            <div className="bigscreen-topic-title" style={{ position: 'relative', zIndex: 1 }}>
              {currentTopic.title}
            </div>

            {/* 标签显示区（统一使用全局配置，不再有独立大屏配置） */}
            {(() => {
              const cfg = loadTagDisplayConfig(settings);
              const typeTag = filterTag(cfg, currentTopic.type);
              const diffTag = filterTag(cfg, currentTopic.difficulty);
              const sourceTag = filterTag(cfg, currentTopic.source_type);
              const customTags = filterTags(cfg, currentTopic.tags);
              const visibleTags: Array<{ key: string; label: string; color?: string }> = [];
              if (typeTag) visibleTags.push({ key: 'type', label: typeTag, color: 'geekblue' });
              if (diffTag) visibleTags.push({ key: 'diff', label: diffTag, color: 'orange' });
              if (sourceTag) visibleTags.push({ key: 'source', label: sourceTag, color: 'purple' });
              customTags.forEach((t) => visibleTags.push({ key: `tag-${t}`, label: `#${t}` }));

              if (visibleTags.length === 0) return null;

              return (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 12,
                    marginTop: 16,
                    fontSize: 18,
                    position: 'relative',
                    zIndex: 1
                  }}
                >
                  {visibleTags.map((t) => (
                    <span
                      key={t.key}
                      style={{
                        padding: '4px 16px',
                        borderRadius: 16,
                        background: t.color ? 'rgba(22,119,255,0.2)' : 'rgba(255,255,255,0.1)',
                        border: `1px solid ${t.color ? 'rgba(22,119,255,0.4)' : 'rgba(255,255,255,0.2)'}`,
                        color: 'rgba(255,255,255,0.9)'
                      }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              );
            })()}

            {/* 持方对阵 */}
            {teamA && teamB && currentItem && (
              <div className="bigscreen-versus" style={{ position: 'relative', zIndex: 1 }}>
                <div
                  className="bigscreen-team slide-in-left"
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }}
                >
                  <div className="bigscreen-stance">{currentItem.stance_a}</div>
                  <div>{teamA.name}</div>
                </div>
                <div className="bigscreen-vs vs-glow">VS</div>
                <div
                  className="bigscreen-team slide-in-right"
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }}
                >
                  <div className="bigscreen-stance">{currentItem.stance_b}</div>
                  <div>{teamB.name}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部按钮组 */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${spacing.lg} ${spacing.xxxl}`,
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: radius.xl,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          marginBottom: spacing.xl
        }}
      >
        <Button
          size="large"
          icon={<LeftOutlined />}
          disabled={revealedCount === 0}
          onClick={handlePrev}
          style={{ minWidth: 120 }}
        >
          上一题
        </Button>
        {!allRevealed ? (
          <Button
            type="primary"
            size="large"
            icon={<RightOutlined />}
            onClick={handleNext}
            style={{
              minWidth: 220,
              height: 64,
              fontSize: 20,
              borderRadius: radius.lg,
              background: 'linear-gradient(135deg, #ffd666 0%, #faad14 100%)',
              border: 'none',
              boxShadow: '0 4px 16px rgba(255, 214, 102, 0.5)'
            }}
            className="pulse-primary"
          >
            {revealedCount === 0 ? '开始揭晓' : '下一题'}
          </Button>
        ) : (
          <Button
            size="large"
            type="primary"
            icon={<CheckOutlined />}
            onClick={onClose}
            style={{ minWidth: 220, height: 64, fontSize: 20, borderRadius: radius.lg }}
          >
            全部揭晓，退出
          </Button>
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          按 <kbd style={kbdStyle}>ESC</kbd> 退出 · <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> 切换题目
        </Typography.Text>
      </div>
    </div>
  );
}
