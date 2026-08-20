// ============================================================
// stt-download.ts — 转写引擎（本地 whisper.cpp + 模型）下载管理
//
// 首次使用时按需下载，不装进安装包。目标目录 userData/stt/：
//   二进制 → stt/whisper(.exe)
//   模型   → stt/models/<model>/ggml-<model>.bin（各模型彼此隔离）
//
// 提供：getSttEngineStatus / downloadSttEngine / cancelSttDownload / removeSttEngine
// 并发防串：同一时刻仅一个下载（模块级互斥标志）。
// ============================================================

import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { net, dialog } from 'electron'
import type { SttEngineStatus, SttImportResult } from '../../shared/types'
import { STT_MODEL_KEY } from '../../shared/types'
import {
  sttDir,
  whisperBinaryPath,
  whisperModelPath,
  resolveExistingModelPath,
  asWhisperModel,
  WHISPER_CLI_KEY
} from './transcription'
import { extractArchive, type ArchiveEntry } from './whisper-extract'
import { auditRepo } from '../db/repository/audit.repo'

// ============================================================
// 下载源常量（whisper.cpp 官方 Release：https://github.com/ggml-org/whisper.cpp/releases）
// 二进制为预编译压缩包（Windows=.zip，Linux/mac=.tar.gz 或 .zip），下载后需解压。
// ============================================================
const WHISPER_VERSION = 'v1.9.2'
/** 请求释放：${platform}-${arch} → 资产文件名（ggml-org/whisper.cpp v1.9.2） */
const BINARY_ASSETS: Record<string, string> = {
  'win32-x64': 'whisper-bin-x64.zip',
  'win32-ia32': 'whisper-bin-Win32.zip',
  'win32-arm64': 'whisper-bin-Win32.zip',
  'darwin-x64': 'whisper-bin-macos-x64.zip',
  'darwin-arm64': 'whisper-bin-macos-arm64.zip',
  'linux-x64': 'whisper-bin-ubuntu-x64.tar.gz',
  'linux-arm64': 'whisper-bin-ubuntu-arm64.tar.gz'
}

/** 官方 GitHub 资产地址 */
function officialBinaryUrl(): string {
  const asset = BINARY_ASSETS[`${process.platform}-${process.arch}`]
  if (!asset) throw new Error(`当前平台 ${process.platform}/${process.arch} 暂未提供转写引擎二进制`)
  return `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/${asset}`
}

/** 二进制候选源：官方优先，后接国内 GitHub 代理镜像（无梯子时可达） */
function binaryCandidateUrls(): string[] {
  const official = officialBinaryUrl()
  return [official, `https://ghproxy.com/${official}`, `https://mirror.ghproxy.com/${official}`]
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

/** 单个候选源连接超时：超时后放弃该源、尝试下一个镜像（默认二进制用此值） */
const SOURCE_TIMEOUT_MS = 20_000
/** 模型下载连接阶段超时：只覆盖「建立连接 + 拿到响应头」，流式读取不再受此约束 */
const MODEL_CONNECT_TIMEOUT_MS = 60_000

/**
 * 从解压产物里挑出「真正的转写命令行工具」。
 * whisper.cpp 的发行压缩包里含多个可执行文件（whisper-cli / whisper-bench / whisper-server ...），
 * 只有 whisper-cli（旧版叫 whisper）支持 `-m/-l/-f` 转写参数；bench/server 均不含 `-l`。
 * 策略：优先 `whisper-cli`；再退回非 bench/server 的 whisper 可执行文件。
 */
function pickExecutable(entries: ArchiveEntry[], win: boolean): ArchiveEntry | undefined {
  const lower = (n: string): string => n.toLowerCase()
  const isCli = (n: string): boolean => lower(n).includes('whisper-cli')
  const cli = entries.find((e) => isCli(e.name))
  if (cli) return cli
  // 兜底：排除明显非转写工具
  const bad = /(-bench|-server|-rt|-stream|web|main$|\.dll|\.so|\.dylib|\.lib|\.hws|\.compiled)/i
  const re = win ? /\.exe$/i : /^whisper/
  return entries.find(
    (e) => re.test(e.name) && /whisper/i.test(e.name) && !bad.test(e.name) && isCli(e.name) === false
  )
}

/**
 * 解压二进制压缩包到 sttDir/：把可执行文件放为 whisper(.exe)，其余配套文件（dll/so/dylib/模型后端等）一并落盘。
 * 完成后清理临时目录与压缩包。ffmpeg 位于子目录，不受影响。
 */
async function installBinaryFromArchive(archivePath: string): Promise<void> {
  const archiveBuf = await fs.readFile(archivePath)
  const entries = extractArchive(new Uint8Array(archiveBuf))
  const win = process.platform === 'win32'
  const exe = pickExecutable(entries, win)
  if (!exe) throw new Error('解压后未找到 whisper 可执行文件')
  const binName = win ? 'whisper.exe' : 'whisper'
  const dir = sttDir()
  await fs.mkdir(dir, { recursive: true })
  for (const e of entries) {
    // 可执行文件 → whisper(.exe)；其余文件平铺到 sttDir（win 需要同目录 dll，mac/linux 需要 so/dylib）
    const dest = e === exe ? join(dir, binName) : join(dir, e.name)
    await fs.writeFile(dest, Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength))
  }
  if (!win) await fs.chmod(join(dir, binName), 0o755).catch(() => undefined)
  await fs.rm(archivePath, { force: true })
}

/** 模型基础 URL（ggml-<model>.bin 官方托管源） */
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
/** 模型国内镜像（无外网时可达） */
const MODEL_MIRROR_URL = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main'

/** 模型候选源：官方优先，后接 hf-mirror 镜像 */
function modelCandidateUrls(model: string): string[] {
  const file = `ggml-${model}.bin`
  return [`${MODEL_BASE_URL}/${file}`, `${MODEL_MIRROR_URL}/${file}`]
}

// ============================================================
// 模块级并发互斥 + 下载进度状态
// ============================================================

let downloading = false
let cancelFlag = false
let currentModel = ''
let currentProgress = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function fileInfo(p: string): Promise<{ ok: boolean; size: number }> {
  return fs
    .stat(p)
    .then((s) => (s.isFile() ? { ok: true, size: s.size } : { ok: false, size: 0 }))
    .catch(() => ({ ok: false, size: 0 }))
}

/**
 * 检测转写引擎安装/下载状态（binary + 指定模型）。
 */
export async function getSttEngineStatus(model?: string): Promise<SttEngineStatus> {
  const m = asWhisperModel(model)
  const binaryPath = whisperBinaryPath()
  // 模型用「新布局优先、旧根兜底」的实际存在路径（新或旧任一存在即认为已装）
  const modelPath = resolveExistingModelPath(m)
  const [bin, mdl] = await Promise.all([fileInfo(binaryPath), fileInfo(modelPath)])
  return {
    installed: bin.ok && mdl.ok,
    binaryOk: bin.ok,
    modelOk: mdl.ok,
    model: m,
    binaryPath,
    modelPath,
    fileSize: mdl.ok ? mdl.size : undefined,
    downloading,
    progress: downloading ? currentProgress : undefined
  }
}

/** 下载上下文：取消标志 + 进度回调（供不同下载域各自维护互斥/进度，如转写引擎 vs ffmpeg 转码器） */
export interface DownloadContext {
  /** 轮询取消标志（true 表示用户已请求取消） */
  isCancelled: () => boolean
  /** 进度更新回调（pct，已按 startPct/endPct 映射到 0-100） */
  onProgress: (pct: number) => void
}

/**
 * 流式下载：按给定候选源依次尝试，前一个失败（网络/超时/非 2xx）自动切换下一个镜像。
 * 带进度回调与取消，每个源有独立超时，避免单个不可达镜像长时间卡住。
 *
 * 超时语义：连接超时只覆盖「建立连接 + 拿到响应头」阶段（fetch 期间），
 * 一旦拿到 res 并进入流式 reader.read() 即清除连接计时器；此后只响应用户取消，
 * 不再用固定超时中断「慢但在下载」的流。
 */
export async function downloadFile(
  urls: string[],
  dest: string,
  startPct: number,
  endPct: number,
  ctx: DownloadContext,
  connectTimeoutMs: number = SOURCE_TIMEOUT_MS
): Promise<void> {
  const part = `${dest}.part`
  const tried: string[] = []
  let lastErr: string | undefined

  for (const url of urls) {
    tried.push(hostOf(url))
    await fs.rm(part, { force: true }).catch(() => undefined)
    const controller = new AbortController()
    // 轮询取消标志：用户点击取消时 abort 底层 fetch
    const pollTimer = setInterval(() => {
      if (ctx.isCancelled()) controller.abort()
    }, 120)
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    type NetFetchResponse = Awaited<ReturnType<typeof net.fetch>>
    let reader: Awaited<ReturnType<NonNullable<NetFetchResponse['body']>['getReader']>> | undefined
    try {
      // fetch 内部负责「建立连接 + 拿到响应头」，连接阶段超时在此生效；
      // res 一返回即清除连接计时器（见 fetchWithTimeout 的 finally）
      const res = await fetchWithTimeout(url, controller.signal, connectTimeoutMs)
      if (!res.ok) {
        lastErr = `HTTP ${res.status}（${hostOf(url)}）`
        continue
      }
      if (!res.body) {
        lastErr = '响应缺少内容流'
        continue
      }
      const total = Number(res.headers.get('content-length') || 0)
      handle = await fs.open(part, 'w')
      reader = res.body.getReader()
      let received = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await handle.write(value)
          received += value.byteLength
          if (total > 0) {
            ctx.onProgress(Math.round(startPct + ((endPct - startPct) * received) / total))
          }
        }
      } finally {
        reader.releaseLock()
        await handle.close()
        handle = undefined
      }
      if (ctx.isCancelled()) throw new Error('canceled')
      await fs.rename(part, dest)
      return
    } catch (e) {
      if (ctx.isCancelled()) throw new Error('canceled')
      lastErr = e instanceof Error ? e.message : String(e)
    } finally {
      clearInterval(pollTimer)
      await handle?.close().catch(() => undefined)
      await fs.rm(part, { force: true }).catch(() => undefined)
    }
  }

  throw new Error(
    `下载失败：所有下载源均不可达（${tried.join(' / ')}）${lastErr ? `，最后一个错误：${lastErr}` : ''}`
  )
}

/**
 * 带连接超时的 fetch：仅限制「建立连接 + 拿到响应头」阶段。
 * 一旦 res 解析返回即清除计时器，返回后的流式读取不再受该超时约束；
 * 同时联动外层 cancelFlag 的 AbortController（signal 触发时同步 abort 内部请求）。
 */
async function fetchWithTimeout(
  url: string,
  signal: AbortSignal,
  connectTimeoutMs: number
): Promise<Awaited<ReturnType<typeof net.fetch>>> {
  const controller = new AbortController()
  // 联动外层取消：用户取消时提前中止内部信号
  const onAbort = (): void => controller.abort()
  signal.addEventListener('abort', onAbort)
  const timeout = setTimeout(() => controller.abort(), connectTimeoutMs)
  try {
    return await net.fetch(url, { redirect: 'follow', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 下载转写引擎（二进制 + 指定模型）到 userData/stt/。
 * 二进制写根目录 stt/whisper(.exe)；模型写独立子目录 stt/models/<m>/（只动该模型，不牵连其它模型/ffmpeg）。
 * 同一时刻仅允许一个下载；可被 cancelSttDownload 打断。
 */
export async function downloadSttEngine(model: string): Promise<void> {
  if (downloading) throw new Error('已有转写引擎下载正在进行中，请等待完成或先取消')
  const m = asWhisperModel(model)
  const dir = sttDir()
  await fs.mkdir(dir, { recursive: true })
  const binaryPath = whisperBinaryPath()
  // 模型写入独立子目录 models/<m>/
  const modelDir = join(dir, 'models', m)
  const modelPath = join(modelDir, `ggml-${m}.bin`)
  await fs.mkdir(modelDir, { recursive: true })

  downloading = true
  cancelFlag = false
  currentProgress = 0
  currentModel = m

  try {
    // 1. 下载二进制压缩包（暂存临时文件）并解压安装
    const archivePath = join(sttDir(), '.engine')
    await downloadFile(binaryCandidateUrls(), archivePath, 0, 45, {
      isCancelled: () => cancelFlag,
      onProgress: (p) => {
        currentProgress = p
      }
    })
    await installBinaryFromArchive(archivePath)

    // 2. 模型（官方 + 国内镜像回退；连接超时放宽：模型体积大，慢连接也不应被 20s 掐断）
    await downloadFile(modelCandidateUrls(m), modelPath, 45, 100, {
      isCancelled: () => cancelFlag,
      onProgress: (p) => {
        currentProgress = p
      }
    }, MODEL_CONNECT_TIMEOUT_MS)
    currentProgress = 100
  } finally {
    downloading = false
    cancelFlag = false
    // 清理可能的残留 .part
    await fs.rm(`${binaryPath}.part`, { force: true }).catch(() => undefined)
    await fs.rm(`${modelPath}.part`, { force: true }).catch(() => undefined)
  }
}

/** 取消进行中的下载（删除已下好的 stub/临时文件）。无进行返回原样成功 */
export async function cancelSttDownload(): Promise<void> {
  if (!downloading) return
  cancelFlag = true
  // 等待下载循环真正退出（downloadFile 收不到 abort 前最多轮询 120ms）
  let waited = 0
  while (downloading && waited < 10000) {
    await sleep(50)
    waited += 50
  }
  // 清理可能残留的 .part
  const binaryPath = whisperBinaryPath()
  const modelPath = whisperModelPath(currentModel)
  await fs.rm(`${binaryPath}.part`, { force: true }).catch(() => undefined)
  await fs.rm(`${modelPath}.part`, { force: true }).catch(() => undefined)
}

/** 删除已下载的转写引擎：只删 whisper 二进制与「当前模型」，不动 ffmpeg/其它模型 */
export async function removeSttEngine(): Promise<void> {
  cancelFlag = true
  let waited = 0
  while (downloading && waited < 10000) {
    await sleep(50)
    waited += 50
  }
  const dir = sttDir()
  // 当前模型名（设置 stt.model，缺省 base），仅删它
  const m = asWhisperModel(auditRepo.getSetting(STT_MODEL_KEY))

  // 1) whisper 二进制：仅当未手动指定 whisper-cli（即 whisperBinaryPath() 属于 sttDir()）时删除
  const manualCli = auditRepo.getSetting(WHISPER_CLI_KEY)
  const hasManual = typeof manualCli === 'string' && manualCli.trim() !== ''
  if (!hasManual) {
    const bin = whisperBinaryPath()
    await fs.rm(bin, { force: true }).catch(() => undefined)
    await fs.rm(`${bin}.part`, { force: true }).catch(() => undefined)
  }

  // 2) 当前模型：新布局 models/<m>/ 整子目录 + 旧根 ggml-<m>.bin（兼容旧布局）
  await fs.rm(join(dir, 'models', m), { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(join(dir, `ggml-${m}.bin`), { force: true }).catch(() => undefined)
  await fs.rm(join(dir, `ggml-${m}.bin.part`), { force: true }).catch(() => undefined)
}

/**
 * 手动导入本地 whisper 模型（离线兜底）。
 * 弹窗选择单个 ggml-<model>.bin 文件 → 复制到 userData/stt/models/<model>/ggml-<model>.bin。
 * 用户取消返回 { ok:false }（不计为错误）；文件名非法返回 { ok:false, error }。
 */
export async function importLocalModel(): Promise<SttImportResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '导入本地 whisper 模型（ggml-<model>.bin）',
    properties: ['openFile'],
    filters: [{ name: 'whisper 模型', extensions: ['bin'] }]
  })
  // 用户取消 → 非错误
  if (canceled || filePaths.length === 0) {
    return { ok: false }
  }
  const src = filePaths[0]
  // 仅接受形如 ggml-<model>.bin 的文件；model 取中间段（去 .bin）
  const fileName = basename(src)
  const match = /^ggml-(.+)\.bin$/i.exec(fileName)
  if (!match || !match[1] || !match[1].trim()) {
    return { ok: false, error: '仅支持 ggml-<model>.bin 文件' }
  }
  const model = match[1].trim()
  // 复制到新布局 models/<model>/ggml-<model>.bin
  const modelDir = join(sttDir(), 'models', model)
  await fs.mkdir(modelDir, { recursive: true })
  const dest = join(modelDir, `ggml-${model}.bin`)
  await fs.copyFile(src, dest)
  return { ok: true, model, path: dest }
}