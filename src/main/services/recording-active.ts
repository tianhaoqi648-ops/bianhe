// ============================================================
// recording-active.ts — 录音活跃状态（主进程内存标志，Me3-fix）
//
// 用途：restoreBackup 在覆盖数据库文件前拒绝"录音进行中"的恢复
// （恢复后旧连接句柄与新文件分离，录音停止时的新绑定写入会丢失）。
//
// 状态来源：renderer 在录音会话开始/结束时经 RECORDING_ACTIVE IPC
// 通知主进程（会话级——分段切片不翻转）。标志存内存：应用重启必然
// 归零；renderer 异常残留 true 时属 fail-safe 方向（宁可让用户先
// 重启，也不冒恢复丢数据的风险）。
// ============================================================

let active = false

/** 录音会话开始/结束时由 RECORDING_ACTIVE handler 调用 */
export function setRecordingActive(value: boolean): void {
  active = value
}

/** restoreBackup 前置守卫读取 */
export function isRecordingActive(): boolean {
  return active
}

// ------------------------------------------------------------
// P5-012：restore critical section 标志
//
// restoreBackup 在 serialize 回调入口置位、finally 释放（所有失败路径
// 均释放，不会永久阻塞录音）。RECORDING_ACTIVE handler 据此拒绝
// restore 进行中的录音启动，保证「恢复 critical section」与「录音
// 会话启动」互斥（两个 critical section 不可能重叠）。
//
// 内存态：应用重启必然归零——进程在 critical section 内崩溃时，
// 重启后本标志自动清除，无需 startup cleanup；与 active 同为
// fail-safe 方向（宁可让录音等几秒，也不冒恢复丢数据风险）。
// ------------------------------------------------------------

let restoreInProgress = false

/** restoreBackup 进入/退出 critical section 时调用 */
export function setRestoreInProgress(value: boolean): void {
  restoreInProgress = value
}

/** RECORDING_ACTIVE handler 守卫读取 */
export function isRestoreInProgress(): boolean {
  return restoreInProgress
}
