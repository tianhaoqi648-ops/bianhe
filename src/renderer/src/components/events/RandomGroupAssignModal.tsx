// ============================================================
// RandomGroupAssignModal.tsx — 随机分组弹窗
//
// 支持两种分配策略：
//   - by_group_count：按组数分配（min=2, max=20，默认 4）
//   - by_team_count：按每组 N 队分配（min=2, max=10，默认 4）
//
// 流程：
//   1. 用户选择策略 / 数量 / 是否覆盖现有分组
//   2. 「预览」调用 eventStore.randomAssignGroups({ dry_run: true })
//   3. 预览表格展示分配方案，组名可编辑
//   4. 「确认分配」调用 eventStore.randomAssignGroups({ dry_run: false, group_names })
// ============================================================

import { useEffect, useState } from 'react';
import {
  Modal,
  Segmented,
  InputNumber,
  Switch,
  Table,
  Input,
  Tag,
  Button,
  Space,
  Typography,
  Alert
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ThunderboltOutlined, EyeOutlined } from '@ant-design/icons';
import { useEventStore } from '../../stores/eventStore';
import { useToast } from '../../hooks/useToast';
import type { RandomAssignGroupResult } from '../../../../shared/types';
import { primaryButtonStyle } from '../../styles/shared';
import { spacing, fontSize } from '../../styles/tokens';

const { Text } = Typography;

export interface RandomGroupAssignModalProps {
  open: boolean;
  eventId: string;
  onCancel: () => void;
  /** 分配成功后回调（刷新列表） */
  onSuccess?: () => void;
}

type Strategy = 'by_group_count' | 'by_team_count';

type GroupPlanItem = { name: string; team_ids: string[]; team_names: string[] };

export default function RandomGroupAssignModal({
  open,
  eventId,
  onCancel,
  onSuccess
}: RandomGroupAssignModalProps) {
  const eventStore = useEventStore();
  const toast = useToast();

  const [strategy, setStrategy] = useState<Strategy>('by_group_count');
  const [count, setCount] = useState<number>(4);
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [previewResult, setPreviewResult] = useState<RandomAssignGroupResult | null>(null);
  const [editedGroupNames, setEditedGroupNames] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);

  // 打开弹窗时重置所有状态
  useEffect(() => {
    if (open) {
      setStrategy('by_group_count');
      setCount(4);
      setOverwrite(false);
      setPreviewResult(null);
      setEditedGroupNames([]);
      setLoading(false);
      setConfirming(false);
    }
  }, [open]);

  // 切换策略时重置 count 默认值与预览
  useEffect(() => {
    setCount(4);
    setPreviewResult(null);
    setEditedGroupNames([]);
  }, [strategy]);

  // 切换 count / overwrite 时清空预览（参数变化后旧预览失效）
  useEffect(() => {
    setPreviewResult(null);
    setEditedGroupNames([]);
  }, [count, overwrite]);

  const countMin = 2;
  const countMax = strategy === 'by_group_count' ? 20 : 10;

  const handlePreview = async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const result = await eventStore.randomAssignGroups({
        event_id: eventId,
        strategy,
        count,
        overwrite,
        dry_run: true
      });
      setPreviewResult(result);
      setEditedGroupNames(result.groups_plan.map((g) => g.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预览失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!eventId) return;
    if (!previewResult || previewResult.groups_plan.length === 0) return;
    setConfirming(true);
    try {
      await eventStore.randomAssignGroups({
        event_id: eventId,
        strategy,
        count,
        overwrite,
        dry_run: false,
        group_names: editedGroupNames
      });
      toast.success('随机分组已完成');
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分配失败');
    } finally {
      setConfirming(false);
    }
  };

  const columns: ColumnsType<GroupPlanItem> = [
    {
      title: '组名',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text: string, _record: GroupPlanItem, index: number) => (
        <Input
          value={editedGroupNames[index] ?? text}
          onChange={(e) => {
            const next = [...editedGroupNames];
            next[index] = e.target.value;
            setEditedGroupNames(next);
          }}
          maxLength={50}
        />
      )
    },
    {
      title: '队伍',
      dataIndex: 'team_names',
      key: 'team_names',
      render: (names: string[]) => (
        <Space wrap size={[4, 4]}>
          {names.map((n, i) => (
            <Tag key={i}>{n}</Tag>
          ))}
        </Space>
      )
    }
  ];

  const isPreviewEmpty = !!previewResult && previewResult.groups_plan.length === 0;
  const confirmDisabled = !previewResult || isPreviewEmpty || !eventId;

  return (
    <Modal
      title="随机分组"
      open={open}
      onCancel={onCancel}
      width={680}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button
            icon={<EyeOutlined />}
            loading={loading}
            onClick={handlePreview}
            disabled={!eventId}
          >
            预览
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={confirming}
            onClick={handleConfirm}
            disabled={confirmDisabled}
            style={primaryButtonStyle}
          >
            确认分配
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={spacing.md} style={{ width: '100%' }}>
        <div>
          <Text
            type="secondary"
            style={{ fontSize: fontSize.caption, display: 'block', marginBottom: spacing.xs }}
          >
            分配策略
          </Text>
          <Segmented
            value={strategy}
            onChange={(v) => setStrategy(v as Strategy)}
            options={[
              { label: '按组数分配', value: 'by_group_count' },
              { label: '按每组 N 队分配', value: 'by_team_count' }
            ]}
          />
        </div>

        <div>
          <Text
            type="secondary"
            style={{ fontSize: fontSize.caption, display: 'block', marginBottom: spacing.xs }}
          >
            {strategy === 'by_group_count' ? '组数' : '每组队伍数'}
          </Text>
          <InputNumber
            min={countMin}
            max={countMax}
            value={count}
            onChange={(v) => setCount(typeof v === 'number' ? v : countMin)}
            style={{ width: 160 }}
          />
        </div>

        <div>
          <Space align="center">
            <Switch checked={overwrite} onChange={setOverwrite} />
            <Text>覆盖现有分组</Text>
          </Space>
          <Text
            type="secondary"
            style={{ fontSize: fontSize.caption, display: 'block', marginTop: spacing.xs }}
          >
            开启后，所有队伍（含已分组）将重新随机分配；关闭时仅分配未分组的队伍
          </Text>
        </div>

        {previewResult && (
          isPreviewEmpty ? (
            <Alert
              type="info"
              showIcon
              message='没有需要分配的队伍，可开启"覆盖现有分组"重新分配'
            />
          ) : (
            <>
              <Alert
                type="success"
                showIcon
                message={`预览：将创建/复用 ${previewResult.groups_plan.length} 个分组，分配 ${previewResult.teams_assigned} 支队伍`}
              />
              <Table
                columns={columns}
                dataSource={previewResult.groups_plan}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
              />
            </>
          )
        )}
      </Space>
    </Modal>
  );
}
