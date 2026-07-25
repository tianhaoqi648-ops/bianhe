import { Modal, Form, Input, Select, InputNumber, Tag, Space, message } from 'antd';
import type { Topic, TopicCreateInput, TopicUpdateInput } from '../../../shared/types';
import {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from './FilterPanel';
import { spacing } from '../styles/tokens';
import { primaryButtonStyle } from '../styles/shared';

/**
 * 新增辩题时的默认值（用户偏好：减少手动输入）
 * 编辑模式不受影响，仍预填原值
 */
const DEFAULT_NEW_TOPIC_VALUES = {
  title: '', // 标题必填，预填空让 Ant Design 必填校验生效
  type: '价值辩', // TYPE_OPTIONS 第一项，最常用
  domain: '社会热点', // DOMAIN_OPTIONS 第一项
  difficulty: '入门级', // DIFFICULTY_OPTIONS 第一项，新手友好
  source: '新国辩', // SOURCE_OPTIONS 第一项
  source_type: '自定义', // 用户手动新增默认为自定义
  tags: [] as string[],
  weight: 1.0,
  status: 'active'
} as const;

/**
 * 根据模式计算 Form 的 initialValues
 * - 编辑模式：预填 topic 原值
 * - 新增模式：预填 DEFAULT_NEW_TOPIC_VALUES
 */
function computeInitialValues(topic?: Topic | null) {
  if (topic) {
    return {
      title: topic.title,
      type: topic.type ?? undefined,
      domain: topic.domain ?? undefined,
      difficulty: topic.difficulty ?? undefined,
      source: topic.source ?? undefined,
      source_type: topic.source_type ?? undefined,
      tags: topic.tags ?? [],
      weight: topic.weight,
      status: topic.status
    };
  }
  return { ...DEFAULT_NEW_TOPIC_VALUES };
}

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

  // 不再需要 useEffect 设置字段值
  // Form 通过 key={topic?.id ?? 'new-topic'} 强制重新挂载
  // 配合 initialValues={computeInitialValues(topic)} 一次性初始化

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
        okButtonProps={{ size: 'middle', style: primaryButtonStyle }}
        cancelButtonProps={{ size: 'middle' }}
        width={560}
        destroyOnClose
      >
        <Form
          key={topic?.id ?? 'new-topic'}
          form={form}
          layout="vertical"
          initialValues={computeInitialValues(topic)}
        >
          <Form.Item
            name="title"
            label="辩题标题"
            rules={[{ required: true, message: '请输入辩题标题' }]}
          >
            <Input.TextArea rows={2} maxLength={200} showCount placeholder="请输入辩题标题" />
          </Form.Item>

          <Space style={{ display: 'flex' }} size={spacing.md}>
            <Form.Item name="type" label="类型" style={{ flex: 1, marginBottom: spacing.md }}>
              <Select
                allowClear
                placeholder="选择类型"
                options={TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="domain" label="领域" style={{ flex: 1, marginBottom: spacing.md }}>
              <Select
                allowClear
                placeholder="选择领域"
                options={DOMAIN_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} size={spacing.md}>
            <Form.Item name="difficulty" label="难度" style={{ flex: 1, marginBottom: spacing.md }}>
              <Select
                allowClear
                placeholder="选择难度"
                options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="source" label="来源" style={{ flex: 1, marginBottom: spacing.md }}>
              <Select
                allowClear
                placeholder="选择来源"
                options={SOURCE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
          </Space>

          <Space style={{ display: 'flex' }} size={spacing.md}>
            <Form.Item name="source_type" label="来源类型" style={{ flex: 1, marginBottom: spacing.md }}>
              <Select
                placeholder="选择来源类型"
                options={SOURCE_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item name="weight" label="权重" style={{ flex: 1, marginBottom: spacing.md }}>
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
