import { useEffect, useState } from 'react';
import {
  Modal,
  Table,
  Button,
  Space,
  Select,
  Input,
  Typography,
  Popconfirm,
  Tag
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import EmptyState from './common/EmptyState';
import type { ColumnsType } from 'antd/es/table';
import type { Team, TeamHistory, Topic } from '../../../shared/types';
import { useToast } from '../hooks/useToast';
import { spacing, radius, gray } from '../styles/tokens';

const { Text } = Typography;

export interface TeamHistoryModalProps {
  open: boolean;
  team: Team | null;
  /** 该队伍的所有历史记录（父组件传入） */
  history: TeamHistory[];
  /** 候选辩题（用于添加历史时选择） */
  topicOptions: Topic[];
  /** 候选赛事（用于添加历史时选择 event_id） */
  eventOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onAdd: (data: {
    team_id: string;
    topic_id: string;
    event_id: string;
    played_at?: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function TeamHistoryModal({
  open,
  team,
  history,
  topicOptions,
  eventOptions,
  onClose,
  onAdd,
  onDelete
}: TeamHistoryModalProps) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [newTopicId, setNewTopicId] = useState<string | null>(null);
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const [newPlayedAt, setNewPlayedAt] = useState<string>('');

  // 重置添加表单
  useEffect(() => {
    if (open) {
      setAdding(false);
      setNewTopicId(null);
      setNewEventId(null);
      setNewPlayedAt('');
    }
  }, [open, team?.id]);

  const handleAdd = async () => {
    if (!team) return;
    if (!newTopicId) {
      toast.warning('请选择辩题');
      return;
    }
    if (!newEventId) {
      toast.warning('请选择赛事');
      return;
    }
    try {
      await onAdd({
        team_id: team.id,
        topic_id: newTopicId,
        event_id: newEventId,
        played_at: newPlayedAt || null
      });
      toast.success('已添加');
      setNewTopicId(null);
      setNewEventId(null);
      setNewPlayedAt('');
      setAdding(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  // 通过 topic_id 查找辩题标题
  const topicMap = new Map<string, Topic>();
  topicOptions.forEach((t) => topicMap.set(t.id, t));
  const eventMap = new Map<string, string>();
  eventOptions.forEach((e) => eventMap.set(e.id, e.name));

  const columns: ColumnsType<TeamHistory> = [
    {
      title: '辩题',
      dataIndex: 'topic_id',
      key: 'topic',
      render: (topicId: string) => {
        const t = topicMap.get(topicId);
        return t ? t.title : <Text type="secondary">（已删除辩题）</Text>;
      }
    },
    {
      title: '所属赛事',
      dataIndex: 'event_id',
      key: 'event',
      width: 160,
      render: (eventId: string) => eventMap.get(eventId) ?? eventId.slice(0, 8)
    },
    {
      title: '比赛时间',
      dataIndex: 'played_at',
      key: 'played_at',
      width: 160,
      render: (v: string | null) => v ?? '-'
    },
    {
      title: '持方',
      dataIndex: 'stance',
      key: 'stance',
      width: 80,
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">-</Text>;
        return <Tag color={v === '正方' ? 'blue' : 'red'}>{v}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: TeamHistory) => (
        <Popconfirm
          title="确认删除这条历史？"
          onConfirm={async () => {
            await onDelete(record.id);
            toast.success('已删除');
          }}
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  return (
    <>
      <Modal
        title={`队伍历史辩题${team ? ` - ${team.name}` : ''}`}
        open={open}
        onCancel={onClose}
        footer={null}
        width={760}
        destroyOnHidden
      >
        {/* 添加历史 */}
        {adding ? (
          <div
            style={{
              padding: spacing.md,
              marginBottom: spacing.md,
              border: `1px solid ${gray[100]}`,
              borderRadius: radius.md
            }}
          >
            <Space style={{ display: 'flex', flexWrap: 'wrap' }} size={8}>
              <Select
                showSearch
                placeholder="选择辩题"
                style={{ minWidth: 280 }}
                value={newTopicId ?? undefined}
                onChange={setNewTopicId}
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={topicOptions.map((t) => ({
                  label: t.title,
                  value: t.id
                }))}
              />
              <Select
                placeholder="选择赛事"
                style={{ minWidth: 180 }}
                value={newEventId ?? undefined}
                onChange={setNewEventId}
                options={eventOptions.map((e) => ({
                  label: e.name,
                  value: e.id
                }))}
              />
              <Input
                placeholder="比赛时间（YYYY-MM-DD）"
                style={{ width: 180 }}
                value={newPlayedAt}
                onChange={(e) => setNewPlayedAt(e.target.value)}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                添加
              </Button>
              <Button onClick={() => setAdding(false)}>取消</Button>
            </Space>
          </div>
        ) : (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ marginBottom: 12 }}
            onClick={() => setAdding(true)}
            disabled={!team}
          >
            录入历史辩题
          </Button>
        )}

        {history.length === 0 ? (
          <EmptyState type="topic" description="暂无历史辩题记录" />
        ) : (
          <Table
            columns={columns}
            dataSource={history}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, showSizeChanger: false }}
          />
        )}
      </Modal>
    </>
  );
}
