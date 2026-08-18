// ============================================================
// BatchEditHistoryModal.tsx — 批量编辑历史弹窗
//
// 仿 ImportHistoryModal 风格，列出最近 20 次批量编辑记录。
// 支持按快照撤销，撤销后历史保留并标记"已撤销"。
// ============================================================

import { useEffect, useState } from 'react'
import {
  Modal,
  Table,
  Button,
  Popconfirm,
  Tag,
  Space,
  Tooltip,
  Typography
} from 'antd'
import { HistoryOutlined, UndoOutlined } from '@ant-design/icons'
import BrandSpin from './common/BrandSpin'
import EmptyState from './common/EmptyState'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import type { BatchEditHistory } from '../../../shared/types'
import { useBatchEditStore } from '../stores/batchEditStore'
import { useToast } from '../hooks/useToast'
import { spacing } from '../styles/tokens'

const { Text } = Typography

export interface BatchEditHistoryModalProps {
  open: boolean
  onClose: () => void
  /** 撤销成功后回调，让父组件刷新题库列表 */
  onSuccess?: () => void
}

export default function BatchEditHistoryModal({
  open,
  onClose,
  onSuccess
}: BatchEditHistoryModalProps) {
  const toast = useToast()
  const { historyList, historyLoading, fetchHistory, revert } = useBatchEditStore()
  const [revokingId, setRevokingId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      void fetchHistory()
    }
  }, [open, fetchHistory])

  const handleRevert = async (historyId: string) => {
    setRevokingId(historyId)
    try {
      const result = await revert(historyId)
      if (!result) {
        throw new Error('撤销失败：未获取到结果')
      }
      toast.success(`已撤销，恢复 ${result.restoredCount} 条辩题`)
      onSuccess?.()
      await fetchHistory()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '撤销失败')
    } finally {
      setRevokingId(null)
    }
  }

  const columns: ColumnsType<BatchEditHistory> = [
    {
      title: '执行时间',
      dataIndex: 'executed_at',
      key: 'executed_at',
      width: 150,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {dayjs(v).format('YYYY-MM-DD HH:mm')}
        </Text>
      )
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
      ellipsis: true,
      render: (v: string | null) => (
        <Tooltip title={v} placement="topLeft">
          <Text style={{ fontSize: 13 }}>{v ?? '-'}</Text>
        </Tooltip>
      )
    },
    {
      title: '影响',
      key: 'stats',
      width: 130,
      render: (_, r) => (
        <Space size={4}>
          <Tag color="blue" style={{ fontSize: 11 }}>
            {r.topic_count} 题
          </Tag>
          <Tag color="purple" style={{ fontSize: 11 }}>
            {r.field_count} 字段
          </Tag>
        </Space>
      )
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_, r) =>
        r.reverted ? (
          <Tag color="default">已撤销</Tag>
        ) : (
          <Tag color="success">生效中</Tag>
        )
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_, r) => (
        <Popconfirm
          title="撤销该次批量编辑？"
          description={`将按快照恢复 ${r.topic_count} 条辩题的字段值`}
          okText="撤销"
          okType="danger"
          cancelText="取消"
          onConfirm={() => handleRevert(r.id)}
          disabled={r.reverted || revokingId === r.id}
        >
          <Button
            size="small"
            type="link"
            danger
            icon={<UndoOutlined />}
            loading={revokingId === r.id}
            disabled={r.reverted}
          >
            撤销
          </Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <>
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>批量编辑历史</span>
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
        destroyOnHidden
      >
        <BrandSpin spinning={historyLoading}>
          {historyList.length === 0 ? (
            <div style={{ padding: `${spacing.xxxl} 0` }}>
              <EmptyState type="default" description="暂无批量编辑记录" />
            </div>
          ) : (
            <>
              <div style={{ marginBottom: spacing.md }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {historyList.length} 条记录（最多保留最近 20 条）。点击「撤销」按快照恢复字段值。
                </Text>
              </div>
              <Table
                columns={columns}
                dataSource={historyList}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false }}
                scroll={{ x: 700 }}
              />
            </>
          )}
        </BrandSpin>
      </Modal>
    </>
  )
}
