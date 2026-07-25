import { Modal, Form, Input, InputNumber, Select } from 'antd';
import { useEffect } from 'react';
import type {
  Round,
  RoundCreateInput,
  RoundUpdateInput
} from '../../../shared/types';
import { DIFFICULTY_OPTIONS } from './FilterPanel';

export interface RoundEditModalProps {
  open: boolean;
  round?: Round | null;
  /** 创建模式下需要传 eventId */
  eventId?: string;
  /** 下一个轮次编号（创建模式下作为默认值） */
  nextRoundNumber?: number;
  onOk: (data: RoundCreateInput | RoundUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function RoundEditModal({
  open,
  round,
  eventId,
  nextRoundNumber,
  onOk,
  onCancel
}: RoundEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!round;

  useEffect(() => {
    if (open) {
      if (round) {
        form.setFieldsValue({
          name: round.name ?? undefined,
          round_number: round.round_number ?? undefined,
          difficulty_override: round.difficulty_override ?? undefined,
          topic_count: round.topic_count ?? undefined
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          round_number: nextRoundNumber ?? 1,
          topic_count: 4
        });
      }
    }
  }, [open, round, nextRoundNumber, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const data: RoundCreateInput | RoundUpdateInput = isEdit
      ? {
          name: values.name ?? null,
          round_number: values.round_number ?? null,
          difficulty_override: values.difficulty_override ?? null,
          topic_count: values.topic_count ?? null
        }
      : {
          event_id: eventId ?? '',
          name: values.name ?? null,
          round_number: values.round_number ?? null,
          difficulty_override: values.difficulty_override ?? null,
          topic_count: values.topic_count ?? null
        };
    await onOk(data, isEdit);
  };

  return (
    <Modal
      title={isEdit ? '编辑轮次' : '新建轮次'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="name" label="轮次名称">
          <Input placeholder="如：分组赛 / 复赛 / 决赛" maxLength={50} />
        </Form.Item>

        <Form.Item
          name="round_number"
          label="轮次序号"
          rules={[{ required: true, message: '请输入轮次序号' }]}
        >
          <InputNumber min={1} max={99} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="difficulty_override" label="难度梯度">
          <Select
            allowClear
            placeholder="留空则不限制难度"
            options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
          />
        </Form.Item>

        <Form.Item name="topic_count" label="本轮题量">
          <InputNumber min={1} max={50} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
