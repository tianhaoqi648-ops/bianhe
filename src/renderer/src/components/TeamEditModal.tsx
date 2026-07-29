import { Modal, Form, Input, Select, Button, Space } from 'antd';
import type { InputRef } from 'antd';
import { useEffect, useRef } from 'react';
import type {
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamGroup
} from '../../../shared/types';
import { primaryButtonStyle } from '../styles/shared';

export interface TeamEditModalProps {
  open: boolean;
  team?: Team | null;
  /** 创建模式下需要传 eventId */
  eventId?: string;
  /** 创建模式下可选的赛事列表（若提供则在表单中显示赛事选择器） */
  eventOptions?: Array<{ id: string; name: string }>;
  /** 当前赛事的所有分组列表（非空时显示「所属分组」选择器） */
  groupOptions?: TeamGroup[];
  onOk: (data: TeamCreateInput | TeamUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
  /** 创建模式下"保存并继续"回调：连续添加多支队伍 */
  onContinue?: (data: TeamCreateInput) => Promise<void>;
}

export default function TeamEditModal({
  open,
  team,
  eventId,
  eventOptions,
  groupOptions,
  onOk,
  onCancel,
  onContinue
}: TeamEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!team;
  const showEventSelect = !isEdit && eventOptions && eventOptions.length > 0;
  const nameInputRef = useRef<InputRef>(null);
  const showContinue = !isEdit && !!onContinue;

  useEffect(() => {
    if (open) {
      if (team) {
        form.setFieldsValue({
          name: team.name,
          group_id: team.group_id ?? undefined
        });
      } else {
        form.resetFields();
        if (eventId) {
          form.setFieldsValue({ event_id: eventId });
        }
      }
    }
  }, [open, team, eventId, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const data: TeamCreateInput | TeamUpdateInput = isEdit
      ? {
          name: values.name,
          group_id: values.group_id ?? null
        }
      : {
          name: values.name,
          event_id: values.event_id ?? eventId ?? '',
          group_id: values.group_id ?? null
        };
    await onOk(data, isEdit);
  };

  const handleContinue = async () => {
    const values = await form.validateFields();
    const data: TeamCreateInput = {
      name: values.name,
      event_id: values.event_id ?? eventId ?? '',
      group_id: values.group_id ?? null
    };
    await onContinue?.(data);
    // 清空队伍名（保留 event_id 选择），自动聚焦回 name 输入框
    form.setFieldValue('name', '');
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  // 自定义 footer：仅新建模式 + 提供 onContinue 时使用
  const customFooter = showContinue ? (
    <Space>
      <Button onClick={onCancel}>取消</Button>
      <Button onClick={handleContinue}>保存并继续</Button>
      <Button type="primary" style={primaryButtonStyle} onClick={handleOk}>
        保存
      </Button>
    </Space>
  ) : undefined;

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
      okButtonProps={{ style: primaryButtonStyle }}
      footer={customFooter}
    >
      <Form form={form} layout="vertical" preserve={false}>
        {showEventSelect && (
          <Form.Item
            name="event_id"
            label="所属赛事"
            rules={[{ required: true, message: '请选择赛事' }]}
          >
            <Select
              placeholder="选择赛事"
              options={eventOptions!.map((e) => ({ label: e.name, value: e.id }))}
            />
          </Form.Item>
        )}
        <Form.Item
          name="name"
          label="队伍名称"
          rules={[{ required: true, message: '请输入队伍名称' }]}
        >
          <Input ref={nameInputRef} placeholder="如：北京大学辩论队" maxLength={100} />
        </Form.Item>
        {groupOptions && groupOptions.length > 0 && (
          <Form.Item name="group_id" label="所属分组">
            <Select
              placeholder="选择分组（可选）"
              allowClear
              options={groupOptions.map((g) => ({ label: g.name, value: g.id }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
