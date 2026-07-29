// ============================================================
// hotkey-manager.ts —— 全局快捷键管理器单例
//
// 职责：
//   1. 维护全局快捷键注册表（scope + combo → handler）
//   2. 监听 window.keydown，按当前激活 scope 分发事件
//   3. 处理修饰键解析（ctrl/shift/alt/meta）+ 焦点豁免
//   4. 提供 setScope / clearScope 由页面 useEffect 调用
//
// 设计要点：
//   - combo 规范化：统一小写，例如 'ctrl+k' / 'shift+a' / 'r' / 'escape' / 'arrowleft'
//   - 焦点在 input/textarea/contenteditable 时，单字符快捷键不触发，仅 Ctrl+/Shift+ 等修饰键组合生效
//   - 同 scope 同 combo 重复注册时 warn 并覆盖
//   - 全局 scope ('global') 始终激活，具体页面 scope 由 useHotkeyScope hook 管理
// ============================================================

export interface HotkeyRegistration {
  /** 唯一 id，由 register 返回，用于注销 */
  id: string
  /** 作用域，如 'global' / 'draw' / 'topic-library' / 'bigscreen' */
  scope: string
  /** 规范化后的组合键，如 'ctrl+k' / 'r' / 'escape' */
  combo: string
  /** 触发的回调 */
  handler: (e: KeyboardEvent) => void
  /** 用于帮助弹窗显示的描述文字 */
  description: string
  /** 是否启用，false 时不触发 */
  enabled: boolean
}

interface InternalRegistration extends HotkeyRegistration {
  /** 是否阻止默认行为 */
  preventDefault: boolean
}

const GLOBAL_SCOPE = 'global'

/**
 * 将 KeyboardEvent 解析为规范化的 combo 字符串。
 * 例如：Ctrl+K → 'ctrl+k'，Shift+A → 'shift+a'，单字符 R → 'r'，
 * 方向键 → 'arrowleft' / 'arrowright' / 'arrowup' / 'arrowdown'，
 * Escape → 'escape'，Delete → 'delete'，Backspace → 'backspace'。
 */
export function parseCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  if (e.metaKey) parts.push('meta')
  // key 已经处理了 Shift 大写，统一小写
  // 空格键 e.key 为 ' '，归一化为 'space' 以匹配注册的 combo
  const rawKey = e.key.toLowerCase()
  const key = rawKey === ' ' ? 'space' : rawKey
  parts.push(key)
  return parts.join('+')
}

/**
 * 判断当前焦点元素是否在输入框内，若是则单字符快捷键应豁免。
 */
function isTypingContext(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

/**
 * 判断 combo 是否为单字符（无修饰键），如 'r' / 'f' / '?' / '/'。
 * 这类快捷键在输入框内应豁免。
 */
function isBareCharCombo(combo: string): boolean {
  return !combo.includes('+')
}

class HotkeyManager {
  private registrations = new Map<string, InternalRegistration>()
  private activeScopes = new Set<string>([GLOBAL_SCOPE])
  /** scope 引用计数，用于 releaseScope 判断是否真正清除 */
  private scopeRefCount = new Map<string, number>()
  private listenerAttached = false
  private idCounter = 0

  /**
   * 初始化：挂载全局 keydown 监听。应在 App 启动时调用一次。
   */
  init(): void {
    if (this.listenerAttached) return
    window.addEventListener('keydown', this.handleKeyDown)
    this.listenerAttached = true
  }

  /**
   * 销毁：移除监听。一般不需要调用，应用退出时自然清理。
   */
  destroy(): void {
    if (!this.listenerAttached) return
    window.removeEventListener('keydown', this.handleKeyDown)
    this.listenerAttached = false
    this.registrations.clear()
    this.activeScopes.clear()
    this.activeScopes.add(GLOBAL_SCOPE)
  }

  /**
   * 注册一个快捷键。
   * @returns 注册 id，用于 unregister
   */
  register(params: {
    scope?: string
    combo: string
    handler: (e: KeyboardEvent) => void
    description: string
    enabled?: boolean
    preventDefault?: boolean
  }): string {
    const scope = params.scope ?? GLOBAL_SCOPE
    const combo = params.combo.toLowerCase().trim()

    // 冲突检测：同 scope 同 combo 已存在时 warn 并跳过（不覆盖）
    // 这样 BigScreenTimer 卸载时 useHotkeys cleanup 调用 unregisterBatch 不会误删 TimerPage 的注册项
    const existing = this.findRegistration(scope, combo)
    if (existing) {
      // eslint-disable-next-line no-console
      console.warn(
        `[HotkeyManager] 快捷键冲突：scope="${scope}" combo="${combo}" 已注册（描述：${existing.description}），跳过重复注册`
      )
      return existing.id
    }

    const id = `hk_${++this.idCounter}`
    this.registrations.set(id, {
      id,
      scope,
      combo,
      handler: params.handler,
      description: params.description,
      enabled: params.enabled ?? true,
      preventDefault: params.preventDefault ?? true
    })
    return id
  }

  /**
   * 注销一个快捷键。
   */
  unregister(id: string): void {
    this.registrations.delete(id)
  }

  /**
   * 批量注销。
   */
  unregisterBatch(ids: string[]): void {
    for (const id of ids) this.registrations.delete(id)
  }

  /**
   * 激活某个 scope。通常由 useHotkeyScope 在页面 mount 时调用。
   * 使用引用计数：多次 setScope 同一 scope 会累加计数。
   */
  setScope(scope: string): void {
    this.activeScopes.add(scope)
    this.scopeRefCount.set(scope, (this.scopeRefCount.get(scope) ?? 0) + 1)
  }

  /**
   * 释放对某个 scope 的引用（引用计数减 1）。
   * 当引用计数归零时才真正从 activeScopes 中移除。
   * 用于解决 BigScreenTimer 卸载时 clearScope 影响 TimerPage 的问题。
   */
  releaseScope(scope: string): void {
    if (scope === GLOBAL_SCOPE) return
    const count = (this.scopeRefCount.get(scope) ?? 0) - 1
    if (count <= 0) {
      this.scopeRefCount.delete(scope)
      this.activeScopes.delete(scope)
    } else {
      this.scopeRefCount.set(scope, count)
    }
  }

  /**
   * 停用某个 scope。通常由 useHotkeyScope 在页面 unmount 时调用。
   * 注意：此方法为强制清除，忽略引用计数。一般应优先使用 releaseScope。
   */
  clearScope(scope: string): void {
    if (scope === GLOBAL_SCOPE) return // 全局 scope 不可清除
    this.scopeRefCount.delete(scope)
    this.activeScopes.delete(scope)
  }

  /**
   * 获取所有注册项（用于帮助弹窗展示）。
   */
  getAllRegistrations(): HotkeyRegistration[] {
    return Array.from(this.registrations.values()).map(
      ({ preventDefault: _preventDefault, ...rest }) => rest
    )
  }

  /**
   * 获取当前激活的 scope 集合（用于调试）。
   */
  getActiveScopes(): string[] {
    return Array.from(this.activeScopes)
  }

  // ---------- 内部方法 ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    const combo = parseCombo(e)
    const typing = isTypingContext()

    // 按优先级查找匹配的注册项：具体 scope 优先于 global
    const matched = this.findMatchingRegistration(combo, typing)
    if (!matched) {
      // 没有启用的注册项匹配，但可能存在 enabled=false 的注册项匹配
      // 此时仍需 preventDefault 阻止浏览器默认行为（如 Space 触发按钮 click、ArrowLeft 滚动页面）
      const anyMatched = this.findMatchingRegistration(combo, typing, true)
      if (anyMatched && anyMatched.preventDefault) {
        e.preventDefault()
      }
      return
    }

    if (!matched.enabled) {
      // 即使 enabled=false，也 preventDefault 阻止默认行为
      if (matched.preventDefault) {
        e.preventDefault()
      }
      return
    }

    if (matched.preventDefault) {
      e.preventDefault()
    }
    matched.handler(e)
  }

  /**
   * 在激活的 scope 中查找匹配 combo 的注册项。
   * 优先级：具体 scope > global scope。
   * 同一 scope 内后注册的优先（覆盖旧的，已在 register 时处理）。
   *
   * 注意：默认情况下 enabled=false 的注册项会被跳过，继续查找下一个匹配。
   * 这样允许 TimerPage 的 timer::space 在大屏打开时 enabled=false，
   * 让 BigScreenTimer 的 timer-bigscreen::space 被匹配到。
   *
   * @param includeDisabled 是否包含 enabled=false 的注册项。
   *   传 true 时用于判断是否需要 preventDefault 阻止浏览器默认行为，
   *   此时即使所有匹配项都 enabled=false，也认为 combo 被"占用"。
   */
  private findMatchingRegistration(
    combo: string,
    typing: boolean,
    includeDisabled = false
  ): InternalRegistration | null {
    // 先在具体 scope（非 global）中查找
    let bestMatch: InternalRegistration | null = null
    for (const reg of this.registrations.values()) {
      if (reg.combo !== combo) continue
      if (!this.activeScopes.has(reg.scope)) continue
      // 输入框豁免：若在输入框内且 combo 是单字符，跳过
      if (typing && isBareCharCombo(reg.combo)) continue
      // 跳过 enabled=false 的注册项，继续查找下一个匹配（除非 includeDisabled）
      if (!includeDisabled && !reg.enabled) continue
      // 具体 scope 优先于 global
      if (reg.scope === GLOBAL_SCOPE) {
        if (!bestMatch) bestMatch = reg
      } else {
        bestMatch = reg
        break
      }
    }
    return bestMatch
  }

  private findRegistration(
    scope: string,
    combo: string
  ): InternalRegistration | null {
    for (const reg of this.registrations.values()) {
      if (reg.scope === scope && reg.combo === combo) return reg
    }
    return null
  }
}

/** 全局单例 */
export const hotkeyManager = new HotkeyManager()
