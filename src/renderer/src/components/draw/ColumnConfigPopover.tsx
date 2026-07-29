// ============================================================
// ColumnConfigPopover.tsx — 紧凑表格列配置 Popover
//
// SubTask 7.7：列配置弹层
// - Checkbox.Group 列表（10 列可勾选）
// - 默认全显
// - 配置读写 localStorage（key: bianhe-draw-result-columns）
// ============================================================

import { Checkbox, Popover, Button, Space, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { spacing } from '../../styles/tokens';

/** 列 key 联合类型 */
export type ColumnKey =
  | 'idx'
  | 'topic'
  | 'type'
  | 'domain'
  | 'difficulty'
  | 'source'
  | 'tags'
  | 'team_a'
  | 'team_b'
  | 'stance';

/** 列配置：每列是否显示 */
export type ColumnConfig = Record<ColumnKey, boolean>;

/** localStorage key */
export const DRAW_RESULT_COLUMNS_KEY = 'bianhe-draw-result-columns';

/** 默认列配置（全显） */
export const DEFAULT_COLUMN_CONFIG: ColumnConfig = {
  idx: true,
  topic: true,
  type: true,
  domain: true,
  difficulty: true,
  source: true,
  tags: true,
  team_a: true,
  team_b: true,
  stance: true
};

/** 列定义：key → 显示名 */
export const COLUMN_DEFINITIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'idx', label: '题号' },
  { key: 'topic', label: '辩题' },
  { key: 'type', label: '类型' },
  { key: 'domain', label: '领域' },
  { key: 'difficulty', label: '难度' },
  { key: 'source', label: '来源' },
  { key: 'tags', label: '标签' },
  { key: 'team_a', label: 'A方' },
  { key: 'team_b', label: 'B方' },
  { key: 'stance', label: '持方' }
];

/** 从 localStorage 读取列配置，失败回退默认 */
export function loadColumnConfig(): ColumnConfig {
  try {
    const raw = localStorage.getItem(DRAW_RESULT_COLUMNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ColumnConfig>;
      // 合并默认值，确保所有 key 都存在
      return { ...DEFAULT_COLUMN_CONFIG, ...parsed };
    }
  } catch {
    // 解析失败，回退默认
  }
  return { ...DEFAULT_COLUMN_CONFIG };
}

/** 写入列配置到 localStorage */
export function saveColumnConfig(cfg: ColumnConfig): void {
  try {
    localStorage.setItem(DRAW_RESULT_COLUMNS_KEY, JSON.stringify(cfg));
  } catch {
    // 忽略写入失败
  }
}

export interface ColumnConfigPopoverProps {
  /** 当前列配置 */
  value: ColumnConfig;
  /** 配置变更回调 */
  onChange: (cfg: ColumnConfig) => void;
}

export default function ColumnConfigPopover({
  value,
  onChange
}: ColumnConfigPopoverProps) {
  // 当前勾选的列 key 数组
  const checkedKeys = COLUMN_DEFINITIONS.filter((col) => value[col.key]).map(
    (col) => col.key
  );

  const handleCheck = (checked: Array<string>) => {
    const checkedSet = new Set(checked);
    const next = { ...DEFAULT_COLUMN_CONFIG };
    COLUMN_DEFINITIONS.forEach((col) => {
      next[col.key] = checkedSet.has(col.key);
    });
    saveColumnConfig(next);
    onChange(next);
  };

  const handleReset = () => {
    saveColumnConfig({ ...DEFAULT_COLUMN_CONFIG });
    onChange({ ...DEFAULT_COLUMN_CONFIG });
  };

  const content = (
    <div style={{ width: 200, padding: `${spacing.xs} 0` }}>
      <Space
        style={{
          width: '100%',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
          padding: `0 ${spacing.xs}`
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          列设置
        </Typography.Text>
        <Button type="link" size="small" onClick={handleReset}>
          重置
        </Button>
      </Space>
      <Checkbox.Group
        value={checkedKeys}
        onChange={handleCheck}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%', padding: `0 ${spacing.sm}` }}>
          {COLUMN_DEFINITIONS.map((col) => (
            <Checkbox key={col.key} value={col.key}>
              {col.label}
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      overlayStyle={{ width: 220 }}
    >
      <Button icon={<SettingOutlined />} title="列设置">
        列设置
      </Button>
    </Popover>
  );
}
