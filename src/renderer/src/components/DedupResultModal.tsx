import { useEffect, useState } from 'react';
import {
  Modal,
  Button,
  Space,
  Table,
  Empty,
  Spin,
  Typography,
  Tag,
  Alert,
  Popconfirm,
  message,
  Statistic,
  Card,
  Row,
  Col,
  Result
} from 'antd';
import {
  DeleteOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type {
  DedupRunResult,
  DuplicateGroup,
  Topic
} from '../../../shared/types';

const { Text } = Typography;

export interface DedupResultModalProps {
  open: boolean;
  onClose: () => void;
  /** 父组件触发重新检查 */
  onRerun?: () => void;
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  exact: { label: '完全相同', color: 'red' },
  levenshtein: { label: '编辑距离', color: 'orange' },
  keyword: { label: '关键词重合', color: 'gold' },
  ai: { label: 'AI 语义', color: 'purple' }
};

export default function DedupResultModal({
  open,
  onClose,
  onRerun
}: DedupResultModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<DedupRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每组内勾选要删除的 topic id
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const res = await window.dedupAPI.run();
      if (!res.success || !res.data) {
        throw new Error(res.error || '去重检查失败');
      }
      setResult(res.data);
      // 默认每组保留第一条，其余勾选
      const defaultSelected = new Set<string>();
      for (const g of res.data.groups) {
        if (g.topics.length > 1) {
          for (let i = 1; i < g.topics.length; i++) {
            defaultSelected.add(g.topics[i].id);
          }
        }
      }
      setSelectedIds(defaultSelected);
    } catch (e) {
      setError(e instanceof Error ? e.message : '去重检查失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !result && !loading) {
      void runCheck();
    }
    if (!open) {
      // 关闭时重置状态
      setResult(null);
      setError(null);
      setSelectedIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) {
      messageApi.warning('请先勾选要删除的辩题');
      return;
    }
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await window.dedupAPI.deleteTopics(ids);
      if (!res.success) {
        throw new Error(res.error || '删除失败');
      }
      messageApi.success(`已删除 ${ids.length} 条重复辩题`);
      // 重新检查
      await runCheck();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // ---------- 渲染 ----------
  const renderGroupCard = (group: DuplicateGroup, index: number) => {
    const reason = REASON_LABELS[group.reason] ?? { label: group.reason, color: 'default' };
    const tableColumns: ColumnsType<Topic> = [
      {
        title: '',
        key: 'select',
        width: 40,
        render: (_: any, record: Topic) => {
          const checked = selectedIds.has(record.id);
          // 每组至少保留一条，所以已选中的可取消，未选中的可选
          return (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => handleToggleSelect(record.id)}
            />
          );
        }
      },
      {
        title: '标题',
        dataIndex: 'title',
        key: 'title'
      },
      {
        title: '来源',
        dataIndex: 'source',
        key: 'source',
        width: 130,
        render: (v: string | null) => v ?? <Text type="secondary">-</Text>
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 160,
        render: (v: string | null) =>
          v ? new Date(v).toLocaleString('zh-CN') : <Text type="secondary">-</Text>
      }
    ];

    return (
      <Card
        key={group.id}
        size="small"
        title={
          <Space>
            <Text strong>组 {index + 1}</Text>
            <Tag color={reason.color}>{reason.label}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              相似度 {(group.similarity * 100).toFixed(0)}%
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {group.topics.length} 条
            </Text>
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        <Table
          columns={tableColumns}
          dataSource={group.topics}
          rowKey="id"
          size="small"
          pagination={false}
        />
      </Card>
    );
  };

  return (
    <>
      {contextHolder}
      <Modal
        title="去重检查"
        open={open}
        onCancel={onClose}
        width={920}
        footer={
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button icon={<ReloadOutlined />} onClick={runCheck} loading={loading}>
              重新检查
          </Button>
            {result && result.groups.length > 0 && (
              <Popconfirm
                title={`确认删除选中的 ${selectedIds.size} 条辩题？`}
                description="删除后不可恢复"
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={handleDelete}
              >
                <Button
                  type="primary"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleting}
                  disabled={selectedIds.size === 0}
                >
                  删除选中 ({selectedIds.size})
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
        destroyOnClose
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin tip="正在检查全库重复..." />
          </div>
        ) : error ? (
          <Alert
            message="去重检查失败"
            description={error}
            type="error"
            showIcon
            action={
              <Button size="small" onClick={runCheck}>
                重试
              </Button>
            }
          />
        ) : !result ? (
          <Empty description="尚未检查" />
        ) : (
          <div>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="题库总数"
                    value={result.totalCount}
                    prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="重复题数"
                    value={result.duplicateCount}
                    prefix={<WarningOutlined style={{ color: '#faad14' }} />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="重复组数"
                    value={result.groups.length}
                    prefix={<WarningOutlined style={{ color: '#1677ff' }} />}
                  />
                </Card>
              </Col>
            </Row>

            {result.groups.length === 0 ? (
              <Result
                status="success"
                title="未发现重复辩题"
                subTitle={`已检查 ${result.totalCount} 条辩题`}
              />
            ) : (
              <div>
                <Alert
                  message="操作提示"
                  description="默认勾选每组中除第一条外的所有辩题，可手动调整勾选项后批量删除。每组至少应保留一条。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                />
                <div style={{ maxHeight: 480, overflow: 'auto', paddingRight: 8 }}>
                  {result.groups.map((g, i) => renderGroupCard(g, i))}
                </div>
              </div>
            )}
          </div>
        )}
        {onRerun && <span style={{ display: 'none' }}>{onRerun.toString()}</span>}
      </Modal>
    </>
  );
}
