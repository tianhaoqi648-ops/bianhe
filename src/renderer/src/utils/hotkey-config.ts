// ============================================================
// hotkey-config.ts —— 快捷键配置管理工具
//
// 职责：
//   1. 加载/解析用户自定义映射（customMap）与总开关
//   2. 计算某个 preset 的生效 combo / 是否禁用
//   3. 冲突检测（按 scope 隔离：同 scope 同 combo 才算冲突）
//
// 设计要点：
//   - 纯函数无副作用，便于测试与复用
//   - loadCustomMap 用 try/catch 兜底，损坏的 JSON 不抛错
//   - presetId 格式：`${scope}::${combo}`
// ============================================================

import {
  HOTKEY_PRESETS,
  getDefaultCombo,
  type HotkeyPreset
} from './hotkey-presets'

/** 用户自定义映射：presetId → { combo?, disabled? } */
export type HotkeyCustomMap = Record<
  string,
  { combo?: string; disabled?: boolean }
>

/** settings 表中存储 customMap 的 key（JSON 字符串） */
export const HOTKEY_SETTING_KEY = 'hotkeys.custom'

/** settings 表中存储总开关的 key（boolean） */
export const HOTKEY_MASTER_KEY = 'hotkeys.enabled'

/** 单项的生效状态 */
export interface EffectivePreset extends HotkeyPreset {
  /** 实际生效的 combo（自定义覆盖后的值，未覆盖则等于 preset.combo） */
  effectiveCombo: string
  /** 是否被禁用 */
  disabled: boolean
}

/**
 * 从 settings 读取并解析 customMap。
 * 异常或缺失时返回 {}（即所有 preset 用默认值）。
 */
export function loadCustomMap(settings: Record<string, any>): HotkeyCustomMap {
  const raw = settings[HOTKEY_SETTING_KEY]
  if (raw == null) return {}
  // 兼容两种存储形式：已序列化的 JSON 字符串 / 已解析的对象
  if (typeof raw === 'string') {
    return parseCustomMap(raw)
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw as HotkeyCustomMap
  }
  return {}
}

/**
 * 从 settings 读取总开关。
 * 缺失视为 true（默认启用快捷键系统）。
 */
export function loadMasterEnabled(settings: Record<string, any>): boolean {
  const v = settings[HOTKEY_MASTER_KEY]
  if (v == null) return true
  return v === true || v === 'true'
}

/**
 * 取生效 combo：customMap 有覆盖用之，否则用 preset 默认 combo。
 * 若 presetId 不在已知预设中且无自定义，返回 undefined。
 */
export function getEffectiveCombo(
  presetId: string,
  customMap: HotkeyCustomMap
): string {
  const custom = customMap[presetId]
  if (custom?.combo && typeof custom.combo === 'string' && custom.combo.length > 0) {
    return custom.combo.toLowerCase()
  }
  const def = getDefaultCombo(presetId)
  return def ?? ''
}

/** 是否被禁用：customMap[presetId].disabled === true */
export function isPresetDisabled(
  presetId: string,
  customMap: HotkeyCustomMap
): boolean {
  return customMap[presetId]?.disabled === true
}

/**
 * 计算所有 preset 的生效状态，用于帮助弹窗 / 设置 Tab 渲染。
 * 顺序与 HOTKEY_PRESETS 一致。
 */
export function getEffectivePresets(customMap: HotkeyCustomMap): EffectivePreset[] {
  return HOTKEY_PRESETS.map((p) => ({
    ...p,
    effectiveCombo: getEffectiveCombo(p.id, customMap),
    disabled: isPresetDisabled(p.id, customMap)
  }))
}

/**
 * 冲突检测（按作用域隔离）：
 * 仅当两个 preset 的 scope 相同且 effectiveCombo 相同时才算冲突。
 * 跨 scope 的相同 combo 允许共存。
 *
 * @returns presetId → 冲突的其他 presetId 数组（仅含未禁用项）；若无冲突返回 {}
 */
export function findConflicts(
  customMap: HotkeyCustomMap
): Record<string, string[]> {
  const conflicts: Record<string, string[]> = {}

  // 仅考虑未禁用且 effectiveCombo 非空的 preset
  const candidates = HOTKEY_PRESETS.filter((p) => {
    if (isPresetDisabled(p.id, customMap)) return false
    return getEffectiveCombo(p.id, customMap).length > 0
  })

  // 按 scope + effectiveCombo 分组
  const groups = new Map<string, string[]>()
  for (const p of candidates) {
    const combo = getEffectiveCombo(p.id, customMap)
    const key = `${p.scope}::${combo}`
    const arr = groups.get(key)
    if (arr) arr.push(p.id)
    else groups.set(key, [p.id])
  }

  // 组内 ≥2 项则互相加入冲突列表
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      conflicts[id] = ids.filter((other) => other !== id)
    }
  }

  return conflicts
}

/** 序列化 customMap 为 JSON 字符串（持久化用） */
export function serializeCustomMap(map: HotkeyCustomMap): string {
  return JSON.stringify(map)
}

/**
 * 反序列化 customMap。
 * 异常或空值返回 {}。
 */
export function parseCustomMap(
  raw: string | undefined | null
): HotkeyCustomMap {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as HotkeyCustomMap
  } catch {
    return {}
  }
}
