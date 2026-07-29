// ============================================================
// useMediaQuery.ts — 媒体查询 hook
//
// 监听指定的 CSS media query，返回当前是否匹配。
// SSR / 非浏览器环境安全回退为 false。
// 兼容现代浏览器 addEventListener 与老版 Safari addListener。
// ============================================================

import { useEffect, useState } from 'react'

/**
 * 监听指定 media query 并返回当前匹配状态。
 * @param query CSS media query 字符串，如 '(max-width: 767px)'
 * @returns 当前是否匹配
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    // 兼容老版 Safari 回退
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [query])

  return matches
}
