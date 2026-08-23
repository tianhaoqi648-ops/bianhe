import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { DrawResult } from '../../../../shared/types';
import { radius } from '../../styles/tokens';
import { kbdStyle } from '../../styles/shared';
import { type RevealMode } from './RevealAnimation';
import { motionClass } from '../../styles/motion';
import { useSoundManager } from '../SoundManager';

// ============================================================
// DrawCeremony.tsx — P0-4 赛题抽取全屏仪式动画
//
// 阶段机：idle（空闲，按空格开始）→ rolling（候选大字快速闪动+嗒声）→
//         frozen（定格辩题，金色高亮闪烁+胜利铃声）
//
// 设计要点：
//  - 纯展示层：抽取逻辑/结果完全复用 DrawPage 的 drawStore.execute，
//    动画前后不改动抽取结果；本组件仅在结果就绪后负责"定格/高亮/音效"。
//  - 快捷键：Space / PageDown（翻页笔下一页）在 idle 开始、frozen 退出、
//    rolling 提前定格；Esc 随时退出。仅在 open 时用捕获监听，避免干扰其它页面。
//  - 音效：滚动用 Web Audio 轻量"嗒"声；定格复用 useSoundManager.playBell（内置音），
//    不引入任何新依赖。
// ============================================================

interface DrawCeremonyProps {
  open: boolean;
  /** drawStore.execute 执行中（true 时进入 rolling） */
  animating: boolean;
  /** 最近一次抽取结果（就绪后用于定格展示） */
  result: DrawResult | null;
  /** 滚动阶段快速闪动的候选辩题标题池 */
  candidates: string[];
  eventName: string;
  roundName: string;
  /** idle 阶段按空格/翻页笔触发抽取 */
  onStart: () => void;
  /** 退出全屏仪式 */
  onExit: () => void;
  /** 定格揭晓动画模式（默认 flip 翻牌） */
  revealMode?: RevealMode;
}

type CeremonyPhase = 'idle' | 'rolling' | 'frozen';

/** 滚动最短时长：保证仪式感（即使抽取瞬间完成，闪动也至少持续这么久） */
const MIN_ROLL_MS = 1800;
/** 候选闪动切换间隔 */
const FLASH_MS = 80;

// ---------- Web Audio 轻量"嗒"声（模块级单例，无外部依赖） ----------
let tickCtx: AudioContext | null = null;
function playTick() {
  try {
    if (!tickCtx) {
      tickCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = tickCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 1100;
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.045);
  } catch {
    // 音频不可用时静默忽略，不影响动画
  }
}

/** 统一辩题字号：结果与滚动一致，避免单题过大或折行遮挡（refine-draw-ceremony-tone） */
const RESULT_FONT_SIZE = 'clamp(18px, 2.2vw, 30px)';

export default function DrawCeremony({
  open,
  animating,
  result,
  candidates,
  eventName,
  roundName,
  onStart,
  onExit
}: DrawCeremonyProps) {
  const [phase, setPhase] = useState<CeremonyPhase>('idle');
  const [flash, setFlash] = useState('');
  const rollStartRef = useRef<number>(0);
  const endTimerRef = useRef<number | undefined>(undefined);
  const prevAnimatingRef = useRef(false);
  const { playBell } = useSoundManager();

  // 用 ref 持有最新回调/结果，避免定时器/监听闭包过期
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const resultRef = useRef(result);
  resultRef.current = result;
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const pickRandom = useCallback(() => {
    const list = candidatesRef.current;
    if (!list || list.length === 0) return '正在抽取辩题…';
    return list[Math.floor(Math.random() * list.length)] ?? '…';
  }, []);

  /** 定格：进入 frozen 并释放胜利铃声（双击铃） */
  const finalize = useCallback(() => {
    if (resultRef.current) {
      setPhase('frozen');
      void playBell({ atMs: 0, sound: 'double_bell' });
    } else {
      // 无结果（异常返回由父组件负责关闭），回到空闲态避免卡死
      setPhase('idle');
    }
  }, [playBell]);

  // animating 上升时记录滚动起点，并清掉遗留的结束定时器
  useEffect(() => {
    if (animating && !prevAnimatingRef.current) {
      rollStartRef.current = Date.now();
      if (endTimerRef.current !== undefined) window.clearTimeout(endTimerRef.current);
      endTimerRef.current = undefined;
    }
    prevAnimatingRef.current = animating;
  }, [animating]);

  // 主状态机：animating→rolling；rolling 且抽取完成→（最短时长后）frozen
  useEffect((): void | (() => void) => {
    if (!open) return;
    if (animating) {
      setPhase('rolling');
      return;
    }
    if (phase !== 'rolling') return;
    const elapsed = Date.now() - rollStartRef.current;
    const remain = Math.max(0, MIN_ROLL_MS - elapsed);
    if (remain > 0) {
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = undefined;
        finalize();
      }, remain);
      return () => {
        if (endTimerRef.current !== undefined) {
          window.clearTimeout(endTimerRef.current);
          endTimerRef.current = undefined;
        }
      };
    }
    finalize();
  }, [open, animating, phase, finalize]);

  // rolling：候选大字快速闪动 + 嗒声
  useEffect(() => {
    if (!open || phase !== 'rolling') return;
    setFlash(pickRandom());
    const iv = window.setInterval(() => {
      setFlash(pickRandom());
      if (Math.random() < 0.6) playTick();
    }, FLASH_MS);
    return () => window.clearInterval(iv);
  }, [open, phase, pickRandom]);

  // 卸载时清理结束定时器
  useEffect(
    () => () => {
      if (endTimerRef.current !== undefined) window.clearTimeout(endTimerRef.current);
    },
    []
  );

  // 快捷键：仅仪式开启时捕获。Space/PageDown 适配翻页笔。
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const advance = e.code === 'Space' || e.code === 'PageDown';
      if (advance || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.key === 'Escape') {
        onExitRef.current();
        return;
      }
      if (!advance) return;
      if (phase === 'idle') {
        onStartRef.current();
      } else if (phase === 'frozen') {
        onExitRef.current();
      } else if (phase === 'rolling' && !animating && resultRef.current) {
        // 提前结束滚动（"停止"）：已出结果则立即定格
        if (endTimerRef.current !== undefined) window.clearTimeout(endTimerRef.current);
        endTimerRef.current = undefined;
        finalize();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, phase, animating, finalize]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const topics = useMemo(() => result?.topics ?? [], [result]);
  const frozenFirst = phase === 'frozen' && topics.length > 0;

  if (!open) return null;

  return (
    <div className="draw-ceremony-overlay">
      {/* 背景装饰光晕 */}
      <div className="draw-ceremony-glow" />

      {/* 顶部：赛事/场次 + 关闭 */}
      <div className="draw-ceremony-header">
        <Space size={16} style={{ fontSize: 'clamp(14px, 1.6vw, 22px)', color: 'rgba(255,255,255,0.85)' }}>
          <span>{eventName || '辩题抽取'}</span>
          {roundName ? <span>· {roundName}</span> : null}
        </Space>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onExit}
          style={{ color: '#fff', fontSize: 'clamp(13px, 1.4vw, 18px)' }}
        >
          退出
        </Button>
      </div>

      {/* ===== idle：等待开始 ===== */}
      {phase === 'idle' && (
        <div className="draw-ceremony-center">
          <Typography.Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'clamp(18px, 2.2vw, 30px)' }}>
            准备好后，按
            <kbd style={kbdStyle}> 空格 </kbd> / <kbd style={kbdStyle}>PgDn</kbd> 开始抽取
          </Typography.Text>
          <Button
            type="primary"
            size="large"
            onClick={onStart}
            style={{ marginTop: 24, height: 48, borderRadius: radius.lg }}
          >
            开始抽取
          </Button>
        </div>
      )}

      {/* ===== rolling：候选快速闪动 ===== */}
      {phase === 'rolling' && (
        <div className="draw-ceremony-center">
          <div
            className="bigscreen-topic-title ceremony-rolling-title"
            style={{ fontSize: RESULT_FONT_SIZE, maxWidth: '86vw', wordBreak: 'break-word' }}
          >
            {flash}
          </div>
          <Typography.Text
            style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(16px, 1.8vw, 24px)', letterSpacing: 2 }}
          >
            正在抽取辩题…
          </Typography.Text>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 'clamp(12px, 1.2vw, 16px)', marginTop: 24 }}>
            按 <kbd style={kbdStyle}>空格</kbd> / <kbd style={kbdStyle}>PgDn</kbd> 立即定格
          </Typography.Text>
        </div>
      )}

      {/* ===== frozen：定格展示抽取结果 ===== */}
      {frozenFirst && (
        <div className="draw-ceremony-center">
          <Space size={12} style={{ marginBottom: 'clamp(12px, 2vh, 24px)' }}>
            <span className="draw-ceremony-badge">抽 取 结 果</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(13px,1.4vw,18px)' }}>
              共 {topics.length} 道
            </span>
          </Space>

          {/* 第一题：轻渐显揭晓，与其余同字号（去翻转，纯 fade 块无 height 干扰，保证居中与间距） */}
          <div
            key={`reveal-${topics[0].id}`}
            className={motionClass.fadeIn}
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              color: 'rgba(255,255,255,0.82)',
              fontSize: RESULT_FONT_SIZE,
              wordBreak: 'break-word',
              marginBottom: 'clamp(6px, 1.2vh, 14px)'
            }}
          >
            <div style={{ maxWidth: '86vw', textAlign: 'center', wordBreak: 'break-word' }}>
              {topics[0].title}
            </div>
          </div>

          {/* 其余题列表（同字号） */}
          {topics.length > 1 && (
            <div className="draw-ceremony-rest">
              {topics.slice(1).map((t) => (
                <span key={t.id} className="draw-ceremony-rest-item" style={{ fontSize: RESULT_FONT_SIZE }}>
                  {t.title}
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'clamp(16px, 3vh, 32px)' }}>
            <Typography.Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 'clamp(13px, 1.4vw, 18px)' }}>
              按 <kbd style={kbdStyle}>空格</kbd> / <kbd style={kbdStyle}>PgDn</kbd> 返回 · <kbd style={kbdStyle}>Esc</kbd> 退出
            </Typography.Text>
          </div>
        </div>
      )}

      {/* frozen 但无结果（边缘态）保持暗场 */}
    </div>
  );
}