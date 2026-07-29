// ============================================================
// CompactDrawTable.tsx — 紧凑表格视图（Excel 风格）
//
// SubTask 7.6：10 列紧凑表格
// - 列：题号 / 辩题 / 类型 / 领域 / 难度 / 来源 / 标签 / A方 / B方 / 持方
// - 单行表头（深色背景 #1466e0 + 白色字）
// - 行 hover 高亮（淡蓝背景 #f0f7ff）
// - 斑马纹（隔行浅灰背景 #fafafa）
// - 标签列用 Ant Design Tag 显示
// - 列设置按钮 → ColumnConfigPopover
// ============================================================

import { useMemo, useState } from 'react';
import { Table, Tag, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DrawSessionItem } from '../../../../shared/types';
import { normalizeStances } from '../../../../shared/stance-utils';
import { spacing, fontSize, colorPrimary } from '../../styles/tokens';
import ColumnConfigPopover, {
  type ColumnConfig,
  loadColumnConfig,
  DEFAULT_COLUMN_CONFIG
} from './ColumnConfigPopover';

/** 辩题元数据（紧凑表格展示用） */
interface TopicMeta {
  type?: string;
  domain?: string;
  difficulty?: string;
  source?: string;
  tags?: string[];
}

/** 队伍信息 */
interface TeamInfo {
  name: string;
  group_id?: string | null;
}

/** 表格行数据 */
interface CompactRow {
  key: string;
  idx: number;
  topic: string;
  type: string;
  domain: string;
  difficulty: string;
  source: string;
  tags: string[];
  team_a: string;
  team_b: string;
  stance: string;
  /** group/multi_team 模式下的同题队伍名称列表（versus 模式为空数组） */
  teams: string[];
  /** group/multi_team 模式下各队伍对应的持方列表（versus 模式为空数组） */
  team_stances?: string[];
}

export interface CompactDrawTableProps {
  /** 抽取会话明细项 */
  items: DrawSessionItem[];
  /** 辩题 id → 元数据映射 */
  topicsMetaMap?: Map<string, TopicMeta>;
  /** 辩题 id → 标题映射（优先使用，fallback 到 item.topic_title） */
  topicsMap?: Map<string, string>;
  /** 队伍 id → 队伍信息映射 */
  teamsMap?: Map<string, TeamInfo>;
  /** 列配置（可选，不传则内部从 localStorage 读取） */
  columns?: ColumnConfig;
  /** 列配置变更回调 */
  onColumnsChange?: (cfg: ColumnConfig) => void;
}

export default function CompactDrawTable({
  items,
  topicsMetaMap,
  topicsMap,
  teamsMap,
  columns: columnsProp,
  onColumnsChange
}: CompactDrawTableProps) {
  // 列配置：受控模式 vs 内部状态
  const [internalColumns, setInternalColumns] = useState<ColumnConfig>(() =>
    loadColumnConfig()
  );
  const columnConfig = columnsProp ?? internalColumns;

  const handleColumnsChange = (cfg: ColumnConfig) => {
    if (columnsProp === undefined) {
      setInternalColumns(cfg);
    }
    onColumnsChange?.(cfg);
  };

  // 检测是否为 group/multi_team 模式（任一 item 有 team_ids）
  const isGroupMode = useMemo(
    () => items.some((it) => Array.isArray(it.team_ids) && (it.team_ids?.length ?? 0) > 0),
    [items]
  );

  // 构建表格行数据
  const dataSource = useMemo<CompactRow[]>(() => {
    return items.map((item, idx) => {
      const topicTitle =
        (item.topic_id && topicsMap?.get(item.topic_id)) ||
        item.topic_title ||
        '（已删除辩题）';
      const meta = item.topic_id ? topicsMetaMap?.get(item.topic_id) : undefined;

      const teamAName = item.team_a_id
        ? (teamsMap?.get(item.team_a_id)?.name ?? item.team_a_name ?? '（已删除队伍）')
        : '-';
      const teamBName = item.team_b_id
        ? (teamsMap?.get(item.team_b_id)?.name ?? item.team_b_name ?? '（已删除队伍）')
        : '-';

      const stanceParts: string[] = [];
      if (isGroupMode) {
        // group/multi_team 模式：从 team_stances 构建持方
        const teamStances = Array.isArray(item.team_stances) ? item.team_stances : [];
        const validStances = teamStances.filter((s) => s); // 过滤空字符串（循环赛）
        stanceParts.push(...validStances);
      } else {
        if (item.stance_a) stanceParts.push(item.stance_a);
        if (item.stance_b) stanceParts.push(item.stance_b);
      }
      const stance = stanceParts.length > 0 ? stanceParts.join(' vs ') : '-';

      // group/multi_team 模式：解析 team_ids 为队伍名列表
      const teamIds = Array.isArray(item.team_ids) ? item.team_ids : [];
      const teams = teamIds.map(
        (tid) => teamsMap?.get(tid)?.name ?? '（已删除队伍）'
      );

      return {
        key: item.id,
        idx: idx + 1,
        topic: topicTitle,
        type: meta?.type ?? '-',
        domain: meta?.domain ?? '-',
        difficulty: meta?.difficulty ?? '-',
        source: meta?.source ?? '-',
        tags: meta?.tags ?? [],
        team_a: teamAName,
        team_b: teamBName,
        stance,
        teams,
        team_stances: Array.isArray(item.team_stances) ? item.team_stances : []
      };
    });
  }, [items, topicsMetaMap, topicsMap, teamsMap, isGroupMode]);

  // 动态构建列（根据 columnConfig 过滤）
  const tableColumns = useMemo<ColumnsType<CompactRow>>(() => {
    const allColumns: Array<{
      key: keyof ColumnConfig;
      column: {
        title: string;
        dataIndex: string;
        key: string;
        width?: number;
        render?: (value: unknown, record: CompactRow) => React.ReactNode;
      };
    }> = [
      {
        key: 'idx',
        column: {
          title: '题号',
          dataIndex: 'idx',
          key: 'idx',
          width: 60,
          render: (v: unknown) => (
            <span style={{ fontWeight: 600, color: colorPrimary }}>{v as number}</span>
          )
        }
      },
      {
        key: 'topic',
        column: {
          title: '辩题',
          dataIndex: 'topic',
          key: 'topic',
          render: (v: unknown) => (
            <span style={{ fontSize: fontSize.body, lineHeight: 1.5 }}>{v as string}</span>
          )
        }
      },
      {
        key: 'type',
        column: {
          title: '类型',
          dataIndex: 'type',
          key: 'type',
          width: 100,
          render: (v: unknown) => {
            const s = v as string;
            return s === '-' ? <span style={{ color: '#bfbfbf' }}>-</span> : <Tag>{s}</Tag>;
          }
        }
      },
      {
        key: 'domain',
        column: {
          title: '领域',
          dataIndex: 'domain',
          key: 'domain',
          width: 100,
          render: (v: unknown) => {
            const s = v as string;
            return s === '-' ? <span style={{ color: '#bfbfbf' }}>-</span> : <Tag color="cyan">{s}</Tag>;
          }
        }
      },
      {
        key: 'difficulty',
        column: {
          title: '难度',
          dataIndex: 'difficulty',
          key: 'difficulty',
          width: 80,
          render: (v: unknown) => {
            const s = v as string;
            if (s === '-') return <span style={{ color: '#bfbfbf' }}>-</span>;
            const colorMap: Record<string, string> = {
              入门级: 'green',
              进阶级: 'orange',
              专业级: 'red',
              简单: 'green',
              中等: 'orange',
              困难: 'red'
            };
            return <Tag color={colorMap[s] ?? 'default'}>{s}</Tag>;
          }
        }
      },
      {
        key: 'source',
        column: {
          title: '来源',
          dataIndex: 'source',
          key: 'source',
          width: 120,
          render: (v: unknown) => {
            const s = v as string;
            return s === '-' ? <span style={{ color: '#bfbfbf' }}>-</span> : <span>{s}</span>;
          }
        }
      },
      {
        key: 'tags',
        column: {
          title: '标签',
          dataIndex: 'tags',
          key: 'tags',
          width: 160,
          render: (v: unknown) => {
            const tags = v as string[];
            if (!tags || tags.length === 0) {
              return <span style={{ color: '#bfbfbf' }}>-</span>;
            }
            return (
              <Space size={4} wrap>
                {tags.map((t) => (
                  <Tag key={t}>#{t}</Tag>
                ))}
              </Space>
            );
          }
        }
      },
      {
        key: 'team_a',
        column: {
          title: isGroupMode ? '同题队伍' : 'A方',
          dataIndex: isGroupMode ? 'teams' : 'team_a',
          key: 'team_a',
          width: isGroupMode ? 220 : 120,
          render: (_v: unknown, record: CompactRow) => {
            // group/multi_team 模式：渲染多队伍 Tag 列表
            if (isGroupMode) {
              if (record.teams.length === 0) {
                return <span style={{ color: '#bfbfbf' }}>-</span>;
              }
              // Task 12.1：渲染层防御性持方修正（不修改原 record.team_stances）
              const normalizedStances = normalizeStances(record.team_stances ?? []);
              return (
                <Space size={4} wrap>
                  {record.teams.map((name, i) => {
                    const stance = normalizedStances[i];
                    return (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Tag color="blue">{name}</Tag>
                        {stance && (
                          <Tag color={stance === '正方' ? 'gold' : 'silver'} style={{ marginBottom: 0 }}>
                            {stance}
                          </Tag>
                        )}
                      </span>
                    );
                  })}
                </Space>
              );
            }
            // versus 模式：原 A方 渲染
            const s = record.team_a;
            return s === '-' ? <span style={{ color: '#bfbfbf' }}>-</span> : <span style={{ fontWeight: 500 }}>{s}</span>;
          }
        }
      },
      {
        key: 'team_b',
        column: {
          title: 'B方',
          dataIndex: 'team_b',
          key: 'team_b',
          width: 120,
          render: (v: unknown) => {
            const s = v as string;
            return s === '-' ? <span style={{ color: '#bfbfbf' }}>-</span> : <span style={{ fontWeight: 500 }}>{s}</span>;
          }
        }
      },
      {
        key: 'stance',
        column: {
          title: '持方',
          dataIndex: 'stance',
          key: 'stance',
          width: 120,
          render: (v: unknown) => {
            const s = v as string;
            if (s === '-') return <span style={{ color: '#bfbfbf' }}>-</span>;
            return (
              <Space size={4} wrap>
                {s.split(' vs ').map((part, i) => (
                  <Tag key={i} color={part === '正方' ? 'gold' : 'silver'}>{part}</Tag>
                ))}
              </Space>
            );
          }
        }
      }
    ];

    return allColumns
      .filter((col) => {
        // group/multi_team 模式下：跳过 B方 列（保留持方列，渲染 team_stances）
        if (isGroupMode && col.key === 'team_b') {
          return false;
        }
        return columnConfig[col.key];
      })
      .map((col) => col.column);
  }, [columnConfig, isGroupMode]);

  return (
    <div className="compact-draw-table-wrapper" style={{ width: '100%' }}>
      {/* 工具栏：列设置 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: spacing.sm
        }}
        className="compact-draw-no-print"
      >
        <ColumnConfigPopover
          value={columnConfig}
          onChange={handleColumnsChange}
        />
      </div>

      <Table<CompactRow>
        className="compact-draw-table"
        columns={tableColumns}
        dataSource={dataSource}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        bordered
        onHeaderRow={() => ({
          style: {
            background: colorPrimary,
            color: '#ffffff'
          }
        })}
        rowClassName={(_, idx) => (idx % 2 === 1 ? 'compact-row-even' : 'compact-row-odd')}
      />
    </div>
  );
}

// 默认导出列配置（供外部初始化使用）
export { DEFAULT_COLUMN_CONFIG };
