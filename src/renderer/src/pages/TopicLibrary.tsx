import { useEffect, useMemo, useState } from 'react';
import {
  Layout,
  Tree,
  Input,
  Button,
  Space,
  Segmented,
  Pagination,
  Empty,
  Spin,
  Dropdown,
  message,
  Modal,
  Typography,
  theme,
  Affix,
  Badge,
  Breadcrumb,
  Alert,
  Checkbox
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BarsOutlined,
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TagOutlined,
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
  DatabaseFilled,
  HistoryOutlined,
  FileOutlined,
  StarOutlined
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useTopicStore } from '../stores/topicStore';
import type { Topic, TopicCreateInput, TopicUpdateInput, ImportBatch } from '../../../shared/types';
import TopicCard, { TopicListItem } from '../components/TopicCard';
import FilterPanel, {
  TYPE_OPTIONS,
  DIFFICULTY_OPTIONS
} from '../components/FilterPanel';
import TopicEditModal from '../components/TopicEditModal';
import ImportTopicsModal from '../components/ImportTopicsModal';
import ImportHistoryModal from '../components/ImportHistoryModal';
import DedupResultModal from '../components/DedupResultModal';
import {
  paginationStyle,
  floatActionBarStyle,
  pageContainerStyle,
  toolbarStyle,
  emptyStateStyle
} from '../styles/shared';
import { spacing } from '../styles/tokens';

const { Sider, Content } = Layout;
const { Text } = Typography;

// ============================================================
// 8 维分类维度定义
// ============================================================

type DimensionKey =
  | 'type'
  | 'domain'
  | 'difficulty'
  | 'source'
  | 'source_type'
  | 'status'
  | 'tags'
  | 'batch_id';

type DimensionSource = 'ipc_count' | 'ipc_tags' | 'ipc_batches';

interface DimensionMeta {
  key: DimensionKey;
  label: string;
  icon: React.ReactNode;
  source: DimensionSource;
}

const DIMENSIONS: DimensionMeta[] = [
  { key: 'type', label: '类型', icon: <TagOutlined />, source: 'ipc_count' },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, source: 'ipc_count' },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, source: 'ipc_count' },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, source: 'ipc_count' },
  { key: 'source_type', label: '来源类型', icon: <AppstoreOutlined />, source: 'ipc_count' },
  { key: 'status', label: '状态', icon: <StarOutlined />, source: 'ipc_count' },
  { key: 'tags', label: '标签', icon: <TagOutlined />, source: 'ipc_tags' },
  { key: 'batch_id', label: '导入批次', icon: <FileOutlined />, source: 'ipc_batches' }
];

interface DimensionItem {
  value: string;
  count: number;
}

export default function TopicLibrary() {
  const { token } = theme.useToken();
  const store = useTopicStore();
  const [messageApi, contextHolder] = message.useMessage();

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
  // 8 维分类树数据（全库分布，不随分页变化）
  const [dimensionData, setDimensionData] = useState<DimensionItem[]>([]);
  const [dimensionLoading, setDimensionLoading] = useState(false);

  // 拉取所有 tag 候选（取自当前列表，简化处理）
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    store.items.forEach((t) => (t.tags ?? []).forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [store.items]);

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

  // ====== 分类树数据加载（8 维全库分布） ======
  // 维度切换或刷新触发：按 source 类型调用不同 IPC
  useEffect(() => {
    let cancelled = false;
    const dim = DIMENSIONS.find((d) => d.key === dimension)!;
    setDimensionLoading(true);
    (async () => {
      try {
        let items: DimensionItem[] = [];
        if (dim.source === 'ipc_count') {
          // countByDimension 返回 NULL → '(未设置)'，需翻译为 '__unset__'
          const res = await window.topicAPI.countByDimension(dim.key as any);
          if (res.success && res.data) {
            items = res.data.map((r) => ({
              value: r.value === '(未设置)' ? '__unset__' : r.value,
              count: r.count
            }));
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
  }, [dimension, store.total]);

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
    const dim = DIMENSIONS.find((d) => d.key === dimension)!;
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
    if (dim.key === 'batch_id') {
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
        title={dim.key === 'batch_id' ? dimensionBatchNames[key] : displayLabel}
      >
        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>{dim.icon}</span>
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
      store.setFilter({ [dimension]: undefined } as any);
    } else if (selectedCategory === '__unset__') {
      // __unset__ 在 repo.buildWhereClause 中翻译为 IS NULL
      store.setFilter({ [dimension]: '__unset__' } as any);
    } else if (dimension === 'tags') {
      // tags 维度特殊：筛选为单值数组
      store.setFilter({ tags: [selectedCategory] } as any);
    } else {
      store.setFilter({ [dimension]: selectedCategory } as any);
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
    const dim = DIMENSIONS.find((d) => d.key === dimension)!;
    const items = [
      {
        title: (
          <a onClick={() => handleResetToAll()}>全部</a>
        )
      }
    ];
    if (selectedCategory !== '__all__') {
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
  }, [dimension, selectedCategory, dimensionBatchNames]);

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
      return true;
    }
    return false;
  }, [store.filter, dimension]);

  // 重置 FilterPanel 字段但保留当前 dimension 筛选
  const handleResetFilterPanel = () => {
    const dimValue = store.filter[dimension as keyof typeof store.filter];
    store.resetFilter();
    // 恢复当前 dimension 的筛选
    if (dimValue !== undefined) {
      store.setFilter({ [dimension]: dimValue } as any);
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
  };
  const handleEditSubmit = async (data: TopicCreateInput | TopicUpdateInput, isEdit: boolean) => {
    if (isEdit && editingTopic) {
      await store.update(editingTopic.id, data as TopicUpdateInput);
      messageApi.success('已更新');
    } else {
      await store.create(data as TopicCreateInput);
      messageApi.success('已新增');
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
        messageApi.success('已删除');
        store.fetchList();
      }
    });
  };

  const handleToggleStatus = async (id: string, status: string) => {
    await store.updateStatus(id, status);
    messageApi.success('状态已更新');
    store.fetchList();
  };

  const handleWeightChange = async (id: string, weight: number) => {
    await store.updateWeight(id, weight);
    messageApi.success('权重已更新');
    store.fetchList();
  };

  // ====== 批量操作 ======
  const hasSelection = store.allSelectedInFilter || store.selectedIds.length > 0;

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
          messageApi.warning('没有可删除的项');
          return;
        }
        await store.batchRemove(ids);
        messageApi.success(`已删除 ${ids.length} 条`);
        store.clearSelection();
        store.fetchList();
      }
    });
  };

  const handleBatchAddTag = async () => {
    if (!batchTagValue.trim() || !hasSelection) return;
    messageApi.loading({ content: '处理中...', key: 'batchTag', duration: 0 });
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
      messageApi.success({
        content: `已批量打标签（${toUpdate.length} 条）`,
        key: 'batchTag'
      });
      setBatchTagInput(false);
      setBatchTagValue('');
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchTag' });
    }
  };

  const handleBatchChangeType = async (newType: string) => {
    if (!hasSelection) return;
    messageApi.loading({ content: '处理中...', key: 'batchType', duration: 0 });
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      for (const id of ids) {
        await store.update(id, { type: newType });
      }
      messageApi.success({
        content: `已批量修改类型（${ids.length} 条）`,
        key: 'batchType'
      });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      messageApi.error({
        content: e instanceof Error ? e.message : '失败',
        key: 'batchType'
      });
    }
  };

  const handleBatchChangeDifficulty = async (newDiff: string) => {
    if (!hasSelection) return;
    messageApi.loading({ content: '处理中...', key: 'batchDiff', duration: 0 });
    try {
      const ids = await store.getSelectedIdsForBatchOp();
      for (const id of ids) {
        await store.update(id, { difficulty: newDiff });
      }
      messageApi.success({
        content: `已批量修改难度（${ids.length} 条）`,
        key: 'batchDiff'
      });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      messageApi.error({
        content: e instanceof Error ? e.message : '失败',
        key: 'batchDiff'
      });
    }
  };

  const batchMenuItems: MenuProps['items'] = [
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

  // ====== 渲染 ======
  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        {/* 左侧：分类树 */}
        <Sider
          width={220}
          theme="light"
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            padding: 12,
            overflow: 'auto'
          }}
        >
          {/* 分类维度标题区 */}
          <div style={{ marginBottom: 8, padding: '4px 4px 8px' }}>
            <Text strong>分类维度</Text>
          </div>
          {/* 维度切换 */}
          <Segmented
            block
            size="middle"
            value={dimension}
            onChange={(v) => handleDimensionChange(v as DimensionKey)}
            options={DIMENSIONS.map((d) => ({
              label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {d.icon}
                  <span>{d.label}</span>
                </span>
              ),
              value: d.key
            }))}
            style={{ marginBottom: 12 }}
          />
          {/* 面包屑导航 */}
          <Breadcrumb items={breadcrumbItems} style={{ marginBottom: 8, fontSize: 12 }} />
          <Spin spinning={dimensionLoading} size="small">
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
          </Spin>
        </Sider>

        {/* 主区域 */}
        <Content style={{ ...pageContainerStyle, padding: '0 16px 16px', overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div
            style={{
              ...toolbarStyle,
              marginBottom: 12
            }}
          >
            <Space size={8}>
              <Input
                allowClear
                size="middle"
                placeholder="搜索辩题标题关键词 (Ctrl+K)"
                prefix={<SearchOutlined />}
                addonAfter={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Ctrl+K
                  </Text>
                }
                value={store.filter.keyword ?? ''}
                onChange={(e) =>
                  store.setFilter({ keyword: e.target.value || undefined })
                }
                style={{ width: 320 }}
              />
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

            <Space size={8}>
              {hasSelection && (
                <>
                  <Text type="secondary">
                    {store.allSelectedInFilter
                      ? `已选全部 ${store.total} 条（取消 ${store.exceptIds.length} 条）`
                      : `已选 ${store.selectedIds.length} 项`}
                  </Text>
                  <Dropdown menu={{ items: batchMenuItems }} trigger={['click']}>
                    <Button>批量操作</Button>
                  </Dropdown>
                  <Button type="link" onClick={() => store.clearSelection()}>
                    取消选择
                  </Button>
                </>
              )}
              <Button
                icon={<SafetyCertificateOutlined />}
                onClick={() => setDedupOpen(true)}
              >
                去重检查
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                导入
              </Button>
              <Button
                icon={<HistoryOutlined />}
                onClick={() => setImportHistoryOpen(true)}
              >
                导入历史
              </Button>
              <Segmented
                size="small"
                value={store.viewMode}
                onChange={(v) => store.setViewMode(v as 'list' | 'grid')}
                options={[
                  { label: '网格', value: 'grid', icon: <AppstoreOutlined /> },
                  { label: '列表', value: 'list', icon: <BarsOutlined /> }
                ]}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增辩题
              </Button>
            </Space>
          </div>

          {/* 跨页全选提示 Alert */}
          {currentPageAllSelected &&
            !store.allSelectedInFilter &&
            store.total > store.items.length && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
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
              style={{ marginBottom: 12 }}
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
            <div style={{ marginBottom: 12 }}>
              <FilterPanel
                filter={store.filter}
                onChange={(f) => store.setFilter(f)}
                onReset={() => store.resetFilter()}
                tagOptions={tagOptions}
              />
            </div>
          )}

          {/* 批量标签输入条 */}
          {batchTagInput && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                background: token.colorBgContainer,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8
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

          {/* 列表区域 */}
          <Spin spinning={store.loading}>
            {store.items.length === 0 ? (
              <div style={emptyStateStyle}>
                <Empty
                  description={store.error ? `加载失败：${store.error}` : '暂无辩题'}
                >
                  <Space>
                    <Button
                      type="primary"
                      icon={<DatabaseFilled />}
                      onClick={() => setImportOpen(true)}
                    >
                      导入官方题库
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={handleCreate}>
                      新建第一道辩题
                    </Button>
                  </Space>
                </Empty>
              </div>
            ) : store.viewMode === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 16
                }}
              >
                {store.items.map((t) => (
                  <TopicCard
                    key={t.id}
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
                ))}
              </div>
            ) : (
              <div
                style={{
                  background: token.colorBgContainer,
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  overflow: 'hidden'
                }}
              >
                {store.items.map((t) => {
                  const isSelected = store.isSelected(t.id);
                  return (
                    <div
                      key={t.id}
                      style={{
                        position: 'relative',
                        background: isSelected
                          ? token.colorPrimaryBg
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease'
                      }}
                      onClick={() => store.toggleSelect(t.id)}
                    >
                      {isSelected && (
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 3,
                            background: token.colorPrimary,
                            zIndex: 1
                          }}
                        />
                      )}
                      <TopicListItem
                        topic={t}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onToggleStatus={handleToggleStatus}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Spin>

          {/* 分页 */}
          {store.items.length > 0 && (
            <div
              style={{
                ...paginationStyle,
                marginTop: 16,
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
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleBatchDelete}
            >
              批量删除
            </Button>
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
    </>
  );
}
