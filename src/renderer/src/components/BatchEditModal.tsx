// ============================================================
// BatchEditModal.tsx — 批量编辑辩题弹窗
//
// 支持多字段同时编辑，每字段可选 replace/append/clear 模式。
// 系统字段从 FilterPanel 候选值加载，自定义字段从 customFieldOptions 加载。
// 提交时调用 onSubmit(actions)，由父组件解析 ids 并调用 store.execute。
// ============================================================

import { useState, useMemo } from 'react'
import {
  Modal,
  Alert,
  Select,
  InputNumber,
  Button,
  Space,
  Typography,
  Popconfirm,
  Divider
} from 'antd'
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons'
import type { CustomField, BatchEditFieldAction } from '../../../shared/types'
import {
  TYPE_OPTIONS,
  DOMAIN_OPTIONS,
  DIFFICULTY_OPTIONS,
  SOURCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  STATUS_OPTIONS
} from './FilterPanel'
import { useToast } from '../hooks/useToast'
import { spacing } from '../styles/tokens'

const { Text } = Typography

interface EditableFieldMeta {
  key: string
  label: string
  type: 'string' | 'tags' | 'number'
  options?: string[]
}

/** 可批量编辑的系统字段 */
const SYSTEM_EDITABLE_FIELDS: EditableFieldMeta[] = [
  { key: 'type', label: '类型', type: 'string', options: [...TYPE_OPTIONS] },
  { key: 'domain', label: '领域', type: 'string', options: [...DOMAIN_OPTIONS] },
  { key: 'difficulty', label: '难度', type: 'string', options: [...DIFFICULTY_OPTIONS] },
  { key: 'source', label: '来源', type: 'string', options: [...SOURCE_OPTIONS] },
  { key: 'source_type', label: '来源类型', type: 'string', options: [...SOURCE_TYPE_OPTIONS] },
  { key: 'status', label: '状态', type: 'string', options: [...STATUS_OPTIONS] },
  { key: 'weight', label: '权重', type: 'number' },
  { key: 'tags', label: '标签', type: 'tags' }
]

export interface BatchEditModalProps {
  open: boolean
  onClose: () => void
  /** 已选择的目标 topic 数量（含跨页全选模式） */
  targetCount: number
  /** 是否跨页全选模式 */
  isCrossPage: boolean
  /** 自定义字段元数据 */
  customFields: CustomField[]
  /** 自定义字段候选值 */
  customFieldOptions: Record<string, string[]>
  /** 提交回调 */
  onSubmit: (actions: BatchEditFieldAction[]) => Promise<void>
  /** 提交中状态 */
  submitting?: boolean
}

interface FieldRow {
  uid: string
  field: string
  mode: 'replace' | 'append' | 'clear'
  value?: string | string[] | number
}

let uidCounter = 0
function newUid(): string {
  uidCounter += 1
  return `row-${Date.now()}-${uidCounter}`
}

export default function BatchEditModal({
  open,
  onClose,
  targetCount,
  isCrossPage,
  customFields,
  customFieldOptions,
  onSubmit,
  submitting = false
}: BatchEditModalProps) {
  const toast = useToast()
  const [rows, setRows] = useState<FieldRow[]>([])

  // 所有可选字段（系统 + 自定义）
  const allFields: EditableFieldMeta[] = useMemo(() => {
    const custom: EditableFieldMeta[] = customFields.map((cf) => ({
      key: cf.field_key,
      label: cf.field_label,
      type: cf.field_type,
      options: customFieldOptions[cf.field_key] ?? []
    }))
    return [...SYSTEM_EDITABLE_FIELDS, ...custom]
  }, [customFields, customFieldOptions])

  // 已选字段集合（避免同一字段多次添加）
  const usedFieldKeys = useMemo(() => new Set(rows.map((r) => r.field)), [rows])

  const handleAddRow = () => {
    const available = allFields.find((f) => !usedFieldKeys.has(f.key))
    if (!available) {
      toast.warning('已添加全部可编辑字段')
      return
    }
    setRows([...rows, { uid: newUid(), field: available.key, mode: 'replace', value: '' }])
  }

  const handleRemoveRow = (uid: string) => {
    setRows(rows.filter((r) => r.uid !== uid))
  }

  const handleRowChange = (uid: string, patch: Partial<FieldRow>) => {
    setRows(rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))
  }

  const handleSubmit = async () => {
    if (rows.length === 0) {
      toast.warning('请至少添加一个编辑字段')
      return
    }
    // 校验
    for (const row of rows) {
      const fieldMeta = allFields.find((f) => f.key === row.field)
      if (!fieldMeta) continue
      if (row.mode === 'clear') continue
      if (fieldMeta.type === 'tags') {
        if (Array.isArray(row.value) ? row.value.length === 0 : !row.value) {
          toast.warning(`请为「${fieldMeta.label}」输入值`)
          return
        }
      } else if (fieldMeta.type === 'number') {
        if (row.value === undefined || row.value === '' || row.value === null) {
          toast.warning(`请为「${fieldMeta.label}」输入数值`)
          return
        }
      } else {
        if (!row.value || (typeof row.value === 'string' && row.value.trim() === '')) {
          toast.warning(`请为「${fieldMeta.label}」选择值`)
          return
        }
      }
    }

    const actions: BatchEditFieldAction[] = rows.map((r) => {
      const fieldMeta = allFields.find((f) => f.key === r.field)!
      const action: BatchEditFieldAction = { field: r.field, mode: r.mode }
      if (r.mode !== 'clear') {
        if (fieldMeta.type === 'tags') {
          action.value = Array.isArray(r.value) ? r.value : r.value ? [String(r.value)] : []
        } else if (fieldMeta.type === 'number') {
          action.value = Number(r.value)
        } else {
          action.value = String(r.value)
        }
      }
      return action
    })

    await onSubmit(actions)
    setRows([])
  }

  const renderValueInput = (row: FieldRow) => {
    const fieldMeta = allFields.find((f) => f.key === row.field)
    if (!fieldMeta) return null
    if (row.mode === 'clear') {
      return <Text type="secondary">将清空该字段</Text>
    }
    if (fieldMeta.type === 'tags') {
      return (
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="输入后按回车添加"
          tokenSeparators={[',', ' ']}
          value={Array.isArray(row.value) ? row.value : row.value ? [String(row.value)] : []}
          onChange={(v) => handleRowChange(row.uid, { value: v })}
          options={fieldMeta.options?.map((o) => ({ label: o, value: o }))}
        />
      )
    }
    if (fieldMeta.type === 'number') {
      return (
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          max={10}
          step={0.1}
          value={typeof row.value === 'number' ? row.value : undefined}
          onChange={(v) => handleRowChange(row.uid, { value: v ?? 0 })}
        />
      )
    }
    // 标量字符串
    return (
      <Select
        style={{ width: '100%' }}
        allowClear
        showSearch
        value={typeof row.value === 'string' ? row.value : undefined}
        onChange={(v) => handleRowChange(row.uid, { value: v ?? '' })}
        options={fieldMeta.options?.map((o) => ({ label: o, value: o }))}
      />
    )
  }

  return (
    <>
      <Modal
        title="批量编辑辩题"
        open={open}
        onCancel={onClose}
        width={680}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Popconfirm
              title={`确认对 ${targetCount} 条辩题执行批量编辑？`}
              description={isCrossPage ? '跨页全选模式：将对全部选中项生效' : undefined}
              okText="确定执行"
              cancelText="取消"
              onConfirm={handleSubmit}
              disabled={submitting || rows.length === 0}
            >
              <Button type="primary" loading={submitting} disabled={rows.length === 0}>
                执行批量编辑
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: spacing.md }}
          message={`将对 ${targetCount} 条辩题应用批量编辑${isCrossPage ? '（跨页全选模式）' : ''}`}
          description="支持同时编辑多个字段。每个字段可选择替换/追加/清空模式。操作可在历史中撤销。"
        />

        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: `${spacing.xl} 0` }}>
            <Text type="secondary">尚未添加任何编辑字段</Text>
            <div style={{ marginTop: 12 }}>
              <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddRow}>
                添加编辑字段
              </Button>
            </div>
          </div>
        ) : (
          <>
            {rows.map((row) => {
              const fieldMeta = allFields.find((f) => f.key === row.field)
              const isTagsField = fieldMeta?.type === 'tags'
              return (
                <div
                  key={row.uid}
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 8,
                    alignItems: 'flex-start'
                  }}
                >
                  <Select
                    style={{ width: 140 }}
                    value={row.field}
                    onChange={(v) =>
                      handleRowChange(row.uid, { field: v, mode: 'replace', value: '' })
                    }
                    options={allFields.map((f) => ({
                      label: f.label,
                      value: f.key,
                      disabled: usedFieldKeys.has(f.key) && f.key !== row.field
                    }))}
                  />
                  <Select
                    style={{ width: 100 }}
                    value={row.mode}
                    onChange={(v) => handleRowChange(row.uid, { mode: v })}
                    options={[
                      { label: '替换', value: 'replace' },
                      { label: '追加', value: 'append', disabled: !isTagsField },
                      { label: '清空', value: 'clear' }
                    ]}
                  />
                  <div style={{ flex: 1 }}>{renderValueInput(row)}</div>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => handleRemoveRow(row.uid)}
                  />
                </div>
              )
            })}
            <Divider style={{ margin: '12px 0' }} />
            <Button type="dashed" icon={<PlusOutlined />} block onClick={handleAddRow}>
              添加更多字段
            </Button>
          </>
        )}
      </Modal>
    </>
  )
}
