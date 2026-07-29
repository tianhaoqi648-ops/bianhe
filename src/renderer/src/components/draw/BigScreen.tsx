import { useEffect, useRef, useState, useMemo } from 'react';
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
import { normalizeStances } from '../../../../shared/stance-utils';
import { kbdStyle } from '../../styles/shared';
import { spacing, radius, fontSize } from '../../styles/tokens';
import { useSettingsStore, getBgmSetting } from '../../stores/settingsStore';
import { useSoundManager } from '../SoundManager';
import {
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../../utils/tagDisplay';
import { useHotkeys, useHotkeyScope } from '../../hooks/useHotkeys';
import KbdHint from '../common/KbdHint';
import DrawAnimation from './DrawAnimation';
import type { RevealMode } from './RevealAnimation';

export interface BigScreenProps {
  result: DrawResult;
  teams: Team[];
  round: Round | null;
  eventName: string;
  onClose: () => void;
  /** 抽取进行中（由 DrawPage 传入），用于触发大屏三幕动画 */
  animating?: boolean;
  /** 当前已揭晓题数（由 DrawPage 提升管理，便于小屏同步进度） */
  revealedCount: number;
  setRevealedCount: React.Dispatch<React.SetStateAction<number>>;
  /** P3.1 Task 1：揭晓动画模式，透传给 DrawAnimation */
  revealMode?: RevealMode;
}

export default function BigScreen({
  result,
  teams,
  round,
  eventName,
  onClose,
  animating,
  revealedCount,
  setRevealedCount,
  revealMode = 'fade'
}: BigScreenProps) {
  const { topics, session } = result;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  // 大屏三幕动画遮罩：animating 由 false→true 时锁存为 true，
  // 由用户在第三幕按 →/Space 继续（onAdvance）时解除，使三幕完整播完
  const [bigAnimating, setBigAnimating] = useState(false);
  // closing ref：避免关闭动画期间 exitFullscreen 触发重复 onClose
  const closingRef = useRef(false);
  const settings = useSettingsStore((s) => s.settings);
  const { playBgm, stopBgm } = useSoundManager();
  const bgmSetting = useMemo(() => getBgmSetting(settings), [settings]);

  // 锁存 bigAnimating：仅在 animating 变 true 时触发动画
  useEffect(() => {
    if (animating) {
      setBigAnimating(true);
      // P3.1 Task 5：揭晓动画开始时播放 BGM（不循环）
      if (bgmSetting.volume > 0) {
        playBgm(bgmSetting.defaultTrack, { loop: false, volume: bgmSetting.volume / 100 });
      }
    }
  }, [animating, bgmSetting, playBgm]);

  // P3.1 Task 5：揭晓动画结束（bigAnimating → false）时淡出 BGM
  useEffect(() => {
    if (!bigAnimating) {
      stopBgm(300);
    }
  }, [bigAnimating, stopBgm]);

  // 第二幕揭晓第一题回调
  const handleRevealFirst = () => setRevealedCount(1);
  // 第三幕用户继续：关闭遮罩，正常 BigScreen 内容接管（revealedCount 已为 1）
  const handleAdvance = () => setBigAnimating(false);

  // 大屏快捷键：ESC 退出 + 左右切换 + Space 下一题 + F 全屏（通过全局 HotkeyManager 管理）
  useHotkeyScope('bigscreen');
  useHotkeys([
    {
      combo: 'escape',
      description: '退出大屏',
      scope: 'bigscreen',
      handler: () => onClose()
    },
    {
      combo: 'arrowright',
      description: '下一题',
      scope: 'bigscreen',
      handler: () => {
        if (revealedCount < topics.length) handleNext();
      },
      // 动画期间禁用题目切换（→/Space 由 DrawAnimation 第三幕接管）
      enabled: !bigAnimating && revealedCount < topics.length
    },
    {
      combo: 'arrowleft',
      description: '上一题',
      scope: 'bigscreen',
      handler: () => {
        if (revealedCount > 0) handlePrev();
      },
      enabled: !bigAnimating && revealedCount > 0
    },
    {
      combo: 'space',
      description: '下一题',
      scope: 'bigscreen',
      handler: () => {
        if (revealedCount < topics.length) handleNext();
      },
      enabled: !bigAnimating && revealedCount < topics.length
    },
    {
      combo: 'f',
      description: '切换浏览器全屏',
      scope: 'bigscreen',
      handler: () => handleToggleFullscreen()
    }
  ]);

  // ===== 自动浏览器全屏（投屏模式）=====
  // 挂载时自动 requestFullscreen，卸载时自动 exitFullscreen
  useEffect(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {
        // 用户拒绝全屏权限或环境不支持，不阻塞大屏打开
      });
    }
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // ===== 锁定 body/html 滚动（防止父页面滚动条穿透到大屏）=====
  // 大屏为 position:fixed 覆盖视口，但浏览器原生滚动条无法被 z-index 覆盖，
  // 必须从源头锁定 body/html 的 overflow
  useEffect(() => {
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
  }, []);

  // 监听全屏状态变化：同步 isFullscreen + ESC 退出浏览器全屏时同步关闭大屏
  useEffect(() => {
    const handler = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      // 用户主动退出浏览器全屏（非 closing 流程），同步关闭大屏
      if (!isFs && !closingRef.current) {
        closingRef.current = true;
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [onClose]);

  const allRevealed = revealedCount >= topics.length;
  const currentTopic = revealedCount > 0 ? topics[revealedCount - 1] : null;
  const currentItem = currentTopic
    ? session.items.find((it) => it.topic_id === currentTopic.id)
    : null;
  const teamA = currentItem ? teams.find((t) => t.id === currentItem.team_a_id) : null;
  const teamB = currentItem ? teams.find((t) => t.id === currentItem.team_b_id) : null;

  // 长辩题自动缩放字号：按字数分 4 档
  const topicFontSize = useMemo(() => {
    if (!currentTopic) return 'clamp(28px, 5vw, 64px)'
    const len = currentTopic.title.length
    if (len <= 20) return 'clamp(40px, 6vw, 72px)'   // 短辩题：大字号
    if (len <= 40) return 'clamp(32px, 5vw, 56px)'   // 中等
    if (len <= 60) return 'clamp(24px, 4vw, 44px)'   // 长
    return 'clamp(20px, 3vw, 36px)'                  // 超长（>60字）
  }, [currentTopic])

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
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          zIndex: 2
        }}
      >
        <Space size={16} style={{ fontSize: 'clamp(14px, 1.5vw, 22px)', color: 'rgba(255,255,255,0.85)' }}>
          <span>{eventName}</span>
          {round?.name && <span>· {round.name}</span>}
        </Space>

        {/* 题目索引圆点指示器 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '40vw' }}>
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
          <KbdHint kbd="F" description="切换浏览器全屏">
            <Button
              type="text"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={handleToggleFullscreen}
              style={{ color: '#fff', fontSize: fontSize.h3 }}
            />
          </KbdHint>
          <KbdHint kbd="Esc" description="退出大屏">
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              style={{ color: '#fff', fontSize: fontSize.h3 }}
            />
          </KbdHint>
        </Space>
      </div>

      {/* 主体：辩题展示 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {!currentTopic ? (
          <div style={{ textAlign: 'center' }} className="fade-in-up">
            <div style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 700, marginBottom: 'clamp(8px, 1.5vh, 16px)' }}>准备抽取</div>
            <div style={{ fontSize: 'clamp(18px, 2vw, 28px)', color: 'rgba(255,255,255,0.7)', marginBottom: 'clamp(8px, 2vh, 20px)' }}>
              共 {topics.length} 道辩题待揭晓
            </div>
            <div style={{ fontSize: 'clamp(14px, 1.5vw, 20px)', color: 'rgba(255,255,255,0.5)' }}>
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
            <div className="bigscreen-stage-watermark">
              {String(revealedCount).padStart(2, '0')}
            </div>

            <div
              className="bigscreen-topic-title"
              style={{ position: 'relative', zIndex: 1, fontSize: topicFontSize }}
            >
              {currentTopic.title}
            </div>

            {/* 标签显示区（场景=大屏投影） */}
            {(() => {
              const cfg = loadTagDisplayConfig(settings);
              const typeTag = filterTag(cfg, currentTopic.type, 'type', 'bigScreen');
              const diffTag = filterTag(cfg, currentTopic.difficulty, 'difficulty', 'bigScreen');
              const sourceTag = filterTag(cfg, currentTopic.source_type, 'source_type', 'bigScreen');
              const customTags = filterTags(cfg, currentTopic.tags, 'custom', 'bigScreen');
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
                    marginTop: 'clamp(8px, 1.5vh, 16px)',
                    fontSize: 'clamp(14px, 1.5vw, 20px)',
                    position: 'relative',
                    zIndex: 1
                  }}
                >
                  {visibleTags.map((t) => (
                    <span
                      key={t.key}
                      style={{
                        padding: 'clamp(4px, 0.5vh, 8px) clamp(8px, 1vw, 16px)',
                        borderRadius: radius.xxl,
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

            {/* 持方对阵
             * - 对战模式（teamA + teamB 均存在）：渲染双方 VS
             * - 单人模式（teamB 为 null，仅 teamA 存在）：只渲染一方持方 + 队伍名
             */}
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
            {/* 单人模式：teamB 不存在时只渲染一方持方 + 队伍名 */}
            {teamA && !teamB && currentItem && (
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
              </div>
            )}
            {/* 多队模式：team_ids 非空时渲染两两配对 VS */}
            {currentItem && Array.isArray(currentItem.team_ids) && currentItem.team_ids.length > 0 && !teamA && !teamB && (() => {
              const teamIds = currentItem.team_ids as string[];
              const stances = (currentItem.team_stances ?? []) as string[];
              const names = (currentItem.team_names ?? []) as string[];
              // 循环赛检测：所有持位均为空字符串
              const isRoundRobin = stances.length > 0 && stances.every((s) => !s);
              // Task 12.2：渲染层防御性持方修正（不修改原 currentItem.team_stances）
              const normalizedStances = normalizeStances(stances);

              // 构建配对
              const pairs: Array<{ left: { name: string; stance?: string }; right: { name: string; stance?: string } | null }> = [];
              for (let i = 0; i < teamIds.length; i += 2) {
                const leftName = names[i] ?? '（已删除队伍）';
                const leftStance = normalizedStances[i];
                const left = { name: leftName, stance: leftStance };
                let right: { name: string; stance?: string } | null = null;
                if (i + 1 < teamIds.length) {
                  right = { name: names[i + 1] ?? '（已删除队伍）', stance: normalizedStances[i + 1] };
                }
                pairs.push({ left, right });
              }

              return (
                <div className="bigscreen-versus" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>
                  {pairs.map((pair, idx) => (
                    <div key={idx} className="bigscreen-versus" style={{ display: 'flex', alignItems: 'center', gap: 48, justifyContent: 'center' }}>
                      <div
                        className="bigscreen-team slide-in-left"
                        style={{
                          textAlign: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                        }}
                      >
                        {!isRoundRobin && pair.left.stance && (
                          <div className="bigscreen-stance" style={{ fontSize: 24, color: '#999', marginBottom: 8 }}>{pair.left.stance}</div>
                        )}
                        <div style={{ fontSize: 40, fontWeight: 700 }}>{pair.left.name}</div>
                      </div>
                      {pair.right ? (
                        <>
                          <div className="bigscreen-vs vs-glow" style={{ fontSize: 48, fontWeight: 800, color: '#ff4d4f' }}>VS</div>
                          <div
                            className="bigscreen-team slide-in-right"
                            style={{
                              textAlign: 'center',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                            }}
                          >
                            {!isRoundRobin && pair.right.stance && (
                              <div className="bigscreen-stance" style={{ fontSize: 24, color: '#999', marginBottom: 8 }}>{pair.right.stance}</div>
                            )}
                            <div style={{ fontSize: 40, fontWeight: 700 }}>{pair.right.name}</div>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 32, color: '#999' }}>轮空</div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 底部按钮组 */}
      <div
        style={{
          width: '100%',
          flexShrink: 0,
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${spacing.md} ${spacing.xxl}`,
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: radius.xl,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)'
        }}
      >
        <KbdHint kbd="←" description="上一题">
          <Button
            size="large"
            icon={<LeftOutlined />}
            disabled={revealedCount === 0}
            onClick={handlePrev}
            style={{ minWidth: 'clamp(90px, 10vw, 120px)', height: 'clamp(40px, 4vw, 48px)' }}
          >
            上一题
          </Button>
        </KbdHint>
        {!allRevealed ? (
          <KbdHint kbd="→" description="下一题">
            <Button
              type="primary"
              size="large"
              icon={<RightOutlined />}
              onClick={handleNext}
              style={{
                minWidth: 'clamp(160px, 18vw, 220px)',
                height: 'clamp(48px, 5vw, 56px)',
                fontSize: 'clamp(14px, 1.5vw, 18px)',
                borderRadius: radius.lg,
                background: 'linear-gradient(135deg, #ffd666 0%, #faad14 100%)',
                border: 'none',
                boxShadow: '0 4px 16px rgba(255, 214, 102, 0.5)'
              }}
              className="pulse-primary"
            >
              {revealedCount === 0 ? '开始揭晓' : '下一题'}
            </Button>
          </KbdHint>
        ) : (
          <Button
            size="large"
            type="primary"
            icon={<CheckOutlined />}
            onClick={onClose}
            style={{
              minWidth: 'clamp(160px, 18vw, 220px)',
              height: 'clamp(48px, 5vw, 56px)',
              fontSize: 'clamp(14px, 1.5vw, 18px)',
              borderRadius: radius.lg
            }}
          >
            全部揭晓，退出
          </Button>
        )}
      </div>

      <div style={{ textAlign: 'center', width: '100%', flexShrink: 0 }}>
        <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(11px, 1vw, 13px)' }}>
          按 <kbd style={kbdStyle}>ESC</kbd> 退出 · <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> 切换题目
        </Typography.Text>
      </div>

      {/* 大屏三幕动画遮罩：覆盖大屏正常内容，由 bigAnimating 锁存控制 */}
      {bigAnimating && (
        <DrawAnimation
          open
          mode="bigscreen"
          result={result}
          teams={teams}
          animating={animating}
          onRevealFirst={handleRevealFirst}
          onAdvance={handleAdvance}
          revealMode={revealMode}
        />
      )}
    </div>
  );
}
