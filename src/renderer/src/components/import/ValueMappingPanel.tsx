// ============================================================
// ValueMappingPanel.tsx — 导入预览页新值映射面板
//
// 当解析出的 topics 中存在非系统候选值时显示。
// 用户可对每个新值选择：
//   - keep（保留）：原样入库
//   - map（映射到...）：改写为已有候选值
//   - add（加入候选）：原样入库 + 永久加入系统候选
//
// 新增功能：
//   - 多选 Checkbox 支持批量映射
//   - 智能推荐按钮（基于 Levenshtein 相似度）
//   - 推荐结果以金色 Tag 显示在每行，可单独应用
//
// 通过 onMappingChange 回传 mapping 给父组件，由父组件在执行导入前应用。
// ============================================================

import { useState, useMemo, useEffect } from 'react'
import {
  Card,
  Tag,
  Select,
  Space,
  Button,
  Typography,
  Divider,
  Alert,
  Checkbox,
  Tooltip,
  Modal
} from 'antd'
import {
  SwapOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type {
  UnknownValueItem,
  ValueMapping,
  ValueMappingAction,
  ValueMappingRule
} from '../../../../shared/types'
import type { CandidateField } from '../../../../shared/constants'
import { recommendMappings, type Recommendation } from '../../../../shared/utils/value-recommender'

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
  const [selectedValues, setSelectedValues] = useState<Record<CandidateField, Set<string>>>(
    {} as Record<CandidateField, Set<string>>
  )
  const [recommendations, setRecommendations] = useState<
    Record<CandidateField, Recommendation[]>
  >({} as Record<CandidateField, Recommendation[]>)
  const [batchMapModal, setBatchMapModal] = useState<{
    field: CandidateField | null
    open: boolean
  }>({ field: null, open: false })
  const [batchMapTarget, setBatchMapTarget] = useState<string>('')

  // Bug 3.5: 当父组件显式传入新 initialMapping 时同步本地 state（防御性，当前父组件不传）
  useEffect(() => {
    setMapping(initialMapping)
  }, [initialMapping])

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

  // Bug 3.4: 每次更新 mapping[field] 时创建新对象，不 mutate 原引用
  const updateFieldMapping = (
    field: CandidateField,
    updater: (prev: Record<string, ValueMappingRule>) => Record<string, ValueMappingRule>
  ): void => {
    const prevField = mapping[field] ?? {}
    const next: ValueMapping = { ...mapping, [field]: updater(prevField) }
    updateMapping(next)
  }

  const handleActionChange = (
    field: CandidateField,
    originValue: string,
    action: ValueMappingAction
  ) => {
    updateFieldMapping(field, (prev) => {
      const rule: ValueMappingRule = { action }
      if (action === 'map') {
        rule.target = candidateOptions[field][0] ?? ''
      }
      return { ...prev, [originValue]: rule }
    })
  }

  const handleMapTargetChange = (
    field: CandidateField,
    originValue: string,
    target: string
  ) => {
    updateFieldMapping(field, (prev) => ({
      ...prev,
      [originValue]: { action: 'map', target }
    }))
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

  // 多选/批量/推荐辅助函数
  const toggleSelect = (field: CandidateField, value: string) => {
    setSelectedValues((prev) => {
      const next = { ...prev }
      const set = new Set(next[field] ?? [])
      if (set.has(value)) set.delete(value)
      else set.add(value)
      next[field] = set
      return next
    })
  }

  const handleSmartRecommend = (
    field: CandidateField,
    values: Array<{ value: string; count: number }>
  ) => {
    const newValues = values.map((v) => v.value)
    const recs = recommendMappings(newValues, candidateOptions[field], field)
    setRecommendations((prev) => ({ ...prev, [field]: recs }))
    // Bug 5.6: 自动应用所有推荐时，仅覆盖未设置或 action='keep' 的项，
    // 不覆盖用户已设置的 'map' 或 'add'，避免破坏已有配置
    // 未匹配项（reason='no-match'）自动设为 'keep'，UI 显示「推荐保留」标签
    updateFieldMapping(field, (prev) => {
      const next = { ...prev }
      for (const r of recs) {
        const existing = next[r.originValue]
        if (!existing || existing.action === 'keep') {
          if (r.reason === 'no-match') {
            next[r.originValue] = { action: 'keep' }
          } else {
            next[r.originValue] = { action: 'map', target: r.recommendedTarget }
          }
        }
      }
      return next
    })
  }

  const handleBatchMap = (field: CandidateField) => {
    const selected = selectedValues[field]
    if (!selected || selected.size === 0) return
    setBatchMapTarget(candidateOptions[field][0] ?? '')
    setBatchMapModal({ field, open: true })
  }

  const confirmBatchMap = () => {
    if (!batchMapModal.field || !batchMapTarget) return
    const field = batchMapModal.field
    const selected = selectedValues[field]
    if (!selected) return
    updateFieldMapping(field, (prev) => {
      const next = { ...prev }
      for (const v of selected) {
        next[v] = { action: 'map', target: batchMapTarget }
      }
      return next
    })
    setSelectedValues((prev) => ({ ...prev, [field]: new Set() }))
    setBatchMapModal({ field: null, open: false })
  }

  const handleApplySingleRecommend = (field: CandidateField, rec: Recommendation) => {
    updateFieldMapping(field, (prev) => ({
      ...prev,
      [rec.originValue]: { action: 'map', target: rec.recommendedTarget }
    }))
  }

  const handleApplyNoMatchRecommend = (field: CandidateField, rec: Recommendation) => {
    updateFieldMapping(field, (prev) => ({
      ...prev,
      [rec.originValue]: { action: 'keep' }
    }))
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
          <div style={{ fontSize: 12 }}>
            <ul style={{ margin: '0 0 6px 0', paddingLeft: 16 }}>
              <li>
                <b>保留</b>：原样入库，但候选值列表不变
                <Text type="secondary" style={{ marginLeft: 4 }}>
                  （下次导入同值仍会提示；筛选面板可能选不到该值）
                </Text>
              </li>
              <li>
                <b>映射到...</b>：改写为已有候选值入库
                <Text type="secondary" style={{ marginLeft: 4 }}>
                  （如把 &quot;1-入门&quot; 改为 &quot;入门级&quot;，便于统一筛选）
                </Text>
              </li>
              <li>
                <b>加入候选</b>：原样入库 + 永久写入系统候选
                <Text type="secondary" style={{ marginLeft: 4 }}>
                  （重启后仍可用，筛选面板能选到该值，下次导入不再提示）
                </Text>
              </li>
              <li>
                <b>智能推荐</b>：基于相似度自动推荐映射，可逐条撤销
              </li>
            </ul>
            <Text type="secondary" style={{ fontSize: 11 }}>
              提示：「保留」适合临时放行，「加入候选」适合长期使用自有分级体系。
            </Text>
          </div>
        }
      />
      {unknownValues.map((item) => (
        <div key={item.field} style={{ marginBottom: 8 }}>
          <Divider style={{ margin: '8px 0' }} orientation="left" plain>
            <Text strong style={{ fontSize: 13 }}>
              {FIELD_LABEL[item.field]}（{item.values.length} 个新值）
            </Text>
          </Divider>
          {item.values.map(({ value, count }, idx) => {
            const rule = mapping[item.field]?.[value]
            const action = rule?.action ?? 'keep'
            const isSelected = selectedValues[item.field]?.has(value) ?? false
            const rec = recommendations[item.field]?.find((r) => r.originValue === value)
            return (
              <div
                key={`${item.field}-${idx}-${value}`}
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
                <Checkbox
                  checked={isSelected}
                  onChange={() => toggleSelect(item.field, value)}
                />
                <Tag color="orange" style={{ minWidth: 80, textAlign: 'center' }}>
                  {value}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>×{count}</Text>
                {rec && rec.reason !== 'no-match' && (
                  <Tooltip title={`推荐匹配度 ${(rec.score * 100).toFixed(0)}%`}>
                    <Tag
                      color="gold"
                      style={{ cursor: 'pointer', fontSize: 11 }}
                      onClick={() => handleApplySingleRecommend(item.field, rec)}
                    >
                      <ThunderboltOutlined /> 推荐→{rec.recommendedTarget}
                    </Tag>
                  </Tooltip>
                )}
                {rec && rec.reason === 'no-match' && (
                  <Tooltip title="未找到匹配的已有候选值，推荐保留原值">
                    <Tag
                      color="default"
                      style={{ cursor: 'pointer', fontSize: 11 }}
                      onClick={() => handleApplyNoMatchRecommend(item.field, rec)}
                    >
                      <ThunderboltOutlined /> 推荐保留
                    </Tag>
                  </Tooltip>
                )}
                {rec && rule && (
                  // 用户已设 'map' 或 'add'，且不是推荐自动应用的匹配项
                  (rule.action === 'map' || rule.action === 'add') &&
                  !(rec.reason !== 'no-match' && rule.action === 'map' && rule.target === rec.recommendedTarget)
                ) && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    （已设置，跳过）
                  </Text>
                )}
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
          <Space style={{ marginTop: 4, marginLeft: 8 }}>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={() => handleSmartRecommend(item.field, item.values)}
            >
              智能推荐
            </Button>
            <Button
              size="small"
              disabled={!selectedValues[item.field] || selectedValues[item.field].size === 0}
              onClick={() => handleBatchMap(item.field)}
            >
              批量映射选中项（{selectedValues[item.field]?.size ?? 0}）
            </Button>
            <Button
              size="small"
              type="link"
              disabled={!selectedValues[item.field] || selectedValues[item.field].size === 0}
              onClick={() =>
                setSelectedValues((prev) => ({ ...prev, [item.field]: new Set() }))
              }
            >
              清空选中
            </Button>
          </Space>
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

      <Modal
        title={batchMapModal.field ? `批量映射 ${FIELD_LABEL[batchMapModal.field]}` : ''}
        open={batchMapModal.open}
        onOk={confirmBatchMap}
        onCancel={() => setBatchMapModal({ field: null, open: false })}
        okText="确认映射"
        cancelText="取消"
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          将把 {selectedValues[batchMapModal.field ?? 'type']?.size ?? 0} 个新值映射到：
        </Text>
        <Select
          style={{ width: '100%' }}
          value={batchMapTarget}
          onChange={setBatchMapTarget}
          options={
            batchMapModal.field
              ? candidateOptions[batchMapModal.field].map((c) => ({ value: c, label: c }))
              : []
          }
          showSearch
        />
      </Modal>
    </Card>
  )
}
