// ============================================================
// bell-player.ts — 单例铃声试听播放器
//
// 职责：通过 preload bellAPI.playBell 获取文件绝对路径，
//      用 HTML5 Audio 在渲染进程完成播放。
//
// 行为：
//   - 同一铃声正在播放时再次调用 play(bellId) → 停止当前播放
//   - 不同铃声调用 play(bellId) → 切换到新铃声
//   - 播放结束自动清理状态并通知订阅者
//   - 支持 onStateChange(callback) 订阅状态变化
// ============================================================

export type BellPlayState = 'idle' | 'playing' | 'loading'

export interface BellPlayerState {
  /** 当前状态 */
  state: BellPlayState
  /** 当前正在播放的铃声 id（idle 时为 null） */
  currentBellId: string | null
}

export type StateChangeCallback = (state: BellPlayerState) => void

class BellPlayer {
  private audio: HTMLAudioElement | null = null
  private currentBellId: string | null = null
  private currentState: BellPlayState = 'idle'
  private listeners: Set<StateChangeCallback> = new Set()

  /** 获取当前播放状态 */
  getState(): BellPlayerState {
    return { state: this.currentState, currentBellId: this.currentBellId }
  }

  /** 当前是否正在播放 */
  isPlaying(): boolean {
    return this.currentState === 'playing'
  }

  /** 当前播放的铃声 id（无则 null） */
  getCurrentBellId(): string | null {
    return this.currentBellId
  }

  /** 订阅状态变化，返回取消订阅函数 */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * 播放铃声：
   * - 同一铃声再次点击 → 停止
   * - 不同铃声 → 切换播放
   * - 当前空闲 → 开始播放
   */
  async play(bellId: string): Promise<void> {
    // 同一铃声：停止切换
    if (this.currentBellId === bellId && this.currentState !== 'idle') {
      this.stop()
      return
    }

    // 不同铃声或空闲：先停止当前
    this.stopInternal()

    // 进入 loading 状态
    this.setState('loading', bellId)

    // 通过 preload 获取文件路径
    const res = await window.bellAPI.playBell(bellId)
    if (!res.success || !res.data) {
      // 失败：回退到 idle
      this.setState('idle', null)
      throw new Error(res.error ?? '获取铃声文件失败')
    }

    // 若 loading 期间已被 stop，则放弃这次播放
    if (this.currentBellId !== bellId) {
      return
    }

    const audio = new Audio(`file://${res.data.filePath}`)
    audio.addEventListener('ended', this.handleEnded)
    audio.addEventListener('error', this.handleEnded)

    this.audio = audio
    this.currentBellId = bellId
    this.setState('playing', bellId)

    try {
      await audio.play()
    } catch (e) {
      // 播放失败：清理状态
      this.stopInternal()
      throw e
    }
  }

  /** 停止当前播放 */
  stop(): void {
    this.stopInternal()
    // 通知主进程（保持与 preload API 对称，便于将来扩展）
    void window.bellAPI.stopBell()
  }

  // ---------- 内部方法 ----------

  private stopInternal(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
      this.audio.removeEventListener('ended', this.handleEnded)
      this.audio.removeEventListener('error', this.handleEnded)
      this.audio = null
    }
    this.currentBellId = null
    this.setState('idle', null)
  }

  private handleEnded = (): void => {
    this.stopInternal()
  }

  private setState(state: BellPlayState, bellId: string | null): void {
    this.currentState = state
    this.currentBellId = bellId
    const snapshot: BellPlayerState = { state, currentBellId: bellId }
    for (const cb of this.listeners) {
      try {
        cb(snapshot)
      } catch (e) {
        // 单个订阅者异常不应影响其他订阅者
        console.error('[bell-player] state change listener error:', e)
      }
    }
  }
}

/** 单例实例 */
export const bellPlayer = new BellPlayer()
