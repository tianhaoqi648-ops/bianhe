import { useEffect, useState } from 'react';
import {
  Modal,
  Table,
  Button,
  Popconfirm,
  Empty,
  Badge,
  Space,
  Tooltip,
  Typography,
  Spin,
  message
} from 'antd';
import { EyeOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { ImportBatch } from '../../../shared/types';
import { spacing } from '../styles/tokens';

const { Text } = Typography;

export interface ImportHistoryModalProps {
  open: boolean;
  onClose: () => void;
  /** 撤销或刷新后触发，让父组件刷新题库列表 */
  onSuccess?: () => void;
  /** 点击「查看此批次」时回调，父组件用于设置 batch_id 筛选 */
  onViewBatch?: (batchId: string) => void;
}

export default function ImportHistoryModal({
  open,
  onClose,
  onSuccess,
  onViewBatch
}: ImportHistoryModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // ---------- 拉取批次列表 ----------
  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res = await window.importAPI.listBatches();
      if (!res.success || !res.data) {
        throw new Error(res.error || '加载失败');
      }
      setBatches(res.data);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '加载失败');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchBatches();
    }
  }, [open]);

  // ---------- 撤销整批 ----------
  const handleRevoke = async (batchId: string) => {
    setRevokingId(batchId);
    try {
      const res = await window.importAPI.revokeBatch(batchId);
      if (!res.success || !res.data) {
        throw new Error(res.error || '撤销失败');
      }
      messageApi.success(`已撤销该批次导入（删除 ${res.data.deletedCount} 条辩题）`);
      onSuccess?.();
      await fetchBatches();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setRevokingId(null);
    }
  };

  // ---------- 查看此批次 ----------
  const handleView = (batchId: string) => {
    onViewBatch?.(batchId);
    onClose();
  };

  // ---------- 表格列定义 ----------
  const columns: ColumnsType<ImportBatch> = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      width: 220,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text style={{ fontSize: 13 }}>{v || '(未命名)'}</Text>
        </Tooltip>
      )
    },
    {
      title: '导入时间',
      dataIndex: 'imported_at',
      key: 'imported_at',
      width: 150,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {dayjs(v).format('YYYY-MM-DD HH:mm')}
        </Text>
      )
    },
    {
      title: '导入 / 重复 / 失败',
      key: 'stats',
      width: 160,
      render: (_, r) => (
        <Space size={4}>
          <Text style={{ color: '#52c41a', fontSize: 12 }}>{r.imported_count}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>/</Text>
          <Text style={{ color: '#faad14', fontSize: 12 }}>{r.duplicates_count}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>/</Text>
          <Text style={{ color: r.failed_count > 0 ? '#ff4d4f' : '#d9d9d9', fontSize: 12 }}>
            {r.failed_count}
          </Text>
        </Space>
      )
    },
    {
      title: '当前剩余',
      key: 'remainingCount',
      width: 110,
      render: (_, r) => {
        const count = r.remainingCount ?? 0;
        return (
          <Badge
            count={count}
            showZero
            color={count === 0 ? '#d9d9d9' : '#1677ff'}
            overflowCount={9999}
            style={{ fontSize: 12 }}
          />
        );
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, r) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleView(r.id)}
          >
            查看
          </Button>
          <Popconfirm
            title="撤销该批次导入？"
            description={`将删除该批次当前剩余的 ${r.remainingCount ?? 0} 条辩题，不可恢复`}
            okText="撤销"
            okType="danger"
            cancelText="取消"
            onConfirm={() => handleRevoke(r.id)}
            disabled={revokingId === r.id || (r.remainingCount ?? 0) === 0}
          >
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={revokingId === r.id}
              disabled={(r.remainingCount ?? 0) === 0}
            >
              撤销
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>导入历史</span>
          </Space>
        }
        open={open}
        onCancel={onClose}
        width={820}
        footer={
          <Button size="middle" onClick={onClose}>
            关闭
          </Button>
        }
        destroyOnClose
      >
        <Spin spinning={loading}>
          {batches.length === 0 ? (
            <div style={{ padding: `${spacing.xxxl} 0` }}>
              <Empty description="暂无导入记录" />
            </div>
          ) : (
            <>
              <div style={{ marginBottom: spacing.md }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {batches.length} 条导入记录，按导入时间倒序排列。点击「查看」按批次筛选题库；点击「撤销」删除该批次剩余辩题。
                </Text>
              </div>
              <Table
                columns={columns}
                dataSource={batches}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false }}
                scroll={{ x: 700 }}
              />
            </>
          )}
        </Spin>
      </Modal>
    </>
  );
}
