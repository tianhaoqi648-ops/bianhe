// ============================================================
// KbdHint.tsx — 按钮 hover 0.5s 显示 kbd 提示气泡
//
// 在 antd Tooltip 基础上叠加：
// 1. mouseEnterDelay={0.5}：hover 0.5s 后才显示
// 2. mouseLeaveDelay={0}：鼠标离开立即隐藏
// 3. 点击时立即隐藏（避免遮挡按钮反馈）
//
// 视觉：Tooltip 内容显示 <kbd> 样式的快捷键 + 可选简短说明
// 使用 shared.ts 的 kbdStyle 保持与帮助弹窗等处的视觉一致
//
// 用法：
//   <KbdHint kbd="R" description="重新抽取">
//     <Button>重抽</Button>
//   </KbdHint>
// ============================================================

import { Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { kbdStyle } from '../../styles/shared'
import { spacing, fontSize } from '../../styles/tokens'

export interface KbdHintProps {
  /** 要显示的快捷键，如 "R" / "Ctrl+K" / "Shift+R"（已格式化，直接展示） */
  kbd: string
  /** 包裹的按钮（或其它可 hover 元素） */
  children: ReactNode
  /** 气泡位置，默认 'top' */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** 简短说明（可选），显示在 kbd 按键前，如 "重新抽取" */
  description?: string
}

/**
 * KbdHint — 按钮快捷键提示气泡
 *
 * 行为：
 * - hover 0.5s 后显示（antd Tooltip 的 mouseEnterDelay）
 * - 鼠标离开立即隐藏（mouseLeaveDelay=0）
 * - 点击时立即隐藏，避免遮挡按钮反馈
 *
 * 视觉：antd Tooltip 默认深色背景，配合 shared.ts 的 kbdStyle
 * （白色文字 + 半透明白色背景）在深色气泡上保持可读性。
 */
export default function KbdHint({
  kbd,
  children,
  placement = 'top',
  description
}: KbdHintProps) {
  const [open, setOpen] = useState(false)

  // Tooltip 内容：可选描述 + kbd 按键
  const content = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs }}>
      {description && (
        <span style={{ fontSize: fontSize.caption }}>{description}</span>
      )}
      <kbd style={kbdStyle}>{kbd}</kbd>
    </span>
  )

  return (
    <Tooltip
      title={content}
      placement={placement}
      open={open}
      onOpenChange={setOpen}
      mouseEnterDelay={0.5}
      mouseLeaveDelay={0}
    >
      <span onClick={() => setOpen(false)} style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </Tooltip>
  )
}
