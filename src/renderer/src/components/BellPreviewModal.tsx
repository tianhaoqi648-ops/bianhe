// ============================================================
// BellPreviewModal.tsx — 赛前铃声试听
//
// 展示当前赛制铃声（按环节分组）+ 4 种内置铃声，
// 供比赛开始前验证铃声效果。
// 播放统一走 useSoundManager.playBell，内置音与自定义音均可试听。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Modal, Button, Space, Typography, Tag, Tooltip, Divider } from 'antd'
import { SoundOutlined, StopOutlined, BellOutlined } from '@ant-design/icons'
import EmptyState from './common/EmptyState'
import type { DebateFormat } from '../../../shared/types'
import type { BellDef, BellSound } from '../../../shared/debate-formats/types'
import { useSoundManager } from './SoundManager'
import { useToast } from '../hooks/useToast'

const { Text, Title } = Typography

interface BellPreviewModalProps {
  open: boolean
  onClose: () => void
  format: DebateFormat | null
}

/** 内置铃声展示配置：sound 枚举值 → 标签 + 期望播放时长（ms，用于 UI 状态展示） */
const BUILTIN_BELLS: Array<{ sound: BellSound; label: string; durationMs: number }> = [
  { sound: 'beep', label: '电子 beep', durationMs: 1500 },
  { sound: 'bell', label: '单声铃', durationMs: 1500 },
  { sound: 'double_bell', label: '双声铃', durationMs: 2500 },
  { sound: 'time_up', label: '时间到', durationMs: 3000 }
]

/** 获取铃声展示标签 */
function getSoundLabel(bell: BellDef): string {
  if (bell.sound.startsWith('custom:')) return '自定义'
  switch (bell.sound) {
    case 'beep':
      return '电子 beep'
    case 'bell':
      return '单声铃'
    case 'double_bell':
      return '双声铃'
    case 'time_up':
      return '时间到'
    default:
      return '未知'
  }
}

/** 格式化剩余毫秒为 "X 秒" 或 "0 秒（时间到）" */
function formatAt(atMs: number): string {
  if (atMs <= 0) return '时间到'
  const sec = Math.floor(atMs / 1000)
  return `剩余 ${sec} 秒`
}

export default function BellPreviewModal({ open, onClose, format }: BellPreviewModalProps) {
  const { playBell } = useSoundManager()
  const toast = useToast()
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // 卸载或关闭时清理所有定时器与状态
  useEffect(() => {
    if (!open) {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
      setPlayingKey(null)
    }
  }, [open])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  /** 试听铃声 */
  const handlePreview = (bell: BellDef, key: string, durationMs: number) => {
    // 再次点击同一条：停止（清除 UI 状态；内置合成音无法中途停止）
    if (playingKey === key) {
      setPlayingKey(null)
      return
    }
    void playBell(bell).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : '未知错误'
      toast.error(`试听失败：${msg}`)
    })
    setPlayingKey(key)
    const timer = setTimeout(() => {
      setPlayingKey((cur) => (cur === key ? null : cur))
      timersRef.current.delete(timer)
    }, durationMs)
    timersRef.current.add(timer)
  }

  const renderBellRow = (bell: BellDef, key: string) => {
    const isCurrentPlaying = playingKey === key
    const isCustom = bell.sound.startsWith('custom:')
    const durationMs = isCustom ? 3000 : 1500
    return (
      <div
        key={key}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 0',
          gap: 12
        }}
      >
        <Text type="secondary" style={{ fontSize: 12, minWidth: 80 }}>
          {formatAt(bell.atMs)}
        </Text>
        <Tag color={isCustom ? 'purple' : 'blue'} style={{ margin: 0 }}>
          {getSoundLabel(bell)}
        </Tag>
        <Tooltip title={isCurrentPlaying ? '停止试听' : '试听'}>
          <Button
            type="text"
            size="small"
            icon={isCurrentPlaying ? <StopOutlined /> : <SoundOutlined />}
            onClick={() => handlePreview(bell, key, durationMs)}
          />
        </Tooltip>
      </div>
    )
  }

  const hasFormatBells = format?.formatData.stages.some((s) => s.bells.length > 0) ?? false

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <BellOutlined />
          <span>铃声试听</span>
        </Space>
      }
      footer={null}
      width={640}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Text type="secondary">
          比赛开始前可在此快速验证铃声效果。点击「试听」按钮播放对应铃声。
        </Text>

        {/* 当前赛制铃声 */}
        <div>
          <Title level={5} style={{ marginTop: 0 }}>当前赛制铃声</Title>
          {!format ? (
            <EmptyState type="bell" description="未选择赛制" size="small" />
          ) : !hasFormatBells ? (
            <EmptyState type="bell" description="当前赛制未配置铃声" size="small" />
          ) : (
            format.formatData.stages.map((stage, stageIdx) => {
              if (stage.bells.length === 0) return null
              return (
                <div key={stage.id ?? stageIdx} style={{ marginBottom: 12 }}>
                  <Text strong>
                    {stageIdx + 1}. {stage.name}
                  </Text>
                  <div style={{ marginLeft: 12, marginTop: 4 }}>
                    {stage.bells.map((bell, bellIdx) =>
                      renderBellRow(bell, `stage-${stageIdx}-bell-${bellIdx}`)
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <Divider style={{ margin: '8px 0' }} />

        {/* 内置铃声 */}
        <div>
          <Title level={5} style={{ marginTop: 0 }}>内置铃声</Title>
          {BUILTIN_BELLS.map((item) => {
            const key = `builtin-${item.sound}`
            const isCurrentPlaying = playingKey === key
            const bell: BellDef = { atMs: 0, sound: item.sound }
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 0',
                  gap: 12
                }}
              >
                <Tag color="blue" style={{ margin: 0, minWidth: 80, textAlign: 'center' }}>
                  {item.label}
                </Tag>
                <Tooltip title={isCurrentPlaying ? '停止试听' : '试听'}>
                  <Button
                    type="text"
                    size="small"
                    icon={isCurrentPlaying ? <StopOutlined /> : <SoundOutlined />}
                    onClick={() => handlePreview(bell, key, item.durationMs)}
                  />
                </Tooltip>
              </div>
            )
          })}
        </div>
      </Space>
    </Modal>
  )
}
