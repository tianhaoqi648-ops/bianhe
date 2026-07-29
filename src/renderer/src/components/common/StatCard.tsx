// ============================================================
// StatCard.tsx — 统计卡片组件
//
// 展示统计数值 + 迷你 SVG sparkline，支持强调色、图标、delta 变化描述。
// 用于仪表盘、概览页等需要紧凑展示数值趋势的场景。
// ============================================================

import { Card } from 'antd';
import React, { useState } from 'react';
import { shadow, colorPrimary, colorGold, colorPurple, fontSize, radius } from '../../styles/tokens';

// 强调色映射：primary / gold / purple → 具体色值
const COLOR_MAP: Record<NonNullable<StatCardProps['color']>, string> = {
  primary: colorPrimary,
  gold: colorGold,
  purple: colorPurple
};

// delta 类型颜色映射：up=绿、down=红、flat=灰
const DELTA_COLOR: Record<NonNullable<StatCardProps['deltaType']>, string> = {
  up: '#52c41a',
  down: '#ff4d4f',
  flat: '#8c8c8c'
};

export interface StatCardProps {
  /** 数值 */
  value: number | string;
  /** 标签 */
  label: string;
  /** 数值后缀（如「道」「场」） */
  unit?: string;
  /** sparkline 数据点（数字数组，可空） */
  trend?: number[];
  /** sparkline 数据点（增强版：带渐变填充、最新点高亮、tooltip） */
  sparklineData?: number[];
  /** 强调色 */
  color?: 'primary' | 'gold' | 'purple';
  /** 图标 */
  icon?: React.ReactNode;
  /** 数值变化描述（如「较上周 +12%」） */
  delta?: string;
  /** delta 类型（控制颜色） */
  deltaType?: 'up' | 'down' | 'flat';
  style?: React.CSSProperties;
}

/**
 * Sparkline — 纯 SVG 迷你折线图
 *
 * 数据点少于 2 个时不渲染。颜色随强调色变化。
 * 宽 80px 高 24px，可直接嵌入卡片角落。
 */
export function Sparkline({
  data,
  color,
  width = 80,
  height = 24
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * SparklineArea — 增强版 sparkline（带渐变填充、最新点高亮、tooltip）
 *
 * - 24px 高，viewBox 0 0 100 24，宽度撑满父容器
 * - 归一化数据到 0-1（处理 min === max 边界）
 * - 渐变填充（from 主色 to 透明），用 SVG <linearGradient>
 * - 最新数据点高亮（半径 2px 圆点），hover 显示数值 tooltip
 *
 * gradient id 通过 React.useId() 保证唯一，避免多卡片同页面 id 冲突。
 */
function SparklineArea({ data, color }: { data: number[]; color: string }) {
  const rawId = React.useId();
  // React.useId() 返回值可能含冒号（如 ":r0:"），在 SVG url() 引用中不安全，替换掉
  const gradientId = `sparkline-grad-${rawId.replace(/[^a-zA-Z0-9-_]/g, '')}`;

  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1; // 处理 min === max 边界
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 20 - ((v - min) / range) * 18; // viewBox 高 24，留顶部 2px / 底部 4px 边距
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L 100,24 L 0,24 Z`;
  const lastPoint = points[points.length - 1].split(',');
  const lastValue = data[data.length - 1];

  return (
    <svg
      width="100%"
      height={24}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r={2} fill={color}>
        <title>{`最新: ${lastValue}`}</title>
      </circle>
    </svg>
  );
}

/**
 * StatCard — 统计卡片
 *
 * 上方：标签 + 图标
 * 下方：数值 + 单位 + delta（变化描述）
 * 可选底部 sparkline 趋势线。
 *
 * hover 时抬升 2px 并切换为 cardHover 阴影。
 */
export default function StatCard({
  value,
  label,
  unit,
  trend,
  sparklineData,
  color = 'primary',
  icon,
  delta,
  deltaType = 'flat',
  style
}: StatCardProps) {
  const [hovered, setHovered] = useState(false);
  const accentColor = COLOR_MAP[color] || colorPrimary;
  const deltaColor = DELTA_COLOR[deltaType] || DELTA_COLOR.flat;

  return (
    <Card
      size="small"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      styles={{ body: { padding: '12px 16px' } }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radius.lg,
        boxShadow: hovered ? shadow.cardHover : shadow.cardRest,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all 0.2s ease',
        ...style
      }}
    >
      {/* 左侧 3px 色条：按强调色着色 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accentColor
        }}
      />

      {/* 上方：标签 + 图标 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          color: '#8c8c8c',
          fontSize: fontSize.body
        }}
      >
        <span>{label}</span>
        {icon && (
          <span style={{ color: accentColor, fontSize: fontSize.h4, display: 'flex', alignItems: 'center' }}>
            {icon}
          </span>
        )}
      </div>

      {/* 下方：数值 + 单位 + delta */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: fontSize.h2, fontWeight: 700, color: '#262626', lineHeight: 1.2 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: fontSize.body, color: '#8c8c8c' }}>{unit}</span>}
        {delta && (
          <span style={{ fontSize: fontSize.caption, color: deltaColor, marginLeft: 4 }}>{delta}</span>
        )}
      </div>

      {/* sparkline 趋势线 */}
      {trend && trend.length >= 2 && (
        <div style={{ marginTop: 8 }}>
          <Sparkline data={trend} color={accentColor} />
        </div>
      )}

      {/* 增强版 sparkline（带渐变填充、最新点高亮、tooltip） */}
      {sparklineData && sparklineData.length >= 2 && (
        <div style={{ marginTop: 8 }}>
          <SparklineArea data={sparklineData} color={accentColor} />
        </div>
      )}
    </Card>
  );
}
