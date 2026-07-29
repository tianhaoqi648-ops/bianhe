// ============================================================
// DimensionTag.tsx — 维度标签组件
//
// 按辩题维度（类型/难度/领域/状态/批次/标签）自动着色的 Tag 组件，
// 基于 antd Tag 透传 closable / onClose 等能力。
// ============================================================

import { Tag } from 'antd'
import type React from 'react'

/** 维度类型 */
export type DimensionType = 'type' | 'difficulty' | 'domain' | 'status' | 'batch_id' | 'tags' | string

/** 维度到颜色的映射 */
export function getDimensionColor(dimension: DimensionType): string {
  switch (dimension) {
    case 'type': // 类型=蓝
      return 'blue'
    case 'difficulty': // 难度=金
      return 'gold'
    case 'domain': // 领域=紫
      return 'purple'
    case 'status': // 状态=绿
      return 'green'
    case 'batch_id': // 批次=灰
      return 'default'
    case 'tags': // 标签=极客蓝
      return 'geekblue'
    default: // 未知维度=灰
      return 'default'
  }
}

interface DimensionTagProps {
  /** 维度类型 */
  dimension: DimensionType
  /** 标签文字 */
  children: React.ReactNode
  /** 是否可关闭 */
  closable?: boolean
  /** 关闭回调 */
  onClose?: () => void
  /** 自定义样式 */
  style?: React.CSSProperties
}

/** 维度标签：根据 dimension 自动选取颜色 */
export default function DimensionTag({
  dimension,
  children,
  closable,
  onClose,
  style
}: DimensionTagProps) {
  const color = getDimensionColor(dimension)
  return (
    <Tag color={color} closable={closable} onClose={onClose} style={style}>
      {children}
    </Tag>
  )
}
