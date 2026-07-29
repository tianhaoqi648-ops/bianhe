// ============================================================
// DrawResultStyleSwitcher.tsx — 抽取结果展示风格切换器
//
// SubTask 7.1：Segmented 风格切换器
// - 3 个选项：对阵表 / 辩题网格 / 紧凑表格
// - 读写 localStorage（key: bianhe-draw-result-style，默认 matchup-table）
// ============================================================

import { useEffect, useState } from 'react';
import { Segmented } from 'antd';
import { TableOutlined, AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';

/** 抽取结果展示风格 */
export type DrawResultStyle = 'matchup-table' | 'topic-grid' | 'compact-table';

/** localStorage key */
export const DRAW_RESULT_STYLE_KEY = 'bianhe-draw-result-style';

/** 默认风格 */
export const DEFAULT_DRAW_RESULT_STYLE: DrawResultStyle = 'matchup-table';

/** 风格选项标签 */
export const STYLE_LABELS: Record<DrawResultStyle, string> = {
  'matchup-table': '对阵表',
  'topic-grid': '辩题网格',
  'compact-table': '紧凑表格'
};

/** 从 localStorage 读取风格，失败回退默认 */
export function loadDrawResultStyle(): DrawResultStyle {
  try {
    const raw = localStorage.getItem(DRAW_RESULT_STYLE_KEY);
    if (raw === 'matchup-table' || raw === 'topic-grid' || raw === 'compact-table') {
      return raw;
    }
  } catch {
    // localStorage 不可用，回退默认
  }
  return DEFAULT_DRAW_RESULT_STYLE;
}

/** 写入风格到 localStorage */
export function saveDrawResultStyle(style: DrawResultStyle): void {
  try {
    localStorage.setItem(DRAW_RESULT_STYLE_KEY, style);
  } catch {
    // 忽略写入失败
  }
}

export interface DrawResultStyleSwitcherProps {
  /** 当前风格（受控模式，若提供则使用受控值） */
  value?: DrawResultStyle;
  /** 风格切换回调 */
  onChange?: (style: DrawResultStyle) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export default function DrawResultStyleSwitcher({
  value,
  onChange,
  disabled
}: DrawResultStyleSwitcherProps) {
  // 内部状态：非受控模式时从 localStorage 初始化
  const [internalStyle, setInternalStyle] = useState<DrawResultStyle>(() =>
    loadDrawResultStyle()
  );

  // 受控模式同步外部 value
  useEffect(() => {
    if (value !== undefined) {
      setInternalStyle(value);
    }
  }, [value]);

  const current = value !== undefined ? value : internalStyle;

  const handleChange = (next: DrawResultStyle) => {
    if (value === undefined) {
      setInternalStyle(next);
      saveDrawResultStyle(next);
    }
    onChange?.(next);
  };

  return (
    <Segmented<DrawResultStyle>
      value={current}
      onChange={handleChange}
      disabled={disabled}
      size="middle"
      options={[
        {
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <TableOutlined />
              {STYLE_LABELS['matchup-table']}
            </span>
          ),
          value: 'matchup-table'
        },
        {
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AppstoreOutlined />
              {STYLE_LABELS['topic-grid']}
            </span>
          ),
          value: 'topic-grid'
        },
        {
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UnorderedListOutlined />
              {STYLE_LABELS['compact-table']}
            </span>
          ),
          value: 'compact-table'
        }
      ]}
    />
  );
}
