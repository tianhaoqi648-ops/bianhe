import { Modal, Form, Input, Select } from 'antd';
import { useEffect } from 'react';
import type {
  Event,
  EventCreateInput,
  EventUpdateInput
} from '../../../shared/types';

export interface EventEditModalProps {
  open: boolean;
  event?: Event | null;
  onOk: (data: EventCreateInput | EventUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

const STATUS_OPTIONS = [
  { label: '筹备中', value: 'preparing' },
  { label: '进行中', value: 'ongoing' },
  { label: '已结束', value: 'finished' }
];

export default function EventEditModal({
  open,
  event,
  onOk,
  onCancel
}: EventEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!event;

  useEffect(() => {
    if (open) {
      if (event) {
        form.setFieldsValue({
          name: event.name,
          status: event.status ?? 'preparing',
          // DatePicker 需要传 moment 或 dayjs，这里只保存原始字符串
          start_date: event.start_date ?? undefined,
          end_date: event.end_date ?? undefined
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ status: 'preparing' });
      }
    }
  }, [open, event, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    // 字符串日期保持原样（YYYY-MM-DD）；若用户用 DatePicker 选了 dayjs，需 .format()
    const data: EventCreateInput | EventUpdateInput = {
      name: values.name,
      status: values.status,
      start_date: values.start_date ?? null,
      end_date: values.end_date ?? null
    };
    await onOk(data, isEdit);
  };

  return (
    <Modal
      title={isEdit ? '编辑赛事' : '新建赛事'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="赛事名称"
          rules={[{ required: true, message: '请输入赛事名称' }]}
        >
          <Input placeholder="如：2026 校园辩论赛" maxLength={100} />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>

        <Form.Item name="start_date" label="开始日期">
          <Input placeholder="YYYY-MM-DD（可留空）" />
        </Form.Item>

        <Form.Item name="end_date" label="结束日期">
          <Input placeholder="YYYY-MM-DD（可留空）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
