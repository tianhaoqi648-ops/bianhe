import { Modal, Form, Input, Select, InputNumber, Tag, Space, Divider } from 'antd';
import type {
  Topic,
  TopicCreateInput,
  TopicUpdateInput,
  CustomField,
  CustomFieldValue
} from '../../../shared/types';
import {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from './FilterPanel';
import { useToast } from '../hooks/useToast';
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
 * - 编辑模式：预填 topic 原值（含 custom_data，string 类型字段转 [string] 适配 Select mode="tags"）
 * - 新增模式：预填 DEFAULT_NEW_TOPIC_VALUES（custom_data 为空对象）
 *
 * 注意：customFields 参数用于将 string 类型存储值 "v" 转为表单期望的 ["v"]，
 * tags 类型保持数组。这样 Form.Item 命名为 ['custom_data', key] 的字段才能正确显示。
 */
function computeInitialValues(
  topic?: Topic | null,
  customFields: CustomField[] = []
) {
  if (topic) {
    // 转换 custom_data 适配表单：string → [string]，tags 保持数组
    const formDataCustomData: Record<string, string[] | string> = {};
    const stored = topic.custom_data ?? {};
    for (const cf of customFields) {
      const v = stored[cf.field_key];
      if (v === undefined || v === null) continue;
      if (cf.field_type === 'tags') {
        formDataCustomData[cf.field_key] = Array.isArray(v) ? v : [v];
      } else {
        // string 类型：存为 [string] 适配 Select mode="tags" + maxCount=1
        formDataCustomData[cf.field_key] = typeof v === 'string' ? [v] : v;
      }
    }
    return {
      title: topic.title,
      type: topic.type ?? undefined,
      domain: topic.domain ?? undefined,
      difficulty: topic.difficulty ?? undefined,
      source: topic.source ?? undefined,
      source_type: topic.source_type ?? undefined,
      tags: topic.tags ?? [],
      weight: topic.weight,
      status: topic.status,
      custom_data: formDataCustomData
    };
  }
  return { ...DEFAULT_NEW_TOPIC_VALUES, custom_data: {} };
}

export interface TopicEditModalProps {
  open: boolean;
  /** 传入 topic 表示编辑模式，否则为新增 */
  topic?: Topic | null;
  onOk: (data: TopicCreateInput | TopicUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
  /** 自定义字段元数据（由 TopicLibrary 传入） */
  customFields?: CustomField[];
  /** 自定义字段候选值：fieldKey → 候选值数组 */
  customFieldOptions?: Record<string, string[]>;
}

export default function TopicEditModal({
  open,
  topic,
  onOk,
  onCancel,
  customFields = [],
  customFieldOptions = {}
}: TopicEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!topic;
  const toast = useToast();

  // 不再需要 useEffect 设置字段值
  // Form 通过 key={topic?.id ?? 'new-topic'} 强制重新挂载
  // 配合 initialValues={computeInitialValues(topic)} 一次性初始化

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      // 分离系统字段与自定义字段：custom_data 单独提取
      const { custom_data, ...systemFields } = values;
      // 转换 custom_data：string 类型字段从 ["v"] → "v"；tags 类型保持数组
      // （Select mode="tags" 始终返回数组，但 string 类型字段需存储为字符串以与
      //   countByDimension / custom_filters 的 json_extract 比较语义一致）
      const transformedCustomData: Record<string, CustomFieldValue> = {};
      if (custom_data && typeof custom_data === 'object') {
        for (const cf of customFields) {
          const raw = (custom_data as Record<string, unknown>)[cf.field_key];
          if (raw === undefined || raw === null) continue;
          if (cf.field_type === 'tags') {
            // tags 类型：保持数组，过滤空值
            if (Array.isArray(raw)) {
              const arr = (raw as unknown[]).filter(
                (v): v is string => typeof v === 'string' && v.length > 0
              );
              if (arr.length > 0) transformedCustomData[cf.field_key] = arr;
            } else if (typeof raw === 'string' && raw.length > 0) {
              transformedCustomData[cf.field_key] = [raw];
            }
          } else {
            // string 类型：从 ["v"] 提取为 "v"
            if (Array.isArray(raw)) {
              const first = raw.find((v): v is string => typeof v === 'string' && v.length > 0);
              if (first) transformedCustomData[cf.field_key] = first;
            } else if (typeof raw === 'string' && raw.length > 0) {
              transformedCustomData[cf.field_key] = raw;
            }
          }
        }
      }
      // 构建 payload：系统字段 + custom_data
      const payload: TopicCreateInput | TopicUpdateInput = {
        ...systemFields,
        custom_data:
          Object.keys(transformedCustomData).length > 0 ? transformedCustomData : null
      };
      await onOk(payload, isEdit);
    } catch (e: any) {
      if (e?.errorFields) {
        toast.error('请完善必填字段');
      } else {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  return (
    <>
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
        destroyOnHidden
      >
        <Form
          key={topic?.id ?? 'new-topic'}
          form={form}
          layout="vertical"
          initialValues={computeInitialValues(topic, customFields)}
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

          {/* 自定义字段区块 */}
          {customFields.length > 0 && (
            <>
              <Divider orientation="left" plain style={{ margin: `${spacing.md} 0` }}>
                自定义字段
              </Divider>
              {customFields.map((cf) => (
                <Form.Item
                  key={cf.field_key}
                  name={['custom_data', cf.field_key]}
                  label={cf.field_label}
                >
                  {cf.field_type === 'tags' ? (
                    <Select
                      mode="tags"
                      placeholder={`输入${cf.field_label}后按回车`}
                      tokenSeparators={[',', ' ']}
                      tagRender={(props) => (
                        <Tag closable onClose={props.onClose} style={{ margin: 2 }}>
                          {props.label}
                        </Tag>
                      )}
                    />
                  ) : (
                    <Select
                      mode="tags"
                      maxCount={1}
                      allowClear
                      placeholder={`选择或输入${cf.field_label}`}
                      options={(customFieldOptions[cf.field_key] ?? []).map((v) => ({
                        label: v,
                        value: v
                      }))}
                      tagRender={(props) => (
                        <Tag closable onClose={props.onClose} style={{ margin: 2 }}>
                          {props.label}
                        </Tag>
                      )}
                    />
                  )}
                </Form.Item>
              ))}
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
