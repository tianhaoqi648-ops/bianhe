// src/renderer/src/components/import/FieldMappingPanel.tsx
// ============================================================
// FieldMappingPanel — 未识别列绑定 UI
//
// 在 ImportTopicsModal Step 2a 阶段显示。对每个未识别列让用户选择：
//   - ignore：忽略该列
//   - bind：绑定到已有字段（系统字段或已存在的自定义字段）
//   - create：创建新自定义字段（string 或 tags 类型）
//
// 选 create 时同步调 onCreateField 持久化到 DB，避免重复创建。
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { Card, Select, Input, Radio, Space, Typography, Alert, Divider, Tag } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type {
  FieldMapping,
  FieldMappingAction,
  CustomField,
  CustomFieldType,
  FieldDefinition
} from '../../../../shared/types'

const { Text, Title } = Typography

export interface FieldMappingPanelProps {
  /** 未识别的原始表头列名 */
  unmatchedColumns: string[]
  /** 已识别列的映射（原始表头 → 系统字段 key），用于只读展示与重新绑定 */
  matchedMappings?: Record<string, string>
  /** 系统字段定义（用于「绑定到已有字段」选项） */
  systemFields: FieldDefinition[]
  /** 已存在的自定义字段（用于「绑定到已有字段」选项） */
  customFields: CustomField[]
  /** 初始 mapping（一般空对象） */
  initialMapping?: FieldMapping
  /** mapping 变化回调 */
  onMappingChange: (mapping: FieldMapping) => void
  /** 创建新自定义字段的回调（持久化到 DB） */
  onCreateField: (label: string, type: CustomFieldType) => Promise<CustomField>
}

export default function FieldMappingPanel({
  unmatchedColumns,
  matchedMappings = {},
  systemFields,
  customFields,
  initialMapping = {},
  onMappingChange,
  onCreateField
}: FieldMappingPanelProps) {
  const [mapping, setMapping] = useState<FieldMapping>(initialMapping)
  const [creating, setCreating] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editingMatched, setEditingMatched] = useState<Record<string, boolean>>({})

  // Bug 3.7: 异步操作 mounted 守卫
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const matchedEntries = Object.entries(matchedMappings)
  if (unmatchedColumns.length === 0 && matchedEntries.length === 0) return null

  // Bug 5.12: 用 useMemo 缓存 bindTargets
  const bindTargets = useMemo(() => {
    const bindable = systemFields.filter(
      (f) => f.isCountable && f.key !== 'tags' && f.key !== 'batch_id'
    )
    const targets: Array<{ value: string; label: string; group: string }> = [
      ...bindable.map((f) => ({
        value: f.key,
        label: `${f.label}（系统）`,
        group: '系统字段'
      })),
      ...customFields.map((f) => ({
        value: f.field_key,
        label: `${f.field_label}（自定义）`,
        group: '自定义字段'
      }))
    ]
    return targets
  }, [systemFields, customFields])

  // Bug 1.1: 显式调用 onMappingChange 的辅助函数，替代 useEffect 同步器
  const updateMapping = (updater: (prev: FieldMapping) => FieldMapping): void => {
    setMapping((prev) => {
      const next = updater(prev)
      onMappingChange(next)
      return next
    })
  }

  const updateAction = (column: string, action: FieldMappingAction) => {
    updateMapping((prev) => ({ ...prev, [column]: action }))
    setErrors((prev) => ({ ...prev, [column]: '' }))
  }

  const handleCreateField = async (column: string, label: string, type: CustomFieldType) => {
    if (!label.trim()) {
      setErrors((prev) => ({ ...prev, [column]: '字段名不能为空' }))
      return
    }
    setCreating((prev) => ({ ...prev, [column]: true }))
    try {
      const created = await onCreateField(label, type)
      // Bug 3.7: 异步操作后检查 mounted
      if (!mountedRef.current) return
      // 创建成功后改为 bind 到新字段
      updateMapping((prev) => ({
        ...prev,
        [column]: { kind: 'bind', fieldKey: created.field_key }
      }))
      setErrors((prev) => ({ ...prev, [column]: '' }))
    } catch (e) {
      if (!mountedRef.current) return
      // Bug 5.11: 创建失败时把 mapping[column] 改回 ignore，避免残留 create 状态
      setErrors((prev) => ({
        ...prev,
        [column]: e instanceof Error ? e.message : '创建失败'
      }))
      updateMapping((prev) => ({ ...prev, [column]: { kind: 'ignore' } }))
    } finally {
      if (mountedRef.current) {
        setCreating((prev) => ({ ...prev, [column]: false }))
      }
    }
  }

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Title level={5} style={{ margin: 0 }}>
          <LinkOutlined style={{ marginRight: 6, color: '#1677ff' }} />
          字段映射
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {matchedEntries.length} 个已识别 + {unmatchedColumns.length} 个未识别
        </Text>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 8, fontSize: 12 }}
        message={
          unmatchedColumns.length > 0
            ? '文件中存在未识别的列，请选择处理方式：'
            : '已识别列默认使用系统映射，可点击「重新绑定」调整：'
        }
        description={
          unmatchedColumns.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              <li><b>忽略</b>：丢弃该列数据</li>
              <li><b>绑定已有字段</b>：把值写入已存在的系统/自定义字段</li>
              <li><b>创建新字段</b>：新建自定义字段并写入值（自动接入分类树/筛选/编辑）</li>
            </ul>
          ) : undefined
        }
      />
      {matchedEntries.length > 0 && (
        <>
          <Divider orientation="left" plain style={{ margin: '8px 0' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已识别列（可重新绑定）
            </Text>
          </Divider>
          {matchedEntries.map(([column, fieldKey]) => {
            const fieldDef = systemFields.find((f) => f.key === fieldKey)
            const isEditing = editingMatched[column] ?? false
            const editAction = mapping[column] ?? { kind: 'bind' as const, fieldKey }
            return (
              <div
                key={`matched-${column}`}
                style={{
                  marginBottom: 8,
                  padding: '8px 12px',
                  background: '#f6ffed',
                  borderRadius: 4
                }}
              >
                <Space style={{ width: '100%' }} align="start">
                  <Tag color="green" style={{ minWidth: 100, textAlign: 'center' }}>
                    {column}
                  </Tag>
                  {!isEditing ? (
                    <>
                      <Tag color="blue" style={{ minWidth: 100, textAlign: 'center' }}>
                        → {fieldDef?.label ?? fieldKey}
                      </Tag>
                      <a
                        style={{ fontSize: 12 }}
                        onClick={() => setEditingMatched((prev) => ({ ...prev, [column]: true }))}
                      >
                        重新绑定
                      </a>
                    </>
                  ) : (
                    <>
                      <Select
                        size="small"
                        style={{ width: 150 }}
                        value={editAction.kind === 'bind' ? editAction.fieldKey : fieldKey}
                        onChange={(v: string) => {
                          // 用户新选择的 fieldKey 作为 bind 覆盖写入 mapping，
                          // 父组件 onMappingChange 会触发 applyFieldMapping 重新解析
                          updateMapping((prev) => ({ ...prev, [column]: { kind: 'bind', fieldKey: v } }))
                          setEditingMatched((prev) => ({ ...prev, [column]: false }))
                        }}
                        options={bindTargets}
                        showSearch
                        optionFilterProp="label"
                      />
                      <a
                        style={{ fontSize: 12 }}
                        onClick={() => {
                          setEditingMatched((prev) => ({ ...prev, [column]: false }))
                          // 清除该列的 mapping 覆盖，恢复原识别
                          updateMapping((prev) => {
                            const next = { ...prev }
                            delete next[column]
                            return next
                          })
                        }}
                      >
                        取消
                      </a>
                    </>
                  )}
                </Space>
              </div>
            )
          })}
        </>
      )}
      {unmatchedColumns.map((column) => {
        const action = mapping[column] ?? { kind: 'ignore' as const }
        const error = errors[column] ?? ''
        const isCreating = creating[column] ?? false
        // Bug 5.9: bindTargets 为空时禁用"绑定已有字段"选项
        const canBind = bindTargets.length > 0
        return (
          <div
            key={column}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              background: '#fafafa',
              borderRadius: 4
            }}
          >
            <Space style={{ width: '100%' }} align="start">
              <Tag color="blue" style={{ minWidth: 100, textAlign: 'center' }}>
                {column}
              </Tag>
              <Select
                size="small"
                style={{ width: 150 }}
                value={action.kind}
                onChange={(v) => {
                  if (v === 'ignore') updateAction(column, { kind: 'ignore' })
                  else if (v === 'bind') {
                    if (!canBind) return
                    updateAction(column, {
                      kind: 'bind',
                      fieldKey: bindTargets[0]?.value ?? ''
                    })
                  } else if (v === 'create') {
                    updateAction(column, {
                      kind: 'create',
                      fieldLabel: column,
                      fieldType: 'string'
                    })
                  }
                }}
                options={[
                  { value: 'ignore', label: '忽略' },
                  { value: 'bind', label: '绑定已有字段', disabled: !canBind },
                  { value: 'create', label: '创建新字段' }
                ]}
              />
              {action.kind === 'bind' && (
                <Select
                  size="small"
                  style={{ width: 200 }}
                  value={action.fieldKey}
                  onChange={(v) => updateAction(column, { kind: 'bind', fieldKey: v })}
                  options={bindTargets}
                  showSearch
                  optionFilterProp="label"
                />
              )}
              {action.kind === 'create' && (
                <Space direction="vertical" size={4}>
                  <Space>
                    <Input
                      size="small"
                      style={{ width: 150 }}
                      placeholder="字段显示名"
                      value={action.fieldLabel}
                      onChange={(e) =>
                        updateAction(column, {
                          kind: 'create',
                          fieldLabel: e.target.value,
                          fieldType: action.fieldType
                        })
                      }
                    />
                    <Radio.Group
                      size="small"
                      value={action.fieldType}
                      onChange={(e) =>
                        updateAction(column, {
                          kind: 'create',
                          fieldLabel: action.fieldLabel,
                          fieldType: e.target.value
                        })
                      }
                    >
                      <Radio.Button value="string">文本</Radio.Button>
                      <Radio.Button value="tags">标签</Radio.Button>
                    </Radio.Group>
                    <a
                      // Bug 5.10: 创建中禁用点击防重复
                      onClick={() => {
                        if (!isCreating) handleCreateField(column, action.fieldLabel, action.fieldType)
                      }}
                      style={{
                        fontSize: 12,
                        pointerEvents: isCreating ? 'none' : 'auto',
                        opacity: isCreating ? 0.5 : 1
                      }}
                    >
                      {isCreating ? '创建中...' : '确认创建'}
                    </a>
                  </Space>
                </Space>
              )}
            </Space>
            {error && (
              <Text type="danger" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                {error}
              </Text>
            )}
          </div>
        )
      })}
      <Divider style={{ margin: '8px 0' }} />
      <Text type="secondary" style={{ fontSize: 11 }}>
        提示：创建新字段后将自动出现在分类树、筛选面板、辩题编辑表单中。
      </Text>
    </Card>
  )
}
