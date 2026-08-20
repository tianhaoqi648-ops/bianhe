// ============================================================
// transcription.ipc.ts — 录音转文字（STT）IPC handlers
//
// 通道：
//   stt:transcribe       对录音转文字，返回 SttSegment[]
//   stt:status           查询转写引擎安装/下载状态
//   stt:download         下载转写引擎（二进制 + 模型）到 userData/stt/
//   stt:cancel-download  取消进行中的下载
//   stt:remove           删除已下载的转写引擎
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  ApiResponse,
  SttEngineStatus,
  SttFfmpegStatus,
  SttFunAsrStatus,
  SttImportResult,
  SttRequest,
  SttSegment,
  SttFunAsrInstallResult,
  SttDirDiagnostics
} from '../../shared/types'
import { getFunAsrStatus, installFunAsrEnv } from '../services/funasr-service'
import { transcribeRecordings, pickWhisperCli, clearWhisperCli, getSttDirDiagnostics } from '../services/transcription'
import {
  getSttEngineStatus,
  downloadSttEngine,
  cancelSttDownload,
  removeSttEngine,
  importLocalModel
} from '../services/stt-download'
import {
  getFfmpegStatus,
  downloadFfmpeg,
  cancelFfmpeg,
  removeFfmpeg,
  pickFfmpegPath,
  setFfmpegManualPath
} from '../services/ffmpeg-service'

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** ffmpeg 状态错误封装：<status,error>（风格同 stt 的 ApiResponse.error） */
const errStatus = (e: unknown) => ({ installed: false, downloading: false, error: errMsg(e) })

export function registerTranscriptionIpc(): void {
  // 参数/校验：录音转文字
  ipcMain.handle(
    IPC_CHANNELS.STT_TRANSCRIBE,
    async (_e, req: SttRequest): Promise<ApiResponse<SttSegment[]>> => {
      try {
        if (!req || typeof req !== 'object') {
          return { success: false, error: '参数 req 必须为对象' }
        }
        const segments = await transcribeRecordings(req)
        return { success: true, data: segments }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  // 查询转写引擎状态（optional 指定模型，缺省读设置/默认 base）
  ipcMain.handle(
    IPC_CHANNELS.STT_STATUS,
    async (_e, model?: string): Promise<ApiResponse<SttEngineStatus>> => {
      try {
        const status = await getSttEngineStatus(typeof model === 'string' ? model : undefined)
        return { success: true, data: status }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  // 查询 FunASR 本地引擎运行环境状态（envOk/modelOk 等；模型由 funasr 运行时自动拉取）
  ipcMain.handle(IPC_CHANNELS.STT_FUNASR_STATUS, async (): Promise<SttFunAsrStatus> => {
    try {
      return await getFunAsrStatus()
    } catch (e) {
      return { envOk: false, modelOk: false, downloading: false, error: errMsg(e) }
    }
  })

  // 一键安装 FunASR 运行环境（自动检测 python + pip install funasr）
  ipcMain.handle(IPC_CHANNELS.STT_FUNASR_INSTALL, async (): Promise<SttFunAsrInstallResult> => {
    try {
      return await installFunAsrEnv()
    } catch (e) {
      return { ok: false, detail: errMsg(e) }
    }
  })

  // 下载转写引擎（防串：服务层互斥）
  ipcMain.handle(
    IPC_CHANNELS.STT_DOWNLOAD,
    async (_e, model?: string): Promise<ApiResponse<{ ok: true }>> => {
      try {
        if (typeof model !== 'string' || !model.trim()) {
          return { success: false, error: '参数 model 必须为非空字符串' }
        }
        await downloadSttEngine(model.trim())
        return { success: true, data: { ok: true } }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  // 取消下载
  ipcMain.handle(
    IPC_CHANNELS.STT_CANCEL,
    async (): Promise<ApiResponse<{ ok: true }>> => {
      try {
        await cancelSttDownload()
        return { success: true, data: { ok: true } }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  // 删除已下载的转写引擎
  ipcMain.handle(
    IPC_CHANNELS.STT_REMOVE,
    async (): Promise<ApiResponse<{ ok: true }>> => {
      try {
        await removeSttEngine()
        return { success: true, data: { ok: true } }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  // 手动导入本地 whisper 模型（离线兜底；用户取消/失败均回 SttImportResult，不抛异常）
  ipcMain.handle(
    IPC_CHANNELS.STT_IMPORT_MODEL,
    async (): Promise<SttImportResult> => {
      try {
        return await importLocalModel()
      } catch (e) {
        return { ok: false, error: errMsg(e) }
      }
    }
  )

  // 手动选择本机已有的 whisper 转写器（whisper-cli，离线兜底）
  ipcMain.handle(IPC_CHANNELS.STT_WHISPER_PICK, async (): Promise<SttEngineStatus> => {
    try {
      await pickWhisperCli()
      return await getSttEngineStatus()
    } catch (e) {
      throw new Error(errMsg(e))
    }
  })
  // 清除手动 whisper 转写器路径
  ipcMain.handle(IPC_CHANNELS.STT_WHISPER_CLEAR, async (): Promise<SttEngineStatus> => {
    try {
      await clearWhisperCli()
      return await getSttEngineStatus()
    } catch (e) {
      throw new Error(errMsg(e))
    }
  })

  // ---------- ffmpeg 转码器（m4a/webm → 16k mono wav，供本地 whisper） ----------
  // 查询状态
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_STATUS, async (): Promise<SttFfmpegStatus> => {
    try {
      return await getFfmpegStatus()
    } catch (e) {
      return errStatus(e)
    }
  })
  // 下载（服务层互斥；非 win32-x64 平台返回带 error 的状态，不抛错阻塞）
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_DOWNLOAD, async (): Promise<SttFfmpegStatus> => {
    try {
      return await downloadFfmpeg()
    } catch (e) {
      return errStatus(e)
    }
  })
  // 取消下载
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_CANCEL, async (): Promise<SttFfmpegStatus> => {
    try {
      await cancelFfmpeg()
      return await getFfmpegStatus()
    } catch (e) {
      return errStatus(e)
    }
  })
  // 删除已下载的 ffmpeg
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_REMOVE, async (): Promise<SttFfmpegStatus> => {
    try {
      await removeFfmpeg()
      return await getFfmpegStatus()
    } catch (e) {
      return errStatus(e)
    }
  })
  // 手动选择本机已有的 ffmpeg（离线兜底，省略在线下载）
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_PICK, async (): Promise<SttFfmpegStatus> => {
    try {
      return await pickFfmpegPath()
    } catch (e) {
      return errStatus(e)
    }
  })
  // 清除手动指定的 ffmpeg 路径
  ipcMain.handle(IPC_CHANNELS.STT_FFMPEG_CLEAR, async (): Promise<SttFfmpegStatus> => {
    try {
      return await setFfmpegManualPath('')
    } catch (e) {
      return errStatus(e)
    }
  })

  // 查询 stt 目录与模型/ffmpeg 在位状况（展示与丢失找回）
  ipcMain.handle(
    IPC_CHANNELS.STT_DIAGNOSTICS,
    async (): Promise<ApiResponse<SttDirDiagnostics>> => {
      try {
        return { success: true, data: getSttDirDiagnostics() }
      } catch (e) {
        return { success: false, error: errMsg(e) }
      }
    }
  )

  console.log('[main] Transcription (STT) IPC registered')
}