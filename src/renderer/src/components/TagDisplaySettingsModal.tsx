import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Switch,
  Typography,
  Space,
  Empty,
  Alert,
  Button,
  Spin,
  Select,
  message
} from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import type { TagDisplayConfig } from '../../../shared/types';
import { useTopicStore } from '../stores/topicStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig
} from '../utils/tagDisplay';
import { spacing } from '../styles/tokens';

const { Text } = Typography;

const SETTING_KEY = 'ui.tagDisplay';

// 候选值分组定义
const GROUP_DEFS: Array<{
  key: string;
  label: string;
  field: 'type' | 'difficulty' | 'source_type' | 'tags';
  prefix?: string;
}> = [
  { key: 'type', label: '题型', field: 'type' },
  { key: 'difficulty', label: '难度', field: 'difficulty' },
  { key: 'source_type', label: '来源类型', field: 'source_type' },
  { key: 'tags', label: '自定义标签', field: 'tags', prefix: '#' }
];

export interface TagDisplaySettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TagDisplaySettingsModal({
  open,
  onClose
}: TagDisplaySettingsModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const topicStore = useTopicStore();
  const settingsStore = useSettingsStore();
  const [config, setConfig] = useState<TagDisplayConfig>(DEFAULT_TAG_DISPLAY_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载配置 + 拉取候选值
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        await topicStore.fetchList({ page: 1, pageSize: 1000 });
        const cfg = loadTagDisplayConfig(settingsStore.settings);
        setConfig(cfg);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 从题库汇总所有候选值，按类别分组
  const groupedOptions = useMemo(() => {
    const groups: Record<string, Set<string>> = {
      type: new Set<string>(),
      difficulty: new Set<string>(),
      source_type: new Set<string>(),
      tags: new Set<string>()
    };
    topicStore.items.forEach((t) => {
      if (t.type) groups.type.add(t.type);
      if (t.difficulty) groups.difficulty.add(t.difficulty);
      if (t.source_type) groups.source_type.add(t.source_type);
      (t.tags ?? []).forEach((tag) => groups.tags.add(tag));
    });
    return GROUP_DEFS.map((g) => ({
      label: g.label,
      prefix: g.prefix,
      options: Array.from(groups[g.field]).sort().map((v) => ({
        label: g.prefix ? `${g.prefix}${v}` : v,
        value: v
      }))
    }));
  }, [topicStore.items]);

  const totalCandidates = useMemo(
    () => groupedOptions.reduce((sum, g) => sum + g.options.length, 0),
    [groupedOptions]
  );

  const handleToggleEnabled = (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled }));
  };

  const handleSelectedTagsChange = (values: string[]) => {
    setConfig((prev) => ({ ...prev, selectedTags: values }));
  };

  const handleReset = () => {
    setConfig(DEFAULT_TAG_DISPLAY_CONFIG);
    messageApi.info('已恢复默认配置（显示全部标签），需点击"保存"后生效');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsStore.set(SETTING_KEY, config);
      messageApi.success('标签显示配置已保存');
      onClose();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <TagsOutlined style={{ color: '#1677ff' }} />
          <span>标签显示配置</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={620}
      destroyOnClose
      maskClosable={!saving}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={handleSave}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button onClick={handleReset} disabled={saving}>
            恢复默认
          </Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      {contextHolder}
      <Spin spinning={loading}>
        <Alert
          message="配置说明"
          description={
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              <li>总开关关闭：所有位置不显示任何标签</li>
              <li>总开关开启 + 未选择标签：显示全部标签</li>
              <li>总开关开启 + 选择了标签：只显示选中的标签</li>
              <li>隐藏标签仅影响 UI 展示，不影响数据与抽题范围</li>
            </ul>
          }
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        {/* 总开关 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `${spacing.sm} 0`,
            marginBottom: spacing.md,
            borderBottom: '1px solid #f0f0f0'
          }}
        >
          <Space>
            <Text strong>显示标签</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              总开关
            </Text>
          </Space>
          <Switch
            checked={config.enabled}
            onChange={handleToggleEnabled}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </div>

        {/* 多选标签值 */}
        <div style={{ opacity: config.enabled ? 1 : 0.5 }}>
          <Space direction="vertical" size={spacing.xs} style={{ width: '100%', marginBottom: spacing.sm }}>
            <Text strong>显示哪些标签</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              不选=显示全部；选中后只显示选中的（共 {totalCandidates} 个候选值）
            </Text>
          </Space>
          {totalCandidates === 0 ? (
            <Empty description="题库中暂无标签数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Select
              mode="multiple"
              allowClear
              placeholder="不选=显示全部标签"
              style={{ width: '100%' }}
              value={config.selectedTags}
              onChange={handleSelectedTagsChange}
              disabled={!config.enabled}
              maxTagCount="responsive"
              options={groupedOptions}
              optionFilterProp="label"
            />
          )}
        </div>

        {/* 当前选中预览 */}
        {config.enabled && config.selectedTags.length > 0 && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="success"
            showIcon
            message={`已选择 ${config.selectedTags.length} 个标签，将只显示这些标签`}
            description={
              <Text style={{ fontSize: 12 }}>
                {config.selectedTags.map((t) => `#${t}`).join(' ')}
              </Text>
            }
          />
        )}
        {config.enabled && config.selectedTags.length === 0 && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="info"
            showIcon
            message="将显示全部标签"
          />
        )}
        {!config.enabled && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="warning"
            showIcon
            message="已关闭标签显示，所有位置将不显示任何标签"
          />
        )}
      </Spin>
    </Modal>
  );
}
