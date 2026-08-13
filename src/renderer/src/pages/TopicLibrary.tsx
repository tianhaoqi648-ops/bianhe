import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout,
  Tree,
  Input,
  Button,
  Space,
  Pagination,
  Dropdown,
  Modal,
  Typography,
  theme,
  Affix,
  Badge,
  Breadcrumb,
  Alert,
  Checkbox,
  Tooltip,
  Table,
  Row,
  Col,
  Radio,
  Select
} from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import BrandSpin from '../components/common/BrandSpin';
import AccentCard from '../components/common/AccentCard';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import KbdHint from '../components/common/KbdHint';
import { safeIpc } from '../lib/ipc';
import {
  AppstoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TagOutlined,
  TagsOutlined,
  GlobalOutlined,
  FireOutlined,
  DatabaseOutlined,
  FolderOutlined,
  SearchOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  FilterOutlined,
  UploadOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  FileOutlined,
  StarOutlined,
  EditOutlined,
  TableOutlined,
  CopyOutlined,
  DownloadOutlined,
  EyeOutlined,
  MoreOutlined,
  SettingOutlined
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { InputRef } from 'antd';
import { useTopicStore } from '../stores/topicStore';
import { useAgentStore } from '../stores/agentStore';
import type {
  Topic,
  TopicCreateInput,
  TopicUpdateInput,
  ImportBatch,
  CustomField,
  BatchEditFieldAction
} from '../../../shared/types';
import TopicCard from '../components/TopicCard';
import DimensionTag from '../components/common/DimensionTag';
import FilterPanel, {
  TYPE_OPTIONS,
  DIFFICULTY_OPTIONS
} from '../components/FilterPanel';
import TopicEditModal from '../components/TopicEditModal';
import ImportTopicsModal from '../components/ImportTopicsModal';
import ImportHistoryModal from '../components/ImportHistoryModal';
import DedupResultModal from '../components/DedupResultModal';
import BatchEditModal from '../components/BatchEditModal';
import BatchEditHistoryModal from '../components/BatchEditHistoryModal';
import { useBatchEditStore } from '../stores/batchEditStore';
import {
  paginationStyle,
  floatActionBarStyle,
  pageContainerStyle,
  toolbarStyle,
  emptyStateStyle,
  cardStyle
} from '../styles/shared';
import { spacing, colorGold, fontSize, radius } from '../styles/tokens';
import { useHotkeys, useHotkeyScope } from '../hooks/useHotkeys';
import { useToast } from '../hooks/useToast';
import { useMediaQuery } from '../hooks/useMediaQuery';

const { Sider, Content } = Layout;
const { Text } = Typography;

// ============================================================
// 视图模式 / 密度 持久化 key
// ============================================================
const VIEW_MODE_STORAGE_KEY = 'bianhe-topic-view-mode';
const DENSITY_STORAGE_KEY = 'bianhe-topic-density';

type ViewMode = 'table' | 'card';
type TableDensity = 'compact' | 'standard' | 'comfortable';

// 从 localStorage 读取视图模式（容错：异常时回退默认值 'table'）
function loadViewMode(): ViewMode {
  try {
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'table' || v === 'card') return v;
  } catch {
    // 忽略 localStorage 不可用的情况
  }
  return 'table';
}

// 从 localStorage 读取表格密度（容错：异常时回退默认值 'compact'）
function loadDensity(): TableDensity {
  try {
    const v = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (v === 'compact' || v === 'standard' || v === 'comfortable') return v;
  } catch {
    // 忽略 localStorage 不可用的情况
  }
  return 'compact';
}

// ============================================================
// 列配置持久化（SubTask 5.3）
// ============================================================
const COLUMN_CONFIG_STORAGE_KEY = 'topic-library-columns';

/** 可配置列定义（操作列始终显示，不在此列表中） */
const CONFIGURABLE_COLUMNS: { key: string; title: string }[] = [
  { key: 'title', title: '题干' },
  { key: 'type', title: '类型' },
  { key: 'difficulty', title: '难度' },
  { key: 'domain', title: '领域' },
  { key: 'status', title: '状态' },
  { key: 'tags', title: '标签' }
];

/** 从 localStorage 读取隐藏列 key 集合（容错：异常时回退空集，即全部显示） */
function loadHiddenColumns(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLUMN_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 兼容两种存储格式：字符串数组（隐藏 key）或对象数组（含 visible）
        const hidden = parsed
          .map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'key' in item && 'visible' in item) {
              return (item as { key: string; visible: boolean }).visible ? null : (item as { key: string }).key;
            }
            return null;
          })
          .filter((k: string | null): k is string => k !== null);
        return new Set(hidden);
      }
    }
  } catch {
    // 忽略 localStorage 不可用或 JSON 解析失败
  }
  return new Set();
}

/** 持久化隐藏列 key 集合到 localStorage */
function saveHiddenColumns(hiddenKeys: Set<string>): void {
  try {
    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify(Array.from(hiddenKeys))
    );
  } catch {
    // 忽略 localStorage 不可用
  }
}

// ============================================================
// 8 维分类维度定义 + 动态自定义字段维度
// ============================================================

type SystemDimensionKey =
  | 'type'
  | 'domain'
  | 'difficulty'
  | 'source'
  | 'source_type'
  | 'status'
  | 'tags'
  | 'batch_id';

/** 自定义字段维度的 key 前缀，避免与系统维度冲突 */
const CUSTOM_DIM_PREFIX = 'custom:';

type DimensionKey = SystemDimensionKey | string;

type DimensionSource = 'ipc_count' | 'ipc_tags' | 'ipc_batches' | 'ipc_custom_field_tags';

interface DimensionMeta {
  key: DimensionKey;
  label: string;
  icon: React.ReactNode;
  source: DimensionSource;
  /** 自定义字段原始 key（仅 custom:* 维度有值），用于 IPC 调用 */
  customFieldKey?: string;
}

/** 系统维度（静态） */
const SYSTEM_DIMENSIONS: DimensionMeta[] = [
  { key: 'type', label: '类型', icon: <TagOutlined />, source: 'ipc_count' },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, source: 'ipc_count' },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, source: 'ipc_count' },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, source: 'ipc_count' },
  { key: 'source_type', label: '来源类型', icon: <AppstoreOutlined />, source: 'ipc_count' },
  { key: 'status', label: '状态', icon: <StarOutlined />, source: 'ipc_count' },
  { key: 'tags',        label: '标签',     icon: <TagsOutlined />,         source: 'ipc_tags' },
  { key: 'batch_id', label: '导入批次', icon: <FileOutlined />, source: 'ipc_batches' }
];

/** 判断维度 key 是否为自定义字段维度 */
function isCustomDimension(key: string): boolean {
  return key.startsWith(CUSTOM_DIM_PREFIX);
}

/** 从维度 key 提取自定义字段原始 key */
function extractCustomFieldKey(dimKey: string): string {
  return dimKey.slice(CUSTOM_DIM_PREFIX.length);
}

interface DimensionItem {
  value: string;
  count: number;
}

export default function TopicLibrary() {
  const { token } = theme.useToken();
  const store = useTopicStore();
  const toast = useToast();
  const navigate = useNavigate();
  // 搜索框 ref（供 Ctrl+K / / 快捷键聚焦）
  const searchInputRef = useRef<InputRef>(null);

  // 移动端断点（<768px）—— SubTask 21.2：表格 fixed 列移动端处理
  const isMobile = useMediaQuery('(max-width: 767px)');

  // 视图模式：表格 / 卡片（默认表格，从 localStorage 恢复）
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  // 表格密度：紧凑 / 标准 / 宽松（默认紧凑，从 localStorage 恢复）
  const [density, setDensity] = useState<TableDensity>(() => loadDensity());

  // ====== 右键上下文菜单（SubTask 5.2） ======
  // 当前右键的行记录（用于构建菜单项），同时用 ref 保证同步读取
  const [contextTopic, setContextTopic] = useState<Topic | null>(null);
  const contextTopicRef = useRef<Topic | null>(null);

  // ====== 列配置面板（SubTask 5.3） ======
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() => loadHiddenColumns());

  // 视图模式 / 密度 持久化到 localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // 忽略 localStorage 不可用
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // 忽略 localStorage 不可用
    }
  }, [density]);

  // 当前分类维度
  const [dimension, setDimension] = useState<DimensionKey>('type');
  // 当前选中的分类节点（'__all__' 表示全部）
  const [selectedCategory, setSelectedCategory] = useState<string>('__all__');
  // 抽屉筛选面板可见
  const [filterOpen, setFilterOpen] = useState(false);
  // 编辑弹窗
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  // 批量操作菜单中的标签输入
  const [batchTagInput, setBatchTagInput] = useState(false);
  const [batchTagValue, setBatchTagValue] = useState('');
  // 导入弹窗 & 去重检查弹窗
  const [importOpen, setImportOpen] = useState(false);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  // 批量编辑
  const batchEditStore = useBatchEditStore();
  const [batchEditSubmitting, setBatchEditSubmitting] = useState(false);
  // 8 维分类树数据（全库分布，不随分页变化）
  const [dimensionData, setDimensionData] = useState<DimensionItem[]>([]);
  const [dimensionLoading, setDimensionLoading] = useState(false);

  // ====== 自定义字段元数据（动态加载到 DIMENSIONS 和 FilterPanel） ======
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // 自定义字段候选值：fieldKey → 候选值数组（用于 FilterPanel 下拉）
  const [customFieldOptions, setCustomFieldOptions] = useState<Record<string, string[]>>({});

  // 拉取所有 tag 候选（取自当前列表，简化处理）
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    store.items.forEach((t) => (t.tags ?? []).forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [store.items]);

  // ====== 动态 DIMENSIONS：系统维度 + 自定义字段维度 ======
  const DIMENSIONS: DimensionMeta[] = useMemo(() => {
    const customDims: DimensionMeta[] = customFields.map((cf) => ({
      key: `${CUSTOM_DIM_PREFIX}${cf.field_key}`,
      label: cf.field_label,
      icon: <TagsOutlined />,
      source: cf.field_type === 'tags' ? 'ipc_custom_field_tags' : 'ipc_count',
      customFieldKey: cf.field_key
    }));
    return [...SYSTEM_DIMENSIONS, ...customDims];
  }, [customFields]);

  // 加载自定义字段元数据 + 候选值
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.customFieldAPI.list();
        if (!cancelled && res.success && res.data) {
          setCustomFields(res.data);
          // 拉取每个自定义字段的候选值（统一用 listCustomFieldTags，支持 string 和 tags 类型）
          const optionsMap: Record<string, string[]> = {};
          await Promise.all(
            res.data.map(async (cf) => {
              const tagRes = await window.topicAPI.listCustomFieldTags(cf.field_key);
              if (tagRes.success && tagRes.data) {
                optionsMap[cf.field_key] = tagRes.data.map((r) => r.value);
              }
            })
          );
          if (!cancelled) {
            setCustomFieldOptions(optionsMap);
          }
        }
      } catch (e) {
        console.error('[TopicLibrary] load customFields failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ====== 数据加载 ======
  useEffect(() => {
    store.fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store.filter.type,
    store.filter.domain,
    store.filter.difficulty,
    store.filter.source,
    store.filter.source_type,
    store.filter.status,
    store.filter.tags,
    store.filter.custom_filters,
    store.filter.page,
    store.filter.pageSize
  ]);

  // 关键词搜索：防抖（300ms）
  useEffect(() => {
    const t = setTimeout(() => {
      // 只有 keyword 变化时才触发
      store.fetchList();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.filter.keyword]);

  // ====== 分类树数据加载（8 维全库分布 + 自定义字段维度） ======
  // 维度切换或刷新触发：按 source 类型调用不同 IPC
  useEffect(() => {
    let cancelled = false;
    const dim = DIMENSIONS.find((d) => d.key === dimension);
    if (!dim) {
      setDimensionData([]);
      return;
    }
    setDimensionLoading(true);
    (async () => {
      try {
        let items: DimensionItem[] = [];
        if (dim.source === 'ipc_count') {
          // 系统字段 countByDimension：dim.key 即系统字段名
          // 自定义 string 字段也走此分支，但 countByDimension 内部会用 json_extract
          // 注意：自定义字段维度需传入原始 fieldKey，而非带前缀的 dim.key
          const fieldKey = dim.customFieldKey ?? dim.key;
          const res = await window.topicAPI.countByDimension(fieldKey as any);
          if (res.success && res.data) {
            items = res.data.map((r) => ({
              value: r.value === '(未设置)' ? '__unset__' : r.value,
              count: r.count
            }));
          }
        } else if (dim.source === 'ipc_custom_field_tags') {
          // tags 类型自定义字段：用 listCustomFieldTags 聚合数组内每个 tag
          if (dim.customFieldKey) {
            const res = await window.topicAPI.listCustomFieldTags(dim.customFieldKey);
            if (res.success && res.data) {
              items = res.data.map((r) => ({ value: r.value, count: r.count }));
            }
          }
        } else if (dim.source === 'ipc_tags') {
          // listAllTags 聚合所有 active 题的 tags
          const res = await window.topicAPI.listAllTags();
          if (res.success && res.data) {
            items = res.data.map((r) => ({ value: r.value, count: r.count }));
          }
        } else if (dim.source === 'ipc_batches') {
          // listBatches 拉取批次，按 file_name 显示，同名加后缀
          const res = await window.importAPI.listBatches();
          if (res.success && res.data) {
            const nameCount = new Map<string, number>();
            items = res.data
              .filter((b) => (b as ImportBatch).remainingCount !== 0)
              .map((b) => {
                const baseName = b.file_name || '(未命名)';
                const seen = nameCount.get(baseName) ?? 0;
                nameCount.set(baseName, seen + 1);
                return {
                  value: b.id, // batch_id 维度节点 key 用批次 id
                  count: (b as ImportBatch).remainingCount ?? 0
                };
              });
            // 节点显示名通过 dimensionBatchNames 提供给 renderTreeNode
            setDimensionBatchNames(
              res.data.reduce<Record<string, string>>((acc, b) => {
                const baseName = b.file_name || '(未命名)';
                acc[b.id] = baseName;
                return acc;
              }, {})
            );
          }
        }
        if (!cancelled) {
          setDimensionData(items);
        }
      } catch (e) {
        if (!cancelled) {
          setDimensionData([]);
          console.error('[TopicLibrary] load dimension data failed:', e);
        }
      } finally {
        if (!cancelled) setDimensionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension, store.total, DIMENSIONS]);

  // 批次维度：id → 显示名映射（处理同名加后缀）
  const [dimensionBatchNames, setDimensionBatchNames] = useState<Record<string, string>>({});

  // ====== 分类树渲染 ======
  const treeData: DataNode[] = useMemo(() => {
    return [
      { key: '__all__', title: '__all__' },
      ...dimensionData.map((item) => ({
        key: item.value,
        title: item.value
      }))
    ];
  }, [dimensionData]);

  // 分类树节点渲染（图标 + 标题 + Badge 计数）
  const renderTreeNode = (node: DataNode) => {
    const dim = DIMENSIONS.find((d) => d.key === dimension);
    const key = String(node.key);
    if (key === '__all__') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FolderOutlined style={{ color: token.colorPrimary }} />
          <span style={{ fontWeight: 500 }}>全部</span>
          <Badge
            count={store.total}
            showZero
            color={token.colorPrimary}
            overflowCount={9999}
            style={{ marginLeft: 4 }}
          />
        </span>
      );
    }
    // 查找该节点对应的 count
    const item = dimensionData.find((d) => d.value === key);
    const count = item?.count ?? 0;
    // 显示名：批次维度用 dimensionBatchNames 处理同名后缀
    let displayLabel = key;
    if (dim?.key === 'batch_id') {
      // 同名加后缀逻辑：在 dimensionData 加载时已处理，此处从 dimensionData 中读
      // 这里 key 已经是批次 id，需用 id → name 映射显示
      const baseName = dimensionBatchNames[key] ?? '(未命名)';
      // 计算同名后缀
      const sameNameItems = dimensionData.filter(
        (d) => dimensionBatchNames[d.value] === baseName
      );
      const idx = sameNameItems.findIndex((d) => d.value === key);
      displayLabel = idx === 0 ? baseName : `${baseName} (${idx + 1})`;
    } else if (key === '__unset__') {
      displayLabel = '(未设置)';
    }
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        title={dim?.key === 'batch_id' ? dimensionBatchNames[key] : displayLabel}
      >
        <span style={{ color: token.colorTextSecondary, fontSize: fontSize.body }}>{dim?.icon}</span>
        <span
          style={{
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {displayLabel}
        </span>
        <Badge
          count={count}
          showZero
          overflowCount={9999}
          style={{
            marginLeft: 4,
            backgroundColor: count > 0 ? token.colorPrimaryBg : '#f0f0f0',
            color: count > 0 ? token.colorPrimary : token.colorTextSecondary,
            boxShadow: 'none'
          }}
        />
      </span>
    );
  };

  // 选中分类 → 自动同步到 filter
  useEffect(() => {
    if (selectedCategory === '__all__') {
      if (isCustomDimension(dimension)) {
        // 自定义字段维度：清除 custom_filters[fieldKey]
        const fieldKey = extractCustomFieldKey(dimension);
        const next = { ...(store.filter.custom_filters ?? {}) };
        delete next[fieldKey];
        store.setFilter({ custom_filters: Object.keys(next).length > 0 ? next : undefined });
      } else {
        store.setFilter({ [dimension]: undefined } as any);
      }
    } else if (selectedCategory === '__unset__') {
      // __unset__ 在 repo.buildWhereClause 中翻译为 IS NULL
      if (isCustomDimension(dimension)) {
        const fieldKey = extractCustomFieldKey(dimension);
        const next = { ...(store.filter.custom_filters ?? {}), [fieldKey]: '__unset__' };
        store.setFilter({ custom_filters: next });
      } else {
        store.setFilter({ [dimension]: '__unset__' } as any);
      }
    } else if (dimension === 'tags') {
      // tags 维度特殊：筛选为单值数组
      store.setFilter({ tags: [selectedCategory] } as any);
    } else {
      if (isCustomDimension(dimension)) {
        const fieldKey = extractCustomFieldKey(dimension);
        const next = { ...(store.filter.custom_filters ?? {}), [fieldKey]: selectedCategory };
        store.setFilter({ custom_filters: next });
      } else {
        store.setFilter({ [dimension]: selectedCategory } as any);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, dimension]);

  // 切换维度时重置选中
  const handleDimensionChange = (dim: DimensionKey) => {
    setDimension(dim);
    setSelectedCategory('__all__');
  };

  // ====== 面包屑导航 ======
  const breadcrumbItems = useMemo(() => {
    const dim = DIMENSIONS.find((d) => d.key === dimension);
    const items = [
      {
        title: (
          <a onClick={() => handleResetToAll()}>全部</a>
        )
      }
    ];
    if (selectedCategory !== '__all__' && dim) {
      let label = selectedCategory;
      if (selectedCategory === '__unset__') {
        label = '(未设置)';
      } else if (dimension === 'batch_id') {
        label = dimensionBatchNames[selectedCategory] ?? selectedCategory;
      }
      items.push({
        title: (
          <span>
            {dim.label} / {label}
          </span>
        )
      });
    }
    return items;
  }, [dimension, selectedCategory, dimensionBatchNames, DIMENSIONS]);

  // 面包屑「全部」点击：清除当前维度筛选
  const handleResetToAll = () => {
    setSelectedCategory('__all__');
  };

  // ====== FilterPanel 重置筛选按钮 ======
  // 判断 FilterPanel 是否有激活字段（排除 page/pageSize/dimension/空值/空数组）
  const hasFilterPanelActive = useMemo(() => {
    const f = store.filter;
    for (const key of Object.keys(f) as (keyof typeof f)[]) {
      if (key === 'page' || key === 'pageSize') continue;
      const v = f[key];
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      // dimension 字段由分类树管理，不计入 FilterPanel 激活判定
      if (key === dimension) continue;
      // custom_filters：当前选中的自定义字段维度不计入
      if (key === 'custom_filters' && isCustomDimension(dimension)) {
        const fieldKey = extractCustomFieldKey(dimension);
        const customFilters = (v ?? {}) as Record<string, string>;
        const others = { ...customFilters };
        delete others[fieldKey];
        if (Object.keys(others).length === 0) continue;
      }
      return true;
    }
    return false;
  }, [store.filter, dimension]);

  // 重置 FilterPanel 字段但保留当前 dimension 筛选
  const handleResetFilterPanel = () => {
    if (isCustomDimension(dimension)) {
      // 自定义字段维度：保留 custom_filters[fieldKey]
      const fieldKey = extractCustomFieldKey(dimension);
      const customValue = store.filter.custom_filters?.[fieldKey];
      store.resetFilter();
      if (customValue !== undefined) {
        store.setFilter({ custom_filters: { [fieldKey]: customValue } });
      }
    } else {
      const dimValue = store.filter[dimension as keyof typeof store.filter];
      store.resetFilter();
      if (dimValue !== undefined) {
        store.setFilter({ [dimension]: dimValue } as any);
      }
    }
  };

  // ====== 跨页全选状态计算 ======
  // 当前页是否全选
  const currentPageAllSelected = useMemo(() => {
    if (store.items.length === 0) return false;
    if (store.allSelectedInFilter) return true; // 已全选
    return store.items.every((t) => store.isSelected(t.id));
  }, [store.items, store.allSelectedInFilter, store.selectedIds, store.exceptIds]);

  // 当前页全选（进入显式 selectedIds 模式，不进跨页模式）
  const handleSelectAllOnPage = () => {
    const pageIds = store.items.map((t) => t.id);
    store.selectPage(pageIds);
  };

  // 切换当前页全选
  const handleToggleSelectAllOnPage = () => {
    if (currentPageAllSelected) {
      // 取消当前页全选
      const pageIdSet = new Set(store.items.map((t) => t.id));
      store.setSelectedIds(store.selectedIds.filter((id) => !pageIdSet.has(id)));
    } else {
      handleSelectAllOnPage();
    }
  };

  // ====== 新增/编辑 ======
  const handleCreate = () => {
    setEditingTopic(null);
    setEditModalOpen(true);
  };
  const handleEdit = (topic: Topic) => {
    setEditingTopic(topic);
    setEditModalOpen(true);
    // Task 24.4: 打开编辑 Modal 时同步 Agent 上下文
    useAgentStore.getState().setContext({
      currentTopic: { id: topic.id, title: topic.title }
    });
  };
  const handleEditSubmit = async (data: TopicCreateInput | TopicUpdateInput, isEdit: boolean) => {
    if (isEdit && editingTopic) {
      await store.update(editingTopic.id, data as TopicUpdateInput);
      toast.success('已更新');
    } else {
      await store.create(data as TopicCreateInput);
      toast.success('已新增');
    }
    setEditModalOpen(false);
    setEditingTopic(null);
    store.fetchList();
  };

  // ====== 单项操作 ======
  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: '确认删除该辩题？',
      content: '删除后不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await store.remove(id);
        toast.success('已删除');
        store.fetchList();
      }
    });
  };

  const handleToggleStatus = async (id: string, status: string) => {
    await store.updateStatus(id, status);
    toast.success('状态已更新');
    store.fetchList();
  };

  const handleWeightChange = async (id: string, weight: number) => {
    await store.updateWeight(id, weight);
    toast.success('权重已更新');
    store.fetchList();
  };

  // ====== 单项操作（SubTask 5.2 上下文菜单扩展） ======
  // 复制（创建副本）
  const handleCopy = async (topic: Topic) => {
    try {
      await store.create({
        title: `${topic.title}（副本）`,
        type: topic.type,
        domain: topic.domain,
        difficulty: topic.difficulty,
        source: topic.source,
        source_type: topic.source_type,
        tags: topic.tags,
        weight: topic.weight,
        status: 'active',
        custom_data: topic.custom_data
      });
      toast.success('已复制');
      store.fetchList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败');
    }
  };

  // 导出选中（客户端 JSON 下载，兼容单选与多选）
  const handleExportSelected = async (onlyTopic?: Topic) => {
    try {
      let topicsToExport: Topic[];
      if (onlyTopic) {
        topicsToExport = [onlyTopic];
      } else {
        const ids = await store.getSelectedIdsForBatchOp();
        if (ids.length === 0) {
          toast.warning('没有可导出的项');
          return;
        }
        const idSet = new Set(ids);
        // P3.4 Task 19：用 safeIpc 包装 IPC 调用，统一错误 Toast
        const data = await safeIpc(
          window.topicAPI.list({
            ...store.filter,
            page: 1,
            pageSize: 100000
          }),
          { items: [] as Topic[], total: 0 }
        );
        if (data.items.length === 0) {
          toast.error('导出失败：无法获取辩题数据');
          return;
        }
        topicsToExport = data.items.filter((t) => idSet.has(t.id));
      }
      const blob = new Blob([JSON.stringify(topicsToExport, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `topics-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${topicsToExport.length} 条辩题`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  // 查看历史（跳转到历史页）
  const handleViewHistory = (topic: Topic) => {
    navigate('/history');
    toast.info(`查看「${topic.title.slice(0, 20)}${topic.title.length > 20 ? '…' : ''}」的相关历史`);
  };

  // ====== 批量操作 ======
  const hasSelection = store.allSelectedInFilter || store.selectedIds.length > 0;

  // 题库管理快捷键：Ctrl+K / / 聚焦搜索，Ctrl+A 全选筛选，Delete 删除选中
  useHotkeyScope('topic-library');
  useHotkeys([
    {
      combo: 'ctrl+k',
      description: '聚焦搜索框',
      scope: 'topic-library',
      handler: () => {
        searchInputRef.current?.focus();
      }
    },
    {
      combo: '/',
      description: '聚焦搜索框',
      scope: 'topic-library',
      handler: () => {
        searchInputRef.current?.focus();
      }
    },
    {
      combo: 'ctrl+a',
      description: '全选当前筛选结果',
      scope: 'topic-library',
      handler: () => {
        store.selectAllInFilter();
      }
    },
    {
      combo: 'delete',
      description: '删除选中辩题',
      scope: 'topic-library',
      handler: () => {
        if (hasSelection) handleBatchDelete();
      },
      enabled: hasSelection
    },
    {
      combo: 'ctrl+b',
      description: '打开批量编辑弹窗',
      scope: 'topic-library',
      handler: () => {
        if (hasSelection) handleOpenBatchEdit();
      },
      enabled: hasSelection
    }
  ]);

  const handleBatchDelete = () => {
    if (!hasSelection) return;
    const isCrossPage = store.allSelectedInFilter;
    const selectedCount = isCrossPage
      ? store.total - store.exceptIds.length
      : store.selectedIds.length;

    Modal.confirm({
      title: isCrossPage
        ? `确认跨页批量删除 ${selectedCount} 条辩题？`
        : `确认批量删除 ${store.selectedIds.length} 条辩题？`,
      content: isCrossPage
        ? `跨页全选模式：将删除除已取消 ${store.exceptIds.length} 条外的全部 ${store.total} 条中的 ${selectedCount} 条，不可恢复`
        : '删除后不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const ids = await store.getSelectedIdsForBatchOp();
        if (ids.length === 0) {
          toast.warning('没有可删除的项');
          return;
        }
        await store.batchRemove(ids);
        toast.success(`已删除 ${ids.length} 条`);
        store.clearSelection();
        store.fetchList();
      }
    });
  };

  const handleBatchAddTag = async () => {
    if (!batchTagValue.trim() || !hasSelection) return;
    toast.loading('处理中...', { key: 'batchTag' });
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      // 拉取选中项完整 topic 数据（跨页模式下 store.items 仅有当前页）
      const idSet = new Set(ids);
      let toUpdate: Topic[] = [];
      if (store.allSelectedInFilter || ids.length > store.items.length) {
        const res = await window.topicAPI.list({
          ...store.filter,
          page: 1,
          pageSize: 100000
        });
        if (res.success && res.data) {
          toUpdate = res.data.items.filter((t) => idSet.has(t.id));
        }
      } else {
        toUpdate = store.items.filter((t) => idSet.has(t.id));
      }
      for (const t of toUpdate) {
        const newTags = Array.from(new Set([...(t.tags ?? []), batchTagValue.trim()]));
        await store.update(t.id, { tags: newTags });
      }
      toast.success(`已批量打标签（${toUpdate.length} 条）`, { key: 'batchTag' });
      setBatchTagInput(false);
      setBatchTagValue('');
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '失败', { key: 'batchTag' });
    }
  };

  const handleBatchChangeType = async (newType: string) => {
    if (!hasSelection) return;
    toast.loading('处理中...', { key: 'batchType' });
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      for (const id of ids) {
        await store.update(id, { type: newType });
      }
      toast.success(`已批量修改类型（${ids.length} 条）`, { key: 'batchType' });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '失败', { key: 'batchType' });
    }
  };

  const handleBatchChangeDifficulty = async (newDiff: string) => {
    if (!hasSelection) return;
    toast.loading('处理中...', { key: 'batchDiff' });
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      for (const id of ids) {
        await store.update(id, { difficulty: newDiff });
      }
      toast.success(`已批量修改难度（${ids.length} 条）`, { key: 'batchDiff' });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '失败', { key: 'batchDiff' });
    }
  };

  // ====== 批量编辑（弹窗） ======
  const handleOpenBatchEdit = () => {
    if (!hasSelection) {
      toast.warning('请先选择辩题');
      return;
    }
    batchEditStore.openModal();
  };

  const handleBatchEditSubmit = async (actions: BatchEditFieldAction[]) => {
    setBatchEditSubmitting(true);
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      if (ids.length === 0) {
        toast.warning('没有可编辑的项');
        return;
      }
      const result = await batchEditStore.execute({ topicIds: ids, actions });
      if (!result) {
        throw new Error('批量编辑失败：未获取到结果');
      }
      // 仪式感 Toast：成功 + 撤销按钮（3s 内可回滚）
      toast.undo(
        `已批量编辑 ${result.affectedCount} 条辩题（${result.fieldCount} 个字段）`,
        async () => {
          try {
            await batchEditStore.revert(result.historyId);
            toast.success('已撤销批量编辑');
            store.fetchList();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '撤销失败');
          }
        }
      );
      batchEditStore.closeModal();
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量编辑失败');
    } finally {
      setBatchEditSubmitting(false);
    }
  };

  const batchMenuItems: MenuProps['items'] = [
    {
      key: 'batchEdit',
      icon: <EditOutlined />,
      label: '批量编辑（多字段）',
      onClick: handleOpenBatchEdit
    },
    {
      key: 'addTag',
      icon: <TagOutlined />,
      label: '批量打标签',
      onClick: () => setBatchTagInput(true)
    },
    {
      key: 'changeType',
      icon: <FolderOutlined />,
      label: '批量改类型',
      children: TYPE_OPTIONS.map((t) => ({
        key: `type-${t}`,
        label: t,
        onClick: () => handleBatchChangeType(t)
      }))
    },
    {
      key: 'changeDifficulty',
      icon: <FolderOutlined />,
      label: '批量改难度',
      children: DIFFICULTY_OPTIONS.map((d) => ({
        key: `diff-${d}`,
        label: d,
        onClick: () => handleBatchChangeDifficulty(d)
      }))
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '批量删除',
      danger: true,
      onClick: handleBatchDelete
    }
  ];

  // ====== 右键上下文菜单项（SubTask 5.2） ======
  // 多选时（≥2 项已选）显示批量操作菜单；否则显示单项操作菜单
  const contextMenuItems: MenuProps['items'] = useMemo(() => {
    const topic = contextTopicRef.current;
    const selectedCount = store.allSelectedInFilter
      ? store.total - store.exceptIds.length
      : store.selectedIds.length;
    const isMultiSelect = selectedCount >= 2;

    if (isMultiSelect) {
      // 批量操作菜单
      return [
        {
          key: 'batchEdit',
          icon: <EditOutlined />,
          label: '批量编辑',
          onClick: handleOpenBatchEdit
        },
        {
          key: 'batchDelete',
          icon: <DeleteOutlined />,
          label: '批量删除',
          danger: true,
          onClick: handleBatchDelete
        },
        { type: 'divider' as const },
        {
          key: 'batchExport',
          icon: <DownloadOutlined />,
          label: `批量导出（${selectedCount} 项）`,
          onClick: () => void handleExportSelected()
        }
      ];
    }

    // 单项操作菜单（默认对右键的行操作）
    if (!topic) return [];
    return [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: '编辑',
        onClick: () => handleEdit(topic)
      },
      {
        key: 'copy',
        icon: <CopyOutlined />,
        label: '复制',
        onClick: () => void handleCopy(topic)
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: '删除',
        danger: true,
        onClick: () => handleDelete(topic.id)
      },
      { type: 'divider' as const },
      {
        key: 'export',
        icon: <DownloadOutlined />,
        label: '导出选中',
        onClick: () => void handleExportSelected(topic)
      },
      {
        key: 'viewHistory',
        icon: <EyeOutlined />,
        label: '查看历史',
        onClick: () => handleViewHistory(topic)
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTopic, store.selectedIds, store.allSelectedInFilter, store.total, store.exceptIds.length]);

  // ====== 表格视图列定义（SubTask 9.2 + 9.4） ======
  // 题干（ellipsis）/ 类型 / 难度 / 领域 / 状态 / 标签 / 操作
  // 各维度 Tag 使用 DimensionTag 组件按 dimension 着色
  const tableColumns: ColumnsType<Topic> = useMemo(
    () => [
      {
        title: '题干',
        dataIndex: 'title',
        key: 'title',
        ellipsis: { showTitle: true },
        width: '32%',
        render: (_: unknown, record: Topic) => {
          const isFavorited = record.status === 'favorited';
          const isBlacklisted = record.status === 'blacklisted';
          return (
            <span
              style={{
                fontWeight: 500,
                textDecoration: isBlacklisted ? 'line-through' : 'none',
                color: isBlacklisted ? token.colorTextSecondary : token.colorText
              }}
            >
              {isFavorited && <StarOutlined style={{ color: '#faad14', marginRight: 6 }} />}
              {record.title}
            </span>
          );
        }
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        width: 90,
        render: (v: string | null) =>
          v ? <DimensionTag dimension="type">{v}</DimensionTag> : <Text type="secondary">-</Text>
      },
      {
        title: '难度',
        dataIndex: 'difficulty',
        key: 'difficulty',
        width: 90,
        render: (v: string | null) =>
          v ? <DimensionTag dimension="difficulty">{v}</DimensionTag> : <Text type="secondary">-</Text>
      },
      {
        title: '领域',
        dataIndex: 'domain',
        key: 'domain',
        width: 110,
        ellipsis: true,
        render: (v: string | null) =>
          v ? <DimensionTag dimension="domain">{v}</DimensionTag> : <Text type="secondary">-</Text>
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (v: string) => {
          const label =
            v === 'favorited' ? '收藏' : v === 'blacklisted' ? '黑名单' : '正常';
          return <DimensionTag dimension="status">{label}</DimensionTag>;
        }
      },
      {
        title: '标签',
        dataIndex: 'tags',
        key: 'tags',
        width: 180,
        render: (tags: string[] | null) => {
          if (!tags || tags.length === 0) return <Text type="secondary">-</Text>;
          const visible = tags.slice(0, 3);
          return (
            <Space size={4} wrap>
              {visible.map((t) => (
                <DimensionTag key={t} dimension="tags">#{t}</DimensionTag>
              ))}
              {tags.length > 3 && <Text type="secondary">+{tags.length - 3}</Text>}
            </Space>
          );
        }
      },
      {
        title: '操作',
        key: 'action',
        width: 140,
        fixed: 'right' as const,
        render: (_: unknown, record: Topic) => (
          <Space size={4}>
            <Button
              size="small"
              type="link"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            >
              编辑
            </Button>
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(record.id);
              }}
            >
              删除
            </Button>
          </Space>
        )
      }
    ],
    // 依赖 token 颜色、handleEdit、handleDelete（这两个 handler 通过 useCallback 闭包稳定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token.colorText, token.colorTextSecondary]
  );

  // ====== 可见列过滤（SubTask 5.3 + 21.2） ======
  // 操作列（key='action'）桌面端始终显示，移动端隐藏（操作改由行点击 + 长按菜单触发）
  // 其余列根据 hiddenColumnKeys 过滤
  const visibleColumns = useMemo(
    () =>
      tableColumns.filter((col) => {
        if (col.key === 'action') return !isMobile;
        return !hiddenColumnKeys.has(col.key as string);
      }),
    [tableColumns, hiddenColumnKeys, isMobile]
  );

  // ====== 渲染 ======
  return (
    <>
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 56px)' }}>
        {/* 左侧：分类树 */}
        <Sider
          width={240}
          theme="light"
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            padding: spacing.md,
            position: 'sticky',
            top: 0,
            height: 'calc(100vh - 56px)',
            overflow: 'auto'
          }}
        >
          {/* 分类维度标题区 */}
          <div style={{ marginBottom: spacing.sm, padding: '4px 4px 8px' }}>
            <Text strong>分类维度</Text>
          </div>
          {/* 维度切换：图标按钮组 + Tooltip（SubTask 21.1：可达性改造，触摸目标 ≥44px） */}
          <Space size={2} style={{ marginBottom: spacing.md, display: 'flex', flexWrap: 'nowrap' }}>
            {DIMENSIONS.map((d) => (
              <Tooltip key={d.key} title={d.label}>
                <Button
                  type={dimension === d.key ? 'primary' : 'text'}
                  size="small"
                  icon={d.icon}
                  aria-label={d.label}
                  onClick={() => handleDimensionChange(d.key)}
                  className="dimension-icon-btn"
                  style={{
                    width: 36,
                    minWidth: 36,
                    height: 44,
                    padding: 0,
                    flex: '0 0 36px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                />
              </Tooltip>
            ))}
          </Space>
          {/* 面包屑导航 */}
          <Breadcrumb items={breadcrumbItems} style={{ marginBottom: spacing.sm, fontSize: fontSize.caption }} />
          <BrandSpin spinning={dimensionLoading} size="small">
            <Tree
              treeData={treeData}
              selectedKeys={[selectedCategory]}
              onSelect={(keys) => {
                const k = keys[0] as string | undefined;
                setSelectedCategory(k ?? '__all__');
              }}
              titleRender={renderTreeNode}
              showLine
              blockNode
            />
          </BrandSpin>
        </Sider>

        {/* 主区域 */}
        <Content style={{ ...pageContainerStyle, padding: `0 ${spacing.lg} ${spacing.lg}` }}>
          <PageHeader title="题库管理" subtitle="维护辩题库，支持批量导入与编辑" />
          {/* 顶部工具栏（SubTask 20.2：拆分为两行） */}
          <div
            style={{
              ...toolbarStyle,
              marginBottom: spacing.md,
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 0
            }}
          >
            {/* 第一行：搜索 + 视图切换 + 密度切换 + 其他常用按钮（始终显示） */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: spacing.sm
              }}
            >
              <Space size={8} wrap>
                <Input
                  ref={searchInputRef}
                  allowClear
                  size="middle"
                  placeholder="搜索辩题标题关键词 (Ctrl+K 或 /)"
                  prefix={<SearchOutlined />}
                  addonAfter={
                    <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                      Ctrl+K
                    </Text>
                  }
                  value={store.filter.keyword ?? ''}
                  onChange={(e) =>
                    store.setFilter({ keyword: e.target.value || undefined })
                  }
                  style={{ width: 320 }}
                />
                <Button icon={<ReloadOutlined />} onClick={() => store.fetchList()}>
                  刷新
                </Button>
                {store.items.length > 0 && (
                  <Checkbox
                    checked={currentPageAllSelected}
                    indeterminate={
                      !currentPageAllSelected &&
                      store.items.some((t) => store.isSelected(t.id))
                    }
                    onChange={handleToggleSelectAllOnPage}
                  >
                    全选当前页
                  </Checkbox>
                )}
              </Space>

              <Space size={8} wrap>
                <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                  导入
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'dedup',
                        label: '去重检查',
                        icon: <SafetyCertificateOutlined />,
                        onClick: () => setDedupOpen(true)
                      },
                      {
                        key: 'import-history',
                        label: '导入历史',
                        icon: <HistoryOutlined />,
                        onClick: () => setImportHistoryOpen(true)
                      },
                      {
                        key: 'batch-edit-history',
                        label: '批量编辑历史',
                        icon: <HistoryOutlined />,
                        onClick: () => batchEditStore.openHistory()
                      }
                    ]
                  }}
                >
                  <Button icon={<MoreOutlined />}>更多</Button>
                </Dropdown>
                {/* 视图切换：表格 / 卡片（SubTask 9.1） */}
                <Radio.Group
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value as ViewMode)}
                  size="small"
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="table">
                    <TableOutlined /> 表格
                  </Radio.Button>
                  <Radio.Button value="card">
                    <AppstoreOutlined /> 卡片
                  </Radio.Button>
                </Radio.Group>
                {/* 表格密度切换器：紧邻视图切换器右侧（SubTask 9.2） */}
                <Select
                  size="small"
                  value={density}
                  onChange={setDensity}
                  style={{ width: 90 }}
                  options={[
                    { value: 'compact', label: '紧凑' },
                    { value: 'standard', label: '标准' },
                    { value: 'comfortable', label: '宽松' }
                  ]}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                  新增辩题
                </Button>
              </Space>
            </div>

            {/* 第二行：筛选 + 重置 + 批量操作（仅选中时显示） */}
            {hasSelection && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                  paddingTop: spacing.sm,
                  marginTop: spacing.sm
                }}
              >
                <Space size={8} wrap>
                  <Button
                    icon={<FilterOutlined />}
                    onClick={() => setFilterOpen((v) => !v)}
                    type={filterOpen ? 'primary' : 'default'}
                  >
                    筛选
                  </Button>
                  {hasFilterPanelActive && (
                    <Button
                      icon={<CloseCircleOutlined />}
                      onClick={handleResetFilterPanel}
                    >
                      重置筛选
                    </Button>
                  )}
                  <Text type="secondary">
                    {store.allSelectedInFilter
                      ? `已选全部 ${store.total} 条（取消 ${store.exceptIds.length} 条）`
                      : `已选 ${store.selectedIds.length} 项`}
                  </Text>
                </Space>
                <Space size={8} wrap>
                  <Dropdown menu={{ items: batchMenuItems }} trigger={['click']}>
                    <Button>批量操作</Button>
                  </Dropdown>
                  <Button type="link" onClick={() => store.clearSelection()}>
                    取消选择
                  </Button>
                </Space>
              </div>
            )}
          </div>

          {/* 跨页全选提示 Alert */}
          {currentPageAllSelected &&
            !store.allSelectedInFilter &&
            store.total > store.items.length && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: spacing.md }}
                message={`已选当前页 ${store.items.length} 条，还有 ${
                  store.total - store.items.length
                } 条未选中`}
                action={
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => store.selectAllInFilter()}
                  >
                    选中全部 {store.total} 条
                  </Button>
                }
              />
            )}

          {store.allSelectedInFilter && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: spacing.md }}
              message={`已选中全部 ${store.total} 条（已取消 ${store.exceptIds.length} 条）`}
              action={
                <Button size="small" onClick={() => store.clearSelection()}>
                  清除选择
                </Button>
              }
            />
          )}

          {/* 抽屉式筛选面板（折叠展开） */}
          {filterOpen && (
            <div style={{ marginBottom: spacing.md }}>
              <FilterPanel
                filter={store.filter}
                onChange={(f) => store.setFilter(f)}
                onReset={() => store.resetFilter()}
                tagOptions={tagOptions}
                customFields={customFields}
                customFieldOptions={customFieldOptions}
              />
            </div>
          )}

          {/* 批量标签输入条 */}
          {batchTagInput && (
            <div
              style={{
                marginBottom: spacing.md,
                padding: spacing.md,
                background: token.colorBgContainer,
                borderRadius: radius.lg,
                border: `1px solid ${token.colorBorderSecondary}`,
                display: 'flex',
                alignItems: 'center',
                gap: spacing.sm
              }}
            >
              <Text>
                为选中的{' '}
                {store.allSelectedInFilter
                  ? store.total - store.exceptIds.length
                  : store.selectedIds.length}{' '}
                条辩题添加标签：
              </Text>
              <Input
                size="small"
                style={{ width: 200 }}
                placeholder="输入标签"
                value={batchTagValue}
                onChange={(e) => setBatchTagValue(e.target.value)}
                onPressEnter={handleBatchAddTag}
              />
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={handleBatchAddTag}>
                确定
              </Button>
              <Button
                size="small"
                icon={<CloseCircleOutlined />}
                onClick={() => {
                  setBatchTagInput(false);
                  setBatchTagValue('');
                }}
              >
                取消
              </Button>
            </div>
          )}

          {/* P1-14 修复：订阅 topicStore.error，加载失败时显示 Alert 并提供重试按钮 */}
          {store.error && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: spacing.md }}
              message="加载辩题列表失败"
              description={store.error}
              action={
                <Button
                  size="small"
                  type="primary"
                  onClick={() => store.fetchList()}
                >
                  重试
                </Button>
              }
            />
          )}

          {/* 列表区域 */}
          <AccentCard
            size="small"
            style={{ background: token.colorBgContainer, ...cardStyle }}
            title={
              <Space>
                <Text strong>辩题列表</Text>
                <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                  共 {store.total} 条
                </Text>
              </Space>
            }
          >
          <BrandSpin spinning={store.loading}>
            {store.items.length === 0 ? (
              <div style={emptyStateStyle}>
                <EmptyState
                  type="topic"
                  description={store.error ? `加载失败：${store.error}` : '暂无辩题'}
                  cta={
                    store.error
                      ? undefined
                      : [
                          {
                            text: '导入辩题',
                            icon: <UploadOutlined />,
                            onClick: () => setImportOpen(true)
                          },
                          {
                            text: '新建辩题',
                            icon: <PlusOutlined />,
                            onClick: handleCreate
                          }
                        ]
                  }
                />
              </div>
            ) : viewMode === 'table' ? (
              <>
                {/* 表格视图（SubTask 9.2 + 20.3）：antd Table + 选中态行高亮 */}
                {/* 密度通过 size 属性切换：compact→small / standard→middle / comfortable→large */}
                {/* SubTask 5.1：行双击打开编辑 Modal；SubTask 5.2：行右键上下文菜单；SubTask 5.3：表头右键列配置 */}
                <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
                  <Table<Topic>
                    dataSource={store.items}
                    columns={visibleColumns}
                    rowKey="id"
                    size={
                      density === 'compact'
                        ? 'small'
                        : density === 'standard'
                          ? 'middle'
                          : 'large'
                    }
                    pagination={false}
                    locale={{ emptyText: '暂无辩题' }}
                    scroll={{ x: 1000 }}
                    rowSelection={{
                      selectedRowKeys: store.items
                        .filter((t) => store.isSelected(t.id))
                        .map((t) => t.id),
                      onChange: (keys) => {
                        // 同步当前页选中状态到 store（兼容跨页全选模式）
                        const newSet = new Set(keys as string[]);
                        for (const t of store.items) {
                          const wasSelected = store.isSelected(t.id);
                          const nowSelected = newSet.has(t.id);
                          if (nowSelected && !wasSelected) {
                            store.select(t.id);
                          } else if (!nowSelected && wasSelected) {
                            store.deselect(t.id);
                          }
                        }
                      }
                    }}
                    onRow={(record) => ({
                      onClick: (e) => {
                        // 跳过 checkbox / 按钮 / 链接等可点击元素的点击，避免与 rowSelection 双触发
                        if (
                          (e.target as HTMLElement).closest(
                            '.ant-checkbox-wrapper, .ant-checkbox, button, a, .ant-dropdown'
                          )
                        ) {
                          return;
                        }
                        // SubTask 21.2：移动端行点击进入详情（编辑 Modal）；
                        // 桌面端行点击切换选中态
                        if (isMobile) {
                          handleEdit(record);
                          return;
                        }
                        store.toggleSelect(record.id);
                      },
                      onDoubleClick: (e) => {
                        // SubTask 5.1：双击行打开编辑 Modal（跳过 checkbox / 按钮 / 链接）
                        if (
                          (e.target as HTMLElement).closest(
                            '.ant-checkbox-wrapper, .ant-checkbox, button, a, .ant-dropdown'
                          )
                        ) {
                          return;
                        }
                        handleEdit(record);
                      },
                      onContextMenu: () => {
                        // SubTask 5.2：记录右键的行，供 Dropdown 菜单项使用
                        contextTopicRef.current = record;
                        setContextTopic(record);
                      },
                      style: {
                        cursor: 'pointer',
                        background: store.isSelected(record.id)
                          ? token.colorPrimaryBg
                          : undefined
                      }
                    })}
                    onHeaderRow={() => ({
                      onContextMenu: (e) => {
                        // SubTask 5.3：表头右键打开列配置面板
                        e.preventDefault();
                        e.stopPropagation();
                        setColumnConfigOpen(true);
                      }
                    })}
                  />
                </Dropdown>
              </>
            ) : (
              /* 卡片视图（SubTask 9.3 + 20.4）：响应式 Row/Col + 金色色条
                 响应式断点：移动 <768px → 2 列 (xs=12) / 平板 768-1023px → 3 列 (md=8) / 桌面 ≥1024px → 4 列 (lg=6)
                 保留 Task 14 添加的 staggered 进入动画 */
              <Row gutter={[16, 16]}>
                {store.items.map((t, index) => (
                  <Col key={t.id} xs={12} sm={12} md={8} lg={6}>
                    <div
                      className={index < 8 ? 'fade-in-up-staggered' : undefined}
                      style={{
                        ...(index < 8 ? ({ '--i': index } as React.CSSProperties) : {}),
                        borderLeft: `3px solid ${colorGold}`
                      }}
                    >
                      <TopicCard
                        topic={t}
                        selected={store.isSelected(t.id)}
                        onSelect={(id, sel) =>
                          sel ? store.select(id) : store.deselect(id)
                        }
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onToggleStatus={handleToggleStatus}
                        onWeightChange={handleWeightChange}
                      />
                    </div>
                  </Col>
                ))}
              </Row>
            )}
          </BrandSpin>
          </AccentCard>

          {/* 分页 */}
          {store.items.length > 0 && (
            <div
              style={{
                ...paginationStyle,
                marginTop: spacing.lg,
                justifyContent: 'space-between',
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: 'rgba(255, 255, 255, 0.85)'
              }}
            >
              <Text type="secondary">共 {store.total} 条</Text>
              <Pagination
                current={store.filter.page ?? 1}
                pageSize={store.filter.pageSize ?? 20}
                total={store.total}
                showSizeChanger
                showQuickJumper
                pageSizeOptions={[10, 20, 50, 100]}
                onChange={(page, pageSize) => store.setFilter({ page, pageSize })}
              />
            </div>
          )}
        </Content>
      </Layout>

      {/* 选中态浮动操作栏 */}
      {hasSelection && (
        <Affix offsetBottom={spacing.xl}>
          <div style={floatActionBarStyle}>
            <Badge
              count={
                store.allSelectedInFilter
                  ? store.total - store.exceptIds.length
                  : store.selectedIds.length
              }
              style={{ backgroundColor: token.colorPrimary }}
            />
            <Text strong>
              {store.allSelectedInFilter
                ? `已选全部 ${store.total} 条`
                : `已选 ${store.selectedIds.length} 项`}
            </Text>
            <Dropdown menu={{ items: batchMenuItems }} trigger={['click']}>
              <Button icon={<TagOutlined />}>批量操作</Button>
            </Dropdown>
            <KbdHint kbd="Delete" description="删除选中辩题">
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBatchDelete}
              >
                批量删除
              </Button>
            </KbdHint>
            <KbdHint kbd="Ctrl+B" description="打开批量编辑弹窗">
              <Button
                icon={<EditOutlined />}
                onClick={handleOpenBatchEdit}
              >
                批量编辑
              </Button>
            </KbdHint>
            <Button
              icon={<TagOutlined />}
              onClick={() => setBatchTagInput(true)}
            >
              批量加标签
            </Button>
            <Button type="link" onClick={() => store.clearSelection()}>
              取消选择
            </Button>
          </div>
        </Affix>
      )}

      {/* 新增/编辑弹窗 */}
      <TopicEditModal
        open={editModalOpen}
        topic={editingTopic}
        onOk={handleEditSubmit}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingTopic(null);
        }}
        customFields={customFields}
        customFieldOptions={customFieldOptions}
      />

      {/* 导入辩题弹窗 */}
      <ImportTopicsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => store.fetchList()}
      />

      {/* 导入历史弹窗 */}
      <ImportHistoryModal
        open={importHistoryOpen}
        onClose={() => setImportHistoryOpen(false)}
        onSuccess={() => store.fetchList()}
        onViewBatch={(batchId) => {
          store.setFilter({ batch_id: batchId, page: 1 });
        }}
      />

      {/* 去重检查弹窗 */}
      <DedupResultModal
        open={dedupOpen}
        onClose={() => setDedupOpen(false)}
        onRerun={() => store.fetchList()}
      />

      {/* 批量编辑弹窗 */}
      <BatchEditModal
        open={batchEditStore.modalOpen}
        onClose={() => batchEditStore.closeModal()}
        targetCount={
          store.allSelectedInFilter
            ? store.total - store.exceptIds.length
            : store.selectedIds.length
        }
        isCrossPage={store.allSelectedInFilter}
        customFields={customFields}
        customFieldOptions={customFieldOptions}
        onSubmit={handleBatchEditSubmit}
        submitting={batchEditSubmitting}
      />

      {/* 批量编辑历史弹窗 */}
      <BatchEditHistoryModal
        open={batchEditStore.historyOpen}
        onClose={() => batchEditStore.closeHistory()}
        onSuccess={() => store.fetchList()}
      />

      {/* 列配置面板（SubTask 5.3）：表头右键打开，可勾选显示/隐藏列 */}
      <Modal
        title={
          <Space size={6}>
            <SettingOutlined />
            <span>列配置</span>
          </Space>
        }
        open={columnConfigOpen}
        onCancel={() => setColumnConfigOpen(false)}
        footer={null}
        width={280}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, padding: `${spacing.sm} 0` }}>
          {CONFIGURABLE_COLUMNS.map((col) => (
            <Checkbox
              key={col.key}
              checked={!hiddenColumnKeys.has(col.key)}
              onChange={(e) => {
                const next = new Set(hiddenColumnKeys);
                if (e.target.checked) {
                  next.delete(col.key);
                } else {
                  next.add(col.key);
                }
                setHiddenColumnKeys(next);
                saveHiddenColumns(next);
              }}
            >
              {col.title}
            </Checkbox>
          ))}
          <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: spacing.xs, paddingTop: spacing.sm }}>
            <Button
              size="small"
              type="link"
              onClick={() => {
                const empty = new Set<string>();
                setHiddenColumnKeys(empty);
                saveHiddenColumns(empty);
              }}
            >
              重置为默认（全部显示）
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
