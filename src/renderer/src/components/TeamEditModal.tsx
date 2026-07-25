import { Modal, Form, Input } from 'antd';
import { useEffect } from 'react';
import type {
  Team,
  TeamCreateInput,
  TeamUpdateInput
} from '../../../shared/types';

export interface TeamEditModalProps {
  open: boolean;
  team?: Team | null;
  /** 创建模式下需要传 eventId */
  eventId?: string;
  onOk: (data: TeamCreateInput | TeamUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function TeamEditModal({
  open,
  team,
  eventId,
  onOk,
  onCancel
}: TeamEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!team;

  useEffect(() => {
    if (open) {
      if (team) {
        form.setFieldsValue({ name: team.name });
      } else {
        form.resetFields();
      }
    }
  }, [open, team, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const data: TeamCreateInput | TeamUpdateInput = isEdit
      ? { name: values.name }
      : { name: values.name, event_id: eventId ?? '' };
    await onOk(data, isEdit);
  };

  return (
    <Modal
      title={isEdit ? '编辑队伍' : '添加队伍'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={420}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="队伍名称"
          rules={[{ required: true, message: '请输入队伍名称' }]}
        >
          <Input placeholder="如：北京大学辩论队" maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
