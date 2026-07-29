// ============================================================
// BackupManageModal.tsx — 备份管理弹窗
//
// P3.4 Task 20.4：数据备份管理 UI
//   - 表格列：文件名 / 大小（KB）/ 时间 / 操作（恢复 / 删除）
//   - "恢复"按钮：弹出确认 Modal → backup.restore(filename) → Toast "请重启应用"
//   - "删除"按钮：直接删除 + 刷新列表
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { Modal, Table, Button, Space, Popconfirm, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { RollbackOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import type { BackupInfo } from '../../../shared/types'
import { useToast } from '../hooks/useToast'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

/** 格式化文件大小为 KB / MB */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 格式化 ISO 时间为本地可读格式 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return iso
  }
}

export default function BackupManageModal({ open, onClose }: Props) {
  const toast = useToast()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  /** 拉取备份列表 */
  const fetchBackups = useCallback(async () => {
    setLoading(true)
    try {
      const backup = window.electron?.backup
      if (!backup) {
        setBackups([])
        toast.error('备份 API 不可用')
        return
      }
      const res = await backup.list()
      if (res.success && res.data) {
        setBackups(res.data)
      } else {
        setBackups([])
        if (res.error) toast.warning(res.error)
      }
    } catch (e) {
      setBackups([])
      toast.error(e instanceof Error ? e.message : '加载备份列表失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  // 打开弹窗时拉取列表
  useEffect(() => {
    if (open) {
      void fetchBackups()
    }
  }, [open, fetchBackups])

  /** 恢复备份（带二次确认） */
  const handleRestore = async (filename: string) => {
    setRestoring(filename)
    try {
      const backupApi = window.electron?.backup
      if (!backupApi) {
        toast.error('备份 API 不可用')
        return
      }
      const res = await backupApi.restore(filename)
      if (res.success) {
        toast.success('已恢复备份，请重启应用以加载恢复后的数据')
        // 恢复后刷新列表（mtime 可能变化）
        await fetchBackups()
      } else {
        toast.error(res.error || '恢复失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '恢复失败')
    } finally {
      setRestoring(null)
    }
  }

  /** 删除备份 */
  const handleDelete = async (filename: string) => {
    setDeleting(filename)
    try {
      const backup = window.electron?.backup
      if (!backup) {
        toast.error('备份 API 不可用')
        return
      }
      const res = await backup.delete(filename)
      if (res.success) {
        toast.success('已删除备份')
        await fetchBackups()
      } else {
        toast.error(res.error || '删除失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const columns: ColumnsType<BackupInfo> = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
      render: (name: string) => <Text code>{name}</Text>
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number) => formatSize(size)
    },
    {
      title: '时间',
      dataIndex: 'mtime',
      key: 'mtime',
      width: 180,
      render: (mtime: string) => formatTime(mtime)
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: BackupInfo) => (
        <Space size="small">
          <Popconfirm
            title="恢复备份"
            description="恢复将覆盖当前数据，是否继续？"
            onConfirm={() => handleRestore(record.filename)}
            okText="确认恢复"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              type="link"
              icon={<RollbackOutlined />}
              loading={restoring === record.filename}
            >
              恢复
            </Button>
          </Popconfirm>
          <Popconfirm
            title="删除备份"
            description={`确认删除 ${record.filename}？`}
            onConfirm={() => handleDelete(record.filename)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={deleting === record.filename}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Modal
      title="管理备份"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => fetchBackups()} loading={loading}>
            刷新
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
      width={680}
    >
      <Table<BackupInfo>
        columns={columns}
        dataSource={backups}
        rowKey="filename"
        size="small"
        loading={loading}
        pagination={false}
        locale={{ emptyText: '暂无备份' }}
        style={{ marginTop: 8 }}
      />
      {backups.length === 0 && !loading && (
        <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          提示：应用启动时会自动备份（距上次备份超过 24 小时）。可在"数据管理"中点击"立即备份"手动创建。
        </Text>
      )}
    </Modal>
  )
}
