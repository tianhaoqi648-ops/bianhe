import { useEffect, useRef, useState } from 'react';
import { Typography, Progress } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { DrawResult, Team } from '../../../../shared/types';
import { gradient, shadow, colorGold } from '../../styles/tokens';
import { duration, easing } from '../../styles/motion';
import { kbdStyle } from '../../styles/shared';
import RevealAnimation, { type RevealMode } from './RevealAnimation';

export interface DrawAnimationProps {
  open: boolean;
  /** 'small' = 小屏短动画；'bigscreen' = 大屏三幕动画 */
  mode?: 'small' | 'bigscreen';
  /** bigscreen 模式：抽取结果（第二幕揭晓第一题用） */
  result?: DrawResult | null;
  /** bigscreen 模式：队伍列表（用于第一题队伍配对展示） */
  teams?: Team[];
  /** bigscreen 模式：execute 仍在进行中（true 时第二幕尚未触发） */
  animating?: boolean;
  /** bigscreen 模式：进入第二幕时回调（BigScreen 据此 setRevealedCount(1)） */
  onRevealFirst?: () => void;
  /** bigscreen 模式：第三幕按 →/Space 继续时回调（BigScreen 据此关闭遮罩） */
  onAdvance?: () => void;
  /** P3.1 Task 1：揭晓动画模式，默认 'fade' 保持向后兼容 */
  revealMode?: RevealMode;
}

/** 大屏三幕状态机阶段 */
type BigPhase = 'gathering' | 'revealing' | 'waiting';

/** 漂浮粒子背景 */
function ParticleField() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: 4 + Math.random() * 8,
    delay: `${Math.random() * 4}s`,
    duration: `${3 + Math.random() * 3}s`
  }));

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {particles.map((p) => (
        <span
          key={p.id}
          className="float-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration
          }}
        />
      ))}
    </div>
  );
}

/** 大屏第一幕：粒子向中心收拢 + 金色环形进度条 0→100% */
function GatheringAct({ progress }: { progress: number }) {
  // 12 颗粒子按角度均匀分布，由父容器 rotate 控制方向，translateX 控制半径
  const converge = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    angle: (i / 12) * Math.PI * 2,
    delay: `${(i % 6) * 60}ms`
  }));

  return (
    <div
      style={{
        position: 'relative',
        width: 320,
        height: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {/* 收拢粒子 */}
      {converge.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `rotate(${p.angle}rad)`
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: -4,
              left: -4,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ffd666',
              boxShadow: '0 0 8px rgba(255,214,102,0.8)',
              animation: `converge-particle ${duration.slow + duration.normal}ms ${easing.spring} forwards`,
              animationDelay: p.delay
            }}
          />
        </div>
      ))}

      {/* 金色环形进度条 */}
      <Progress
        type="circle"
        percent={Math.round(progress)}
        size={200}
        strokeColor={colorGold}
        trailColor="rgba(255,255,255,0.12)"
        strokeWidth={8}
        showInfo={false}
      />

      {/* 中心闪电 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: gradient.brand,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: shadow.primaryHover
        }}
      >
        <ThunderboltOutlined className="draw-spin" style={{ fontSize: 44, color: '#fff' }} />
      </div>
    </div>
  );
}

/** 大屏第二/三幕：环形炸开 + 第一题卡片揭晓 + 队伍配对展示 */
function RevealAct({
  title,
  teamA,
  teamB,
  stanceA,
  stanceB,
  showHint,
  revealMode
}: {
  title: string;
  teamA: Team | null;
  teamB: Team | null;
  stanceA: string | null;
  stanceB: string | null;
  showHint: boolean;
  revealMode: RevealMode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        width: '100%',
        maxWidth: '90vw',
        textAlign: 'center'
      }}
    >
      {/* 炸开光环 */}
      <span
        style={{
          position: 'absolute',
          top: '0%',
          left: '50%',
          width: 220,
          height: 220,
          borderRadius: '50%',
          border: `4px solid ${colorGold}`,
          boxShadow: '0 0 40px rgba(255,214,102,0.7)',
          animation: `burst-ring ${duration.normal + duration.fast}ms ${easing.easeOut} forwards`,
          pointerEvents: 'none'
        }}
      />

      {/* 第一题卡片：委托 RevealAnimation 揭晓（P3.1 Task 1） */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '80vw', minHeight: 120 }}>
        <Typography.Text
          style={{
            color: colorGold,
            fontSize: 'clamp(14px,1.5vw,20px)',
            letterSpacing: 2,
            display: 'block',
            marginBottom: 8
          }}
        >
          第一题
        </Typography.Text>
        <RevealAnimation mode={revealMode}>
          <div
            className="bigscreen-topic-title"
            style={{ fontSize: 'clamp(28px,4vw,56px)', maxWidth: '80vw', margin: 0 }}
          >
            {title}
          </div>
        </RevealAnimation>
      </div>

      {/* 队伍配对 */}
      {teamA && teamB && (
        <div className="bigscreen-versus" style={{ position: 'relative', zIndex: 1 }}>
          <div className="bigscreen-team slide-in-left">
            <div className="bigscreen-stance">{stanceA ?? '正方'}</div>
            <div>{teamA.name}</div>
          </div>
          <div className="bigscreen-vs vs-glow">VS</div>
          <div className="bigscreen-team slide-in-right">
            <div className="bigscreen-stance">{stanceB ?? '反方'}</div>
            <div>{teamB.name}</div>
          </div>
        </div>
      )}

      {/* 第三幕：等待手动继续提示 */}
      {showHint && (
        <div className="fade-in-up" style={{ position: 'relative', zIndex: 1, marginTop: 8 }}>
          <Typography.Text
            style={{ color: 'rgba(255,255,255,0.85)', fontSize: 'clamp(16px,1.8vw,22px)' }}
          >
            按 <kbd style={kbdStyle}>→</kbd> / <kbd style={kbdStyle}>Space</kbd> 继续揭晓
          </Typography.Text>
        </div>
      )}
    </div>
  );
}

export default function DrawAnimation({
  open,
  mode = 'small',
  result,
  teams,
  animating,
  onRevealFirst,
  onAdvance,
  revealMode = 'fade'
}: DrawAnimationProps) {
  // ===== bigscreen 三幕状态机 =====
  const [phase, setPhase] = useState<BigPhase>('gathering');
  const [progress, setProgress] = useState(0);
  const [gathered, setGathered] = useState(false);
  const revealedFiredRef = useRef(false);
  const onRevealFirstRef = useRef(onRevealFirst);
  const onAdvanceRef = useRef(onAdvance);
  onRevealFirstRef.current = onRevealFirst;
  onAdvanceRef.current = onAdvance;

  // 第一幕：进度条 0→100% + 700ms 计时
  useEffect(() => {
    if (!open || mode !== 'bigscreen') return;
    setPhase('gathering');
    setProgress(0);
    setGathered(false);
    revealedFiredRef.current = false;
    const GATHER_MS = 700;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / GATHER_MS);
      setProgress(p * 100);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setGathered(true);
        setProgress(100);
        // 转换到 revealing 由下方 effect 根据 result/animating 接管
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, mode]);

  // 第一幕完成 && execute 完成 && result 可用 → 进入第二幕 revealing
  useEffect(() => {
    if (!open || mode !== 'bigscreen') return;
    if (phase !== 'gathering') return;
    if (!gathered) return;
    // execute 仍在进行中：等待新鲜结果，避免使用上一次的旧结果
    if (animating) return;
    if (!result || !result.topics?.length) return;
    setPhase('revealing');
  }, [open, mode, phase, gathered, animating, result]);

  // 第二幕：触发 onRevealFirst + 500ms 后进入第三幕 waiting
  useEffect(() => {
    if (!open || mode !== 'bigscreen') return;
    if (phase !== 'revealing') return;
    if (!revealedFiredRef.current) {
      revealedFiredRef.current = true;
      onRevealFirstRef.current?.();
    }
    const t = setTimeout(() => setPhase('waiting'), 500);
    return () => clearTimeout(t);
  }, [open, mode, phase]);

  // 第三幕：监听 → / Space 继续（capture 阶段，确保动画期间优先于禁用的 hotkey）
  useEffect(() => {
    if (!open || mode !== 'bigscreen') return;
    if (phase !== 'waiting') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        onAdvanceRef.current?.();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, mode, phase]);

  if (!open) return null;

  // ===== bigscreen 模式：三幕动画 =====
  if (mode === 'bigscreen') {
    const firstTopic = result?.topics?.[0] ?? null;
    const firstItem = firstTopic
      ? result?.session?.items?.find((it) => it.topic_id === firstTopic.id) ?? null
      : null;
    const teamA = firstItem ? teams?.find((t) => t.id === firstItem.team_a_id) ?? null : null;
    const teamB = firstItem ? teams?.find((t) => t.id === firstItem.team_b_id) ?? null : null;

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10000,
          background: gradient.bigscreen,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff'
        }}
      >
        <ParticleField />

        {phase === 'gathering' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 24,
              position: 'relative',
              zIndex: 1
            }}
          >
            <GatheringAct progress={progress} />
            <Typography.Text
              style={{ color: 'rgba(255,255,255,0.7)', fontSize: 'clamp(16px,1.8vw,22px)' }}
            >
              正在抽取辩题
            </Typography.Text>
          </div>
        )}

        {(phase === 'revealing' || phase === 'waiting') && firstTopic && (
          <RevealAct
            title={firstTopic.title}
            teamA={teamA}
            teamB={teamB}
            stanceA={firstItem?.stance_a ?? null}
            stanceB={firstItem?.stance_b ?? null}
            showHint={phase === 'waiting'}
            revealMode={revealMode}
          />
        )}
      </div>
    );
  }

  // ===== small 模式（默认）：保留粒子 + 同心圆 + 闪电 + 进度条 =====
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: gradient.drawOverlay,
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff'
      }}
    >
      <ParticleField />

      {/* 同心圆波纹（尺寸扩大 1.5 倍：原 200x200 → 300x300） */}
      <div style={{ position: 'relative', width: 300, height: 300, marginBottom: 24 }}>
        <span className="ripple-ring" style={{ width: 300, height: 300, animationDelay: '0s' }} />
        <span className="ripple-ring" style={{ width: 300, height: 300, animationDelay: '0.4s' }} />
        <span className="ripple-ring" style={{ width: 300, height: 300, animationDelay: '0.8s' }} />

        {/* 中心闪电（尺寸扩大 1.5 倍：原 120x120 → 180x180） */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: gradient.brand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: shadow.primaryHover
          }}
        >
          <ThunderboltOutlined className="draw-spin" style={{ fontSize: 84, color: '#fff' }} />
        </div>
      </div>

      <Typography.Title level={2} style={{ color: '#fff', marginBottom: 8 }}>
        <span className="ellipsis">正在抽取辩题</span>
      </Typography.Title>
      <Typography.Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: 24 }}>
        正在从题库中随机选取辩题
      </Typography.Text>

      {/* 假进度条（宽度扩大 1.5 倍：原 360 → 540） */}
      <div style={{ width: 540, maxWidth: '80vw' }}>
        <Progress
          percent={75}
          status="active"
          strokeColor={{ from: '#1677ff', to: '#722ed1' }}
          trailColor="rgba(255, 255, 255, 0.1)"
          showInfo={false}
        />
      </div>
    </div>
  );
}
