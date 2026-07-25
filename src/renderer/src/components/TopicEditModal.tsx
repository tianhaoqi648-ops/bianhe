import { Modal, Form, Input, Select, InputNumber, Tag, Space, message } from 'antd';
import { useEffect } from 'react';
import type { Topic, TopicCreateInput, TopicUpdateInput } from '../../../shared/types';
import {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from './FilterPanel';

export interface TopicEditModalProps {
  open: boolean;
  /** 传入 topic 表示编辑模式，否则为新增 */
  topic?: Topic | null;
  onOk: (data: TopicCreateInput | TopicUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function TopicEditModal({
  open,
  topic,
  onOk,
  onCancel
}: TopicEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!topic;
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (open) {
      if (topic) {
        form.setFieldsValue({
          title: topic.title,
          type: topic.type ?? undefined,
          domain: topic.domain ?? undefined,
          difficulty: topic.difficulty ?? undefined,
          source: topic.source ?? undefined,
          source_type: topic.source_type ?? undefined,
          tags: topic.tags ?? [],
          weight: topic.weight,
          status: topic.status
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          weight: 1.0,
          source_type: '自定义',
          status: 'active'
        });
      }
    }
  }, [open, topic, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onOk(values as TopicCreateInput, isEdit);
    } catch (e: any) {
      if (e?.errorFields) {
        messageApi.error('请完善必填字段');
      } else {
        messageApi.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={isEdit ? '编辑辩题' : '新增辩题'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label="辩题标题"
            rules={[{ required: true, message: '请输入辩题标题' }]}
          >
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="请输入辩题标题" />
          </Form.Item>

          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="type" label="类型" style={{ flex: 1, marginBottom: 12 }}>
              <Select
                allowClear
                placeholder="选择类型"
                options={TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="domain" label="领域" style={{ flex: 1, marginBottom: 12 }}>
              <Select
                allowClear
                placeholder="选择领域"
                options={DOMAIN_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="difficulty" label="难度" style={{ flex: 1, marginBottom: 12 }}>
              <Select
                allowClear
                placeholder="选择难度"
                options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="source" label="来源" style={{ flex: 1, marginBottom: 12 }}>
              <Select
                allowClear
                placeholder="选择来源"
                options={SOURCE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="source_type" label="来源类型" style={{ flex: 1, marginBottom: 12 }}>
              <Select
                placeholder="选择来源类型"
                options={SOURCE_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="weight" label="权重" style={{ flex: 1, marginBottom: 12 }}>
              <InputNumber min={0} max={10} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Form.Item name="tags" label="标签">
            <Select
              mode="tags"
              placeholder="输入标签后按回车，可创建自定义标签"
              tokenSeparators={[',', ' ']}
              tagRender={(props) => (
                <Tag closable onClose={props.onClose} style={{ margin: 2 }}>
                  {props.label}
                </Tag>
              )}
            />
          </Form.Item>

          <Form.Item name="status" label="状态" style={{ marginBottom: 0 }}>
            <Select
              options={[
                { label: '正常', value: 'active' },
                { label: '收藏', value: 'favorited' },
                { label: '黑名单', value: 'blacklisted' }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
