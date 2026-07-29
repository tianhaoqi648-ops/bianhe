// ============================================================
// useHotkeys.ts —— React 友好的快捷键 hook
//
// 提供两个 hook：
//   1. useHotkeys(defs) —— 注册一组快捷键，组件卸载时自动注销
//   2. useHotkeyScope(scope) —— 激活某个作用域，组件卸载时自动停用
//
// 设计要点：
//   - handler 用 useRef 持有最新值，避免每次渲染重新注册
//   - defs 用 useRef 稳定引用
//   - 支持动态 enabled，无需重新注册
//   - 订阅 settingsStore 的 customMap 与 masterEnabled，响应自定义配置
//     · masterEnabled === false 时：不注册任何快捷键
//     · 单项 disabled：跳过注册
//     · 自定义 combo：用 getEffectiveCombo 覆盖 def.combo
// ============================================================

import { useEffect, useMemo, useRef } from 'react'
import { hotkeyManager } from '../utils/hotkey-manager'
import { useSettingsStore } from '../stores/settingsStore'
import {
  loadCustomMap,
  loadMasterEnabled,
  getEffectiveCombo,
  isPresetDisabled
} from '../utils/hotkey-config'

export interface HotkeyDef {
  /** 组合键，如 'ctrl+k' / 'r' / 'escape' / 'arrowleft' */
  combo: string
  /** 触发的回调 */
  handler: (e: KeyboardEvent) => void
  /** 用于帮助弹窗显示的描述文字 */
  description: string
  /** 作用域，默认 'global' */
  scope?: string
  /** 是否启用，默认 true。false 时注册但仍可被帮助弹窗显示 */
  enabled?: boolean
  /** 是否阻止默认行为，默认 true */
  preventDefault?: boolean
}

/**
 * 注册一组快捷键，组件卸载时自动注销。
 *
 * @example
 * useHotkeys([
 *   { combo: 'r', description: '重抽', handler: handleRedo, scope: 'draw' },
 *   { combo: 'f', description: '投屏', handler: () => setBigScreen(true), scope: 'draw' }
 * ])
 */
export function useHotkeys(defs: HotkeyDef | HotkeyDef[]): void {
  const defsArray = Array.isArray(defs) ? defs : [defs]

  // 用 ref 持有最新的 defs，避免每次渲染重新注册
  const defsRef = useRef(defsArray)
  defsRef.current = defsArray

  // 订阅用户自定义配置
  const settings = useSettingsStore((s) => s.settings)
  const customMap = useMemo(() => loadCustomMap(settings), [settings])
  const masterEnabled = useMemo(() => loadMasterEnabled(settings), [settings])

  // 计算 enabled 指纹：当任何 def.enabled 变化时，触发重新注册
  // 这样 hotkeyManager 中的 reg.enabled 能保持最新，findMatchingRegistration 能正确跳过 enabled=false 的注册项
  const enabledFingerprint = defsArray
    .map((d) => `${d.combo}:${d.scope ?? 'global'}:${d.enabled === false ? '0' : '1'}`)
    .join('|')

  useEffect(() => {
    // 总开关关闭：不注册任何快捷键（直接返回空清理函数）
    if (!masterEnabled) {
      return () => {}
    }

    const ids: string[] = []

    for (const def of defsRef.current) {
      const scope = def.scope ?? 'global'
      const presetId = `${scope}::${def.combo}`

      // 若被用户禁用则跳过
      if (isPresetDisabled(presetId, customMap)) continue

      // 取生效 combo（用户自定义覆盖或默认）
      const effectiveCombo = getEffectiveCombo(presetId, customMap)
      if (!effectiveCombo) continue

      // 创建稳定闭包，调用最新的 handler（实时读取 enabled）
      const stableHandler = (e: KeyboardEvent) => {
        const currentDef = defsRef.current.find(
          (d) => d.combo === def.combo && (d.scope ?? 'global') === (def.scope ?? 'global')
        )
        if (currentDef?.enabled === false) return
        currentDef?.handler(e)
      }

      const id = hotkeyManager.register({
        scope: def.scope,
        combo: effectiveCombo,
        handler: stableHandler,
        description: def.description,
        // enabled 作为注册时的快照传入，findMatchingRegistration 会据此跳过
        // enabledFingerprint 变化时 useEffect 会重新注册，保证 reg.enabled 与最新 def.enabled 一致
        enabled: def.enabled ?? true,
        preventDefault: def.preventDefault ?? true
      })
      ids.push(id)
    }

    return () => {
      hotkeyManager.unregisterBatch(ids)
    }
  }, [customMap, masterEnabled, enabledFingerprint])
}

/**
 * 激活某个作用域，组件卸载时自动停用。
 *
 * @example
 * useHotkeyScope('draw')
 *
 * @param scope 作用域名，如 'draw' / 'topic-library' / 'bigscreen'
 * @param deps 依赖数组，变化时会重新激活（一般不需要传）
 */
export function useHotkeyScope(scope: string | string[], deps: unknown[] = []): void {
  const scopes = Array.isArray(scope) ? scope : [scope]
  const scopesRef = useRef(scopes)
  scopesRef.current = scopes

  useEffect(() => {
    for (const s of scopesRef.current) {
      hotkeyManager.setScope(s)
    }
    return () => {
      for (const s of scopesRef.current) {
        hotkeyManager.releaseScope(s)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
