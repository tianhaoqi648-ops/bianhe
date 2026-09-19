// ============================================================
// recording-active.test.ts — Me3-fix Lifecycle Gate：
// 录音活跃标志语义锁定（单一全局 bool）。
//
// 语义成立的代码证据（勿凭 UI 推断）：
// 1. 录音入口仅两条互斥路由：/timer（TimerPage）与 /judge（JudgeArena）
//    （App.tsx:243/245）——任一时刻至多一个页面挂载；
// 2. 页面内 start 守卫：useTimerRecorder.start `if (recording) return false`、
//    JudgeArena `if (liveMic.recording)` toggle——同页不会双会话；
// 3. 两 hook 均无 useEffect 卸载清理、TimerPage 无导航拦截 → 录音中导航
//    产生"僵尸会话"（无 stop 路径、永不写 DB）；
// 4. setActive(false) 只能由各自页面自身的会话 stop 触发——不存在
//    "A 停止时 B 仍活跃"的调用路径 → 单一 bool 语义充分；
//    僵尸窗口内 flag 恒为 true 属 fail-safe 方向（restore/import 被阻止，
//    无数据风险），应用重启归零。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { setRecordingActive, isRecordingActive } from '../recording-active'

describe('recording-active 语义锁定（Me3-fix Lifecycle Gate）', () => {
  beforeEach(() => {
    setRecordingActive(false)
  })

  it('start → active；stop → inactive（单会话正常生命周期）', () => {
    setRecordingActive(true)
    expect(isRecordingActive()).toBe(true)
    setRecordingActive(false)
    expect(isRecordingActive()).toBe(false)
  })

  it('重复 start（导航场景：A 会话未停 → B 页面开始）→ 仍 active，不产生 false-clear', () => {
    // /timer 开始 → 未停导航到 /judge → live mic 开始：
    // 两次 setActive(true)，中间无 false——flag 必须保持 true
    setRecordingActive(true)
    setRecordingActive(true)
    expect(isRecordingActive()).toBe(true)
  })

  it('false 幂等：未录音时重复 false 不产生错误状态', () => {
    setRecordingActive(false)
    setRecordingActive(false)
    expect(isRecordingActive()).toBe(false)
  })
})
