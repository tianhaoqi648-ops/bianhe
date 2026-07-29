// ============================================================
// HotkeySettingsTab.tsx —— Settings 页面「快捷键」Tab 内容
//
// 集成：总开关 / 按 scope 分组的列表 / 录制 / 禁用 / 冲突检测 / 恢复默认
// 编辑策略：每次修改立即持久化（无「保存」按钮）
// 冲突策略：按作用域隔离 — 同 scope 同 combo 才视为冲突
// ============================================================

import { useMemo } from 'react'
import {
  Card,
  Switch,
  Button,
  Space,
  Alert,
  Typography,
  Row,
  Col,
  Popconfirm,
  Tag,
  theme
} from 'antd'
import { KeyOutlined, UndoOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../stores/settingsStore'
import {
  HOTKEY_PRESETS,
  SCOPE_LABELS,
  type HotkeyPreset
} from '../utils/hotkey-presets'
import {
  HOTKEY_SETTING_KEY,
  HOTKEY_MASTER_KEY,
  loadCustomMap,
  loadMasterEnabled,
  getEffectiveCombo,
  getEffectivePresets,
  isPresetDisabled,
  findConflicts,
  serializeCustomMap,
  type HotkeyCustomMap,
  type EffectivePreset
} from '../utils/hotkey-config'
import HotkeyRecorder from './HotkeyRecorder'
import { useToast } from '../hooks/useToast'
import { spacing } from '../styles/tokens'

const { Text } = Typography

/** 按 SCOPE_LABELS 顺序排列的作用域列表 */
const ORDERED_SCOPES = Object.keys(SCOPE_LABELS)

export default function HotkeySettingsTab() {
  const { token } = theme.useToken()
  const settings = useSettingsStore((s) => s.settings)
  const settingsStore = useSettingsStore()
  const toast = useToast()

  const customMap = useMemo(() => loadCustomMap(settings), [settings])
  const masterEnabled = useMemo(() => loadMasterEnabled(settings), [settings])
  const conflicts = useMemo(() => findConflicts(customMap), [customMap])

  const effectivePresets = useMemo(
    () => getEffectivePresets(customMap),
    [customMap]
  )

  // 按 scope 分组
  const grouped = useMemo(() => {
    const groups: Record<string, EffectivePreset[]> = {}
    for (const scope of ORDERED_SCOPES) groups[scope] = []
    for (const p of effectivePresets) {
      if (!groups[p.scope]) groups[p.scope] = []
      groups[p.scope].push(p)
    }
    return groups
  }, [effectivePresets])

  // 持久化 customMap
  const persistCustomMap = (next: HotkeyCustomMap) => {
    void settingsStore.set(HOTKEY_SETTING_KEY, serializeCustomMap(next))
  }

  /** 录制新 combo — 同 scope 冲突检测 */
  const handleComboChange = (preset: HotkeyPreset, newCombo: string) => {
    // 检测同 scope 冲突：忽略自身、已禁用项
    const conflictPreset = HOTKEY_PRESETS.find((p) => {
      if (p.id === preset.id) return false
      if (p.scope !== preset.scope) return false
      if (isPresetDisabled(p.id, customMap)) return false
      return getEffectiveCombo(p.id, customMap) === newCombo
    })
    if (conflictPreset) {
      toast.error(
        `该组合已在当前作用域内被「${conflictPreset.description}」占用，请选择其他组合`
      )
      return
    }

    const next: HotkeyCustomMap = {
      ...customMap,
      [preset.id]: { ...customMap[preset.id], combo: newCombo }
    }
    persistCustomMap(next)
    toast.success('已更新')
  }

  /** 切换单项禁用 */
  const handleToggleDisable = (preset: HotkeyPreset, disabled: boolean) => {
    const next: HotkeyCustomMap = { ...customMap }
    const existing = next[preset.id]
    const updated = { ...existing, disabled }
    // 若 combo 与 disabled 都缺省，删除 key 保持 map 紧凑
    if (!updated.combo && !updated.disabled) {
      delete next[preset.id]
    } else {
      next[preset.id] = updated
    }
    persistCustomMap(next)
    toast.success(disabled ? '已禁用' : '已启用')
  }

  /** 恢复单项默认 combo */
  const handleResetOne = (preset: HotkeyPreset) => {
    const next: HotkeyCustomMap = { ...customMap }
    const existing = next[preset.id]
    if (existing) {
      delete existing.combo
      if (!existing.disabled) delete next[preset.id]
    }
    persistCustomMap(next)
    toast.success('已恢复默认')
  }

  /** 切换总开关 */
  const handleToggleMaster = (enabled: boolean) => {
    void settingsStore.set(HOTKEY_MASTER_KEY, enabled)
  }

  /** 恢复全部默认（仅清空 customMap，不影响总开关） */
  const handleResetAll = () => {
    void settingsStore.delete(HOTKEY_SETTING_KEY)
    toast.success('已恢复全部默认组合')
  }

  // 冲突列表渲染
  const conflictList = Object.entries(conflicts).flatMap(([id, others]) =>
    others.map((otherId) => {
      const a = HOTKEY_PRESETS.find((p) => p.id === id)
      const b = HOTKEY_PRESETS.find((p) => p.id === otherId)
      if (!a || !b) return null
      return `${SCOPE_LABELS[a.scope] ?? a.scope} · ${a.description} ⇄ ${b.description}`
    }).filter(Boolean)
  )

  return (
    <>
        {/* 冲突提示（仅 findConflicts 非空时显示） */}
        {conflictList.length > 0 && (
          <Alert
            type="error"
            showIcon
            message={`检测到 ${conflictList.length} 处同作用域冲突`}
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {conflictList.map((c, i) => (
                  <li key={i} style={{ fontSize: 12 }}>{c}</li>
                ))}
              </ul>
            }
            style={{ marginBottom: spacing.md }}
          />
        )}

        {/* 顶部工具栏：总开关 + 恢复全部默认 */}
        <Card size="small" style={{ marginBottom: spacing.md }}>
          <Row align="middle" justify="space-between">
            <Col>
              <Space>
                <Switch
                  checked={masterEnabled}
                  onChange={handleToggleMaster}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                />
                <Text strong>启用快捷键系统</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  （关闭后所有快捷键失效）
                </Text>
              </Space>
            </Col>
            <Col>
              <Popconfirm
                title="确认恢复全部默认？"
                description="将清除所有自定义组合与禁用状态，不影响总开关"
                onConfirm={handleResetAll}
                okText="确认"
                cancelText="取消"
              >
                <Button icon={<UndoOutlined />} size="small">
                  恢复全部默认
                </Button>
              </Popconfirm>
            </Col>
          </Row>
        </Card>

        {/* 总开关关闭时的警告 */}
        {!masterEnabled && (
          <Alert
            type="warning"
            showIcon
            message="快捷键系统已禁用"
            description="所有快捷键均不会触发。如需恢复，请打开上方总开关。"
            style={{ marginBottom: spacing.md }}
          />
        )}

        {/* 按 SCOPE_LABELS 顺序分组渲染 */}
        {ORDERED_SCOPES.map((scope) => {
          const list = grouped[scope] ?? []
          if (list.length === 0) return null
          const label = SCOPE_LABELS[scope] ?? scope
          return (
            <Card
              key={scope}
              size="small"
              title={
                <Space>
                  <KeyOutlined style={{ color: token.colorPrimary }} />
                  <span>{label}</span>
                  <Tag color="blue" style={{ marginLeft: 4 }}>
                    {list.length}
                  </Tag>
                </Space>
              }
              style={{ marginBottom: spacing.md }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((preset) => {
                  const isConflicted = conflicts[preset.id]?.length > 0
                  return (
                    <Row
                      key={preset.id}
                      align="middle"
                      justify="space-between"
                      style={{
                        padding: `${spacing.xs} 0`,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        opacity: masterEnabled ? 1 : 0.5
                      }}
                    >
                      <Col flex="auto">
                        <Space direction="vertical" size={0}>
                          <Space size={6}>
                            <Text>{preset.description}</Text>
                            {isConflicted && (
                              <Tag color="error" style={{ fontSize: 11 }}>
                                冲突
                              </Tag>
                            )}
                            {preset.disabled && (
                              <Tag color="default" style={{ fontSize: 11 }}>
                                已禁用
                              </Tag>
                            )}
                          </Space>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            默认：{preset.combo}
                          </Text>
                        </Space>
                      </Col>
                      <Col flex="none">
                        <Space size={12}>
                          <HotkeyRecorder
                            value={preset.effectiveCombo}
                            defaultCombo={preset.combo}
                            onChange={(combo) =>
                              handleComboChange(preset, combo)
                            }
                            onReset={() => handleResetOne(preset)}
                            disabled={!masterEnabled || preset.disabled}
                          />
                          <Switch
                            checked={!preset.disabled}
                            onChange={(checked) =>
                              handleToggleDisable(preset, !checked)
                            }
                            disabled={!masterEnabled}
                            size="small"
                          />
                        </Space>
                      </Col>
                    </Row>
                  )
                })}
              </div>
            </Card>
          )
        })}
    </>
  )
}
