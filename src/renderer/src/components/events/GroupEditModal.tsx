import { Modal, Form, Input, InputNumber } from 'antd';
import { useEffect } from 'react';
import type {
  TeamGroup,
  TeamGroupCreateInput,
  TeamGroupUpdateInput
} from '../../../../shared/types';
import { primaryButtonStyle } from '../../styles/shared';

export interface GroupEditModalProps {
  open: boolean;
  /** 传入 group 进入编辑模式；null/undefined 为新建 */
  group?: TeamGroup | null;
  /** 创建模式需要传 eventId */
  eventId?: string;
  /** 下一个排序序号（新建模式默认值） */
  nextSortOrder?: number;
  onOk: (
    data: TeamGroupCreateInput | TeamGroupUpdateInput,
    isEdit: boolean
  ) => Promise<void>;
  onCancel: () => void;
}

export default function GroupEditModal({
  open,
  group,
  eventId,
  nextSortOrder,
  onOk,
  onCancel
}: GroupEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!group;

  useEffect(() => {
    if (open) {
      if (group) {
        form.setFieldsValue({
          name: group.name,
          sort_order: group.sort_order
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          name: undefined,
          sort_order: nextSortOrder ?? 1
        });
      }
    }
  }, [open, group, nextSortOrder, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const data: TeamGroupCreateInput | TeamGroupUpdateInput = isEdit
      ? {
          name: values.name,
          sort_order: typeof values.sort_order === 'number' ? values.sort_order : 0
        }
      : {
          event_id: eventId ?? '',
          name: values.name,
          sort_order: typeof values.sort_order === 'number' ? values.sort_order : 0
        };
    await onOk(data, isEdit);
  };

  return (
    <Modal
      title={isEdit ? '编辑分组' : '新建分组'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={480}
      destroyOnClose
      okButtonProps={{ style: primaryButtonStyle }}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="分组名称"
          rules={[{ required: true, message: '请输入分组名称' }]}
        >
          <Input placeholder="如：A 组 / 第一组" maxLength={50} />
        </Form.Item>

        <Form.Item
          name="sort_order"
          label="排序序号"
          rules={[{ required: true, message: '请输入排序序号' }]}
        >
          <InputNumber min={0} max={9999} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
