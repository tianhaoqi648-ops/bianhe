// ============================================================
// debate-formats/types.ts — 赛制类型定义
//
// 抽出到独立文件避免 types.ts 循环依赖
// ============================================================

export type StageSide = 'aff' | 'neg' | 'both' | 'og' | 'oo' | 'cg' | 'co'

/** 铃声类型：内置 4 种 + custom 自定义文件 */
export type BellSound = 'beep' | 'bell' | 'double_bell' | 'time_up' | 'custom'

export interface BellDef {
  /** 触发时间点（剩余毫秒，0 = 时间到） */
  atMs: number
  sound: BellSound
  /** 当 sound='custom' 时，引用 bell_assets 表的 id */
  customBellId?: string
}

export interface StageDef {
  id: string
  name: string
  side: StageSide
  durationMs: number
  /** 宽限时间（毫秒）：时间到后允许继续发言的时间，超时显示红色警告 */
  graceMs?: number
  bells: BellDef[]
  /** 自由辩论标记：标记后引擎允许通过 Space 键切换发言方 */
  isFreeDebate?: boolean
}

export interface DebateFormatData {
  stages: StageDef[]
  totalDurationMs: number
}

/** 铃声资源元数据（对应 bell_assets 表） */
export interface BellAsset {
  id: string
  name: string
  /** 文件相对路径（相对于 userData/bells/） */
  filePath: string
  /** 文件大小（字节） */
  fileSize: number
  /** MIME 类型，如 audio/mp3 */
  mimeType: string
  /** 时长（毫秒），可选 */
  durationMs?: number
  createdAt: string
}

/** 计时器视觉主题 */
export interface TimerTheme {
  /** 正方称谓，默认"正方" */
  affLabel: string
  /** 反方称谓，默认"反方" */
  negLabel: string
  /** 正方主题色（CSS color），默认 "#1677ff" */
  affColor: string
  /** 反方主题色（CSS color），默认 "#ff4d4f" */
  negColor: string
  /** 强调色（环节高亮、按钮），默认 "#1677ff" */
  accentColor: string
  /** 背景图路径（绝对路径或 data URL），可选 */
  backgroundPath?: string
  /** 背景图模式 */
  backgroundFit?: 'cover' | 'contain' | 'stretch'
}
