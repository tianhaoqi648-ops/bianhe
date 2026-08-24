// ============================================================
// app-error.ts — 统一结构化错误（Task2.1 轻量统一错误处理）
//
// 提供：
//   AppErrorCode    错误分类枚举（字符串字面量联合）
//   AppError        结构化错误类（继承 Error，携带 code/userMessage/details）
//   toApiError(err) 错误分类推断：识别数据库/校验/文件/导入/部分失败/Agent 等，
//                   将其归类为 AppError；无法识别时回退原始 message（UNKNOWN）。
//
// 兼容性约定：
//   - ApiResponse.error 仍保持 string；结构化信息通过新增的 ApiResponse.appError 字段透传。
//   - toApiError 对未知错误回退：userMessage === message（等价于既有 `error: e.message`），
//     确保不破坏既有 renderer 对 `error` 字符串的判读。
// ============================================================

/** 错误分类码 */
export type AppErrorCode =
  | 'SQLITE_CONSTRAINT'
  | 'SQLITE_BUSY'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'FILE'
  | 'IMPORT'
  | 'PARTIAL_FAILURE'
  | 'AGENT'
  | 'UNKNOWN'

/**
 * 结构化错误。继承 Error 便于被 try/catch 捕获并沿用 `instanceof Error` 语义，
 * 同时携带分类码与面向用户的中文提示。
 */
export class AppError extends Error {
  code: AppErrorCode
  /** 面向用户的中文可读提示（renderer 展示用） */
  userMessage: string
  /** 附加上下文（错误码、出错对象 id 等） */
  details?: Record<string, unknown>

  constructor(
    code: AppErrorCode,
    message: string,
    userMessage?: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.userMessage = userMessage ?? message
    this.details = details
  }
}

/** 判断是否为已构造的 AppError 实例 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}

/**
 * 把任意抛出值归类为 AppError。
 * - 已是 AppError → 原样返回
 * - 按错误码 / 消息文本识别分类，输出中文 userMessage
 * - 无法识别 → UNKNOWN，userMessage 回退原始 message（保持既有 `error: string` 语义）
 */
export function toApiError(err: unknown): AppError {
  if (err instanceof AppError) return err

  const raw = err instanceof Error ? err.message : String(err)
  const rawCode = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined
  const rawName = err instanceof Error ? err.name : ''

  // --- 数据库：SQLite 约束违例 ---
  if (typeof rawCode === 'string' && /^SQLITE_CONSTRAINT/.test(rawCode)) {
    return classifyConstraint(raw, rawCode)
  }
  if (/UNIQUE constraint|already exists|已存在|唯一性约束/i.test(raw)) {
    return new AppError('SQLITE_CONSTRAINT', raw, '该辩题已存在，请勿重复添加')
  }
  if (/FOREIGN KEY constraint|SQLITE_CONSTRAINT|约束失败/i.test(raw)) {
    return new AppError('SQLITE_CONSTRAINT', raw, '数据完整性校验失败，操作未能完成')
  }

  // --- 数据库：Busy / Locked ---
  if (
    (typeof rawCode === 'string' && /^SQLITE_BUSY/.test(rawCode)) ||
    /database is locked|SQLITE_BUSY|数据库被锁定/i.test(raw)
  ) {
    return new AppError('SQLITE_BUSY', raw, '数据库正忙，请稍后重试')
  }

  // --- 参数/输入校验（assertParam 抛出的信息已是中文，直接用） ---
  if (/^参数 .*必须/.test(raw)) {
    return new AppError('VALIDATION', raw, raw)
  }

  // --- 未找到记录 ---
  // 中文原文（含「不存在/未找到」）已面向用户，直接透出；英文原文才用通用中文提示。
  if (/已经?不存在|未找到/.test(raw)) {
    return new AppError('NOT_FOUND', raw, raw)
  }
  if (/not found|notfound|no rows/i.test(raw)) {
    return new AppError('NOT_FOUND', raw, '未找到指定记录，请刷新后重试')
  }

  // --- 文件/路径/IO ---
  if (/ENOENT|EACCES|EPERM|EISDIR|ENOSPC|ENOTDIR|fs\.|文件|路径|目录|无法写入|无法读取/i.test(raw)) {
    return new AppError('FILE', raw, '文件操作失败，请检查文件是否存在或权限是否足够')
  }

  // --- 导入 ---
  if (/^\[import|导入失败|解析失败/i.test(raw) || /import/i.test(rawName)) {
    return new AppError('IMPORT', raw, '导入失败，请检查数据格式或内容')
  }

  // --- Agent / LLM ---
  if (/api[ _-]?key|apikey|API Key|未配置|模型|llm|agent/i.test(raw)) {
    return new AppError('AGENT', raw, 'Agent 服务异常，请检查 AI 配置后重试')
  }

  // --- 未知：回退原始 message ---
  return new AppError('UNKNOWN', raw, raw)
}

/** 根据具体约束码细分提示（唯一约束 → 「该辩题已存在」类） */
function classifyConstraint(raw: string, code: string): AppError {
  if (/UNIQUE|unique/.test(code)) {
    return new AppError('SQLITE_CONSTRAINT', raw, '该辩题已存在，请勿重复添加')
  }
  if (/FOREIGN|foreign/.test(code)) {
    return new AppError('SQLITE_CONSTRAINT', raw, '数据存在关联引用，无法执行此操作')
  }
  return new AppError('SQLITE_CONSTRAINT', raw, '数据完整性校验失败，操作未能完成')
}

/**
 * 便捷后缀：把 AppError 转成可安全跨 IPC 传输的纯对象（避免 Error 实例
 * message 不可枚举导致序列化丢字段）。
 */
export function toAppErrorObject(appError: AppError): {
  name: string
  code: AppErrorCode
  message: string
  userMessage: string
  details?: Record<string, unknown>
} {
  return {
    name: appError.name,
    code: appError.code,
    message: appError.message,
    userMessage: appError.userMessage,
    details: appError.details
  }
}