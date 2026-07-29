// ============================================================
// StageCard.tsx — 单环节卡片（辨之竹风格）
// 显示：序号 + 环节名 + 发言方 Tag + 时长 + 铃声数 + 操作按钮
// Task 7.5：显示「不计时」Tag（timingMode === 'untimed'）
// Task 8.1/8.2：新增「试听铃声」按钮，依次播放该环节 bells（按 atMs 升序，间隔 1s）
// Task 12.3：dragHandleProps / listeners 分离，grip handle 改为 <button> 无障碍
// Task 12.4：保留上下箭头按钮（type="text" 次要样式），键盘用户仍可排序
// Task 13.1：新增「复制」按钮
// Task 13.2：多选模式显示 Checkbox
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Card, Tag, Space, Button, Typography, Tooltip, Checkbox, theme as antdTheme } from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  BellOutlined,
  HolderOutlined,
  SoundOutlined,
  StopOutlined,
  CopyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import type { StageDef, StageSide } from '../../../../shared/debate-formats/types'
import { colorPrimary, colorGold, fontSize } from '../../styles/tokens'
import { useSoundManager } from '../SoundManager'

const { Text } = Typography

const SIDE_LABELS: Record<StageSide, string> = {
  aff: '正方', neg: '反方', both: '双方',
  og: '上院政府', oo: '上院反对', cg: '下院政府', co: '下院反对'
}

const SIDE_COLORS: Record<StageSide, string> = {
  aff: 'blue', neg: 'red', both: 'purple',
  og: 'blue', oo: 'red', cg: 'cyan', co: 'orange'
}

interface StageCardProps {
  stage: StageDef
  index: number
  /** 环节总数（用于禁用末尾"下移"按钮） */
  total: number
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  /** @dnd-kit 拖拽 handle 的 aria/role/tabIndex 属性 */
  dragHandleProps?: DraggableAttributes
  /** @dnd-kit 拖拽事件 listeners（指针/键盘事件） */
  listeners?: DraggableSyntheticListeners
  /** 上移环节（键盘可达性备选方案） */
  onMoveUp?: () => void
  /** 下移环节（键盘可达性备选方案） */
  onMoveDown?: () => void
  /** 复制环节到剪贴板 */
  onCopy?: () => void
  /** 多选模式开启时显示 Checkbox */
  selectable?: boolean
  /** 当前是否被多选选中 */
  selected?: boolean
  /** 多选切换回调 */
  onSelectToggle?: (checked: boolean) => void
  /** 计时模式 Tag 快捷切换回调（点击 Tag 时调用） */
  onTimingModeToggle?: () => void
}

export default function StageCard({
  stage,
  index,
  total,
  isEditing,
  onEdit,
  onDelete,
  dragHandleProps,
  listeners,
  onMoveUp,
  onMoveDown,
  onCopy,
  selectable,
  selected,
  onSelectToggle,
  onTimingModeToggle
}: StageCardProps) {
  const { token } = antdTheme.useToken()
  const { playBell } = useSoundManager()
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [handleHovered, setHandleHovered] = useState(false)
  const previewTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // 卸载时清理所有定时器，避免内存泄漏与状态泄漏
  useEffect(() => {
    return () => {
      previewTimersRef.current.forEach((t) => clearTimeout(t))
      previewTimersRef.current.clear()
    }
  }, [])

  const isUntimed = stage.timingMode === 'untimed'
  const minutes = Math.floor(stage.durationMs / 60000)
  const seconds = Math.floor((stage.durationMs % 60000) / 1000)
  const timeStr = isUntimed
    ? '不计时'
    : seconds > 0
      ? `${minutes}分${seconds}秒`
      : `${minutes}分钟`

  /** 试听铃声：依次播放该环节 bells（按 atMs 升序），间隔约 1 秒 */
  const handlePreviewBells = (e: React.MouseEvent) => {
    e.stopPropagation()
    // 再次点击：停止试听（清除定时器与状态；内置合成音无法中途停止）
    if (isPreviewing) {
      previewTimersRef.current.forEach((t) => clearTimeout(t))
      previewTimersRef.current.clear()
      setIsPreviewing(false)
      return
    }
    if (stage.bells.length === 0) return
    setIsPreviewing(true)
    // 按 atMs 升序播放，间隔约 1 秒，让用户能区分不同铃声
    const sortedBells = [...stage.bells].sort((a, b) => a.atMs - b.atMs)
    sortedBells.forEach((bell, idx) => {
      const timer = setTimeout(() => {
        void playBell(bell)
        previewTimersRef.current.delete(timer)
        // 最后一个铃声播放后，延迟 1 秒清除播放状态
        if (idx === sortedBells.length - 1) {
          const clearTimer = setTimeout(() => {
            setIsPreviewing(false)
            previewTimersRef.current.delete(clearTimer)
          }, 1000)
          previewTimersRef.current.add(clearTimer)
        }
      }, idx * 1000)
      previewTimersRef.current.add(timer)
    })
  }

  return (
    <Card
      size="small"
      className="card-hover"
      style={{
        marginBottom: 8,
        border: isEditing
          ? `2px solid ${colorPrimary}`
          : `1px solid ${token.colorBorderSecondary}`,
        cursor: 'pointer',
        background: selected ? token.colorPrimaryBg : undefined
      }}
      onClick={onEdit}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {selectable && (
          <Checkbox
            checked={selected}
            onChange={(e) => onSelectToggle?.(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`选择环节 ${stage.name}`}
          />
        )}
        {/* Task 12.3：grip handle 改为 <button>，aria-label 无障碍 */}
        <button
          type="button"
          {...dragHandleProps}
          {...listeners}
          aria-label={`拖拽排序 ${stage.name}`}
          style={{
            cursor: handleHovered ? 'grabbing' : 'grab',
            color: handleHovered ? token.colorText : token.colorTextTertiary,
            background: handleHovered ? token.colorFillQuaternary : 'transparent',
            border: 'none',
            padding: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            transition: 'color 0.15s, background 0.15s'
          }}
          onMouseEnter={() => setHandleHovered(true)}
          onMouseLeave={() => setHandleHovered(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <HolderOutlined />
        </button>
        <Text strong style={{ minWidth: 24 }}>{index + 1}.</Text>
        <div style={{ flex: 1 }}>
          <Space direction="vertical" size={0}>
            <Space>
              <Text strong>{stage.name}</Text>
              <Tag color={SIDE_COLORS[stage.side]}>{SIDE_LABELS[stage.side]}</Tag>
              {stage.isFreeDebate && <Tag color="purple">自由辩论</Tag>}
              <Tag
                color={isUntimed ? 'default' : 'blue'}
                style={{ cursor: onTimingModeToggle ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (!onTimingModeToggle) return
                  e.stopPropagation()
                  onTimingModeToggle()
                }}
              >
                {isUntimed ? '不计时' : '倒计时'}
              </Tag>
              {stage.isBellPreview && (
                <Tag color={colorGold} style={{ color: '#fff', fontWeight: 600 }}>
                  🔔 铃声试听
                </Tag>
              )}
              {stage.graceMs && !isUntimed && <Tag color="orange">宽限 {stage.graceMs / 1000}s</Tag>}
            </Space>
            <Space size="small">
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>⏱ {timeStr}</Text>
              {stage.bells.length > 0 && (
                <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                  <BellOutlined /> {stage.bells.length} 个铃响点
                </Text>
              )}
            </Space>
          </Space>
        </div>
        <Space size={0}>
          {/* Task 8.1：试听铃声按钮（与 BellPreviewModal 互补，不替代） */}
          <Tooltip title={stage.bells.length === 0 ? '请先添加铃响点' : (isPreviewing ? '停止试听' : '试听铃声')}>
            <Button
              type="default"
              size="small"
              danger={isPreviewing}
              icon={isPreviewing ? <StopOutlined /> : <SoundOutlined />}
              onClick={handlePreviewBells}
              disabled={stage.bells.length === 0}
            >
              {isPreviewing ? '停止' : '试听'}
            </Button>
          </Tooltip>
          {/* Task 12.4：上下箭头按钮（次要 type="text"，键盘可达性备选） */}
          {onMoveUp && (
            <Tooltip title="上移">
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={index === 0}
                onClick={(e) => { e.stopPropagation(); onMoveUp() }}
                aria-label={`上移环节 ${stage.name}`}
              />
            </Tooltip>
          )}
          {onMoveDown && (
            <Tooltip title="下移">
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={index === total - 1}
                onClick={(e) => { e.stopPropagation(); onMoveDown() }}
                aria-label={`下移环节 ${stage.name}`}
              />
            </Tooltip>
          )}
          {/* Task 13.1：复制按钮 */}
          {onCopy && (
            <Tooltip title="复制环节">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={(e) => { e.stopPropagation(); onCopy() }}
                aria-label={`复制环节 ${stage.name}`}
              />
            </Tooltip>
          )}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            aria-label={`编辑环节 ${stage.name}`}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            aria-label={`删除环节 ${stage.name}`}
          />
        </Space>
      </div>
    </Card>
  )
}
