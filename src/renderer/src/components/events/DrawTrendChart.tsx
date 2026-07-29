// ============================================================
// DrawTrendChart.tsx — 抽取走势折线图
//
// 纯 SVG 折线图：按 draw_time 的日期分组统计每日抽取次数。
// X 轴 = 日期，Y 轴 = 抽取次数。
//
// 特性：
// 1. ResizeObserver 监听容器宽度自适应（高度固定 200px）
// 2. 横向网格线 + 坐标轴标签
// 3. 数据点 hover 显示 tooltip（绝对定位 div）
// 4. 日期唯一值 < 2 时显示「数据不足」占位
//
// 实现说明：项目未引入 d3，沿用 DonutChart / Sparkline 的纯 SVG 模式。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import type { DrawSessionDetail } from '../../../../shared/types';
import { spacing, fontSize, gray } from '../../styles/tokens';

const { Text } = Typography;

export interface DrawTrendChartProps {
  sessions: DrawSessionDetail[];
}

/** 图表高度（固定） */
const CHART_HEIGHT = 200;
/** 图表内边距 */
const PADDING = { top: 16, right: 16, bottom: 32, left: 36 };
/** 折线颜色 */
const LINE_COLOR = '#1677ff';
/** 网格线颜色 */
const GRID_COLOR = '#f0f0f0';
/** 轴线颜色 */
const AXIS_COLOR = '#d9d9d9';
/** 轴标签颜色 */
const AXIS_LABEL_COLOR = '#8c8c8c';
/** 数据点半径 */
const POINT_RADIUS = 3.5;
/** hover 命中半径 */
const HIT_RADIUS = 8;

interface TrendPoint {
  date: dayjs.Dayjs;
  dateKey: string;
  count: number;
}

/**
 * DrawTrendChart — 抽取走势折线图
 *
 * 用法：
 * ```tsx
 * <DrawTrendChart sessions={sessions} />
 * ```
 *
 * 数据不足（sessions 为空或日期唯一值 < 2）时显示占位文案。
 */
export default function DrawTrendChart({ sessions }: DrawTrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(640);
  const [hovered, setHovered] = useState<{
    point: TrendPoint;
    x: number;
    y: number;
  } | null>(null);

  // 监听容器宽度变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(Math.floor(w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 按日期分组统计每日抽取次数
  const points = useMemo<TrendPoint[]>(() => {
    const map = new Map<string, { date: dayjs.Dayjs; count: number }>();
    sessions.forEach((s) => {
      if (!s.draw_time) return;
      const d = dayjs(s.draw_time);
      const key = d.format('YYYY-MM-DD');
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { date: d.startOf('day'), count: 1 });
      }
    });
    const arr = Array.from(map.entries()).map(([dateKey, v]) => ({
      date: v.date,
      dateKey,
      count: v.count
    }));
    // 按日期升序
    arr.sort((a, b) => a.date.valueOf() - b.date.valueOf());
    return arr;
  }, [sessions]);

  // 计算坐标映射
  const plot = useMemo(() => {
    if (points.length < 2) return null;
    const innerW = Math.max(width - PADDING.left - PADDING.right, 10);
    const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

    const minT = points[0].date.valueOf();
    const maxT = points[points.length - 1].date.valueOf();
    const tRange = Math.max(maxT - minT, 1);

    const maxCount = Math.max(...points.map((p) => p.count), 1);
    // Y 轴上限取 maxCount 向上取整到合适刻度
    const yMax = Math.max(maxCount, 1);

    const xOf = (t: number) =>
      PADDING.left + ((t - minT) / tRange) * innerW;
    const yOf = (c: number) =>
      PADDING.top + innerH - (c / yMax) * innerH;

    const linePath = points
      .map((p, i) => {
        const x = xOf(p.date.valueOf());
        const y = yOf(p.count);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    // Y 轴刻度（4 段）
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = Math.round((yMax * i) / 4);
      return { value, y: yOf(value) };
    });

    // X 轴刻度：最多 6 个标签，均匀采样
    const xTickCount = Math.min(points.length, 6);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const idx = Math.floor((i * (points.length - 1)) / Math.max(xTickCount - 1, 1));
      const p = points[idx];
      return { label: p.date.format('MM-DD'), x: xOf(p.date.valueOf()) };
    });

    return {
      innerW,
      innerH,
      xOf,
      yOf,
      linePath,
      yTicks,
      xTicks,
      yMax
    };
  }, [points, width]);

  // 空数据 / 日期唯一值 < 2 时显示占位
  if (points.length < 2) {
    return (
      <div ref={containerRef} style={{ width: '100%', minHeight: CHART_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text type="secondary" style={{ fontSize: fontSize.body }}>
          数据不足，无法绘制走势
        </Text>
      </div>
    );
  }

  if (!plot) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: CHART_HEIGHT }}
    >
      <svg
        width={width}
        height={CHART_HEIGHT}
        style={{ display: 'block' }}
        role="img"
        aria-label="抽取走势折线图"
      >
        {/* 横向网格线 + Y 轴刻度标签 */}
        {plot.yTicks.map((t, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PADDING.left}
              y1={t.y}
              x2={width - PADDING.right}
              y2={t.y}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={t.y}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={fontSize.caption}
              fill={AXIS_LABEL_COLOR}
            >
              {t.value}
            </text>
          </g>
        ))}

        {/* X 轴刻度标签 */}
        {plot.xTicks.map((t, i) => (
          <text
            key={`x-${i}`}
            x={t.x}
            y={CHART_HEIGHT - PADDING.bottom + 16}
            textAnchor="middle"
            fontSize={fontSize.caption}
            fill={AXIS_LABEL_COLOR}
          >
            {t.label}
          </text>
        ))}

        {/* X 轴 / Y 轴主线 */}
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={CHART_HEIGHT - PADDING.bottom}
          stroke={AXIS_COLOR}
          strokeWidth={1}
        />
        <line
          x1={PADDING.left}
          y1={CHART_HEIGHT - PADDING.bottom}
          x2={width - PADDING.right}
          y2={CHART_HEIGHT - PADDING.bottom}
          stroke={AXIS_COLOR}
          strokeWidth={1}
        />

        {/* 折线 */}
        <path
          d={plot.linePath}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 折线下方的浅色填充（面积感） */}
        <path
          d={`${plot.linePath} L${plot.xOf(points[points.length - 1].date.valueOf()).toFixed(2)},${(CHART_HEIGHT - PADDING.bottom).toFixed(2)} L${plot.xOf(points[0].date.valueOf()).toFixed(2)},${(CHART_HEIGHT - PADDING.bottom).toFixed(2)} Z`}
          fill={LINE_COLOR}
          opacity={0.08}
        />

        {/* 数据点 + 不可见的命中区域 */}
        {points.map((p, i) => {
          const cx = plot.xOf(p.date.valueOf());
          const cy = plot.yOf(p.count);
          return (
            <g key={`pt-${i}`}>
              <circle
                cx={cx}
                cy={cy}
                r={POINT_RADIUS}
                fill="#fff"
                stroke={LINE_COLOR}
                strokeWidth={2}
              />
              <circle
                cx={cx}
                cy={cy}
                r={HIT_RADIUS}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered({ point: p, x: cx, y: cy })}
                onMouseLeave={() => setHovered(null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip：绝对定位 */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hovered.x + 8, width - 140),
            top: Math.max(hovered.y - 48, 4),
            background: gray[900],
            color: '#fff',
            padding: `${spacing.xs} ${spacing.sm}`,
            borderRadius: 4,
            fontSize: fontSize.caption,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10
          }}
        >
          <div>{hovered.point.date.format('YYYY-MM-DD')}</div>
          <div>抽取 {hovered.point.count} 次</div>
        </div>
      )}
    </div>
  );
}
