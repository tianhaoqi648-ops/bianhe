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
  Divider,
  message
} from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import type { TagCategory, TagDisplayConfig } from '../../../shared/types';
import { useTopicStore } from '../stores/topicStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig
} from '../utils/tagDisplay';
import { spacing } from '../styles/tokens';

const { Text } = Typography;

const SETTING_KEY = 'ui.tagDisplay';

// 类别定义（顺序决定 UI 显示顺序）
const CATEGORY_DEFS: Array<{
  key: TagCategory;
  label: string;
  field: 'type' | 'difficulty' | 'source_type' | 'tags';
  prefix?: string;
}> = [
  { key: 'type', label: '题型', field: 'type' },
  { key: 'difficulty', label: '难度', field: 'difficulty' },
  { key: 'source_type', label: '来源类型', field: 'source_type' },
  { key: 'custom', label: '自定义标签', field: 'tags', prefix: '#' }
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

  // 从题库汇总各类别候选值
  const candidates = useMemo(() => {
    const sets: Record<TagCategory, Set<string>> = {
      type: new Set<string>(),
      difficulty: new Set<string>(),
      source_type: new Set<string>(),
      custom: new Set<string>()
    };
    topicStore.items.forEach((t) => {
      if (t.type) sets.type.add(t.type);
      if (t.difficulty) sets.difficulty.add(t.difficulty);
      if (t.source_type) sets.source_type.add(t.source_type);
      (t.tags ?? []).forEach((tag) => sets.custom.add(tag));
    });
    return sets;
  }, [topicStore.items]);

  const handleToggleCategory = (cat: TagCategory, enabled: boolean) => {
    setConfig((prev) => ({
      ...prev,
      categoryEnabled: {
        ...prev.categoryEnabled,
        [cat]: enabled
      }
    }));
  };

  const handleSelectedValuesChange = (cat: TagCategory, values: string[]) => {
    setConfig((prev) => ({
      ...prev,
      selectedValues: {
        ...prev.selectedValues,
        [cat]: values
      }
    }));
  };

  const handleReset = () => {
    setConfig(DEFAULT_TAG_DISPLAY_CONFIG);
    messageApi.info('已恢复默认配置（全部类别开启 + 显示全部），需点击"保存"后生效');
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

  // 渲染单类别区块
  const renderCategoryBlock = (def: (typeof CATEGORY_DEFS)[number]) => {
    const cat = def.key;
    const enabled = config.categoryEnabled[cat];
    const values = Array.from(candidates[cat]).sort();
    const selected = config.selectedValues[cat];

    return (
      <div style={{ marginBottom: spacing.md }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.xs
          }}
        >
          <Space>
            <Text strong>{def.label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {values.length} 个候选值
            </Text>
          </Space>
          <Switch
            size="small"
            checked={enabled}
            onChange={(v) => handleToggleCategory(cat, v)}
            checkedChildren="显示"
            unCheckedChildren="隐藏"
          />
        </div>

        <div style={{ opacity: enabled ? 1 : 0.5 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            不选=显示全部；选中后只显示选中的
          </Text>
          {values.length === 0 ? (
            <Empty description="暂无候选值" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Select
              mode="multiple"
              allowClear
              placeholder="不选=显示全部"
              style={{ width: '100%' }}
              value={selected}
              onChange={(vals) => handleSelectedValuesChange(cat, vals)}
              disabled={!enabled}
              maxTagCount="responsive"
              options={values.map((v) => ({
                label: def.prefix ? `${def.prefix}${v}` : v,
                value: v
              }))}
              optionFilterProp="label"
            />
          )}
        </div>
      </div>
    );
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
              <li>每个类别独立控制：关闭=不显示该类别任何标签</li>
              <li>类别开启 + 未选择标签：显示该类别全部</li>
              <li>类别开启 + 选择了标签：只显示选中的</li>
              <li>隐藏标签仅影响 UI 展示，不影响数据与抽题范围</li>
              <li>作用于：题库浏览 / 抽取结果 / 大屏投影 / 筛选面板（编辑弹窗不受影响）</li>
            </ul>
          }
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        {CATEGORY_DEFS.map((def, idx) => (
          <div key={def.key}>
            {renderCategoryBlock(def)}
            {idx < CATEGORY_DEFS.length - 1 && <Divider style={{ margin: '8px 0' }} />}
          </div>
        ))}
      </Spin>
    </Modal>
  );
}
