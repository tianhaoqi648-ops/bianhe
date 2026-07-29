// ============================================================
// HotkeyRecorder.tsx —— 按键录制组件
//
// 用于 HotkeySettingsTab 中每行快捷键的录制 / 清除 / 恢复默认。
// 录制态下挂载临时 keydown 监听，按 Escape 取消录制；
// 单独 Escape 不作为快捷键（已有 global::escape 预设无需录制）。
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { Input, Button, Space } from 'antd'
import { formatCombo } from '../utils/hotkey-presets'
import { parseCombo } from '../utils/hotkey-manager'

export interface HotkeyRecorderProps {
  /** 当前生效的 combo，如 'ctrl+k' */
  value: string
  /** 默认 combo，用于判断「恢复默认」按钮是否显示 */
  defaultCombo: string
  /** 录制成功回调 */
  onChange: (combo: string) => void
  /** 「恢复默认」按钮回调，不传则不显示该按钮 */
  onReset?: () => void
  /** 整行被禁用（如总开关关闭时） */
  disabled?: boolean
}

/** 修饰键集合，单独按下时忽略，等待用户继续按 */
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta'])

export default function HotkeyRecorder({
  value,
  defaultCombo,
  onChange,
  onReset,
  disabled
}: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false)

  const startRecord = useCallback(() => {
    if (disabled) return
    setRecording(true)
  }, [disabled])

  const cancelRecord = useCallback(() => {
    setRecording(false)
  }, [])

  // 录制态下挂载临时 keydown 监听
  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 阻止默认行为（避免按 Ctrl+S 触发保存、F5 刷新等）
      e.preventDefault()
      e.stopPropagation()

      const combo = parseCombo(e)
      const parts = combo.split('+')
      const lastKey = parts[parts.length - 1]

      // 修饰键单独按下：忽略，等待用户继续按
      if (MODIFIER_KEYS.has(lastKey)) return

      // 单独 Escape：取消录制，不作为快捷键
      if (combo === 'escape') {
        setRecording(false)
        return
      }

      // 接受其他所有组合（单字符 / 修饰键+字符 / 方向键 / 功能键等）
      onChange(combo)
      setRecording(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [recording, onChange])

  const showResetButton = onReset && value !== defaultCombo

  return (
    <Space size={4} style={{ width: '100%' }}>
      <Input
        readOnly
        size="small"
        value={recording ? '按下任意键组合…' : formatCombo(value)}
        placeholder={recording ? '按下任意键组合…' : ''}
        disabled={disabled}
        style={{
          width: 150,
          fontFamily: recording ? undefined : 'monospace',
          fontSize: 12,
          color: recording ? '#999' : undefined,
          fontStyle: recording ? 'italic' : undefined,
          cursor: 'default'
        }}
      />
      {recording ? (
        <Button size="small" type="link" onClick={cancelRecord}>
          取消
        </Button>
      ) : (
        <Space size={0}>
          <Button
            size="small"
            type="link"
            onClick={startRecord}
            disabled={disabled}
          >
            录制
          </Button>
          {showResetButton && (
            <Button
              size="small"
              type="link"
              onClick={onReset}
              disabled={disabled}
              style={{ color: '#8c8c8c' }}
            >
              恢复默认
            </Button>
          )}
        </Space>
      )}
    </Space>
  )
}
