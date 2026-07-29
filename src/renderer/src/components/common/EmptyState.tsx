import type { CSSProperties, ReactNode } from 'react';
import { Button, Space } from 'antd';
import { spacing, fontSize } from '../../styles/tokens';

/** CTA 按钮配置 */
export interface EmptyStateCta {
  /** 按钮文字 */
  text: string;
  /** 可选图标 */
  icon?: ReactNode;
  /** 点击回调 */
  onClick: () => void;
  /** 按钮类型，默认 'primary' */
  type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
}

/**
 * EmptyState 组件 Props
 */
export interface EmptyStateProps {
  /** 类型，决定使用哪种插画 */
  type?: 'topic' | 'timer' | 'bell' | 'default';
  /** 描述文字 */
  description?: string;
  /** 自定义图标 */
  image?: ReactNode;
  /** 尺寸 */
  size?: 'small' | 'default' | 'large';
  style?: CSSProperties;
  /** CTA 按钮组（渲染在描述文字下方、children 之前）。未传时不渲染 */
  cta?: EmptyStateCta[];
  /** 自定义底部内容（如操作按钮），渲染在 CTA 下方 */
  children?: ReactNode;
}

// 尺寸映射：SVG 尺寸 + 文字字号
const SIZE_MAP = {
  small: { svg: 80, fontSize: fontSize.caption },
  default: { svg: 120, fontSize: fontSize.body },
  large: { svg: 160, fontSize: fontSize.h4 }
} as const;

// 插画主色（淡灰）
const STROKE_COLOR = '#d9d9d9';
// 插画填充淡色
const FILL_COLOR = '#f5f5f5';
// 描述文字颜色
const TEXT_COLOR = '#999';

/**
 * 辩题卡插画：一张卡片 + 文字线条
 */
function TopicIllustration({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <rect
        x="20"
        y="30"
        width="80"
        height="60"
        rx="6"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill={FILL_COLOR}
      />
      <line x1="30" y1="45" x2="80" y2="45" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="55" x2="70" y2="55" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="65" x2="75" y2="65" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="75" x2="60" y2="75" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 计时器插画：钟表 + 指针
 */
function TimerIllustration({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* 表盘 */}
      <circle cx="60" cy="60" r="36" stroke={STROKE_COLOR} strokeWidth="2" fill={FILL_COLOR} />
      {/* 顶部挂钮 */}
      <rect x="56" y="18" width="8" height="8" rx="2" stroke={STROKE_COLOR} strokeWidth="2" fill={FILL_COLOR} />
      {/* 12 点刻度 */}
      <line x1="60" y1="28" x2="60" y2="34" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 3 点刻度 */}
      <line x1="92" y1="60" x2="86" y2="60" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 6 点刻度 */}
      <line x1="60" y1="92" x2="60" y2="86" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 9 点刻度 */}
      <line x1="28" y1="60" x2="34" y2="60" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 时针 */}
      <line x1="60" y1="60" x2="60" y2="42" stroke={STROKE_COLOR} strokeWidth="2.5" strokeLinecap="round" />
      {/* 分针 */}
      <line x1="60" y1="60" x2="78" y2="60" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 中心点 */}
      <circle cx="60" cy="60" r="2.5" fill={STROKE_COLOR} />
    </svg>
  );
}

/**
 * 铃铛插画：一个铃 + 摆锤
 */
function BellIllustration({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* 顶部挂环 */}
      <path
        d="M56 22 a4 4 0 0 1 8 0"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill="none"
      />
      {/* 铃铛主体（钟形） */}
      <path
        d="M44 38 Q44 70 36 84 L84 84 Q76 70 76 38 Z"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill={FILL_COLOR}
        strokeLinejoin="round"
      />
      {/* 铃口横线 */}
      <line x1="34" y1="84" x2="86" y2="84" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
      {/* 摆锤 */}
      <circle cx="60" cy="94" r="5" stroke={STROKE_COLOR} strokeWidth="2" fill={FILL_COLOR} />
      {/* 摆锤连接线 */}
      <line x1="60" y1="84" x2="60" y2="89" stroke={STROKE_COLOR} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 通用空盒插画
 */
function DefaultIllustration({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* 盒子主体（等距投影） */}
      {/* 顶面 */}
      <path
        d="M24 38 L60 22 L96 38 L60 54 Z"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill={FILL_COLOR}
        strokeLinejoin="round"
      />
      {/* 左侧面 */}
      <path
        d="M24 38 L24 82 L60 98 L60 54 Z"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill={FILL_COLOR}
        strokeLinejoin="round"
      />
      {/* 右侧面 */}
      <path
        d="M96 38 L96 82 L60 98 L60 54 Z"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* 顶面装饰线（虚线表示打开） */}
      <line
        x1="40"
        y1="31"
        x2="76"
        y2="47"
        stroke={STROKE_COLOR}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 3"
      />
    </svg>
  );
}

/**
 * 根据类型返回对应插画
 */
function renderIllustration(type: EmptyStateProps['type'], size: number) {
  switch (type) {
    case 'topic':
      return <TopicIllustration size={size} />;
    case 'timer':
      return <TimerIllustration size={size} />;
    case 'bell':
      return <BellIllustration size={size} />;
    case 'default':
    default:
      return <DefaultIllustration size={size} />;
  }
}

/**
 * EmptyState 空状态组件
 *
 * 用于替代 antd Empty，提供辩论主题相关的简笔画插画。
 * 支持 4 种类型（辩题卡 / 计时器 / 铃铛 / 通用空盒）和 3 种尺寸。
 */
export default function EmptyState({
  type = 'default',
  description,
  image,
  size = 'default',
  style,
  cta,
  children
}: EmptyStateProps) {
  const { svg: svgSize, fontSize } = SIZE_MAP[size];

  // 容器样式：flex 居中，padding 32
  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
    ...style
  };

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: 12 }}>
        {image ?? renderIllustration(type, svgSize)}
      </div>
      {description && (
        <span style={{ fontSize, color: TEXT_COLOR, textAlign: 'center' }}>
          {description}
        </span>
      )}
      {cta && cta.length > 0 && (
        <Space style={{ marginTop: 12 }} wrap>
          {cta.map((item, idx) => (
            <Button
              key={idx}
              type={item.type ?? (idx === 0 ? 'primary' : 'default')}
              icon={item.icon}
              onClick={item.onClick}
            >
              {item.text}
            </Button>
          ))}
        </Space>
      )}
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
