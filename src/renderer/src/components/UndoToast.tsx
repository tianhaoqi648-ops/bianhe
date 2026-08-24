// ============================================================
// UndoToast.tsx — 撤销/重做操作反馈组件
//
// 监听 undoStore.lastUndoResult 和 error，自动显示成功/失败提示。
// 在 App.tsx 中挂载一次即可，无需传 props。
// ============================================================

import { useEffect, useRef } from 'react'
import { useUndoStore } from '../stores/undoStore'
import { useToast } from '../hooks/useToast'
import { UNDO_NOT_AVAILABLE_COPY } from '../utils/undo-manager'

export default function UndoToast(): JSX.Element {
  const lastUndoResult = useUndoStore((s) => s.lastUndoResult)
  const error = useUndoStore((s) => s.error)
  const notUndoableLabel = useUndoStore((s) => s.notUndoableLabel)
  const clearError = useUndoStore((s) => s.clearError)
  const clearNotUndoable = useUndoStore((s) => s.clearNotUndoable)
  const toast = useToast()

  // 用 ref 记录上一次显示的 result 引用，避免重复弹 toast
  const lastShownResultRef = useRef<typeof lastUndoResult>(null)

  useEffect(() => {
    if (lastUndoResult && lastUndoResult !== lastShownResultRef.current) {
      lastShownResultRef.current = lastUndoResult
      toast.success(
        `已撤销：${lastUndoResult.label}（恢复 ${lastUndoResult.affectedCount} 项）`
      )
    }
  }, [lastUndoResult, toast])

  // Governance-8.1：写操作成功但未能创建 undo_log（payload 超限 / 容量保护）时，
  // 明确提示该次不可撤销，避免用户误以为可以撤销。用 ref 防重复弹。
  const lastShownNotUndoableRef = useRef<string | null>(null)
  useEffect(() => {
    if (notUndoableLabel && notUndoableLabel !== lastShownNotUndoableRef.current) {
      lastShownNotUndoableRef.current = notUndoableLabel
      toast.error(`${UNDO_NOT_AVAILABLE_COPY}：${notUndoableLabel}`)
      clearNotUndoable()
    }
  }, [notUndoableLabel, toast, clearNotUndoable])

  useEffect(() => {
    if (error) {
      toast.error(error)
      // 显示后清除错误，避免重复弹
      clearError()
    }
  }, [error, toast, clearError])

  return <></>
}
