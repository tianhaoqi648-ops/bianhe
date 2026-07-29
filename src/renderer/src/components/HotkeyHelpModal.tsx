// ============================================================
// HotkeyHelpModal.tsx —— 快捷键帮助弹窗
//
// 按 ? 触发，展示按作用域分组的快捷键列表。
// 显示用户自定义后的生效 combo（effectiveCombo），
// 已禁用项以灰色 Tag 标注；总开关关闭时顶部显示警告。
// ============================================================

import { useMemo } from 'react'
import { Modal, Typography, Tag, Divider, Alert } from 'antd'
import { SCOPE_LABELS, formatCombo } from '../utils/hotkey-presets'
import {
  loadCustomMap,
  loadMasterEnabled,
  getEffectivePresets,
  type EffectivePreset
} from '../utils/hotkey-config'
import { useSettingsStore } from '../stores/settingsStore'
import { spacing } from '../styles/tokens'

const { Text } = Typography

export interface HotkeyHelpModalProps {
  open: boolean
  onClose: () => void
}

/** 单个快捷键行 */
function HotkeyRow({ preset }: { preset: EffectivePreset }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${spacing.xs} 0`,
        opacity: preset.disabled ? 0.5 : 1
      }}
    >
      <Text style={{ fontSize: 13 }}>{preset.description}</Text>
      {preset.disabled ? (
        <Tag
          color="default"
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '2px 8px',
            margin: 0
          }}
        >
          已禁用
        </Tag>
      ) : (
        <Tag
          color="blue"
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '2px 8px',
            margin: 0
          }}
        >
          {formatCombo(preset.effectiveCombo)}
        </Tag>
      )}
    </div>
  )
}

/** 单个作用域分组 */
function ScopeGroup({
  scope,
  presets
}: {
  scope: string
  presets: EffectivePreset[]
}) {
  const label = SCOPE_LABELS[scope] ?? scope
  return (
    <div style={{ marginBottom: spacing.md }}>
      <Text
        strong
        style={{
          fontSize: 13,
          color: '#8c8c8c',
          textTransform: 'uppercase',
          letterSpacing: 0.5
        }}
      >
        {label}
      </Text>
      <Divider style={{ margin: `${spacing.xs} 0 ${spacing.sm}` }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {presets.map((preset) => (
          <HotkeyRow key={preset.id} preset={preset} />
        ))}
      </div>
    </div>
  )
}

export default function HotkeyHelpModal({ open, onClose }: HotkeyHelpModalProps) {
  const settings = useSettingsStore((s) => s.settings)
  const customMap = useMemo(() => loadCustomMap(settings), [settings])
  const masterEnabled = useMemo(() => loadMasterEnabled(settings), [settings])
  const effective = useMemo(() => getEffectivePresets(customMap), [customMap])

  // 按 scope 分组
  const grouped = useMemo(() => {
    const groups: Record<string, EffectivePreset[]> = {}
    for (const p of effective) {
      if (!groups[p.scope]) groups[p.scope] = []
      groups[p.scope].push(p)
    }
    return groups
  }, [effective])

  // 按 SCOPE_LABELS 的顺序排序，未知 scope 放最后
  const orderedScopes = Object.keys(grouped).sort((a, b) => {
    const idxA = Object.keys(SCOPE_LABELS).indexOf(a)
    const idxB = Object.keys(SCOPE_LABELS).indexOf(b)
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })

  return (
    <Modal
      title="快捷键帮助"
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      centered
    >
      <div style={{ maxHeight: 480, overflowY: 'auto', paddingRight: spacing.xs }}>
        {masterEnabled ? (
          <Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginBottom: spacing.md }}
          >
            输入框内输入时，单字符快捷键（如 R / F / ?）不会触发，仅 Ctrl+ / Shift+
            等修饰键组合生效。
          </Text>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="快捷键系统已被禁用"
            description="所有快捷键均不会触发。如需启用，请到「设置 → 快捷键」打开总开关。"
            style={{ marginBottom: spacing.md }}
          />
        )}
        {orderedScopes.map((scope) => (
          <ScopeGroup key={scope} scope={scope} presets={grouped[scope]} />
        ))}
      </div>
    </Modal>
  )
}
