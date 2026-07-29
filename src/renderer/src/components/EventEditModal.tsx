import { Modal, Form, Input, Select, DatePicker, Switch, Tooltip, theme } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import dayjs from 'dayjs';
import type {
  Event,
  EventCreateInput,
  EventUpdateInput
} from '../../../shared/types';
import { primaryButtonStyle } from '../styles/shared';

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
  const { token } = theme.useToken();
  const isEdit = !!event;

  useEffect(() => {
    if (open) {
      if (event) {
        // 编辑模式：把 YYYY-MM-DD 字符串转回 dayjs 对象
        // allow_repeat (number) -> boolean 给 Switch（0 → false, 1 → true）
        form.setFieldsValue({
          name: event.name,
          status: event.status ?? 'preparing',
          start_date: event.start_date ? dayjs(event.start_date, 'YYYY-MM-DD') : undefined,
          end_date: event.end_date ? dayjs(event.end_date, 'YYYY-MM-DD') : undefined,
          allow_repeat: !!event.allow_repeat
        });
      } else {
        // 新建模式：默认今天开始，一周后结束；允许重复默认关闭
        form.resetFields();
        form.setFieldsValue({
          status: 'preparing',
          start_date: dayjs(),
          end_date: dayjs().add(7, 'day'),
          allow_repeat: false
        });
      }
    }
  }, [open, event, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    // DatePicker 的 value 是 dayjs 对象，提交时转回 YYYY-MM-DD 字符串保持后端兼容
    // allow_repeat: Switch 的 boolean -> number（1/0）传给后端
    const data: EventCreateInput | EventUpdateInput = {
      name: values.name,
      status: values.status,
      start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : null,
      end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : null,
      allow_repeat: values.allow_repeat ? 1 : 0
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
      okButtonProps={{ style: primaryButtonStyle }}
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
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择开始日期" />
        </Form.Item>

        <Form.Item name="end_date" label="结束日期">
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择结束日期" />
        </Form.Item>

        {/* 允许辩题重复：开启后该赛事抽取时允许同一辩题被多次抽出（有放回抽样） */}
        <Form.Item
          name="allow_repeat"
          label={
            <span>
              允许辩题重复&nbsp;
              <Tooltip title="开启后该赛事抽取时允许同一辩题被多次抽出（有放回抽样）">
                <QuestionCircleOutlined style={{ color: token.colorTextSecondary }} />
              </Tooltip>
            </span>
          }
          valuePropName="checked"
        >
          <Switch checkedChildren="允许" unCheckedChildren="不允许" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
