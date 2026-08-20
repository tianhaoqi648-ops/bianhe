// ============================================================
// funasr-service.ts — FunASR 本地转写引擎（与 whisper.cpp 并列的第二种本地实现）
//
// 说明：FunASR 是达摩院的语音识别模型套件，运行在有 python + pip 的机器上。
// 现实约束：用户机器不一定装了 python/funasr，且 FunASR 模型在 ModelScope / HuggingFace，
// 通常是一整套 config + 权重的目录（而非单个 .bin），没有稳定简单的二进制直链可下载。
// 因此本服务采取「按需 + 如实反馈」的策略：
//   - 检测本机 python 能否 `import funasr`（envOk）；
//   - 若可，用内联 python 脚本调用 AutoModel 对整段 16k mono wav 转写，
//     生成带时间戳（毫秒）的语句数组 { startMs, endMs, text } 解析后返回；
//   - 若不可，明确返回错误与「需安装 python funasr 运行环境」的引导，
//     不伪造下载源、不假装能跑。
//
// 模型布局：sttDir()/models/funasr/<model>/ 目录留作本地模型缓存（对齐 whisper 布局），
// 但模型文件本身交由本机 funasr 的 AutoModel 首次运行时自动拉取与缓存，这里不重复实现下载。
// ============================================================

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SttFunAsrStatus, SttFunAsrInstallResult } from '../../shared/types'
import { STT_FUNASR_MODEL_KEY, FUNASR_MODELS } from '../../shared/types'
import { auditRepo } from '../db/repository/audit.repo'
import { sttDir, MODELS_DIR } from './transcription'

// ============================================================
// 模型名解析 / 目录
// ============================================================

/** 规范化 FunASR 模型名：仅接受 FUNASR_MODELS 白名单；未匹配回退 fallback（缺省 paraformer-zh） */
export function asFunAsrModel(
  model: string | undefined,
  fallback: string = FUNASR_MODELS[0]
): string {
  const m = (model ?? '').trim()
  return (FUNASR_MODELS as readonly string[]).includes(m) ? m : fallback
}

/** 当前 settings 里选定的 FunASR 模型名（缺省 paraformer-zh） */
export function currentFunAsrModel(): string {
  return asFunAsrModel(auditRepo.getSetting(STT_FUNASR_MODEL_KEY))
}

/** FunASR 模型缓存目录（sttDir()/models/funasr/<model>/，对齐 whisper 布局；供 funasr 运行时使用/缓存） */
export function funasrModelDir(model: string): string {
  return join(sttDir(), MODELS_DIR, 'funasr', asFunAsrModel(model))
}

// ============================================================
// 运行环境检测（python + funasr）
// ============================================================

/** 尝试以给定解释器执行一段只读的 python 探针，返回是否成功退出 */
function probePython(interp: string, code: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(interp, ['-c', code], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(false)
    }, 30_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/** 任意剪切式装入模块的探针代码：导入 funasr（不预加载模型，避免网络/体积开销） */
function importFunAsrProbe(): string {
  return 'import funasr; print(funasr.__version__ if hasattr(funasr,"__version__") else "ok")'
}

/** 候选 python 解释器（win 优先 py 启动器，其次 python/python3） */
function pythonCandidates(): string[] {
  return process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']
}

/**
 * 检测本机是否存在可用的 python 解释器（不要求 funasr，仅探测能运行）。
 * 逐个候选解释器执行 `print('py-ok')`，任一成功即返回 true 及该解释器。
 */
export async function detectPython(): Promise<{ ok: boolean; interpreter?: string }> {
  const code = "print('py-ok')"
  for (const interp of pythonCandidates()) {
    const ok = await probePython(interp, code)
    if (ok) return { ok: true, interpreter: interp }
  }
  return { ok: false }
}

/**
 * 检测本机是否存在可用的 python/funasr 运行环境。
 * 逐个候选解释器尝试 `import funasr`，任一成功即返回 true。
 */
export async function detectFunAsrEnv(): Promise<{ ok: boolean; interpreter?: string }> {
  const code = importFunAsrProbe()
  for (const interp of pythonCandidates()) {
    const ok = await probePython(interp, code)
    if (ok) return { ok: true, interpreter: interp }
  }
  return { ok: false }
}

// ============================================================
// FunASR 推理依赖探针（T1）
//  仅 `import funasr` 不代表能转写——funasr 背后依赖 torch / torchaudio 等推理包，
//  缺 torchaudio 时即便能 import funasr，落地推理仍会崩（`No module named 'torchaudio'`）。
//  这里的探针显式逐个 import 依赖并自检，用于「一键安装要真正能用」的状态/安装/转写判定。
// ============================================================

/** funasr 推理所需的 python 依赖清单（探针判定对象） */
export const FUNASR_DEPS = ['torch', 'torchaudio', 'torchvision'] as const

/**
 * 构造依赖探针的 python 源码：依次 `import torch/torchaudio/torchvision`，
 * 逐个捕获 ModuleNotFoundError 收进 missing，最后向 stdout 输出一行 JSON。
 *   - 全装上：`{"ok":true,"missing":[]}`；
 *   - 有缺失：`{"ok":false,"missing":["torchaudio",...]}`
 * 纯函数，供单测断言其结构。
 */
export function probeDepsCode(): string {
  const deps = JSON.stringify([...FUNASR_DEPS])
  return `
import sys, json
# 强制 stdout 以 UTF-8 输出（Windows 下 python 默认按 GBK 写管道，会导致中文 JSON 乱码）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
missing = []
for mod in ${deps}:
    try:
        __import__(mod)
    except ModuleNotFoundError:
        missing.append(mod)
    except Exception:
        # 非「模块未安装」的异常（版本告警等）视为该模块已存在，不误报缺失
        pass
print(json.dumps({"ok": len(missing) == 0, "missing": missing}))
`
}

/** 依赖探针输出解析结果（纯结构，供单测） */
export interface ProbeParsed {
  /** 是否从输出里解析出合法的探针 JSON（false=环境级异常/输出损坏，非「缺某依赖」） */
  parsed: boolean
  /** 探针 JSON 内的 ok 字段（true=无缺失） */
  ok: boolean
  /** 探针 JSON 内申报的缺失依赖列表 */
  missing: string[]
}

/**
 * 从 python 探针的 stdout 文本中解析出 `{"ok":..,"missing":[..]}` 结果（纯函数，可单测）。
 * 取文本里第一个合法的 JSON 对象解析（容忍前部 import 告警噪声）；没有 / 解析失败视为
 * malformed（parsed=false），此时 missing 置空，调用方应把其当作「环境异常」而非「缺某依赖」。
 */
export function parseProbeOutput(output: string): ProbeParsed {
  const s = (output || '').trim()
  const parsedObj = extractFirstJsonObject(s)
  if (parsedObj === null) return { parsed: false, ok: false, missing: [] }
  const o = parsedObj as { ok?: unknown; missing?: unknown }
  const missing = Array.isArray(o.missing)
    ? (o.missing as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return { parsed: true, ok: o.ok === true, missing }
}

/**
 * 从文本中提取第一个合法的 JSON 对象。遍历每个 `{` 起点、其后每个 `}` 终点，
 * 逐个尝试 JSON.parse，首个成功即返回对象；找不到则返回 null。
 * 比单用 lastIndexOf 更健壮：能容忍探针输出前部的 import 告警噪声，也能处理对象内含嵌套对象的场景。
 */
function extractFirstJsonObject(text: string): unknown {
  const opens: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] === '{') opens.push(i)
  for (const open of opens) {
    let depth = 0
    for (let j = open; j < text.length; j++) {
      const ch = text[j]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = text.slice(open, j + 1)
          try {
            const obj: unknown = JSON.parse(candidate)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
          } catch {
            /* 该候选不闭合/损坏，继续尝试 */
          }
          break
        }
      }
    }
  }
  return null
}

/**
 * 从文本中提取第一个合法的 JSON 数组（转写脚本输出的是 `[{...},...]`）。
 * 逐行尝试：跳过 torchaudio/ffmpeg 之类的 Notice/warning 噪声行，找到首个 `[` 开头的可 parse 数组即返回。
 * 找不到可解析的数组 → 抛错（交由调用方给出明确输出片段）。
 */
function extractFirstJsonArray(text: string): unknown {
  const lines = (text || '').split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (!t || !t.startsWith('[')) continue
    try {
      const v: unknown = JSON.parse(t)
      if (Array.isArray(v)) return v
    } catch {
      /* 该行不是完整 JSON 数组，继续找下一行 */
    }
  }
  return null
}

/**
 * 解析 FunASR 转写脚本的 stdout（纯函数，可单测）。
 * torchaudio import 时可能向 stdout 打印 `Notice: ffmpeg is not installed...` 等噪声行，
 * 因此不能直接对整个 stdout JSON.parse；这里从其中提取 JSON 数组返回。
 * 提取失败抛错，错误信息包含前 200 字符的输出片段辅助排错。
 */
export function parseTranscribeOutput(output: string, stderr = ''): unknown {
  const arr = extractFirstJsonArray(output || '')
  if (arr !== null) return arr
  const frag = (output || stderr || '').slice(0, 200)
  throw new Error(`FunASR 输出无法解析：${frag || '空输出'}`)
}
/** 依赖探针执行结果（供调用方区分「缺依赖」与「环境异常」） */
export interface FunAsrDepsProbe {
  /** 探针成功跑完且无缺失依赖 */
  ok: boolean
  /** 缺失的依赖名；探针无法运行/解析失败时为空 */
  missing: string[]
  /** 探针本身无法运行/超时/输出无法解析（环境级异常，非缺某依赖） */
  environmentError: boolean
  /** 探针原始输出片段，供排错 */
  output: string
}

/**
 * 以给定解释器执行依赖探针，返回 ok/missing。
 * spawn 失败、>30s 超时被 kill、或输出解析不出合法 JSON 时，
 * 一律标记 environmentError=true（环境异常），missing 置空，避免把「探针跑不起来」误报成「缺某依赖」。
 */
export async function checkFunAsrDeps(interpreter: string): Promise<FunAsrDepsProbe> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(interpreter, ['-c', probeDepsCode()], { windowsHide: true })
    } catch (e) {
      resolve({
        ok: false,
        missing: [],
        environmentError: true,
        output: `无法启动探针：${e instanceof Error ? e.message : String(e)}`
      })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve({ ok: false, missing: [], environmentError: true, output: '依赖探针执行超时（>30s）' })
    }, 30_000)
    child.stdout!.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr!.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, missing: [], environmentError: true, output: e.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const parsed = parseProbeOutput(out)
      if (!parsed.parsed) {
        resolve({
          ok: false,
          missing: [],
          environmentError: true,
          output: (out || err || '').trim().slice(0, 300) || '探针无输出'
        })
        return
      }
      resolve({ ok: parsed.ok, missing: parsed.missing, environmentError: false, output: out.trim() })
    })
  })
}

/** FunASR 运行时探测结果（transcription 分支复用，支持 local-first/api 兜底） */
export interface FunAsrReadiness {
  ready: boolean
  /** 未就绪原因：no-funasr（未装 funasr 包）/ missing-deps（缺推理依赖）/ env-error（探针环境异常） */
  reason?: 'no-funasr' | 'missing-deps' | 'env-error'
  /** missing-deps 时列出的具体缺失依赖 */
  missingDeps: string[]
}

/**
 * 探测「能否真正用 funasr 转写」：不仅 `import funasr`，还要依赖齐全。
 * 不 throw，返回结构化结果供调用方决定本地失败时是否回退 API。
 */
export async function checkFunAsrReadiness(): Promise<FunAsrReadiness> {
  const env = await detectFunAsrEnv()
  if (!env.ok || !env.interpreter) return { ready: false, reason: 'no-funasr', missingDeps: [] }
  const deps = await checkFunAsrDeps(env.interpreter)
  if (deps.environmentError) return { ready: false, reason: 'env-error', missingDeps: [] }
  if (deps.missing.length) return { ready: false, reason: 'missing-deps', missingDeps: deps.missing }
  return { ready: true, missingDeps: [] }
}

/**
 * 断言「能真正用 funasr 转写」（import funasr + 推理依赖齐全）。
 * 不满足时抛出带明确模块名/引导文案的错误，供转写入口在启动前拦截，
 * 替代历史「仅判 import funasr」导致的「就绪误报、转写才崩」。
 * @returns 找到的、可用的 python 解释器
 */
export async function assertFunAsrReady(): Promise<{ interpreter: string }> {
  const env = await detectFunAsrEnv()
  if (!env.ok || !env.interpreter) {
    throw new Error(
      'FunASR 运行环境未安装：未检测到本机 python 的 funasr 包。' +
        '请到「设置 → AI 转写」点击「一键安装 FunASR 依赖」，或执行：pip install funasr'
    )
  }
  const deps = await checkFunAsrDeps(env.interpreter)
  if (deps.environmentError) {
    throw new Error('无法确认 FunASR 依赖（依赖探针执行失败）。请重试，或手动执行：pip install torch torchaudio')
  }
  if (deps.missing.length) {
    throw new Error(
      `缺少依赖：${deps.missing.join('、')}。` +
        '请到「设置 → AI 转写」点击「一键安装 FunASR 依赖」补全，' +
        `或执行：pip install ${deps.missing.join(' ')}`
    )
  }
  return { interpreter: env.interpreter }
}

// ---------- 一键安装 FunASR 运行环境 ----------

/** 正在进行的安装是否互斥（避免重复 pip） */
let funasrInstalling = false

/** 安装取消标志（简单模块级标志，供超时/外部中断使用） */
let funasrInstallCancelled = false

/** spawn 一个命令并收集 stdout/stderr，返回退出码与输出（可被模块级 cancelFlag 中断、可超时） */
function runPipProcess(
  interp: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(interp, args, { windowsHide: true })
    } catch (e) {
      reject(e)
      return
    }
    const timer = setTimeout(() => {
      funasrInstallCancelled = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, 10 * 60 * 1000) // 10 分钟超时，给足下载/编译时间
    let out = ''
    let err = ''
    const pollCancel = setInterval(() => {
      if (funasrInstallCancelled && child.exitCode == null) {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
    }, 500)
    child.stdout!.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr!.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      clearInterval(pollCancel)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      clearInterval(pollCancel)
      resolve({ code: code ?? -1, stdout: out, stderr: err })
    })
  })
}

/** 提取 pip 输出尾部作为帮助排错的详情片段 */
function tailOutput(stdout: string, stderr: string): string {
  const joined = (stderr || stdout).trim()
  if (!joined) return '无输出'
  const lines = joined.split(/\r?\n/).filter(Boolean)
  return lines.slice(-12).join('\n')
}

/**
 * 按清单逐个 `pip install <pkg>`，返回首个失败项详情；取消时返回取消文案。
 * torch 系依赖（torch/torchaudio/torchvision）普通 pip 失败时，用 pytorch CPU 源重试一次，
 * 避免用户侧默认源版本不匹配（torch 与 torchaudio 版本需对齐）。
 */
async function installPackages(
  interp: string,
  packages: string[]
): Promise<{ ok: boolean; detail?: string }> {
  for (const pkg of packages) {
    let res = await runPipProcess(interp, ['-m', 'pip', 'install', pkg])
    if (res.code === 0) continue
    if (funasrInstallCancelled) return { ok: false, detail: '安装已取消。' }
    if (pkg.startsWith('torch')) {
      // 普通源可能因 torch/torchaudio 版本不匹配失败 → 改用 CPU 源重试
      res = await runPipProcess(interp, [
        '-m',
        'pip',
        'install',
        pkg,
        '--index-url',
        'https://download.pytorch.org/whl/cpu'
      ])
      if (res.code === 0) continue
      if (funasrInstallCancelled) return { ok: false, detail: '安装已取消。' }
    }
    const extra = pkg.startsWith('torch')
      ? ' —— 可手动执行：pip install ' + pkg + ' --index-url https://download.pytorch.org/whl/cpu'
      : ''
    return {
      ok: false,
      detail: `安装 ${pkg} 失败：${tailOutput(res.stdout, res.stderr)}${extra}`
    }
  }
  return { ok: true }
}

/**
 * 一键安装 FunASR 运行环境：自动检测 python → pip 升级 pip → pip install funasr → 自检推理依赖，
 * 缺 torchaudio/torch/torchvision 时自动补装。安装成功与否以 spawn 退出码 + 依赖自检为准，不伪造。
 *  - 无 python：返回 needPython=true 与下载引导；
 *  - 有 python：依 pip 退出码与安装后依赖自检如实回执。
 */
export async function installFunAsrEnv(): Promise<SttFunAsrInstallResult> {
  if (funasrInstalling) {
    return { ok: false, detail: '已有安装进行中，请稍候。' }
  }
  funasrInstalling = true
  funasrInstallCancelled = false
  try {
    // 1. 先确认本机是否存在 python
    const py = await detectPython()
    if (!py.ok || !py.interpreter) {
      return {
        ok: false,
        needPython: true,
        detail:
          '未检测到 Python。请到 python.org 下载安装（安装时勾选“Add to PATH”），' +
          '或到微软商店安装；装好后回到本页点击“一键安装”，或手动执行：pip install funasr'
      }
    }
    const interp = py.interpreter
    // 2. 升级 pip（容忍失败，不致命）
    try {
      await runPipProcess(interp, ['-m', 'pip', 'install', '--upgrade', 'pip'])
    } catch {
      /* pip 升级失败可忽略，继续尝试装 funasr */
    }
    if (funasrInstallCancelled) {
      return { ok: false, detail: '安装已取消。' }
    }
    // 3. 安装 funasr
    let res: { code: number; stdout: string; stderr: string }
    try {
      res = await runPipProcess(interp, ['-m', 'pip', 'install', 'funasr'])
    } catch (e) {
      return { ok: false, detail: `pip 安装失败：${e instanceof Error ? e.message : String(e)}` }
    }
    if (funasrInstallCancelled) {
      return { ok: false, detail: '安装已取消（执行超时）。' }
    }
    if (res.code !== 0) {
      return { ok: false, detail: `pip 安装失败（退出码 ${res.code}）：${tailOutput(res.stdout, res.stderr)}` }
    }
    // 4. 自检推理依赖；缺 torchaudio/torch/torchvision 时自动补装（一键安装要真正能用）
    let probe = await checkFunAsrDeps(interp)
    if (!probe.environmentError && probe.missing.length) {
      const depRes = await installPackages(interp, probe.missing)
      if (!depRes.ok) return { ok: false, needPython: false, detail: depRes.detail }
      probe = await checkFunAsrDeps(interp) // 补装后再自检，仍是缺才算最终失败
    }
    if (probe.environmentError) {
      return {
        ok: false,
        needPython: false,
        detail: 'funasr 已安装，但依赖探针无法确认（环境异常）。请重试，或手动执行：pip install torch torchaudio'
      }
    }
    if (probe.missing.length) {
      return {
        ok: false,
        needPython: false,
        detail: `安装后仍缺少依赖：${probe.missing.join('、')}。请手动执行：pip install ${probe.missing.join(' ')}`
      }
    }
    return { ok: true, detail: '已安装 funasr 运行环境及推理依赖。' }
  } finally {
    funasrInstalling = false
  }
}

// ============================================================
// 内联 funasr 转写脚本（写临时 .py，spawn 执行）
// ============================================================

/**
 * 生成内联的 funasr 整段转写脚本源码。
 * 用 AutoModel(model, vad_model, punc_model)+generate 得到带时间戳（毫秒，字符级）结果，
 * 按中文/英文标点把字符聚合成语句，输出 JSON：[{start_ms,end_ms,text}, ...]。
 */
function buildTranscribeScript(): string {
  return `
import sys, json
# 强制 stdout 以 UTF-8 输出（Windows 下 python 默认按 GBK 写管道，导致中文 JSON 乱码）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def main():
    wav = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "paraformer-zh"
    try:
        from funasr import AutoModel
    except Exception as e:
        print(json.dumps({"error": "no_funasr", "detail": str(e)}, ensure_ascii=False))
        sys.exit(2)

    am = AutoModel(
        model=model,
        vad_model="fsmn-vad",
        punc_model="ct-punc",
        disable_update=True,
        disable_pbar=True,
    )
    # 整段（分批）推理。sentence_timestamp=True 让 funasr 返回逐句 start/end（sentence_info），
    # 使跨环节内容能以「句子粒度」产出多段，供后续按环节边界归段，而非整场合成一条 text。
    res = am.generate(input=wav, batch_size_s=300, disable_pbar=True, sentence_timestamp=True)

    sentences = []
    for item in res or []:
        if not isinstance(item, dict):
            continue
        text = item.get("text") or ""
        ts = item.get("timestamp") or []  # 词级时间戳 [[t0,t1],...]（毫秒）
        # 1) 优先用 sentence_info（逐句 start/end），逐句产出，保证句子粒度
        si = item.get("sentence_info")
        emitted = 0
        if isinstance(si, list) and len(si) > 0:
            for s in si:
                if not isinstance(s, dict):
                    continue
                stext = s.get("text") or ""
                if not stext:
                    continue
                try:
                    sstart = int(s.get("start") or 0)
                    send = int(s.get("end") or (sstart + max(200, len(stext) * 100)))
                except (ValueError, TypeError):
                    sstart = len(sentences) * 1000
                    send = sstart + max(200, len(stext) * 100)
                if send < sstart:
                    send = sstart + max(200, len(stext) * 100)
                sentences.append({"start_ms": sstart, "end_ms": send, "text": stext})
                emitted += 1
        # 2) 无 sentence_info 时，用词级 timestamp 的首/末作为整条 text 的段时间
        if emitted == 0:
            seg_start = None
            seg_end = None
            if isinstance(ts, list) and len(ts) > 0:
                first = ts[0]
                last = ts[-1]
                try:
                    if isinstance(first, (list, tuple)) and len(first) >= 1:
                        seg_start = int(first[0])
                    elif isinstance(first, (int, float)):
                        seg_start = int(first)
                    if isinstance(last, (list, tuple)) and len(last) >= 2:
                        seg_end = int(last[-1])
                    elif isinstance(last, (int, float)):
                        seg_end = int(last)
                except (ValueError, TypeError):
                    seg_start = None
            if seg_start is None:
                # 无有效时间戳：给一个随序号递增的兜底，避免全归同一段
                seg_start = len(sentences) * 1000
            if seg_end is None or seg_end < seg_start:
                seg_end = seg_start + max(200, len(text) * 100)
            if text:
                sentences.append({"start_ms": seg_start, "end_ms": seg_end, "text": text})

    print(json.dumps(sentences, ensure_ascii=False))

if __name__ == "__main__":
    main()
`
}

/** spawn 一个命令并收集 stdout/stderr，返回退出码与输出 */
function runProcess(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (e) {
      reject(e)
      return
    }
    let out = ''
    let err = ''
    child.stdout!.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr!.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }))
  })
}

/**
 * 对整段 16k mono wav 用本机 funasr 转写，返回带时间戳（毫秒）的语句数组。
 * 内部：找一个「能 import funasr 且推理依赖齐全」的 python 解释器 → 写临时脚本 → spawn → 解析 stdout JSON。
 * 运行环境不可用或缺推理依赖时抛出带明确模块名/引导文案的错误（T4）。
 * @param wavPath 16k mono wav 绝对路径
 * @param modelPath funasr 模型名（需为 FUNASR_MODELS 白名单；compat 接受原值）
 */
export async function transcribeWholeFunAsr(
  wavPath: string,
  modelPath: string
): Promise<Array<{ startMs: number; endMs: number; text: string }>> {
  const model = asFunAsrModel(modelPath)
  // 启动前依赖完整性检查：仅 `import funasr` 不够，缺 torchaudio 等会转写才崩，这里提前拦截
  const env = await assertFunAsrReady()
  // 尝试在 sttDir()/models/funasr/<model> 建目录（funasr 可能用它做本地缓存；失败可忽略）
  await fs.mkdir(funasrModelDir(model), { recursive: true }).catch(() => undefined)
  if (!(await isReadableFile(wavPath))) {
    throw new Error(`FunASR 转写失败：wav 文件不存在（${wavPath}）`)
  }

  const tmpPy = join(tmpdir(), `funasr-transcribe-${Date.now()}.py`)
  await fs.writeFile(tmpPy, buildTranscribeScript(), 'utf8')
  try {
    const { code, stdout, stderr } = await runProcess(env.interpreter!, [tmpPy, wavPath, model])
    const output = stdout.trim()
    if (code !== 0) {
      if (output.includes('no_funasr')) {
        throw new Error(
          'FunASR 运行环境异常：could not import funasr（首次运行会拉取模型，需联网；请确认已 `pip install funasr`）。' +
            `详情：${stderr.trim() || output}`
        )
      }
      throw new Error(`FunASR 转写失败（退出码 ${code}）：${stderr.trim() || output || '未知错误'}`)
    }
    let parsed: unknown
    try {
      parsed = parseTranscribeOutput(output, stderr)
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : `FunASR 输出无法解析：${output.slice(0, 200) || stderr.slice(0, 200) || '空输出'}`
      )
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('未识别到有效语音（FunASR 未返回语句）')
    }
    const segs: Array<{ startMs: number; endMs: number; text: string }> = []
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue
      const text = String((it as { text?: unknown }).text ?? '').trim()
      if (!text) continue
      const startMs = Number((it as { start_ms?: unknown }).start_ms) || 0
      const endMs = Number((it as { end_ms?: unknown }).end_ms) ?? startMs
      segs.push({ startMs, endMs, text })
    }
    if (segs.length === 0) {
      throw new Error('未识别到有效语音（FunASR 未返回语句）')
    }
    return segs
  } finally {
    await fs.rm(tmpPy, { force: true }).catch(() => undefined)
  }
}

async function isReadableFile(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

/**
 * FunASR 引擎状态：运行环境是否齐备 + 当前模型。
 * 模型实际文件由 funasr 首次运行时自动拉取，本服务不手动下载模型；
 * 故 modelOk 在 envOk 前提下乐观视为可用，下载进度恒为 0。
 */
export async function getFunAsrStatus(): Promise<SttFunAsrStatus> {
  const model = currentFunAsrModel()
  const python = await detectPython()
  if (!python.ok) {
    return {
      envOk: false,
      modelOk: false,
      model,
      downloading: false,
      hasPython: false,
      error:
        '未检测到 Python。请先安装 Python：到 python.org 下载安装（勾选 “Add to PATH”），' +
        '或微软商店安装；装好后点击“一键安装 FunASR 依赖”，也可改回 whisper 本地引擎继续离线转写。'
    }
  }
  const env = await detectFunAsrEnv()
  if (!env.ok) {
    return {
      envOk: false,
      modelOk: false,
      model,
      downloading: false,
      hasPython: true,
      error: '已检测到 Python，但未安装 funasr 包。可点击“一键安装 FunASR 依赖”。'
    }
  }
  // 依赖齐全性自检：仅 `import funasr` 不代表能转写，缺 torchaudio 等需在此如实反馈
  const deps = env.interpreter ? await checkFunAsrDeps(env.interpreter) : undefined
  const missingDeps = deps && !deps.environmentError ? deps.missing : []
  if (deps?.environmentError) {
    return {
      envOk: false,
      modelOk: false,
      model,
      downloading: false,
      hasPython: true,
      error: '无法确认 FunASR 运行环境（依赖探针执行失败）。请重试，或执行：pip install torch torchaudio'
    }
  }
  if (deps && deps.missing.length) {
    return {
      envOk: false,
      modelOk: false,
      model,
      downloading: false,
      hasPython: true,
      missingDeps,
      error:
        `缺少依赖：${deps.missing.join('、')}。` +
        '点击“一键安装 FunASR 依赖”补全，或执行：' +
        `pip install ${deps.missing.join(' ')}`
    }
  }
  // 本机能 import funasr 且依赖齐全 → 模型由 AutoModel 运行时自动拉取，视为可用
  return {
    envOk: true,
    modelOk: true,
    model,
    downloading: false,
    progress: 0,
    hasPython: true,
    missingDeps
  }
}

/** 保底使 sttDir 作为可复用导出（来自 transcription，避免循环依赖） */
export { sttDir }