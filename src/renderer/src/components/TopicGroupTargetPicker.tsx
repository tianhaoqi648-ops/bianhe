import { useEffect, useState } from 'react';
import {
  Modal,
  Checkbox,
  Space,
  Empty,
  Typography,
  Tag
} from 'antd';
import { FolderOutlined } from '@ant-design/icons';
import type { TopicGroup } from '../../../shared/types';

const { Text } = Typography;

interface TopicGroupTargetPickerProps {
  open: boolean;
  /** 弹窗标题，如「复制到题库」「移动到题库」 */
  title: string;
  /** 说明文字 */
  description?: string;
  /** 可选目标题库列表（来自 topicGroupStore） */
  groups: TopicGroup[];
  /** 不可作为目标的题库 id（如整库复制/移动时的源题库） */
  disabledGroupIds?: string[];
  /** 单选模式（如「移出题组」只能选一个目标） */
  singleSelect?: boolean;
  confirmText?: string;
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (targetGroupIds: string[]) => void;
}

/**
 * 目标题库选择器（T2/T3 共享）。
 *
 * TopicLibrary（按题批量复制/移动/加组）与 TopicGroupManagerModal（整库复制/移动）
 * 共用：以 Checkbox 多选（或单选）目标题库，回调选中 id 数组。
 */
export default function TopicGroupTargetPicker({
  open,
  title,
  description,
  groups,
  disabledGroupIds = [],
  singleSelect = false,
  confirmText,
  confirmLoading = false,
  onCancel,
  onConfirm
}: TopicGroupTargetPickerProps) {
  const disabledSet = new Set(disabledGroupIds);
  const available = groups.filter((g) => !disabledSet.has(g.id));

  const [selected, setSelected] = useState<string[]>([]);

  // 打开时重置选择
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  // 单选模式下，重选会替换为单选值
  const handleChange = (values: string[]) => {
    if (singleSelect) {
      // 取最后一个，保证单选
      const last = values[values.length - 1];
      setSelected(last ? [last] : []);
    } else {
      setSelected(values as string[]);
    }
  };

  const confirmDisabled = selected.length === 0;

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => onConfirm(selected)}
      okText={confirmText ?? `确定（${selected.length}）`}
      cancelText="取消"
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: confirmDisabled }}
    >
      {description && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {description}
        </Text>
      )}

      {available.length === 0 ? (
        <Empty
          description="暂无可选题目库"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : singleSelect ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {available.map((g) => (
            <div
              key={g.id}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(g.id) ? [] : [g.id]
                )
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: `1px solid ${selected.includes(g.id) ? '#1677ff' : 'rgba(128,128,128,0.2)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: selected.includes(g.id)
                  ? 'rgba(22,119,255,0.06)'
                  : 'transparent'
              }}
            >
              <FolderOutlined style={{ color: '#1677ff' }} />
              <span>{g.name}</span>
              {g.isDefault && <Tag color="gold">默认题库</Tag>}
            </div>
          ))}
        </Space>
      ) : (
        <Checkbox.Group
          style={{ width: '100%' }}
          value={selected}
          onChange={handleChange}
        >
          <Space
            direction="vertical"
            size={8}
            style={{ width: '100%', maxHeight: 300, overflow: 'auto' }}
          >
            {available.map((g) => (
              <Checkbox key={g.id} value={g.id}>
                {g.name}
                {g.isDefault && <Tag style={{ marginLeft: 4 }} color="gold">默认题库</Tag>}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )}
    </Modal>
  );
}