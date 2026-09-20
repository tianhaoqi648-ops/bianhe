// ============================================================
// errorMessage.ts —— 统一错误消息解析（Phase 4 B3 / UI-008）
//
// 项目错误链事实（设计依据）：
//   主进程 wrap()（src/main/ipc/utils.ts）已通过 toApiError 把异常
//   分类为中文 userMessage：ApiResponse.error 即用户可读文案，
//   ApiResponse.appError 携带结构化 { code, userMessage }。
//   renderer store 链普遍 throw new Error(res.error)，
//   因此 catch 到的 Error.message 多数已是 userMessage。
//
// resolveErrorMessage 的职责：
//   1. 消灭 String(e) 技术串直达 UI 的通道（unknown → fallback）
//   2. 优先消费结构化 userMessage（AppError / ApiResponse 形状）
//   3. 为空消息 Error 提供语义回退
//
// 技术细节（details/code）不进入主文案；需要诊断时由调用方
// 自行 console.error 原始对象。
// ============================================================

/** AppError 跨 IPC 形状（toAppErrorObject 产物）或任意携带 userMessage 的对象 */
interface UserMessageShape {
  userMessage?: unknown
}

/** ApiResponse 失败形状 */
interface ApiErrorShape {
  error?: unknown
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * 解析任意抛出值为主文案字符串。
 *
 * 优先级：
 *   1. err.userMessage（AppError / appError 对象，非空 string）
 *   2. err.error（ApiResponse 失败字段，非空 string —— 已是主进程 userMessage）
 *   3. Error 且 message 非空 → message（项目约定：IPC 链 message 已是 userMessage）
 *   4. 其余（unknown / 空消息）→ fallback
 */
export function resolveErrorMessage(err: unknown, fallback: string): string {
  if (isObject(err)) {
    const um = (err as UserMessageShape).userMessage
    if (typeof um === 'string' && um.trim() !== '') return um
    const apiErr = (err as ApiErrorShape).error
    if (typeof apiErr === 'string' && apiErr.trim() !== '') return apiErr
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim() !== '') return msg
    return fallback
  }
  if (typeof err === 'string' && err.trim() !== '') return err
  return fallback
}
