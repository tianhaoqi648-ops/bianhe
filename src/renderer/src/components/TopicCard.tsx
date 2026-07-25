import { Card, Tag, Tooltip, Dropdown, InputNumber, Space, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  StarFilled,
  StarOutlined,
  StopOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  EllipsisOutlined
} from '@ant-design/icons';
import { useState } from 'react';
import type { Topic } from '../../../shared/types';

// 难度颜色映射
const DIFFICULTY_COLOR: Record<string, string> = {
  入门级: 'green',
  进阶级: 'orange',
  专业级: 'red'
};

// 来源类型颜色
const SOURCE_TYPE_COLOR: Record<string, string> = {
  官方: 'blue',
  自定义: 'purple'
};

export interface TopicCardProps {
  topic: Topic;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onEdit?: (topic: Topic) => void;
  onDelete?: (id: string) => void;
  onToggleStatus?: (id: string, currentStatus: string) => void;
  onWeightChange?: (id: string, weight: number) => void;
}

export default function TopicCard({
  topic,
  selected = false,
  onSelect,
  onEdit,
  onDelete,
  onToggleStatus,
  onWeightChange
}: TopicCardProps) {
  const { token } = theme.useToken();
  const [weightEditing, setWeightEditing] = useState(false);

  const isFavorited = topic.status === 'favorited';
  const isBlacklisted = topic.status === 'blacklisted';

  const menuItems: MenuProps['items'] = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '编辑',
      onClick: () => onEdit?.(topic)
    },
    {
      key: 'favorite',
      icon: isFavorited ? <StarFilled /> : <StarOutlined />,
      label: isFavorited ? '取消收藏' : '收藏',
      onClick: () => onToggleStatus?.(topic.id, isFavorited ? 'active' : 'favorited')
    },
    {
      key: 'blacklist',
      icon: <StopOutlined />,
      label: isBlacklisted ? '移出黑名单' : '加入黑名单',
      danger: !isBlacklisted,
      onClick: () =>
        onToggleStatus?.(topic.id, isBlacklisted ? 'active' : 'blacklisted')
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: () => onDelete?.(topic.id)
    }
  ];

  return (
    <Card
      size="small"
      hoverable
      style={{
        borderColor: selected ? token.colorPrimary : token.colorBorderSecondary,
        borderWidth: selected ? 2 : 1,
        opacity: isBlacklisted ? 0.6 : 1
      }}
      onClick={(e) => {
        // 点击卡片空白处触发选择（避免点击按钮/菜单时触发）
        if ((e.target as HTMLElement).closest('button, a, .ant-dropdown, .ant-input-number')) {
          return;
        }
        onSelect?.(topic.id, !selected);
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            flex: 1,
            fontWeight: 500,
            fontSize: 14,
            color: token.colorText,
            lineHeight: 1.5,
            paddingRight: 4,
            textDecoration: isBlacklisted ? 'line-through' : 'none'
          }}
        >
          {topic.title}
        </div>
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
          <EllipsisOutlined
            style={{ cursor: 'pointer', color: token.colorTextSecondary }}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>

      {/* 标签行 */}
      <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {topic.type && <Tag color="geekblue">{topic.type}</Tag>}
        {topic.difficulty && (
          <Tag color={DIFFICULTY_COLOR[topic.difficulty] ?? 'default'}>{topic.difficulty}</Tag>
        )}
        {topic.source_type && (
          <Tag color={SOURCE_TYPE_COLOR[topic.source_type] ?? 'default'}>
            {topic.source_type}
          </Tag>
        )}
        {isFavorited && (
          <Tag icon={<StarFilled />} color="gold">
            收藏
          </Tag>
        )}
        {isBlacklisted && (
          <Tag icon={<StopOutlined />} color="error">
            黑名单
          </Tag>
        )}
      </div>

      {/* 自定义标签 */}
      {topic.tags && topic.tags.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {topic.tags.map((t) => (
            <Tag key={t} style={{ marginBottom: 2 }}>
              #{t}
            </Tag>
          ))}
        </div>
      )}

      {/* 来源 + 权重 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          color: token.colorTextSecondary,
          paddingTop: 4,
          borderTop: `1px dashed ${token.colorBorderSecondary}`
        }}
      >
        <span>{topic.source || '未知来源'}</span>
        <Space size={4}>
          <span>权重</span>
          {weightEditing ? (
            <InputNumber
              size="small"
              min={0}
              max={10}
              step={0.1}
              defaultValue={topic.weight}
              autoFocus
              onBlur={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isNaN(v) && v !== topic.weight) {
                  onWeightChange?.(topic.id, v);
                }
                setWeightEditing(false);
              }}
              onPressEnter={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isNaN(v)) onWeightChange?.(topic.id, v);
                setWeightEditing(false);
              }}
            />
          ) : (
            <Tooltip title="点击修改权重">
              <span
                style={{ cursor: 'pointer', color: token.colorPrimary }}
                onClick={(e) => {
                  e.stopPropagation();
                  setWeightEditing(true);
                }}
              >
                {topic.weight.toFixed(1)}
              </span>
            </Tooltip>
          )}
        </Space>
      </div>
    </Card>
  );
}

// 给项目用作列表项时的简化展示
export function TopicListItem({
  topic,
  onEdit,
  onDelete,
  onToggleStatus
}: Omit<TopicCardProps, 'selected' | 'onSelect'>) {
  const isFavorited = topic.status === 'favorited';
  const isBlacklisted = topic.status === 'blacklisted';

  const menuItems: MenuProps['items'] = [
    { key: 'edit', icon: <EditOutlined />, label: '编辑', onClick: () => onEdit?.(topic) },
    {
      key: 'favorite',
      icon: isFavorited ? <StarFilled /> : <StarOutlined />,
      label: isFavorited ? '取消收藏' : '收藏',
      onClick: () => onToggleStatus?.(topic.id, isFavorited ? 'active' : 'favorited')
    },
    {
      key: 'blacklist',
      icon: <StopOutlined />,
      label: isBlacklisted ? '移出黑名单' : '加入黑名单',
      danger: !isBlacklisted,
      onClick: () =>
        onToggleStatus?.(topic.id, isBlacklisted ? 'active' : 'blacklisted')
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: () => onDelete?.(topic.id)
    }
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: 14,
            marginBottom: 4,
            textDecoration: isBlacklisted ? 'line-through' : 'none',
            color: isBlacklisted ? '#999' : 'inherit'
          }}
        >
          {isFavorited && <StarFilled style={{ color: '#faad14', marginRight: 6 }} />}
          {topic.title}
        </div>
        <Space size={4} wrap>
          {topic.type && <Tag color="geekblue">{topic.type}</Tag>}
          {topic.difficulty && (
            <Tag color={DIFFICULTY_COLOR[topic.difficulty] ?? 'default'}>
              {topic.difficulty}
            </Tag>
          )}
          {topic.source && <Tag>{topic.source}</Tag>}
          {(topic.tags ?? []).slice(0, 3).map((t) => (
            <Tag key={t}>#{t}</Tag>
          ))}
        </Space>
      </div>
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <MoreOutlined style={{ cursor: 'pointer', fontSize: 18 }} onClick={(e) => e.stopPropagation()} />
      </Dropdown>
    </div>
  );
}
