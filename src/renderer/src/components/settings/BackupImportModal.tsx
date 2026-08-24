// ============================================================
// BackupImportModal.tsx — 一键还原弹窗
//
// 全量数据恢复：选择 JSON 备份文件 → 预览 → 选择冲突策略 → 导入。
// 三种冲突策略：清空后重建（危险）/ 跳过已存在 ID / 覆盖已存在 ID。
// 「清空后重建」需强确认（输入"确认恢复"四字）。
// ============================================================

import { useState } from 'react'
import {
  Modal,
  Button,
  Alert,
  Space,
  Typography,
  Descriptions,
  Radio,
  Checkbox,
  Input,
  Row,
  Col,
  Card,
  Tag
} from 'antd'
import { CloudDownloadOutlined, FileOutlined, WarningOutlined } from '@ant-design/icons'
import { BACKUP_CATEGORIES, SUPPORTED_BACKUP_VERSION } from '../../../../shared/constants'
import type { BackupCategory, BackupImportStrategy, BackupPreviewResult } from '../../../../shared/types'
import { useToast } from '../../hooks/useToast'
import { spacing } from '../../styles/tokens'
import { version as APP_VERSION } from '../../../../../package.json'
import { useTopicStore } from '../../stores/topicStore'
import { useEventStore } from '../../stores/eventStore'
import { useDrawStore } from '../../stores/drawStore'
import { useFormatStore } from '../../stores/formatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTimerStore } from '../../stores/timerStore'

const { Text, Paragraph } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

const STRATEGY_LABELS: Record<BackupImportStrategy, string> = {
  clear_rebuild: '清空后重建',
  skip_existing: '跳过已存在 ID',
  overwrite_existing: '覆盖已存在 ID'
}

const STRATEGY_DESCRIPTIONS: Record<BackupImportStrategy, string> = {
  clear_rebuild: '先清空本地对应类别的所有数据，再从备份文件插入。风险最高，建议先备份当前数据。',
  skip_existing: '保留本地已存在的同 ID 记录，仅插入新记录。最安全。',
  overwrite_existing: '同 ID 记录被备份文件覆盖，新记录插入。中等风险。'
}

function getCategoryLabel(key: BackupCategory): string {
  return BACKUP_CATEGORIES.find((c) => c.key === key)?.label ?? key
}

function getCategoryTables(key: BackupCategory): readonly string[] {
  return BACKUP_CATEGORIES.find((c) => c.key === key)?.tables ?? []
}

export default function BackupImportModal({ open, onClose }: Props) {
  const toast = useToast()
  const [filePath, setFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<BackupPreviewResult | null>(null)
  const [strategy, setStrategy] = useState<BackupImportStrategy>('skip_existing')
  const [categories, setCategories] = useState<BackupCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const handlePickFile = async () => {
    setLoading(true)
    try {
      const picked = await window.fileAPI.pickFile([
        { name: '辩盒备份文件', extensions: ['json'] }
      ])
      if (!picked.success || !picked.data) {
        setLoading(false)
        return
      }
      setFilePath(picked.data)
      const backup = window.electron?.backup
      if (!backup) {
        toast.error('备份 API 不可用')
        setLoading(false)
        return
      }
      const res = await backup.previewImport(picked.data)
      if (res.success && res.data) {
        setPreview(res.data)
        setCategories(res.data.categories)
      } else {
        setPreview(null)
        toast.error(res.error || '解析备份文件失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '选择文件失败')
    } finally {
      setLoading(false)
    }
  }

  const doImport = async () => {
    if (!filePath || !preview) return
    setImporting(true)
    setConfirmModalOpen(false)
    try {
      const backup = window.electron?.backup
      if (!backup) {
        toast.error('备份 API 不可用')
        return
      }
      const res = await backup.import({ filePath, strategy, categories })
      if (res.success && res.data) {
        const {
          inserted,
          skipped,
          overwritten,
          bellFilesRestored,
          badgeFilesRestored,
          fkInvalid,
          fkViolationCount,
          fkViolations
        } = res.data
        let msg = ''
        if (strategy === 'clear_rebuild') {
          msg = `已恢复 ${inserted} 条数据`
        } else if (strategy === 'skip_existing') {
          msg = `新增 ${inserted} 条，跳过 ${skipped} 条已存在`
        } else {
          msg = `覆盖 ${overwritten} 条数据`
        }
        if (bellFilesRestored > 0) {
          msg += `，${bellFilesRestored} 个铃声文件`
        }
        if (badgeFilesRestored > 0) {
          msg += `，${badgeFilesRestored} 个队徽文件`
        }
        // governance 1.2：恢复后外键校验发现孤立引用 → 明确提示「部分恢复」而非静默成功
        if (fkInvalid) {
          const sample = (fkViolations || []).slice(0, 3).join('；')
          toast.error(
            `恢复完成但外键校验失败：存在 ${fkViolationCount} 处孤立引用（${sample}），数据可能不完整，请谨慎使用。`
          )
        } else {
          toast.success(msg)
        }
        // P1-15 修复：导入成功后刷新所有 stores，确保 UI 与新数据一致
        // 各 store 刷新方法名不同：topicStore.fetchList / eventStore.listEvents /
        // drawStore.listSessions / formatStore.fetchAll / settingsStore.fetchAll / timerStore.fetchSessions
        void useTopicStore.getState().fetchList()
        void useEventStore.getState().listEvents()
        void useDrawStore.getState().listSessions()
        void useFormatStore.getState().fetchAll()
        void useSettingsStore.getState().fetchAll()
        void useTimerStore.getState().fetchSessions()
        // 重置状态并关闭
        setFilePath(null)
        setPreview(null)
        setCategories([])
        setStrategy('skip_existing')
        setConfirmText('')
        onClose()
      } else {
        toast.error(res.error || '导入失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleImport = async () => {
    if (!filePath || !preview) return
    // 清空后重建需要强确认
    if (strategy === 'clear_rebuild') {
      setConfirmModalOpen(true)
      setConfirmText('')
      return
    }
    await doImport()
  }

  const versionIncompatible = preview !== null && preview.version !== SUPPORTED_BACKUP_VERSION
  // appVersion 不一致（黄色警告，不阻断导入）
  const appVersionMismatch = preview !== null && preview.appVersion !== APP_VERSION

  const handleModalClose = () => {
    setFilePath(null)
    setPreview(null)
    setCategories([])
    setStrategy('skip_existing')
    setConfirmText('')
    onClose()
  }

  return (
    <>
      <Modal
        title={
          <Space>
            <CloudDownloadOutlined />
            一键还原
          </Space>
        }
        open={open}
        onCancel={handleModalClose}
        width={720}
        footer={
          <Space>
            <Button onClick={handleModalClose}>取消</Button>
            <Button
              type="primary"
              danger={strategy === 'clear_rebuild'}
              loading={importing}
              disabled={!filePath || !preview || versionIncompatible || categories.length === 0}
              onClick={handleImport}
            >
              开始导入
            </Button>
          </Space>
        }
      >
        <Alert
          message="从备份文件恢复数据"
          description="选择 .json 备份文件，预览内容后选择冲突策略并导入。"
          type="info"
          showIcon
          style={{ marginBottom: spacing.md }}
        />

        {/* 文件选择 */}
        <Space style={{ marginBottom: spacing.md, width: '100%' }}>
          <Button icon={<FileOutlined />} loading={loading} onClick={handlePickFile}>
            选择备份文件
          </Button>
          {filePath && (
            <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              {filePath}
            </Text>
          )}
        </Space>

        {/* 预览信息 */}
        {preview && (
          <>
            <Descriptions
              size="small"
              bordered
              column={2}
              style={{ marginBottom: spacing.md }}
            >
              <Descriptions.Item label="版本">{preview.version}</Descriptions.Item>
              <Descriptions.Item label="应用版本">{preview.appVersion}</Descriptions.Item>
              <Descriptions.Item label="导出时间" span={2}>
                {new Date(preview.exportedAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
            </Descriptions>

            {versionIncompatible && (
              <Alert
                message={`备份文件版本 ${preview.version} 不被支持，当前支持版本 ${SUPPORTED_BACKUP_VERSION}`}
                type="error"
                showIcon
                style={{ marginBottom: spacing.md }}
              />
            )}

            {appVersionMismatch && !versionIncompatible && (
              <Alert
                message={`备份文件由 v${preview.appVersion} 生成，与当前版本可能存在差异，建议谨慎导入`}
                type="warning"
                showIcon
                style={{ marginBottom: spacing.md }}
              />
            )}

            {/* 类别勾选 */}
            <Text strong>选择要导入的类别：</Text>
            <Checkbox.Group
              value={categories}
              onChange={(values) => setCategories(values as BackupCategory[])}
              disabled={versionIncompatible}
              style={{ width: '100%', marginTop: 8, marginBottom: spacing.md }}
            >
              <Row gutter={[8, 8]}>
                {preview.categories.map((cat) => {
                  const label = getCategoryLabel(cat)
                  const tables = getCategoryTables(cat)
                  // 统计该类别下的总条数
                  const count = tables.reduce(
                    (sum, t) => sum + (preview.tableCounts[t] || 0),
                    0
                  )
                  return (
                    <Col span={12} key={cat}>
                      <Card size="small" bodyStyle={{ padding: 10 }}>
                        <Checkbox value={cat}>
                          <Text strong>{label}</Text>
                          <Tag color="blue" style={{ marginLeft: 8 }}>
                            {count} 条
                          </Tag>
                        </Checkbox>
                      </Card>
                    </Col>
                  )
                })}
              </Row>
            </Checkbox.Group>

            {/* 冲突策略 */}
            <Text strong>冲突处理策略：</Text>
            <Radio.Group
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              disabled={versionIncompatible}
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: 8,
                marginBottom: spacing.md
              }}
            >
              {(Object.keys(STRATEGY_LABELS) as BackupImportStrategy[]).map((s) => (
                <Radio key={s} value={s} style={{ marginBottom: 4 }}>
                  <Text strong>{STRATEGY_LABELS[s]}</Text>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    {STRATEGY_DESCRIPTIONS[s]}
                  </Text>
                </Radio>
              ))}
            </Radio.Group>

            {strategy === 'clear_rebuild' && (
              <Alert
                message="危险操作"
                description={
                  <>
                    <Paragraph style={{ marginBottom: 8 }}>
                      清空后重建将删除本地所选类别的所有数据，再从备份文件插入。此操作不可撤销，建议先做一次全量备份。
                    </Paragraph>
                    <Paragraph type="warning" style={{ marginBottom: 0 }}>
                      注意：由于数据库外键级联，清空辩题将同时删除队伍历史；清空赛事将同时删除队伍、抽签明细等关联数据。
                    </Paragraph>
                  </>
                }
                type="error"
                showIcon
                icon={<WarningOutlined />}
                style={{ marginBottom: spacing.md }}
              />
            )}
          </>
        )}
      </Modal>

      {/* 强确认 Modal */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#ff4d4f' }} /> 确认清空后重建
          </Space>
        }
        open={confirmModalOpen}
        onCancel={() => setConfirmModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setConfirmModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              danger
              disabled={confirmText !== '确认恢复'}
              loading={importing}
              onClick={doImport}
            >
              确认恢复
            </Button>
          </Space>
        }
      >
        <Alert
          message="此操作将清空本地所选类别的所有数据，并从备份文件恢复。不可撤销！"
          type="error"
          showIcon
          style={{ marginBottom: spacing.md }}
        />
        <Paragraph>
          请输入 <Text strong code>确认恢复</Text> 四个字以确认操作：
        </Paragraph>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="确认恢复"
        />
      </Modal>
    </>
  )
}
