import { Typography, Progress } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { gradient, shadow } from '../../styles/tokens';

export interface DrawAnimationProps {
  open: boolean;
}

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

export default function DrawAnimation({ open }: DrawAnimationProps) {
  if (!open) return null;
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

      {/* 同心圆波纹 */}
      <div style={{ position: 'relative', width: 200, height: 200, marginBottom: 24 }}>
        <span className="ripple-ring" style={{ width: 200, height: 200, animationDelay: '0s' }} />
        <span className="ripple-ring" style={{ width: 200, height: 200, animationDelay: '0.4s' }} />
        <span className="ripple-ring" style={{ width: 200, height: 200, animationDelay: '0.8s' }} />

        {/* 中心闪电 */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: gradient.brand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: shadow.primaryHover
          }}
        >
          <ThunderboltOutlined className="draw-spin" style={{ fontSize: 56, color: '#fff' }} />
        </div>
      </div>

      <Typography.Title level={2} style={{ color: '#fff', marginBottom: 8 }}>
        <span className="ellipsis">正在抽取辩题</span>
      </Typography.Title>
      <Typography.Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: 24 }}>
        正在从题库中随机选取辩题
      </Typography.Text>

      {/* 假进度条 */}
      <div style={{ width: 360, maxWidth: '80vw' }}>
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
