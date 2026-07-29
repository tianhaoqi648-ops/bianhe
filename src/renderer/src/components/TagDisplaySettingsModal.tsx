import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Switch,
  Typography,
  Space,
  Alert,
  Button,
  Select,
  Divider,
  Tabs,
  Tag
} from 'antd';
import BrandSpin from './common/BrandSpin';
import { TagsOutlined } from '@ant-design/icons';
import EmptyState from './common/EmptyState';
import type {
  TagCategory,
  TagDisplayConfig,
  TagDisplayScene,
  SceneTagConfig
} from '../../../shared/types';
import { useTopicStore } from '../stores/topicStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  DEFAULT_SCENE_CONFIG,
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig
} from '../utils/tagDisplay';
import { useToast } from '../hooks/useToast';
import { spacing } from '../styles/tokens';

const { Text } = Typography;

const SETTING_KEY = 'ui.tagDisplay';

// 类别定义（顺序决定 UI 显示顺序）
const CATEGORY_DEFS: Array<{
  key: TagCategory;
  label: string;
  field: 'type' | 'difficulty' | 'source_type' | 'tags';
  prefix?: string;
  color?: string;
}> = [
  { key: 'type', label: '题型', field: 'type', color: 'geekblue' },
  { key: 'difficulty', label: '难度', field: 'difficulty', color: 'orange' },
  { key: 'source_type', label: '来源类型', field: 'source_type', color: 'purple' },
  { key: 'custom', label: '自定义标签', field: 'tags', prefix: '#' }
];

// 场景定义（顺序决定 Tab 顺序）
const SCENE_DEFS: Array<{ key: TagDisplayScene; label: string; desc: string }> = [
  { key: 'library', label: '题库浏览', desc: '题库列表/卡片中显示的标签' },
  { key: 'drawResult', label: '抽取结果', desc: '抽题结果卡片中显示的标签' },
  { key: 'bigScreen', label: '大屏投影', desc: '全屏投影模式显示的标签' },
  { key: 'filter', label: '筛选面板', desc: '筛选面板中可选的维度/标签候选' },
  { key: 'dedup', label: '去重检查', desc: '去重结果中显示的来源信息' }
];

export interface TagDisplaySettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TagDisplaySettingsModal({
  open,
  onClose
}: TagDisplaySettingsModalProps) {
  const toast = useToast();
  const topicStore = useTopicStore();
  const settingsStore = useSettingsStore();
  const [config, setConfig] = useState<TagDisplayConfig>(DEFAULT_TAG_DISPLAY_CONFIG);
  const [activeScene, setActiveScene] = useState<TagDisplayScene>('library');
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

  // 更新某个场景的某个类别开关
  const handleToggleCategory = (
    scene: TagDisplayScene,
    cat: TagCategory,
    enabled: boolean
  ) => {
    setConfig((prev) => ({
      ...prev,
      scenes: {
        ...prev.scenes,
        [scene]: {
          ...prev.scenes[scene],
          categoryEnabled: {
            ...prev.scenes[scene].categoryEnabled,
            [cat]: enabled
          }
        }
      }
    }));
  };

  // 更新某个场景的某个类别白名单
  const handleSelectedValuesChange = (
    scene: TagDisplayScene,
    cat: TagCategory,
    values: string[]
  ) => {
    setConfig((prev) => ({
      ...prev,
      scenes: {
        ...prev.scenes,
        [scene]: {
          ...prev.scenes[scene],
          selectedValues: {
            ...prev.scenes[scene].selectedValues,
            [cat]: values
          }
        }
      }
    }));
  };

  // 重置当前场景为默认
  const handleResetScene = () => {
    setConfig((prev) => ({
      ...prev,
      scenes: {
        ...prev.scenes,
        [activeScene]: { ...DEFAULT_SCENE_CONFIG }
      }
    }));
    toast.info(`已恢复「${SCENE_DEFS.find((s) => s.key === activeScene)?.label}」默认配置，需点击"保存"后生效`);
  };

  // 重置全部场景
  const handleResetAll = () => {
    setConfig(DEFAULT_TAG_DISPLAY_CONFIG);
    toast.info('已恢复全部场景默认配置，需点击"保存"后生效');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsStore.set(SETTING_KEY, config);
      toast.success('标签显示配置已保存');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 渲染单类别区块（场景内）
  const renderCategoryBlock = (
    scene: TagDisplayScene,
    def: (typeof CATEGORY_DEFS)[number]
  ) => {
    const cat = def.key;
    const sceneCfg: SceneTagConfig = config.scenes[scene];
    const enabled = sceneCfg.categoryEnabled[cat];
    const values = Array.from(candidates[cat]).sort();
    const selected = sceneCfg.selectedValues[cat];

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
            onChange={(v) => handleToggleCategory(scene, cat, v)}
            checkedChildren="显示"
            unCheckedChildren="隐藏"
          />
        </div>

        <div style={{ opacity: enabled ? 1 : 0.5 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            不选=显示全部；选中后只显示选中的
          </Text>
          {values.length === 0 ? (
            <EmptyState type="default" description="暂无候选值" size="small" />
          ) : (
            <Select
              mode="multiple"
              allowClear
              placeholder="不选=显示全部"
              style={{ width: '100%' }}
              value={selected}
              onChange={(vals) => handleSelectedValuesChange(scene, cat, vals)}
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

  // 渲染场景 Tab 内容
  const renderScenePanel = (scene: TagDisplayScene) => {
    const sceneCfg = config.scenes[scene];
    const sceneDef = SCENE_DEFS.find((s) => s.key === scene)!;
    const enabledCount = (Object.keys(sceneCfg.categoryEnabled) as TagCategory[]).filter(
      (c) => sceneCfg.categoryEnabled[c]
    ).length;

    return (
      <div>
        <Alert
          message={sceneDef.desc}
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.sm
          }}
        >
          <Space>
            <Tag color={enabledCount === 4 ? 'green' : enabledCount === 0 ? 'red' : 'orange'}>
              {enabledCount}/4 类别开启
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前场景独立配置
            </Text>
          </Space>
          <Button size="small" onClick={handleResetScene} disabled={saving}>
            恢复此场景默认
          </Button>
        </div>

        {CATEGORY_DEFS.map((def, idx) => (
          <div key={def.key}>
            {renderCategoryBlock(scene, def)}
            {idx < CATEGORY_DEFS.length - 1 && <Divider style={{ margin: '8px 0' }} />}
          </div>
        ))}
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
      width={720}
      destroyOnClose
      maskClosable={!saving}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={handleSave}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button onClick={handleResetAll} disabled={saving}>
            恢复全部默认
          </Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      <BrandSpin spinning={loading}>
        <Alert
          message="配置说明"
          description={
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              <li>5 个场景独立配置：题库浏览 / 抽取结果 / 大屏投影 / 筛选面板 / 去重检查</li>
              <li>每个场景内 4 个类别（题型/难度/来源类型/自定义标签）独立开关</li>
              <li>类别开启 + 未选择标签=显示该类别全部；选择标签后只显示选中的</li>
              <li>隐藏标签仅影响 UI 展示，不影响数据与抽题范围</li>
              <li>编辑弹窗、导入预览等编辑场景不受此配置影响</li>
            </ul>
          }
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        <Tabs
          activeKey={activeScene}
          onChange={(k) => setActiveScene(k as TagDisplayScene)}
          type="card"
          items={SCENE_DEFS.map((s) => ({
            key: s.key,
            label: s.label,
            children: renderScenePanel(s.key)
          }))}
        />
      </BrandSpin>
    </Modal>
  );
}
