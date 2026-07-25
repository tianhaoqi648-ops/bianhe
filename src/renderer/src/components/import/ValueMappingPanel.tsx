// ============================================================
// ValueMappingPanel.tsx — 导入预览页新值映射面板
//
// 当解析出的 topics 中存在非系统候选值时显示。
// 用户可对每个新值选择：
//   - keep（保留）：原样入库
//   - map（映射到...）：改写为已有候选值
//   - add（加入候选）：原样入库 + 永久加入系统候选
//
// 通过 onMappingChange 回传 mapping 给父组件，由父组件在执行导入前应用。
// ============================================================

import { useState, useMemo } from 'react'
import { Card, Tag, Select, Space, Button, Typography, Divider, Alert } from 'antd'
import { SwapOutlined, PlusCircleOutlined, MinusCircleOutlined } from '@ant-design/icons'
import type {
  UnknownValueItem,
  ValueMapping,
  ValueMappingAction,
  ValueMappingRule
} from '../../../../shared/types'
import type { CandidateField } from '../../../../shared/constants'

const { Text, Title } = Typography

/** 字段中文标签（与 import-engine FIELD_LABEL 保持一致） */
const FIELD_LABEL: Record<CandidateField, string> = {
  type: '类型',
  domain: '领域',
  difficulty: '难度',
  source: '来源',
  source_type: '来源类型'
}

export interface ValueMappingPanelProps {
  /** 解析检测到的新值 */
  unknownValues: UnknownValueItem[]
  /** 当前合并后的候选值（系统候选 + 用户扩展） */
  candidateOptions: Record<CandidateField, string[]>
  /** 初始 mapping（一般空对象） */
  initialMapping?: ValueMapping
  /** mapping 变化回调 */
  onMappingChange: (mapping: ValueMapping) => void
}

export default function ValueMappingPanel({
  unknownValues,
  candidateOptions,
  initialMapping = {},
  onMappingChange
}: ValueMappingPanelProps) {
  const [mapping, setMapping] = useState<ValueMapping>(initialMapping)

  // 计算总览
  const totalValues = useMemo(
    () => unknownValues.reduce((sum, item) => sum + item.values.length, 0),
    [unknownValues]
  )
  const mappedCount = useMemo(() => {
    let count = 0
    for (const field of Object.keys(mapping) as CandidateField[]) {
      const valueMap = mapping[field]
      if (!valueMap) continue
      for (const origin of Object.keys(valueMap)) {
        if (valueMap[origin]?.action !== 'keep') count++
      }
    }
    return count
  }, [mapping])

  // 内部更新 + 回调
  const updateMapping = (next: ValueMapping) => {
    setMapping(next)
    onMappingChange(next)
  }

  const handleActionChange = (
    field: CandidateField,
    originValue: string,
    action: ValueMappingAction
  ) => {
    const next: ValueMapping = { ...mapping }
    if (!next[field]) next[field] = {}
    const rule: ValueMappingRule = { action }
    if (action === 'map') {
      // 默认 target 设为该字段第一个候选值（用户可改）
      rule.target = candidateOptions[field][0] ?? ''
    }
    next[field]![originValue] = rule
    updateMapping(next)
  }

  const handleMapTargetChange = (
    field: CandidateField,
    originValue: string,
    target: string
  ) => {
    const next: ValueMapping = { ...mapping }
    if (!next[field]) next[field] = {}
    next[field]![originValue] = { action: 'map', target }
    updateMapping(next)
  }

  // 批量操作
  const handleAllKeep = () => updateMapping({})
  const handleAllAdd = () => {
    const next: ValueMapping = {}
    for (const item of unknownValues) {
      next[item.field] = {}
      for (const { value } of item.values) {
        next[item.field]![value] = { action: 'add' }
      }
    }
    updateMapping(next)
  }

  if (unknownValues.length === 0) return null

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Title level={5} style={{ margin: 0 }}>
          <SwapOutlined style={{ marginRight: 6, color: '#faad14' }} />
          新值映射
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {unknownValues.length} 个字段 / {totalValues} 个新值，已处理 {mappedCount} 个
        </Text>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 8, fontSize: 12 }}
        message="导入文件中存在部分字段值不在系统候选内（如新赛事、新难度），可在导入前批量处理："
        description={
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            <li><b>保留</b>：原样入库（后续在筛选面板可能选不到该值）</li>
            <li><b>映射到...</b>：改写为已有候选值（如把&quot;入门&quot;改为&quot;入门级&quot;）</li>
            <li><b>加入候选</b>：原样入库 + 永久加入系统候选（重启后仍可用）</li>
          </ul>
        }
      />
      {unknownValues.map((item) => (
        <div key={item.field} style={{ marginBottom: 8 }}>
          <Divider style={{ margin: '8px 0' }} orientation="left" plain>
            <Text strong style={{ fontSize: 13 }}>
              {FIELD_LABEL[item.field]}（{item.values.length} 个新值）
            </Text>
          </Divider>
          {item.values.map(({ value, count }) => {
            const rule = mapping[item.field]?.[value]
            const action = rule?.action ?? 'keep'
            return (
              <div
                key={`${item.field}-${value}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                  padding: '4px 8px',
                  background: '#fafafa',
                  borderRadius: 4
                }}
              >
                <Tag color="orange" style={{ minWidth: 80, textAlign: 'center' }}>
                  {value}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>×{count}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>→</Text>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={action}
                  onChange={(v) => handleActionChange(item.field, value, v)}
                  options={[
                    { value: 'keep', label: '保留' },
                    { value: 'map', label: '映射到...' },
                    { value: 'add', label: '加入候选' }
                  ]}
                />
                {action === 'map' && (
                  <Select
                    size="small"
                    style={{ width: 130 }}
                    value={rule?.target ?? ''}
                    onChange={(v) => handleMapTargetChange(item.field, value, v)}
                    options={candidateOptions[item.field].map((c) => ({
                      value: c,
                      label: c
                    }))}
                    showSearch
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
      <Divider style={{ margin: '8px 0' }} />
      <Space>
        <Button size="small" icon={<MinusCircleOutlined />} onClick={handleAllKeep}>
          全部保留
        </Button>
        <Button size="small" icon={<PlusCircleOutlined />} onClick={handleAllAdd}>
          全部加入候选
        </Button>
      </Space>
    </Card>
  )
}
