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
  Badge
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
  DatabaseFilled
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useTopicStore } from '../stores/topicStore';
import type { Topic, TopicCreateInput, TopicUpdateInput } from '../../../shared/types';
import TopicCard, { TopicListItem } from '../components/TopicCard';
import FilterPanel, {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS
} from '../components/FilterPanel';
import TopicEditModal from '../components/TopicEditModal';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
import { paginationStyle, floatActionBarStyle } from '../styles/shared';
import { spacing } from '../styles/tokens';

const { Sider, Content } = Layout;
const { Text } = Typography;

// 分类维度元数据
const DIMENSIONS = [
  { key: 'type', label: '类型', icon: <TagOutlined />, options: TYPE_OPTIONS },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, options: DOMAIN_OPTIONS },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, options: DIFFICULTY_OPTIONS },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, options: SOURCE_OPTIONS }
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

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
  const [dedupOpen, setDedupOpen] = useState(false);

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

  // ====== 分类树 ======
  const treeData: DataNode[] = useMemo(() => {
    const dim = DIMENSIONS.find((d) => d.key === dimension)!;
    // 按该维度统计 items 数（仅当前页，可作为粗略指示）
    const counter = new Map<string, number>();
    store.items.forEach((t) => {
      const v = (t as any)[dimension] as string | null;
      if (v) counter.set(v, (counter.get(v) ?? 0) + 1);
    });
    return [
      {
        key: '__all__',
        title: '__all__'
      },
      ...dim.options.map((opt) => ({
        key: opt,
        title: opt
      }))
    ];
  }, [dimension]);

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
    const count =
      store.items.filter((t) => (t as any)[dimension] === key).length;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
          {dim.icon}
        </span>
        <span>{key}</span>
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
  const hasSelection = store.selectedIds.length > 0;

  const handleBatchDelete = () => {
    if (!hasSelection) return;
    Modal.confirm({
      title: `确认批量删除 ${store.selectedIds.length} 条辩题？`,
      content: '删除后不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await store.batchRemove(store.selectedIds);
        messageApi.success(`已删除 ${store.selectedIds.length} 条`);
        store.clearSelection();
        store.fetchList();
      }
    });
  };

  const handleBatchAddTag = async () => {
    if (!batchTagValue.trim() || !hasSelection) return;
    // 对每条选中项逐个 update（保留原 tags）
    messageApi.loading({ content: '处理中...', key: 'batchTag', duration: 0 });
    try {
      for (const id of store.selectedIds) {
        const t = store.items.find((x) => x.id === id);
        if (!t) continue;
        const newTags = Array.from(new Set([...(t.tags ?? []), batchTagValue.trim()]));
        await store.update(id, { tags: newTags });
      }
      messageApi.success({ content: '已批量打标签', key: 'batchTag' });
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
      for (const id of store.selectedIds) {
        await store.update(id, { type: newType });
      }
      messageApi.success({ content: '已批量修改类型', key: 'batchType' });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchType' });
    }
  };

  const handleBatchChangeDifficulty = async (newDiff: string) => {
    if (!hasSelection) return;
    messageApi.loading({ content: '处理中...', key: 'batchDiff', duration: 0 });
    try {
      for (const id of store.selectedIds) {
        await store.update(id, { difficulty: newDiff });
      }
      messageApi.success({ content: '已批量修改难度', key: 'batchDiff' });
      store.clearSelection();
      store.fetchList();
    } catch (e) {
      messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchDiff' });
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
        </Sider>

        {/* 主区域 */}
        <Content style={{ padding: '0 16px 16px', overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              padding: 12,
              background: token.colorBgContainer,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            <Space size={8}>
              <Input
                allowClear
                size="middle"
                placeholder="搜索辩题标题关键词 (Ctrl+K)"
                prefix={<SearchOutlined />}
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
              <Button icon={<ReloadOutlined />} onClick={() => store.fetchList()}>
                刷新
              </Button>
            </Space>

            <Space size={8}>
              {hasSelection && (
                <>
                  <Text type="secondary">已选 {store.selectedIds.length} 项</Text>
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
              <Text>为选中的 {store.selectedIds.length} 条辩题添加标签：</Text>
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
              <Empty
                description={store.error ? `加载失败：${store.error}` : '暂无辩题'}
                style={{ marginTop: 80 }}
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
            ) : store.viewMode === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12
                }}
              >
                {store.items.map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    selected={store.selectedIds.includes(t.id)}
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
                  const isSelected = store.selectedIds.includes(t.id);
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
              count={store.selectedIds.length}
              style={{ backgroundColor: token.colorPrimary }}
            />
            <Text strong>已选 {store.selectedIds.length} 项</Text>
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

      {/* 去重检查弹窗 */}
      <DedupResultModal
        open={dedupOpen}
        onClose={() => setDedupOpen(false)}
        onRerun={() => store.fetchList()}
      />
    </>
  );
}
