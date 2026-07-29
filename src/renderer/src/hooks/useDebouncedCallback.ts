// ============================================================
// useDebouncedCallback.ts — 极简防抖 hook
//
// 与 use-debounce / lodash.debounce 行为一致，但不引入新依赖。
// 防抖函数引用稳定（useCallback + delay 依赖），目标函数始终读取最新闭包（fnRef）。
// 卸载时自动清理定时器，避免内存泄漏与已卸载组件 setState 警告。
// ============================================================

import { useCallback, useEffect, useRef } from 'react'

/**
 * 极简防抖 hook：返回一个防抖后的函数。
 *
 * @param fn 目标函数（每次渲染都可变，通过 ref 读取最新值）
 * @param delay 防抖毫秒数
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number
): (...args: A) => void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debounced = useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        fnRef.current(...args)
      }, delay)
    },
    [delay]
  )

  // 卸载时清掉定时器，避免内存泄漏与已卸载组件 setState 警告
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return debounced
}
