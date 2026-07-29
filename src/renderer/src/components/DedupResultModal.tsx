import { useEffect, useState } from 'react';
import {
 Modal,
  Button,
  Space,
  Typography,
  Tag,
  Alert,
  Popconfirm,
  Statistic,
  Card,
  Row,
  Col,
  Result,
  Progress,
  Checkbox,
  theme
} from 'antd';
import BrandSpin from './common/BrandSpin';
import EmptyState from './common/EmptyState';
import {
  DeleteOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type {
  DedupRunResult,
  DuplicateGroup,
  Topic
} from '../../../shared/types';
import { spacing } from '../styles/tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { loadTagDisplayConfig } from '../utils/tagDisplay';
import { useToast } from '../hooks/useToast';

const { Text, Paragraph } = Typography;

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
  const { token } = theme.useToken();
  const settings = useSettingsStore((s) => s.settings);
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<DedupRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每组内勾选要删除的 topic id
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // dedup 场景配置：source_type 类别开关控制 source 文字显隐
  const dedupCfg = loadTagDisplayConfig(settings).scenes.dedup;
  const showSource = dedupCfg.categoryEnabled.source_type;

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
      toast.warning('请先勾选要删除的辩题');
      return;
    }
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await window.dedupAPI.deleteTopics(ids);
      if (!res.success) {
        throw new Error(res.error || '删除失败');
      }
      toast.success(`已删除 ${ids.length} 条重复辩题`);
      // 重新检查
      await runCheck();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // ---------- 渲染 ----------
  const renderGroupCard = (group: DuplicateGroup, index: number) => {
    const reason = REASON_LABELS[group.reason] ?? { label: group.reason, color: 'default' };
    const similarityPct = Math.round(group.similarity * 100);

    return (
      <Card
        key={group.id}
        size="small"
        title={
          <Space>
            <Text strong>组 {index + 1}</Text>
            <Tag color={reason.color}>{reason.label}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {group.topics.length} 条
            </Text>
          </Space>
        }
        style={{ marginBottom: spacing.md }}
      >
        {/* 相似度进度条 */}
        <div style={{ marginBottom: spacing.md }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              相似度
            </Text>
            <Text strong style={{ color: token.colorPrimary }}>
              {similarityPct}%
            </Text>
          </div>
          <Progress
            percent={similarityPct}
            size="small"
            status={similarityPct >= 90 ? 'exception' : similarityPct >= 70 ? 'active' : 'normal'}
            showInfo={false}
          />
        </div>

        {/* 成员列表：Space + Typography */}
        <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
          {group.topics.map((topic: Topic, i: number) => {
            const checked = selectedIds.has(topic.id);
            return (
              <div
                key={topic.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: spacing.sm,
                  padding: `${spacing.sm} ${spacing.md}`,
                  background: checked
                    ? token.colorFillAlter
                    : token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 6
                }}
              >
                <Checkbox
                  checked={checked}
                  onChange={() => handleToggleSelect(topic.id)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Paragraph
                    style={{
                      margin: 0,
                      fontWeight: i === 0 ? 500 : 400,
                      color: i === 0 ? token.colorText : token.colorTextSecondary
                    }}
                  >
                    {i === 0 && (
                      <Tag color="green" style={{ marginRight: 6 }}>
                        保留
                      </Tag>
                    )}
                    {topic.title}
                  </Paragraph>
                  <Space size={spacing.sm} style={{ marginTop: 4, fontSize: 12 }}>
                    {showSource && (
                      <Text type="secondary">{topic.source ?? '未知来源'}</Text>
                    )}
                    {topic.created_at && (
                      <Text type="secondary">
                        {new Date(topic.created_at).toLocaleString('zh-CN')}
                      </Text>
                    )}
                  </Space>
                </div>
              </div>
            );
          })}
        </Space>
      </Card>
    );
  };

  return (
    <>
      <Modal
        title="去重检查"
        open={open}
        onCancel={onClose}
        width={920}
        footer={
          <Space>
            <Button size="middle" onClick={onClose}>
              关闭
            </Button>
            <Button
              size="middle"
              icon={<ReloadOutlined />}
              onClick={runCheck}
              loading={loading}
            >
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
                  size="middle"
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
            <BrandSpin tip="正在检查全库重复..." />
          </div>
        ) : error ? (
          <Alert
            message="去重检查失败"
            description={error}
            type="error"
            showIcon
            action={
              <Button size="middle" onClick={runCheck}>
                重试
              </Button>
            }
          />
        ) : !result ? (
          <EmptyState type="default" description="尚未检查" />
        ) : (
          <div>
            <Row gutter={spacing.md} style={{ marginBottom: spacing.md }}>
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
                  style={{ marginBottom: spacing.md }}
                />
                <div style={{ maxHeight: 480, overflow: 'auto', paddingRight: spacing.sm }}>
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
