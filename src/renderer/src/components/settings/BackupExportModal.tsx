// ============================================================
// BackupExportModal.tsx — 一键备份弹窗
//
// 全量数据备份：勾选类别 → 调用 backup.export → 写入 JSON 备份文件。
// 与「自动备份管理」（.db 文件级）相互独立，此为业务数据 JSON 级备份。
// ============================================================

import { useEffect, useState } from 'react'
import { Modal, Checkbox, Button, Alert, Space, Typography, Row, Col, Card } from 'antd'
import { CloudUploadOutlined } from '@ant-design/icons'
import { BACKUP_CATEGORIES, DEFAULT_BACKUP_CATEGORIES } from '../../../../shared/constants'
import type { BackupCategory } from '../../../../shared/types'
import { useToast } from '../../hooks/useToast'
import { spacing } from '../../styles/tokens'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

export default function BackupExportModal({ open, onClose }: Props) {
  const toast = useToast()
  const [categories, setCategories] = useState<BackupCategory[]>([...DEFAULT_BACKUP_CATEGORIES])
  const [exporting, setExporting] = useState(false)
  const [stats, setStats] = useState<Record<string, number>>({})

  // 弹窗打开时拉取各类别本地条数统计
  useEffect(() => {
    if (!open) return
    const backup = window.electron?.backup
    if (!backup) return
    backup
      .stats()
      .then((res) => {
        if (res.success && res.data) {
          setStats(res.data)
        }
      })
      .catch(() => {
        // 静默失败，不影响弹窗使用
      })
  }, [open])

  const handleExport = async () => {
    if (categories.length === 0) {
      toast.warning('请至少选择一个类别')
      return
    }
    setExporting(true)
    try {
      const backup = window.electron?.backup
      if (!backup) {
        toast.error('备份 API 不可用')
        return
      }
      const res = await backup.export({ categories })
      if (res.success && res.data) {
        const { filePath, totalRecords, bellFilesCount } = res.data
        toast.success(
          `已备份到 ${filePath}，共 ${totalRecords} 条数据${
            bellFilesCount > 0 ? `，${bellFilesCount} 个铃声文件` : ''
          }`
        )
        onClose()
      } else {
        if (res.error === '用户取消保存') {
          toast.info('已取消')
        } else {
          toast.error(res.error || '备份失败')
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '备份失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <CloudUploadOutlined />
          一键备份
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={exporting}
            disabled={categories.length === 0}
            onClick={handleExport}
          >
            开始备份
          </Button>
        </Space>
      }
    >
      <Alert
        message="选择要备份的数据类别"
        description="勾选需要备份的类别，将打包为单一 JSON 文件。可用于迁移到其他设备或恢复数据。"
        type="info"
        showIcon
        style={{ marginBottom: spacing.md }}
      />
      <Checkbox.Group
        value={categories}
        onChange={(values) => setCategories(values as BackupCategory[])}
        style={{ width: '100%' }}
      >
        <Row gutter={[12, 12]}>
          {BACKUP_CATEGORIES.map((cat) => (
            <Col span={12} key={cat.key}>
              <Card size="small" style={{ height: '100%' }} bodyStyle={{ padding: 12 }}>
                <Checkbox value={cat.key}>
                  <Text strong>{cat.label}</Text>
                </Checkbox>
                <div style={{ marginTop: 4, paddingLeft: 24 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {cat.tables.join('、')}
                  </Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      共 {stats[cat.key] ?? 0} 条
                    </Text>
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Checkbox.Group>
      <Alert
        message="备份文件包含所选类别的所有数据，可用于迁移到其他设备或恢复数据"
        type="info"
        style={{ marginTop: spacing.md }}
      />
    </Modal>
  )
}
