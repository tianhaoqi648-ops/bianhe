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
