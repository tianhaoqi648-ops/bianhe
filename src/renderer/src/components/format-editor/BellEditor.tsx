// ============================================================
// BellEditor.tsx — 铃响点列表编辑器
// 支持 4 种内置音 + 自定义铃声（从 bellAPI 加载）
// 每条铃声右侧提供「试听」按钮（内置音和自定义铃声均可试听）
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { Button, Space, Select, InputNumber, Popconfirm, Tag, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, SoundOutlined, StopOutlined } from '@ant-design/icons'
import type { BellDef } from '../../../../shared/debate-formats/types'
import type { BellAsset } from '../../../../shared/debate-formats/types'
import EmptyState from '../common/EmptyState'
import { useSoundManager } from '../SoundManager'
import { useToast } from '../../hooks/useToast'

interface BellEditorProps {
  value: BellDef[]
  onChange: (bells: BellDef[]) => void
}

export default function BellEditor({ value, onChange }: BellEditorProps) {
  const [customBells, setCustomBells] = useState<BellAsset[]>([])
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const { playBell } = useSoundManager()
  const toast = useToast()

  useEffect(() => {
    void window.bellAPI.list().then((res) => {
      if (res.success && res.data) setCustomBells(res.data)
    })
  }, [])

  // 卸载时清理所有定时器，避免内存泄漏与状态泄漏
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  const soundOptions = [
    { label: '电子 beep', value: 'beep' },
    { label: '单声铃', value: 'bell' },
    { label: '双声铃', value: 'double_bell' },
    { label: '时间到', value: 'time_up' },
    ...customBells.map((b) => ({ label: `🎵 ${b.name}`, value: `custom:${b.id}` }))
  ]

  const addBell = () => {
    onChange([...value, { atMs: 30 * 1000, sound: 'beep' }])
  }

  const updateBell = (idx: number, patch: Partial<BellDef>) => {
    const next = value.map((b, i) => (i === idx ? { ...b, ...patch } : b))
    next.sort((a, b) => b.atMs - a.atMs)
    onChange(next)
  }

  const removeBell = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  /** 试听铃声：内置音与自定义音统一走 playBell */
  const handlePreview = (bell: BellDef, key: string) => {
    // 再次点击同一条：停止（清除 UI 状态；内置音为合成音无法中途停止）
    if (playingKey === key) {
      setPlayingKey(null)
      return
    }
    void playBell(bell).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : '未知错误'
      toast.error(`试听失败：${msg}`)
    })
    setPlayingKey(key)
    // 内置音最长约 900ms；自定义音给 3s 展示播放状态
    const isCustom = bell.sound.startsWith('custom:') || !!bell.customBellId
    const durationMs = isCustom ? 3000 : 1500
    const timer = setTimeout(() => {
      setPlayingKey((cur) => (cur === key ? null : cur))
      timersRef.current.delete(timer)
    }, durationMs)
    timersRef.current.add(timer)
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {value.length === 0 && <EmptyState type="bell" description="无铃响点" size="small" />}
      {value.map((bell, idx) => {
        const key = `bell-${idx}`
        const isCurrentPlaying = playingKey === key
        const isCustom = bell.sound.startsWith('custom:')
        return (
          <Space key={idx} wrap align="center">
            <InputNumber
              min={0}
              max={3600}
              step={1}
              value={bell.atMs / 1000}
              onChange={(v) => updateBell(idx, { atMs: (v ?? 0) * 1000 })}
              formatter={(v) => {
                const sec = v ?? 0
                return sec > 0 ? `剩余 ${sec} 秒` : '时间到'
              }}
              parser={(v) => Number(v?.replace(/[^0-9]/g, '') || 0)}
              style={{ width: 140 }}
            />
            <span>时播放</span>
            <Select
              value={bell.sound}
              onChange={(v) =>
                updateBell(idx, {
                  sound: v,
                  customBellId: v.startsWith('custom:') ? v.split(':')[1] : undefined
                })
              }
              options={soundOptions}
              style={{ width: 150 }}
            />
            {isCustom && <Tag color="purple">自定义</Tag>}
            <Tooltip title={isCurrentPlaying ? '停止试听' : '试听此铃声'}>
              <Button
                type="text"
                size="small"
                icon={isCurrentPlaying ? <StopOutlined /> : <SoundOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  handlePreview(bell, key)
                }}
              />
            </Tooltip>
            <Popconfirm title="删除此铃响点？" onConfirm={() => removeBell(idx)}>
              <Button type="link" danger icon={<DeleteOutlined />} size="small" />
            </Popconfirm>
          </Space>
        )
      })}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addBell} block>
        添加铃响点
      </Button>
    </Space>
  )
}
