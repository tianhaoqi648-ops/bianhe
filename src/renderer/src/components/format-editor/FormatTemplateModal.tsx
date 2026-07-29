// ============================================================
// FormatTemplateModal.tsx — 赛制模板库 Modal（P3.3 Task 14）
//
// 8 个内置赛制模板的网格展示，用户可从中克隆为可编辑副本。
// 克隆时 stages 重新生成 uuid，名称后缀 "(模板副本)"，模板本身不变。
// ============================================================

import { useState } from 'react'
import type { CSSProperties, ComponentType } from 'react'
import { Modal, Row, Col, Card, Button, Typography, Tag, Space, theme as antdTheme, Tooltip } from 'antd'
import {
  TrophyOutlined,
  AimOutlined,
  GlobalOutlined,
  CompassOutlined,
  FlagOutlined,
  StarOutlined,
  ThunderboltOutlined,
  SolutionOutlined,
  GiftOutlined
} from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import { FORMAT_TEMPLATES, type FormatTemplateIcon } from '../../data/format-templates'
import type { StageDef } from '../../../../shared/debate-formats/types'
import { useFormatStore } from '../../stores/formatStore'
import { useToast } from '../../hooks/useToast'

const { Text, Paragraph } = Typography

interface FormatTemplateModalProps {
  open: boolean
  onClose: () => void
  /** 克隆成功后回调，参数为新赛制 id（用于切换到编辑态） */
  onSelect: (formatId: string) => void
}

/** 模板图标标识 → antd Icon 组件映射 */
const ICON_MAP: Record<FormatTemplateIcon, ComponentType<{ style?: CSSProperties }>> = {
  trophy: TrophyOutlined,
  aim: AimOutlined,
  global: GlobalOutlined,
  compass: CompassOutlined,
  flag: FlagOutlined,
  star: StarOutlined,
  thunderbolt: ThunderboltOutlined,
  solution: SolutionOutlined
}

/** 格式化总时长为可读字符串 */
function formatTotalDuration(stages: StageDef[]): string {
  const totalMs = stages.reduce((sum, s) => sum + s.durationMs, 0)
  const totalMin = Math.floor(totalMs / 60000)
  const totalSec = Math.floor((totalMs % 60000) / 1000)
  return totalSec > 0 ? `${totalMin}分${totalSec}秒` : `${totalMin}分钟`
}

export default function FormatTemplateModal({
  open,
  onClose,
  onSelect
}: FormatTemplateModalProps) {
  const formatStore = useFormatStore()
  const toast = useToast()
  const { token } = antdTheme.useToken()
  const [creatingId, setCreatingId] = useState<string | null>(null)

  const handleSelect = async (templateId: string): Promise<void> => {
    const template = FORMAT_TEMPLATES.find((t) => t.id === templateId)
    if (!template) return
    setCreatingId(templateId)
    try {
      // 克隆 stages 为可编辑副本：重新生成 id 避免与现有赛制冲突
      const clonedStages: StageDef[] = template.stages.map((s) => ({
        ...s,
        bells: s.bells.map((b) => ({ ...b })),
        id: uuidv4()
      }))
      const created = await formatStore.createFormat({
        name: `${template.name} (模板副本)`,
        description: template.description,
        formatData: {
          stages: clonedStages,
          totalDurationMs: clonedStages.reduce((sum, s) => sum + s.durationMs, 0)
        }
      })
      if (created) {
        toast.success(`已从模板创建：${created.name}`)
        onSelect(created.id)
        onClose()
      } else {
        toast.error('创建失败')
      }
    } finally {
      setCreatingId(null)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <GiftOutlined style={{ color: token.colorPrimary }} />
          <span>从模板创建</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      destroyOnClose
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        选择一个内置赛制模板，将克隆为可编辑副本（模板本身不会被修改）。
      </Paragraph>
      <Row gutter={[16, 16]}>
        {FORMAT_TEMPLATES.map((tpl) => {
          const Icon = ICON_MAP[tpl.icon]
          const totalDuration = formatTotalDuration(tpl.stages)
          const isCreating = creatingId === tpl.id
          return (
            <Col xs={24} sm={12} lg={8} key={tpl.id}>
              <Card
                size="small"
                hoverable
                style={{
                  height: '100%',
                  borderColor: token.colorBorderSecondary
                }}
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space align="center" size={8}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: token.colorPrimaryBg,
                        color: token.colorPrimary,
                        fontSize: 18
                      }}
                    >
                      <Icon />
                    </span>
                    <Text strong style={{ fontSize: 16 }}>{tpl.name}</Text>
                  </Space>
                  <Paragraph
                    type="secondary"
                    style={{ fontSize: 12, marginBottom: 0, minHeight: 32 }}
                  >
                    {tpl.description}
                  </Paragraph>
                  <Space size={4} wrap>
                    <Tag color="blue">{tpl.stages.length} 环节</Tag>
                    <Tag color="gold">总时长 {totalDuration}</Tag>
                  </Space>
                  <Tooltip title="克隆为可编辑副本">
                    <Button
                      type="primary"
                      block
                      size="small"
                      loading={isCreating}
                      onClick={() => void handleSelect(tpl.id)}
                    >
                      选择
                    </Button>
                  </Tooltip>
                </Space>
              </Card>
            </Col>
          )
        })}
      </Row>
    </Modal>
  )
}
