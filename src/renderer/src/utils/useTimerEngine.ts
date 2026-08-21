// ============================================================
// useTimerEngine.ts — 计时引擎 hook（rAF 驱动）
//
// 职责：
// 1. 维护计时状态（idle/running/paused/finished）
// 2. rAF 驱动倒计时（支持 graceMs 宽限期）
// 3. 触发铃声回调
// 4. 环节自动/手动切换
// 5. 自由辩论发言方切换（switchSide）— 单方独立计时
// 6. 环节开始/结束写入计时记录（addRecord/finishRecord）
// 7. 统计暂停次数（pauseCount）
// 8. prevStage/nextStage 时间缓存（完全保留策略）
// 9. 环节重置（resetStage）与全场重置（reset）分离
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BellDef, DebateFormatData, StageSide, StageCacheValue, TimerSession, TimerState } from '../../../shared/types'
import type { StageDef } from '../../../shared/debate-formats/types'
import { checkBells } from './timer-bells'
import { resolveInitialSide } from '../../../shared/debate-formats/utils'

export interface TimerEngineCallbacks {
  onBell: (stageIndex: number, bell: BellDef) => void
  onStageEnd: (stageIndex: number) => void
  /** 进入/开始某环节时回调（start、next/prev/finishStage 与倒计时自动切换统一触发），用于计时录音标记环节 */
  onStageStart?: (stageIndex: number) => void
  onFinish: () => void
  onStateChange: (state: TimerState) => void
}

interface UseTimerEngineOpts {
  format: DebateFormatData
  callbacks: TimerEngineCallbacks
}

/** 自由辩论环节：从 cache 值取正方剩余时间 */
function getAffFromCache(v: StageCacheValue | null, fallback: number): number {
  if (v == null) return fallback
  if (typeof v === 'number') return fallback
  return v.aff
}

/** 自由辩论环节：从 cache 值取反方剩余时间 */
function getNegFromCache(v: StageCacheValue | null, fallback: number): number {
  if (v == null) return fallback
  if (typeof v === 'number') return fallback
  return v.neg
}

// ============ 每队总时长池（后手） ============

/** 是否启用队伍总时长池（formatData.teamPoolMinutes 存在） */
function hasTeamPool(format: DebateFormatData): boolean {
  return !!format.teamPoolMinutes
}

/** 计算某队总池初始值（毫秒）：优先 teamPoolMinutes（分钟），否则按该队所有 poolSuggestedMs 之和 */
function poolInitMs(format: DebateFormatData, team: 'aff' | 'neg'): number {
  const provided = format.teamPoolMinutes?.[team]
  if (provided != null && provided > 0) return provided * 60000
  const sum = format.stages
    .filter((s) => s.poolTeam === team)
    .reduce((acc, s) => acc + (s.poolSuggestedMs ?? 0), 0)
  return sum > 0 ? sum : 0
}

/**
 * pool 环节：返回该队当前池剩余（作为 remainingMs 与展示来源）；非 pool 环节返回 null。
 * 自由辩论（isFreeDebate）不占用总池，仍走各自 4' 逻辑。
 */
function poolRemainingForStage(
  format: DebateFormatData,
  stage: StageDef | undefined,
  affPool: number | undefined,
  negPool: number | undefined
): number | null {
  if (!hasTeamPool(format) || !stage || stage.isFreeDebate) return null
  if (stage.poolTeam === 'aff') return affPool ?? 0
  if (stage.poolTeam === 'neg') return negPool ?? 0
  return null
}

/**
 * 创建初始状态。
 * - 自由辩论环节下，affRemainingMs/negRemainingMs 初始化为单方时长（durationMs）。
 * - remainingMs 在自由辩论环节下表示"当前发言方的剩余时间"。
 * - stageRemainingMsCache 用于 prevStage 完全保留策略。
 * - existingCache 用于 loadSession 恢复（start 新建会话不传，cache = {}）。
 * - 首次进入第 0 环节时立即写入 cache，避免 prevStage 兜底为 durationMs。
 *
 * M3 修复：兼容 existingCache 中 cache[0] 类型与首环节 isFreeDebate 不一致的情况。
 * 旧数据可能存的是 number，但首环节是自由辩论；此时转换为 {aff,neg} 对象。
 */
function createInitialState(
  format: DebateFormatData,
  sessionId: string,
  existingCache?: Record<number, StageCacheValue>
): TimerState {
  const firstStage = format.stages[0]
  const cache: Record<number, StageCacheValue> = existingCache ? { ...existingCache } : {}
  // 首次进入第 0 环节，立即写入 cache
  if (firstStage?.isFreeDebate) {
    const existing = cache[0]
    if (existing === undefined) {
      cache[0] = { aff: firstStage.durationMs, neg: firstStage.durationMs }
    } else if (typeof existing === 'number') {
      // M3: 旧数据 cache[0] 为 number 但首环节是自由辩论，转换为对象
      cache[0] = { aff: existing, neg: existing }
    }
  } else if (cache[0] === undefined) {
    cache[0] = firstStage?.durationMs ?? 0
  }
  // 队伍总时长池：带 teamPoolMinutes 的赛制初始化双方池剩余
  const poolAff = hasTeamPool(format) ? poolInitMs(format, 'aff') : undefined
  const poolNeg = hasTeamPool(format) ? poolInitMs(format, 'neg') : undefined
  // 首环节为 pool 环节时，剩余时间 = 该队池剩余
  const firstPoolRemaining = poolRemainingForStage(format, firstStage, poolAff, poolNeg)
  const state: TimerState = {
    sessionId,
    status: 'idle',
    currentStageIndex: 0,
    currentSide: resolveInitialSide(firstStage),
    remainingMs: firstPoolRemaining ?? firstStage?.durationMs ?? 0,
    elapsedMs: 0,
    pausedAt: null,
    lastBellIndex: 0,
    stageRemainingMsCache: cache,
    affPoolRemainingMs: poolAff,
    negPoolRemainingMs: poolNeg,
    affSpeechCount: 0,
    negSpeechCount: 0
  }
  if (firstStage?.isFreeDebate) {
    state.affRemainingMs = firstStage.durationMs
    state.negRemainingMs = firstStage.durationMs
  }
  return state
}

export function useTimerEngine(opts: UseTimerEngineOpts) {
  const { format, callbacks } = opts
  const [state, setState] = useState<TimerState>(() => createInitialState(format, ''))
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  // 记录写入所需的 ref
  const sessionIdRef = useRef<string>('')
  const stageStartedAtRef = useRef<number>(0)
  const pauseCountRef = useRef<number>(0)
  // P4 修复：累计当前环节暂停时长，用于 handleStageEnd 计算 actualMs 时扣除暂停时间
  // 避免实际耗时被暂停时长虚增（原代码 actualMs = Date.now() - stageStartedAtRef 包含暂停时长）
  const pauseDurationRef = useRef<number>(0)
  const pauseStartRef = useRef<number>(0)

  // 同步状态快照，用于在事件处理中读取最新状态而不依赖闭包
  const stateRef = useRef(state)
  stateRef.current = state

  // Critical-5 修复：统一通过 useEffect 监听 state 变化触发 onStateChange 持久化。
  // 替代原 tick 中的 pendingStateChange 和 switchSide 中的 queueMicrotask 方案。
  // restoreState 时设置 skipPersistRef，避免从 DB 恢复后立即写回。
  const skipPersistRef = useRef(false)

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // 环节开始：写入 addRecord + 重置 pauseCount + 记录起始时间
  // L4 修复：side 字段若 currentSide 为 'both' 或 null，用 resolveInitialSide 兜底，
  // 避免自由辩论环节下 record.side 永远为 'both'。
  // Task 7.2：untimed 环节开始时播放 atMs != 0 的铃声（按 atMs 升序），
  // 因为 untimed 环节跳过 tick，常规铃声检查不会触发。
  const handleStageStart = useCallback(async (stageIndex: number) => {
    const stage = format.stages[stageIndex]
    if (!stage || !sessionIdRef.current) return
    // 进入环节通知（计时录音在此打环节/发言人标记）
    callbacksRef.current.onStageStart?.(stageIndex)
    stageStartedAtRef.current = Date.now()
    pauseCountRef.current = 0
    // P4 修复：新环节开始时重置累计暂停时长
    pauseDurationRef.current = 0
    // 非计时环节：开始时播放 atMs != 0 的铃声（tick 被跳过，需在此手动触发）
    if (stage.timingMode === 'untimed') {
      const startBells = stage.bells
        .filter((b) => b.atMs !== 0)
        .sort((a, b) => a.atMs - b.atMs)
      startBells.forEach((bell) => {
        callbacksRef.current.onBell(stageIndex, bell)
      })
    }
    // 优先用当前 currentSide（自由辩论环节下记录实际发言方）
    // currentSide 为 'both' 或 null 时，用 resolveInitialSide 兜底
    const cur = stateRef.current.currentSide
    const sideToRecord: StageSide = (cur && cur !== 'both')
      ? cur
      : resolveInitialSide(stage)
    try {
      await window.timerAPI.addRecord({
        sessionId: sessionIdRef.current,
        stageIndex,
        stageName: stage.name,
        side: sideToRecord,
        durationMs: stage.durationMs,
        startedAt: new Date(stageStartedAtRef.current).toISOString()
      })
    } catch {
      // 记录写入失败不影响计时主流程
    }
  }, [format])

  // 环节结束：写入 finishRecord
  // Task 7.2：untimed 环节结束时播放 atMs == 0 的铃声（时间到铃声）
  const handleStageEnd = useCallback(async (stageIndex: number) => {
    if (!sessionIdRef.current) return
    // 非计时环节：结束时播放 atMs == 0 的铃声
    const stage = format.stages[stageIndex]
    if (stage?.timingMode === 'untimed') {
      const endBells = stage.bells.filter((b) => b.atMs === 0)
      endBells.forEach((bell) => {
        callbacksRef.current.onBell(stageIndex, bell)
      })
    }
    // P4 修复：扣除累计暂停时长，避免 actualMs 被暂停时间虚增
    const actualMs = Date.now() - stageStartedAtRef.current - pauseDurationRef.current
    try {
      await window.timerAPI.finishRecord(
        sessionIdRef.current,
        stageIndex,
        actualMs,
        new Date().toISOString(),
        pauseCountRef.current
      )
    } catch {
      // 同上
    }
  }, [format])

  const tick = useCallback((now: number) => {
    const delta = now - lastTickRef.current
    lastTickRef.current = now

    // 本帧待触发的副作用（在 setState 外执行，StrictMode 安全：不会被双倍调用）
    const pendingBells: Array<{ stageIndex: number; bell: BellDef }> = []
    const pendingStageEnd: number[] = []
    const pendingStageStart: number[] = []
    let pendingFinish = false
    // P4-15: untimed 环节标记跳过下一帧 rAF 注册（无倒计时需求，避免空转消耗 CPU）
    let skipNextRaf = false

    setState((prev) => {
      if (prev.status !== 'running') return prev

      const stage = format.stages[prev.currentStageIndex]
      if (!stage) return prev

      // Task 7.2：非计时环节跳过 tick 递减，不修改 remainingMs。
      // P4-15：untimed 环节无需 rAF 驱动倒计时，标记 skipNextRaf 以停止下一帧注册，
      // 避免 rAF 空转消耗 CPU。running 状态由 status 字段维持，不依赖 rAF 持续运行。
      // 用户可通过 Space 或按钮触发 finishStage 进入下一环节。
      if (stage.timingMode === 'untimed') {
        skipNextRaf = true
        return prev
      }

      const graceMs = stage.graceMs ?? 0
      const isFree = !!stage.isFreeDebate
      const newElapsed = prev.elapsedMs + delta

      if (isFree) {
        // ===== 自由辩论：双计时器模型 =====
        // currentSide 强制为 aff/neg（resolveInitialSide 已保证，这里再防御）
        const side: StageSide = prev.currentSide === 'neg' ? 'neg' : 'aff'
        const curAff = prev.affRemainingMs ?? stage.durationMs
        const curNeg = prev.negRemainingMs ?? stage.durationMs
        const curRemaining = side === 'aff' ? curAff : curNeg
        const newRemaining = curRemaining - delta
        const newAff = side === 'aff' ? newRemaining : curAff
        const newNeg = side === 'neg' ? newRemaining : curNeg

        // 铃声检查（基于当前方剩余）
        const { bellsToPlay, newLastBellIndex } = checkBells(
          stage,
          curRemaining,
          newRemaining,
          prev.lastBellIndex
        )
        bellsToPlay.forEach((bell) => {
          pendingBells.push({ stageIndex: prev.currentStageIndex, bell })
        })

        // 当中方 ≤0：
        // - 另一方还有时间 → 立即切换方
        // - 另一方也无时间 → 在 graceMs 宽限期内继续倒计时（变负），
        //   超过 graceMs 才进入下一环节（M6 修复：原逻辑双方都 ≤0 立即进下一环节）
        if (newRemaining <= 0) {
          const otherSide: StageSide = side === 'aff' ? 'neg' : 'aff'
          const otherRemaining = otherSide === 'aff' ? newAff : newNeg
          if (otherRemaining > 0) {
            // 切换发言方
            return {
              ...prev,
              currentSide: otherSide,
              remainingMs: otherRemaining,
              affRemainingMs: newAff,
              negRemainingMs: newNeg,
              elapsedMs: newElapsed,
              lastBellIndex: 0
            }
          }
          // 双方都 ≤0：检查是否仍在 graceMs 宽限期内
          if (newRemaining > 0 - graceMs) {
            // 宽限期内：继续倒计时（当前方时间为负），不进入下一环节
            return {
              ...prev,
              remainingMs: newRemaining,
              affRemainingMs: newAff,
              negRemainingMs: newNeg,
              elapsedMs: newElapsed,
              lastBellIndex: newLastBellIndex
            }
          }
          // 超过 graceMs：进入下一环节
          pendingStageEnd.push(prev.currentStageIndex)
          const nextIndex = prev.currentStageIndex + 1
          if (nextIndex >= format.stages.length) {
            pendingFinish = true
            return {
              ...prev,
              remainingMs: 0,
              affRemainingMs: 0,
              negRemainingMs: 0,
              elapsedMs: newElapsed,
              status: 'finished',
              lastBellIndex: newLastBellIndex
            }
          }
          const nextStage = format.stages[nextIndex]
          const tickNewCache: Record<number, StageCacheValue> = { ...(prev.stageRemainingMsCache ?? {}) }
          if (tickNewCache[nextIndex] === undefined) {
            tickNewCache[nextIndex] = nextStage.isFreeDebate
              ? { aff: nextStage.durationMs, neg: nextStage.durationMs }
              : nextStage.durationMs
          }
          const nextCacheVal = tickNewCache[nextIndex]
          const nextRemaining = typeof nextCacheVal === 'number' ? nextCacheVal : nextCacheVal.aff
          // 下一环节为 pool 环节：剩余时间 = 该队池剩余（自由辩论不占池，池在 prev 中保持不变）
          const nextPoolRemaining = poolRemainingForStage(format, nextStage, prev.affPoolRemainingMs, prev.negPoolRemainingMs)
          const finalNextRemaining = nextPoolRemaining ?? nextRemaining
          pendingStageStart.push(nextIndex)
          return {
            ...prev,
            status: 'paused',
            pausedAt: new Date().toISOString(),
            currentStageIndex: nextIndex,
            currentSide: resolveInitialSide(nextStage),
            remainingMs: finalNextRemaining,
            affRemainingMs: nextStage.isFreeDebate
              ? getAffFromCache(nextCacheVal, nextStage.durationMs)
              : undefined,
            negRemainingMs: nextStage.isFreeDebate
              ? getNegFromCache(nextCacheVal, nextStage.durationMs)
              : undefined,
            elapsedMs: newElapsed,
            lastBellIndex: 0,
            stageRemainingMsCache: tickNewCache
          }
        }

        // 继续倒计时
        return {
          ...prev,
          remainingMs: newRemaining,
          affRemainingMs: newAff,
          negRemainingMs: newNeg,
          elapsedMs: newElapsed,
          lastBellIndex: newLastBellIndex
        }
      }

      // ===== 非自由辩论：单计时器模型（原逻辑） =====
      // 队伍总时长池：pool 环节从该队池剩余倒计时并消耗，非 pool 环节走原 remainingMs
      const poolRemaining = poolRemainingForStage(format, stage, prev.affPoolRemainingMs, prev.negPoolRemainingMs)
      const isPoolStage = poolRemaining !== null
      let newAffPool = prev.affPoolRemainingMs
      let newNegPool = prev.negPoolRemainingMs
      const sourceRemaining = isPoolStage ? (poolRemaining as number) : prev.remainingMs
      const newRemaining = sourceRemaining - delta
      if (isPoolStage) {
        if (stage.poolTeam === 'aff') newAffPool = newRemaining
        else newNegPool = newRemaining
      }
      const { bellsToPlay, newLastBellIndex } = checkBells(
        stage,
        sourceRemaining,
        newRemaining,
        prev.lastBellIndex
      )
      bellsToPlay.forEach((bell) => {
        pendingBells.push({ stageIndex: prev.currentStageIndex, bell })
      })

      if (newRemaining <= 0 - graceMs) {
        pendingStageEnd.push(prev.currentStageIndex)
        const nextIndex = prev.currentStageIndex + 1
        if (nextIndex >= format.stages.length) {
          pendingFinish = true
          return {
            ...prev,
            remainingMs: 0,
            affPoolRemainingMs: newAffPool,
            negPoolRemainingMs: newNegPool,
            elapsedMs: newElapsed,
            status: 'finished',
            lastBellIndex: newLastBellIndex
          }
        }
        const nextStage = format.stages[nextIndex]
        const tickNewCache: Record<number, StageCacheValue> = { ...(prev.stageRemainingMsCache ?? {}) }
        if (tickNewCache[nextIndex] === undefined) {
          tickNewCache[nextIndex] = nextStage.isFreeDebate
            ? { aff: nextStage.durationMs, neg: nextStage.durationMs }
            : nextStage.durationMs
        }
        const nextCacheVal = tickNewCache[nextIndex]
        // 下一环节为 pool 环节：剩余时间 = 该队池剩余；否则用缓存
        const nextPoolRemaining = poolRemainingForStage(format, nextStage, newAffPool, newNegPool)
        const nextRemaining = nextPoolRemaining ?? (typeof nextCacheVal === 'number' ? nextCacheVal : nextCacheVal.aff)
        pendingStageStart.push(nextIndex)
        return {
          ...prev,
          status: 'paused',
          pausedAt: new Date().toISOString(),
          currentStageIndex: nextIndex,
          currentSide: resolveInitialSide(nextStage),
          remainingMs: nextRemaining,
          affPoolRemainingMs: newAffPool,
          negPoolRemainingMs: newNegPool,
          affRemainingMs: nextStage.isFreeDebate
            ? getAffFromCache(nextCacheVal, nextStage.durationMs)
            : undefined,
          negRemainingMs: nextStage.isFreeDebate
            ? getNegFromCache(nextCacheVal, nextStage.durationMs)
            : undefined,
          elapsedMs: newElapsed,
          lastBellIndex: 0,
          stageRemainingMsCache: tickNewCache
        }
      }

      return {
        ...prev,
        remainingMs: newRemaining,
        affPoolRemainingMs: newAffPool,
        negPoolRemainingMs: newNegPool,
        elapsedMs: newElapsed,
        lastBellIndex: newLastBellIndex
      }
    })

    // 在 setState 之外执行副作用（StrictMode 安全：不会被双倍调用）
    pendingBells.forEach(({ stageIndex, bell }) => {
      callbacksRef.current.onBell(stageIndex, bell)
    })
    pendingStageEnd.forEach((stageIndex) => {
      callbacksRef.current.onStageEnd(stageIndex)
      void handleStageEnd(stageIndex)
    })
    pendingStageStart.forEach((stageIndex) => {
      void handleStageStart(stageIndex)
    })
    if (pendingFinish) {
      callbacksRef.current.onFinish()
    }
    // Critical-5 修复：onStateChange 由 useEffect 监听 state 统一触发，
    // 不再在 tick 中手动调用，避免遗漏。

    // 注册下一帧：只要本帧没有触发 pendingFinish 且未处于 untimed 环节，就继续 tick。
    // state.status 变为 finished/paused 时由 useEffect 监听并 stopRaf，
    // 这里不再依赖 stateRef.current.status（setState 异步，可能仍是旧值）。
    // P4-15: untimed 环节 skipNextRaf=true，不再注册下一帧，避免 rAF 空转消耗 CPU；
    // 后续 finishStage/nextStage 切换到 timed 环节时由 useEffect 重新启动 rAF。
    if (!pendingFinish && !skipNextRaf) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [format, handleStageEnd, handleStageStart])

  // 监听 state.status 变化，自动管理 rAF（修复 start 启动 bug）
  // - running 时若 rafRef 为空则启动 rAF（首次启动 / 从 paused 恢复）
  // - 非 running 时 stopRaf（finished/paused/idle）
  // tick 内部只要 !pendingFinish && !skipNextRaf 就会自行注册下一帧，此处仅负责启动与停止。
  // P4-15: untimed 环节不启动 rAF（无倒计时需求，避免空转消耗 CPU）。
  // running 状态由 status 字段维持，用户通过 Space/按钮触发 finishStage 进入下一环节；
  // 切换到 timed 环节时 currentStageIndex 变化触发本 effect 重新评估并启动 rAF。
  useEffect(() => {
    if (state.status === 'running') {
      const stage = format.stages[state.currentStageIndex]
      if (stage?.timingMode === 'untimed') {
        // untimed 环节：确保 rAF 已停止，不启动新循环
        stopRaf()
        return
      }
      if (rafRef.current === null) {
        lastTickRef.current = performance.now()
        rafRef.current = requestAnimationFrame(tick)
      }
    } else {
      stopRaf()
    }
  }, [state.status, state.currentStageIndex, format, tick, stopRaf])

  const start = useCallback((sessionId: string) => {
    sessionIdRef.current = sessionId
    pauseCountRef.current = 0
    lastTickRef.current = performance.now()
    // Task 11.2：合并为单次 setState，直接构造 running 状态。
    // 原代码两次 setState（先 createInitialState 设 idle，再设 running），
    // React 批处理可能导致 rAF 启动时状态仍是 idle，tick 直接 return，倒计时不工作。
    setState(() => {
      const initial = createInitialState(format, sessionId)
      return { ...initial, status: 'running' as const }
    })
    void handleStageStart(0)
    // rAF 由 useEffect 监听 state.status 自动启动
  }, [format, handleStageStart])

  const pause = useCallback(() => {
    // 通过 stateRef 读取最新状态，避免不必要的 setState 调用
    if (stateRef.current.status !== 'running') return
    stopRaf()
    // P4 修复：记录暂停开始时间，供 resume 累计暂停时长
    pauseStartRef.current = Date.now()
    // P2-26: 将 pauseCountRef 递增移入 setState 更新器，
    // 利用 React 批处理中更新器顺序执行特性，第二次调用时 prev.status 已为 'paused'，
    // 避免连续两次 pause() 导致 pauseCountRef 重复递增。
    setState((prev) => {
      if (prev.status !== 'running') return prev
      pauseCountRef.current += 1
      return { ...prev, status: 'paused', pausedAt: new Date().toISOString() }
    })
  }, [stopRaf])

  const resume = useCallback(() => {
    setState((prev) => {
      if (prev.status !== 'paused') return prev
      // P4 修复：累加本次暂停时长到 pauseDurationRef，供 handleStageEnd 扣除
      if (pauseStartRef.current > 0) {
        pauseDurationRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = 0
      }
      lastTickRef.current = performance.now()
      return { ...prev, status: 'running', pausedAt: null }
    })
    // rAF 由 useEffect 监听 state.status 自动启动
  }, [])

  /**
   * 进入下一环节。
   * - 保存当前环节的 remainingMs 到 stageRemainingMsCache（用于 prevStage 完全保留）
   * - 从 cache 恢复下一环节时间，若无则用初始 durationMs
   * - 自由辩论环节下，恢复 affRemainingMs/negRemainingMs
   */
  const nextStage = useCallback(() => {
    const cur = stateRef.current
    const targetIdx = cur.currentStageIndex + 1
    if (targetIdx >= format.stages.length) return
    // P1-3 修复：跳过环节前结束当前环节计时记录
    void handleStageEnd(cur.currentStageIndex)
    stopRaf()
    setState((prev) => {
      const nextIndex = prev.currentStageIndex + 1
      if (nextIndex >= format.stages.length) return prev
      // 保存当前环节到 cache（自由辩论环节存双方独立时间）
      const newCache: Record<number, StageCacheValue> = { ...(prev.stageRemainingMsCache ?? {}) }
      const curStage = format.stages[prev.currentStageIndex]
      if (curStage?.isFreeDebate) {
        newCache[prev.currentStageIndex] = {
          aff: prev.affRemainingMs ?? prev.remainingMs,
          neg: prev.negRemainingMs ?? prev.remainingMs
        }
      } else {
        newCache[prev.currentStageIndex] = prev.remainingMs
      }

      const nextStageDef = format.stages[nextIndex]
      // 从 cache 恢复，若无则用初始 durationMs
      const cachedVal = newCache[nextIndex]
      const cachedRemaining = typeof cachedVal === 'number'
        ? cachedVal
        : (cachedVal?.aff ?? nextStageDef.durationMs)
      // 兜底：若 cache 缺该 idx，立即写入初始时长
      if (newCache[nextIndex] === undefined) {
        newCache[nextIndex] = nextStageDef.isFreeDebate
          ? { aff: nextStageDef.durationMs, neg: nextStageDef.durationMs }
          : nextStageDef.durationMs
      }

      // 下一环节为 pool 环节：剩余时间 = 该队池剩余（覆盖 cache 值）
      const nextPoolRemaining = nextStageDef.isFreeDebate
        ? null
        : poolRemainingForStage(format, nextStageDef, prev.affPoolRemainingMs, prev.negPoolRemainingMs)
      const finalRemaining = nextPoolRemaining ?? cachedRemaining

      const nextState: TimerState = {
        ...prev,
        status: 'paused',
        pausedAt: new Date().toISOString(),
        currentStageIndex: nextIndex,
        currentSide: resolveInitialSide(nextStageDef),
        remainingMs: finalRemaining,
        affPoolRemainingMs: prev.affPoolRemainingMs,
        negPoolRemainingMs: prev.negPoolRemainingMs,
        lastBellIndex: 0,
        stageRemainingMsCache: newCache
      }
      if (nextStageDef.isFreeDebate) {
        // 自由辩论环节：恢复双方独立计时器
        const cachedAff = typeof cachedVal === 'number' ? cachedVal : (cachedVal?.aff ?? nextStageDef.durationMs)
        const cachedNeg = typeof cachedVal === 'number' ? cachedVal : (cachedVal?.neg ?? nextStageDef.durationMs)
        nextState.affRemainingMs = cachedAff
        nextState.negRemainingMs = cachedNeg
      } else {
        // 非自由辩论环节：清空双方计时器字段
        nextState.affRemainingMs = undefined
        nextState.negRemainingMs = undefined
      }
      return nextState
    })
    // P1-3 修复：进入新环节后开始计时记录
    void handleStageStart(targetIdx)
  }, [format, stopRaf, handleStageEnd, handleStageStart])

  /**
   * 回到上一环节。
   * - 保存当前环节的 remainingMs 到 stageRemainingMsCache
   * - 从 cache 恢复上一环节时间，若无则用初始 durationMs
   * - 自由辩论环节下，恢复 affRemainingMs/negRemainingMs
   */
  const prevStage = useCallback(() => {
    const cur = stateRef.current
    if (cur.currentStageIndex <= 0) return
    const targetIdx = cur.currentStageIndex - 1
    // P1-3 修复：回退环节前结束当前环节计时记录
    void handleStageEnd(cur.currentStageIndex)
    stopRaf()
    setState((prev) => {
      if (prev.currentStageIndex <= 0) return prev
      // 保存当前环节到 cache（自由辩论环节存双方独立时间）
      const newCache: Record<number, StageCacheValue> = { ...(prev.stageRemainingMsCache ?? {}) }
      const curStage = format.stages[prev.currentStageIndex]
      if (curStage?.isFreeDebate) {
        newCache[prev.currentStageIndex] = {
          aff: prev.affRemainingMs ?? prev.remainingMs,
          neg: prev.negRemainingMs ?? prev.remainingMs
        }
      } else {
        newCache[prev.currentStageIndex] = prev.remainingMs
      }

      const prevIdx = prev.currentStageIndex - 1
      const prevStageDef = format.stages[prevIdx]
      // 从 cache 恢复，若无则用初始 durationMs
      const cachedVal = newCache[prevIdx]
      const cachedRemaining = typeof cachedVal === 'number'
        ? cachedVal
        : (cachedVal?.aff ?? prevStageDef.durationMs)
      // 兜底：若 cache 缺该 idx，立即写入初始时长
      if (newCache[prevIdx] === undefined) {
        newCache[prevIdx] = prevStageDef.isFreeDebate
          ? { aff: prevStageDef.durationMs, neg: prevStageDef.durationMs }
          : prevStageDef.durationMs
      }

      // 上一环节为 pool 环节：剩余时间 = 该队池剩余（覆盖 cache 值）
      const prevPoolRemaining = prevStageDef.isFreeDebate
        ? null
        : poolRemainingForStage(format, prevStageDef, prev.affPoolRemainingMs, prev.negPoolRemainingMs)
      const finalRemaining = prevPoolRemaining ?? cachedRemaining

      const nextState: TimerState = {
        ...prev,
        status: 'paused',
        pausedAt: new Date().toISOString(),
        currentStageIndex: prevIdx,
        currentSide: resolveInitialSide(prevStageDef),
        remainingMs: finalRemaining,
        affPoolRemainingMs: prev.affPoolRemainingMs,
        negPoolRemainingMs: prev.negPoolRemainingMs,
        lastBellIndex: 0,
        stageRemainingMsCache: newCache
      }
      if (prevStageDef.isFreeDebate) {
        const cachedAff = typeof cachedVal === 'number' ? cachedVal : (cachedVal?.aff ?? prevStageDef.durationMs)
        const cachedNeg = typeof cachedVal === 'number' ? cachedVal : (cachedVal?.neg ?? prevStageDef.durationMs)
        nextState.affRemainingMs = cachedAff
        nextState.negRemainingMs = cachedNeg
      } else {
        nextState.affRemainingMs = undefined
        nextState.negRemainingMs = undefined
      }
      return nextState
    })
    // P1-3 修复：回退到上一环节后开始计时记录
    void handleStageStart(targetIdx)
  }, [format, stopRaf, handleStageEnd, handleStageStart])

  const addTime = useCallback((ms: number) => {
    setState((prev) => {
      const stage = format.stages[prev.currentStageIndex]
      const isFree = !!stage?.isFreeDebate
      // 自由辩论环节下，加时仅作用于当前发言方
      const newRemaining = prev.remainingMs + ms
      if (isFree) {
        if (prev.currentSide === 'aff') {
          return {
            ...prev,
            remainingMs: newRemaining,
            affRemainingMs: newRemaining
          }
        } else if (prev.currentSide === 'neg') {
          return {
            ...prev,
            remainingMs: newRemaining,
            negRemainingMs: newRemaining
          }
        }
        // P2-27: currentSide 非 aff/neg（如 'both' 或 null）时同步双方独立计时器与 remainingMs，
        // 避免加时后 aff/neg 计时器与 remainingMs 脱节导致 tick 中时间计算异常
        return {
          ...prev,
          remainingMs: newRemaining,
          affRemainingMs: newRemaining,
          negRemainingMs: newRemaining
        }
      }
      // 非自由辩论环节，允许 remainingMs 为负（宽限期内）
      // pool 环节：加时同时加到该队池剩余与 remainingMs
      if (stage?.poolTeam === 'aff') {
        return { ...prev, remainingMs: newRemaining, affPoolRemainingMs: newRemaining }
      }
      if (stage?.poolTeam === 'neg') {
        return { ...prev, remainingMs: newRemaining, negPoolRemainingMs: newRemaining }
      }
      return { ...prev, remainingMs: newRemaining }
    })
  }, [format])

  /**
   * 自由辩论发言方切换：单方独立计时。
   * - 保存当前方剩余时间到 affRemainingMs/negRemainingMs
   * - 切换 currentSide 到另一方
   * - 将 remainingMs 设为另一方的剩余时间
   * - 重置 lastBellIndex（铃声重新检查）
   * - 发言次数记录：每次切到某方开始发言时，该方发言次数 +1
   *   （正/反方各自计数；与复位语义一致：reset 归零，resetStage 归零）
   * - Critical-5 修复：onStateChange 由 useEffect 统一触发，无需手动 queueMicrotask
   */
  const switchSide = useCallback(() => {
    setState((prev) => {
      if (prev.status !== 'running' && prev.status !== 'paused') return prev
      const stage = format.stages[prev.currentStageIndex]
      if (!stage?.isFreeDebate) return prev
      const next: StageSide = prev.currentSide === 'aff' ? 'neg' : 'aff'
      // 保存当前方剩余时间
      const newAff = prev.currentSide === 'aff' ? prev.remainingMs : prev.affRemainingMs
      const newNeg = prev.currentSide === 'neg' ? prev.remainingMs : prev.negRemainingMs
      // 切换到另一方的剩余时间
      const nextRemaining = next === 'aff' ? (newAff ?? stage.durationMs) : (newNeg ?? stage.durationMs)
      return {
        ...prev,
        currentSide: next,
        remainingMs: nextRemaining,
        affRemainingMs: newAff,
        negRemainingMs: newNeg,
        // 每次「切到某方开始发言」时该方 +1
        affSpeechCount: (prev.affSpeechCount ?? 0) + (next === 'aff' ? 1 : 0),
        negSpeechCount: (prev.negSpeechCount ?? 0) + (next === 'neg' ? 1 : 0),
        lastBellIndex: 0
      }
    })
  }, [format])

  const finish = useCallback(() => {
    stopRaf()
    setState((prev) => ({ ...prev, status: 'finished' }))
  }, [stopRaf])

  /**
   * 结束当前环节（E 键「时间到」用）：
   * - 写入 finishRecord
   * - 进入下一环节（若非最后环节），从 cache 恢复或用初始时长
   * - 最后环节则 finish
   */
  const finishStage = useCallback(() => {
    const prev = stateRef.current
    if (prev.status !== 'running' && prev.status !== 'paused') return
    void handleStageEnd(prev.currentStageIndex)
    const nextIndex = prev.currentStageIndex + 1
    if (nextIndex >= format.stages.length) {
      // 最后环节：直接 finish
      stopRaf()
      setState((s) => ({ ...s, status: 'finished', remainingMs: 0 }))
      callbacksRef.current.onFinish()
      return
    }
    // 进入下一环节
    const newCache: Record<number, StageCacheValue> = { ...(prev.stageRemainingMsCache ?? {}) }
    // Medium-3 修复：自由辩论环节 cache 类型一致性。
    // 原代码固定写 0（number），但自由辩论环节 cache 应为 { aff, neg } 对象，
    // 否则 prevStage 读取时 getAffFromCache/getNegFromCache 会 fallback 到 durationMs，
    // 导致"时间到"后回到上一环节时间被错误恢复为满时长。
    // 这里与 nextStage 保持一致：保存实际剩余时间。
    const curStageDef = format.stages[prev.currentStageIndex]
    if (curStageDef?.isFreeDebate) {
      newCache[prev.currentStageIndex] = {
        aff: prev.affRemainingMs ?? prev.remainingMs,
        neg: prev.negRemainingMs ?? prev.remainingMs
      }
    } else {
      newCache[prev.currentStageIndex] = prev.remainingMs
    }
    const nextStageDef = format.stages[nextIndex]
    if (newCache[nextIndex] === undefined) {
      newCache[nextIndex] = nextStageDef.isFreeDebate
        ? { aff: nextStageDef.durationMs, neg: nextStageDef.durationMs }
        : nextStageDef.durationMs
    }
    const cachedVal = newCache[nextIndex]
    const cachedRemaining = typeof cachedVal === 'number'
      ? cachedVal
      : (cachedVal?.aff ?? nextStageDef.durationMs)
    // 下一环节为 pool 环节：剩余时间 = 该队池剩余（覆盖 cache 值）
    const nextPoolRemaining = nextStageDef.isFreeDebate
      ? null
      : poolRemainingForStage(format, nextStageDef, prev.affPoolRemainingMs, prev.negPoolRemainingMs)
    const finalRemaining = nextPoolRemaining ?? cachedRemaining
    stopRaf()
    setState((s) => ({
      ...s,
      status: 'paused',
      pausedAt: new Date().toISOString(),
      currentStageIndex: nextIndex,
      currentSide: resolveInitialSide(nextStageDef),
      remainingMs: finalRemaining,
      affPoolRemainingMs: s.affPoolRemainingMs,
      negPoolRemainingMs: s.negPoolRemainingMs,
      affRemainingMs: nextStageDef.isFreeDebate
        ? (typeof cachedVal === 'number' ? cachedVal : (cachedVal?.aff ?? nextStageDef.durationMs))
        : undefined,
      negRemainingMs: nextStageDef.isFreeDebate
        ? (typeof cachedVal === 'number' ? cachedVal : (cachedVal?.neg ?? nextStageDef.durationMs))
        : undefined,
      lastBellIndex: 0,
      stageRemainingMsCache: newCache
    }))
    void handleStageStart(nextIndex)
  }, [format, handleStageEnd, handleStageStart, stopRaf])

  /**
   * 环节重置：仅重置当前环节的时间状态，保留进度与 sessionId。
   * - 自由辩论环节下，affRemainingMs/negRemainingMs 都重置为单方时长
   * - status 回到 idle
   * - H1 修复：currentSide 用 resolveInitialSide 而非 stage.side，
   *   避免自定义赛制 side='both' 时触发 12 分钟 bug
   */
  const resetStage = useCallback(() => {
    stopRaf()
    setState((prev) => {
      const stage = format.stages[prev.currentStageIndex]
      if (!stage) return prev
      const nextState: TimerState = {
        ...prev,
        status: 'idle',
        remainingMs: poolRemainingForStage(format, stage, prev.affPoolRemainingMs, prev.negPoolRemainingMs) ?? stage.durationMs,
        lastBellIndex: 0,
        pausedAt: null
      }
      if (stage.isFreeDebate) {
        nextState.affRemainingMs = stage.durationMs
        nextState.negRemainingMs = stage.durationMs
        nextState.currentSide = resolveInitialSide(stage)  // H1: 用 resolveInitialSide 而非 stage.side
        // 发言次数与环节时间一并重置归零（重新开始本次自由辩论）
        nextState.affSpeechCount = 0
        nextState.negSpeechCount = 0
      } else {
        nextState.affRemainingMs = undefined
        nextState.negRemainingMs = undefined
      }
      return nextState
    })
  }, [format, stopRaf])

  /**
   * 全场重置：回到第 0 个环节 idle 状态，清空 sessionId。
   * 与 resetStage 区别：reset 清空整场进度，resetStage 仅重置当前环节。
   */
  const reset = useCallback(() => {
    stopRaf()
    sessionIdRef.current = ''
    pauseCountRef.current = 0
    setState(createInitialState(format, ''))
  }, [format, stopRaf])

  /**
   * 从 TimerSession 恢复 engine state（loadSession 用）。
   * - 恢复后默认 paused 状态（避免自动 rAF 导致计时失控），用户需手动按空格恢复
   * - 读取 session.stageRemainingCache 作为 cache
   * - 若 cache 缺当前环节，用 session.remainingMs 或 stage.durationMs 兜底
   * - 自由辩论环节下，从 DB 恢复 affRemainingMs/negRemainingMs（若字段存在）
   *   否则用 restoredRemaining 兜底（兼容旧数据）
   * - 双保险：若 session.currentSide === 'both' 或 null 且环节为自由辩论，fallback 到 'aff'
   */
  const restoreState = useCallback((session: {
    id: string
    status: TimerSession['status']
    currentStageIndex: number
    currentSide: StageSide | null
    remainingMs?: number | null
    formatSnapshot: DebateFormatData
    stageRemainingCache?: Record<number, StageCacheValue> | null
    affRemainingMs?: number | null
    negRemainingMs?: number | null
    affPoolRemainingMs?: number | null
    negPoolRemainingMs?: number | null
    affSpeechCount?: number | null
    negSpeechCount?: number | null
    pausedAt?: string | null
  }) => {
    stopRaf()
    sessionIdRef.current = session.id
    pauseCountRef.current = 0
    const stage = session.formatSnapshot.stages[session.currentStageIndex]
    const cache: Record<number, StageCacheValue> = { ...(session.stageRemainingCache ?? {}) }
    if (cache[session.currentStageIndex] === undefined) {
      cache[session.currentStageIndex] = stage?.isFreeDebate
        ? { aff: session.remainingMs ?? stage?.durationMs ?? 0, neg: session.remainingMs ?? stage?.durationMs ?? 0 }
        : (session.remainingMs ?? stage?.durationMs ?? 0)
    }
    // 队伍总时长池：从 DB 恢复（缺省则按赛制初始化）
    const restoredAffPool = session.affPoolRemainingMs
      ?? (hasTeamPool(session.formatSnapshot) ? poolInitMs(session.formatSnapshot, 'aff') : undefined)
    const restoredNegPool = session.negPoolRemainingMs
      ?? (hasTeamPool(session.formatSnapshot) ? poolInitMs(session.formatSnapshot, 'neg') : undefined)
    // pool 环节：剩余时间 = 该队池剩余（覆盖 remainingMs）
    const restoredPool = poolRemainingForStage(session.formatSnapshot, stage, restoredAffPool, restoredNegPool)
    const restoredRemaining = session.remainingMs ?? stage?.durationMs ?? 0
    // L2 修复：所有环节都处理 'both'，自由辩论 fallback 到 'aff'，非自由辩论 fallback 到 resolveInitialSide
    // 原逻辑仅在 isFreeDebate 时处理 'both'，导致非自由辩论环节残留 'both' 进入 tick 后行为异常
    const restoredSide: StageSide = (() => {
      const cur = session.currentSide
      if (cur && cur !== 'both') return cur
      // cur 为 null 或 'both'
      if (stage?.isFreeDebate) return 'aff'
      return resolveInitialSide(stage) ?? 'aff'
    })()
    // 从 DB 恢复双方独立时间（若字段存在），否则用 restoredRemaining 兜底
    const restoredAff = stage?.isFreeDebate
      ? (session.affRemainingMs ?? restoredRemaining)
      : undefined
    const restoredNeg = stage?.isFreeDebate
      ? (session.negRemainingMs ?? restoredRemaining)
      : undefined
    setState({
      sessionId: session.id,
      status: session.status === 'running' ? 'paused' : session.status,
      currentStageIndex: session.currentStageIndex,
      currentSide: restoredSide,
      remainingMs: restoredPool ?? restoredRemaining,
      // P4 修复：原代码硬编码 elapsedMs: 0，丢失已耗时。
      // elapsedMs = 当前环节总时长 - 剩余时间，越界或无数据时兜底 0
      elapsedMs:
        session.currentStageIndex >= 0 &&
        session.currentStageIndex < session.formatSnapshot.stages.length
          ? Math.max(
              0,
              (session.formatSnapshot.stages[session.currentStageIndex]?.durationMs ?? 0) -
                (session.remainingMs ?? 0)
            )
          : 0,
      // P2-25: 保留原始 pausedAt，避免从 DB 恢复 paused 状态时丢失原始暂停时间戳
      pausedAt: session.status === 'running'
        ? new Date().toISOString()
        : (session.pausedAt ?? null),
      lastBellIndex: 0,
      stageRemainingMsCache: cache,
      affRemainingMs: restoredAff,
      negRemainingMs: restoredNeg,
      affPoolRemainingMs: restoredAffPool,
      negPoolRemainingMs: restoredNegPool,
      affSpeechCount: session.affSpeechCount ?? 0,
      negSpeechCount: session.negSpeechCount ?? 0
    })
    // Critical-5 修复：从 DB 恢复后跳过一次 onStateChange，避免立即写回 DB
    skipPersistRef.current = true
  }, [stopRaf])

  // format 变化时（如用户切换赛制）重置 state，避免 currentStageIndex 越界
  useEffect(() => {
    setState(createInitialState(format, sessionIdRef.current))
    stopRaf()
  }, [format, stopRaf])

  useEffect(() => {
    return () => stopRaf()
  }, [stopRaf])

  // Critical-5 修复：统一通过 useEffect 监听 state 变化触发 onStateChange 持久化。
  // 这样所有修改 state 的操作（start/pause/resume/nextStage/prevStage/addTime/
  // switchSide/finish/finishStage/resetStage/reset/tick）都会自动触发持久化，
  // 解决原代码中多处不触发 onStateChange 导致的 DB 持久化断层问题。
  // restoreState 时通过 skipPersistRef 跳过一次，避免从 DB 恢复后立即写回。
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    // 仅在已有 sessionId 时触发持久化（初始空状态不持久化）
    if (state.sessionId) {
      callbacksRef.current.onStateChange(state)
    }
  }, [state])

  return useMemo(() => ({
    state,
    start,
    pause,
    resume,
    nextStage,
    prevStage,
    addTime,
    switchSide,
    finish,
    finishStage,
    reset,
    resetStage,
    restoreState
  }), [
    state,
    start,
    pause,
    resume,
    nextStage,
    prevStage,
    addTime,
    switchSide,
    finish,
    finishStage,
    reset,
    resetStage,
    restoreState
  ])
}
