// ============================================================
// mode.ts — 主进程数据库模式（DbMode）状态存储
//
// 为何独立成模块：
//   db/index.ts 顶层 import 了 better-sqlite3 原生绑定（Electron ABI），
//   无法在 vitest(Node ABI) 中直接加载，导致「主进程 dbMode 暴露」难以单测。
//   本模块不依赖 electron 也不依赖 better-sqlite3，纯内存状态，
//   既作为主进程 dbMode 的唯一来源（db/index.ts 使用），也可独立单测。
//
// 对外暴露：
//   - mode      当前数据库模式（persistent / memory），实时可读
//   - setMode  仅在实际发生变化时通知监听者（等价于原先 setDbMode 的广播时机）
//   - onChange  订阅模式变化，返回取消订阅函数
// ============================================================

export type DbMode = 'persistent' | 'memory'

/** 模式变化监听器 */
export type DbModeChangeListener = (mode: DbMode) => void

export interface DbModeStore {
  /** 当前数据库模式 */
  readonly mode: DbMode
  /** 切换模式：仅当值实际变化时通知监听者 */
  setMode(mode: DbMode): void
  /** 订阅模式变化，返回取消订阅函数 */
  onChange(listener: DbModeChangeListener): () => void
}

/**
 * 创建数据库模式状态存储。
 * @param initial 初始模式，默认为 'persistent'
 */
export function createDbModeStore(initial: DbMode = 'persistent'): DbModeStore {
  let current: DbMode = initial
  const listeners = new Set<DbModeChangeListener>()

  return {
    get mode() {
      return current
    },
    setMode(next: DbMode) {
      if (next === current) return
      current = next
      // 快照遍历，允许监听者内部安全取消订阅
      for (const listener of [...listeners]) {
        listener(current)
      }
    },
    onChange(listener: DbModeChangeListener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** 单例：主进程全局唯一的 dbMode 状态存储 */
export const dbModeStore = createDbModeStore()