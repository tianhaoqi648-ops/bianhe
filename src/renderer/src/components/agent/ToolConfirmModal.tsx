// ============================================================
// ToolConfirmModal.tsx — Agent 工具调用人工确认弹窗（AI Agent v1.3.0 Week 7 Task 43）
//
// 职责：
// 1. 高风险工具执行前由主进程推送 tool_call_confirm 事件，本组件渲染确认弹窗（SubTask 43.1）
// 2. 显示工具的人类可读说明文案（description，SubTask 43.2）
// 3. 显示入参 JSON，支持只读 → 可编辑切换（SubTask 43.3）
// 4. 底部三按钮：确认执行（绿）/ 确认执行（已修改参数）（蓝，仅参数被修改且 JSON 合法时启用）/ 取消（红）（SubTask 43.4）
// 5. 点击按钮调用 agentStore.handleConfirmResult 并关闭弹窗（SubTask 43.5）
//
// 依赖：
// - antd Modal / Input.TextArea / Button / Typography / Alert / theme
// - @ant-design/icons EditOutlined / CheckOutlined（编辑参数切换图标）
// - useAgentStore: pendingConfirm / handleConfirmResult
// - ToolCallConfirmEvent 类型来自 shared/agent-types
//
// 设计要点：
// - pendingConfirm 为 null 时不渲染弹窗（open=false）
// - maskClosable=false / closable=false：强制用户选择按钮，不允许点击遮罩或右上角 X 关闭
// - 入参默认只读模式（Typography.Paragraph + copyable），点击「编辑参数」切换为可编辑 TextArea
// - 编辑时实时校验 JSON 合法性，解析失败显示 Alert 红色错误提示
// - 「确认执行（已修改参数）」按钮仅在编辑态 + JSON 合法 + 内容与原文不一致时启用
// - Modal onCancel 走 handleConfirmResult(toolCallId, false) 与「取消」按钮一致
// - 当 pendingConfirm 变化（新事件到达）时重置本地编辑态，避免上次编辑残留
// ============================================================

import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Input, Button, Typography, Alert, theme } from 'antd'
import { EditOutlined, CheckOutlined } from '@ant-design/icons'
import { useAgentStore } from '../../stores/agentStore'

/** ToolConfirmModal Props：无 props，状态全部来自 store */
export interface ToolConfirmModalProps {}

/**
 * ToolConfirmModal — Agent 工具调用人工确认弹窗
 *
 * 根据 agentStore.pendingConfirm 显隐。弹窗内展示工具说明与入参 JSON，
 * 用户可只读查看或切换为编辑态修改参数。底部三按钮分别对应：
 * - 直接确认 / 确认并使用修改后的参数 / 取消。
 */
export function ToolConfirmModal(_props: ToolConfirmModalProps): JSX.Element {
  const { token } = theme.useToken()

  // ===== store 状态 =====
  const pendingConfirm = useAgentStore((s) => s.pendingConfirm)
  const handleConfirmResult = useAgentStore((s) => s.handleConfirmResult)

  // ===== 本地状态 =====
  /** 是否处于参数编辑态 */
  const [isEditing, setIsEditing] = useState(false)
  /** 编辑框中的 JSON 文本 */
  const [editedArgsText, setEditedArgsText] = useState('')
  /** JSON 解析错误信息（null 表示合法） */
  const [parseError, setParseError] = useState<string | null>(null)

  // ===== 派生值 =====
  // 原始入参 JSON 文本（pretty-printed），用于只读展示与修改对比
  const originalArgsText = useMemo(() => {
    if (!pendingConfirm) return ''
    return JSON.stringify(pendingConfirm.args, null, 2)
  }, [pendingConfirm])

  // ===== 副作用：pendingConfirm 变化时重置本地编辑态 =====
  useEffect(() => {
    if (pendingConfirm) {
      setIsEditing(false)
      setEditedArgsText(originalArgsText)
      setParseError(null)
    }
  }, [pendingConfirm, originalArgsText])

  // ===== 解析编辑后的 JSON =====
  // 仅在编辑态尝试解析；非编辑态视为合法（直接用原 args）
  const parsedEditedArgs = useMemo<Record<string, unknown> | null>(() => {
    if (!isEditing) return null
    try {
      const parsed = JSON.parse(editedArgsText)
      // 仅接受对象类型（工具入参必须是 key-value 结构）
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null
      }
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }, [isEditing, editedArgsText])

  // 解析错误信息（用于显示 Alert）
  const jsonErrorMessage = useMemo<string | null>(() => {
    if (!isEditing) return null
    if (parseError) return parseError
    // parseError 为空但 parsedEditedArgs 为 null：说明是结构问题（非对象）
    try {
      const parsed = JSON.parse(editedArgsText)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return '参数必须是 JSON 对象（不能是数组或基础类型）'
      }
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'JSON 解析失败'
    }
  }, [isEditing, parseError, editedArgsText, parsedEditedArgs])

  // 判断参数是否被修改：编辑态 + 解析成功 + 与原 JSON 文本不一致
  const isModified = useMemo(() => {
    if (!isEditing) return false
    if (parsedEditedArgs === null) return false
    // 用字符串对比（用户改任何字符都会触发）
    return editedArgsText !== originalArgsText
  }, [isEditing, parsedEditedArgs, editedArgsText, originalArgsText])

  // ===== 事件处理 =====

  /** 切换编辑态：进入编辑态时用原 args JSON 初始化 */
  const handleToggleEdit = (): void => {
    if (!isEditing) {
      setEditedArgsText(originalArgsText)
      setParseError(null)
      setIsEditing(true)
    } else {
      setIsEditing(false)
      // 退出编辑态时清空错误
      setParseError(null)
    }
  }

  /** 编辑框 onChange：实时更新文本 + 校验 JSON */
  const handleArgsChange = (value: string): void => {
    setEditedArgsText(value)
    // 空字符串特殊处理：标记为错误（参数不能为空对象文本）
    if (!value.trim()) {
      setParseError('参数不能为空')
      return
    }
    try {
      JSON.parse(value)
      setParseError(null)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'JSON 解析失败')
    }
  }

  /** 确认执行（使用原参数） */
  const handleConfirm = (): void => {
    if (!pendingConfirm) return
    handleConfirmResult(pendingConfirm.toolCallId, true)
  }

  /** 确认执行（使用修改后的参数） */
  const handleConfirmWithModified = (): void => {
    if (!pendingConfirm) return
    if (!parsedEditedArgs) return
    handleConfirmResult(pendingConfirm.toolCallId, true, parsedEditedArgs)
  }

  /** 取消 */
  const handleCancel = (): void => {
    if (!pendingConfirm) return
    handleConfirmResult(pendingConfirm.toolCallId, false)
  }

  // ===== 渲染 =====
  const isOpen = !!pendingConfirm
  const toolName = pendingConfirm?.toolName ?? ''
  const description = pendingConfirm?.description ?? ''

  // 自定义 footer：三个按钮（绿 / 蓝 / 红）
  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      {/* 取消（红） */}
      <Button danger onClick={handleCancel}>
        取消
      </Button>

      {/* 确认执行（已修改参数）（蓝，仅参数被修改且 JSON 合法时启用） */}
      <Button
        type="primary"
        onClick={handleConfirmWithModified}
        disabled={!isModified}
        title={
          !isModified
            ? '需要先编辑参数并保证 JSON 合法才能启用'
            : '使用修改后的参数执行'
        }
      >
        确认执行（已修改参数）
      </Button>

      {/* 确认执行（绿） */}
      <Button
        type="primary"
        onClick={handleConfirm}
        style={{
          backgroundColor: token.colorSuccess,
          borderColor: token.colorSuccess
        }}
      >
        确认执行
      </Button>
    </div>
  )

  return (
    <Modal
      open={isOpen}
      title={`确认执行：${toolName}`}
      onCancel={handleCancel}
      footer={footer}
      // 强制用户选择按钮：不允许点击遮罩关闭 / 不显示右上角 X
      maskClosable={false}
      closable={false}
      // 不允许键盘 ESC 关闭（与 maskClosable 语义一致）
      keyboard={false}
      destroyOnClose
      width={520}
    >
      {pendingConfirm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 工具说明文案 */}
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              工具说明
            </Typography.Text>
            <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
              {description || '（无说明文案）'}
            </Typography.Paragraph>
          </div>

          {/* 入参 JSON 区 */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                入参
              </Typography.Text>
              <Button
                type="link"
                size="small"
                icon={isEditing ? <CheckOutlined /> : <EditOutlined />}
                onClick={handleToggleEdit}
              >
                {isEditing ? '完成编辑' : '编辑参数'}
              </Button>
            </div>

            {isEditing ? (
              <>
                <Input.TextArea
                  value={editedArgsText}
                  onChange={(e) => handleArgsChange(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 12 }}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    borderColor: parseError ? token.colorError : undefined
                  }}
                  spellCheck={false}
                />
                {jsonErrorMessage && (
                  <Alert
                    type="error"
                    message={`JSON 解析失败：${jsonErrorMessage}`}
                    showIcon
                    style={{ marginTop: 8 }}
                  />
                )}
              </>
            ) : (
              <Typography.Paragraph
                copyable
                style={{
                  backgroundColor: token.colorFillQuaternary,
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0
                }}
              >
                {originalArgsText || '{}'}
              </Typography.Paragraph>
            )}
          </div>

          {/* 风险提示 */}
          <Alert
            type="warning"
            message="该工具被标记为高风险，请确认入参无误后再执行。"
            showIcon
          />
        </div>
      )}
    </Modal>
  )
}
