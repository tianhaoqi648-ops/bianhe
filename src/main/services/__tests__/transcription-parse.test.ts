// ============================================================
// transcription-parse.test.ts — STT 时间戳解析 + 环节归段纯函数单测（2026-08-20）
//
// 覆盖：parseWhisperSegments（MM:SS.mmm / HH:MM:SS.mmm、日志行/分隔符行跳过滤）、
//       extractStdoutText（复用时间戳行解析、丢日志、只返回纯文本）、
//       bucketByStage（多环节归段/同环节文本合并/无标记单段/空输入单段）。
// 仅覆盖可 import 的纯函数；transcription.ts 顶部依赖 electron，故在此 mock 掉。
// ============================================================

import { describe, it, expect, vi } from 'vitest'

// 解析/归段函数本身不触碰 electron，但所在模块顶部 import 了 electron 与其依赖，
// 故在 import 前 mock 掉 electron、db repository 与 ffmpeg-service。
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  net: { fetch: () => Promise.reject(new Error('not used in unit test')) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
}))

vi.mock('../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: () => null,
    setSetting: () => {}
  }
}))

vi.mock('./ffmpeg-service', () => ({
  getFfmpegStatus: async () => ({ installed: false }),
  transcodeToWav: async () => {},
  ffmpegPath: () => ''
}))

import { parseWhisperSegments, extractStdoutText, bucketByStage, resolveSttLocalEngine } from '../transcription'
import {
  asFunAsrModel,
  probeDepsCode,
  parseProbeOutput,
  parseTranscribeOutput,
  checkFunAsrDeps,
  FUNASR_DEPS
} from '../funasr-service'

describe('parseWhisperSegments', () => {
  it('从含日志行、分隔符行与混合时间戳行的输出中正确解析出 {startMs,endMs,text}', () => {
    const out = [
      "load: model from 'models/ggml-base.bin'",
      'system_info: n_threads = 4 / 8 | AVX = 1',
      'whisper_print_timings: load time = 123.45 ms',
      '-- p.1 --',
      '[00:00:00.000 --> 00:00:03.500]   各位评委好',
      '[00:00:03.600 --> 00:00:06.200]   我方观点一',
      '',
      '[00:00:06.300 --> 00:00:08.000]   支持方论述',
      "main: processing 'x.wav'",
      '[00:01:05.123 --> 00:01:07.456]   第二环节内容',
      '[01:23:45.678 --> 01:23:49.000]   多小时录音内容'
    ].join('\n')

    const segs = parseWhisperSegments(out)
    expect(segs).toHaveLength(5)
    expect(segs[0]).toEqual({ startMs: 0, endMs: 3500, text: '各位评委好' })
    expect(segs[1]).toEqual({ startMs: 3600, endMs: 6200, text: '我方观点一' })
    expect(segs[2]).toEqual({ startMs: 6300, endMs: 8000, text: '支持方论述' })
    // 00:01:05.123 → (1*60+5)*1000+123 = 65123
    expect(segs[3]).toEqual({ startMs: 65123, endMs: 67456, text: '第二环节内容' })
    // 01:23:45.678 → ((1*60+23)*60+45)*1000+678 = 5025678
    expect(segs[4]).toEqual({ startMs: 5025678, endMs: 5029000, text: '多小时录音内容' })
  })

  it('兼容只有「分钟」的 MM:SS.mmm 时间戳格式', () => {
    const out = '[01:02.500 --> 01:05.000]   只有分钟格式'
    const segs = parseWhisperSegments(out)
    expect(segs).toEqual([{ startMs: 62500, endMs: 65000, text: '只有分钟格式' }])
  })

  it('跳过日志行、分隔符行与无文本的空时间戳行', () => {
    const out = [
      'load: something',
      '--',
      '[00:00:00.000 --> 00:00:01.000]   ',
      '[00:00:02.000 --> 00:00:03.000]   有效文本'
    ].join('\n')
    const segs = parseWhisperSegments(out)
    expect(segs).toEqual([{ startMs: 2000, endMs: 3000, text: '有效文本' }])
  })

  it('空输入返回空数组', () => {
    expect(parseWhisperSegments('')).toEqual([])
    expect(parseWhisperSegments('\n\n  \n')).toEqual([])
  })
})

describe('extractStdoutText（复用时间戳行解析）', () => {
  it('丢日志、只返回纯文本（多行由换行合并），行为不变', () => {
    const out = [
      'system_info: n_threads = 4 | AVX = 1',
      '[00:00:00.000 --> 00:00:03.500]   各位评委好',
      'whisper_print_timings: load time = 1.00 ms',
      '[00:00:03.600 --> 00:00:06.200]   我方观点一'
    ].join('\n')
    expect(extractStdoutText(out)).toBe('各位评委好\n我方观点一')
  })

  it('保留非日志、非时间戳的字行（历史兜底行为不回归）', () => {
    const out = '[00:00:01.000 --> 00:00:02.000]   带时间戳的文本\n无时间戳的字行'
    expect(extractStdoutText(out)).toBe('带时间戳的文本\n无时间戳的字行')
  })
})

describe('bucketByStage', () => {
  const segs = [
    { startMs: 0, endMs: 1000, text: 'A1' },
    { startMs: 2000, endMs: 3000, text: 'A2' },
    { startMs: 6000, endMs: 6200, text: 'B1' },
    { startMs: 15000, endMs: 15200, text: 'C1' }
  ]

  it('按环节边界归段、同环节多条文本用换行合并、startMs 取环节首条', () => {
    const stageTimes = [0, 6000, 14000]
    const labels = [
      { stage: '立论', speaker: '正方一' },
      { stage: '质询', speaker: '反方二' },
      { stage: '总结', speaker: '正方三' }
    ]
    const res = bucketByStage(segs, stageTimes, labels)
    expect(res).toEqual([
      { stage: '立论', speaker: '正方一', text: 'A1\nA2', startMs: 0 },
      { stage: '质询', speaker: '反方二', text: 'B1', startMs: 6000 },
      { stage: '总结', speaker: '正方三', text: 'C1', startMs: 15000 }
    ])
  })

  it('stageTimes 首个非 0 时先归一化为相对（首值为 0），再归段', () => {
    // 相对监听场景：markers.atMs 为绝对 epoch，首段 startMs 仍是相对文件的
    const stageTimes = [6000, 12000, 20000] // 首个 6000 ≠ 0 → 归一化为 [0,6000,14000]
    const labels = [
      { stage: '立论', speaker: '正方一' },
      { stage: '质询', speaker: '反方二' },
      { stage: '总结', speaker: '正方三' }
    ]
    const res = bucketByStage(segs, stageTimes, labels)
    expect(res).toEqual([
      { stage: '立论', speaker: '正方一', text: 'A1\nA2', startMs: 0 },
      { stage: '质询', speaker: '反方二', text: 'B1', startMs: 6000 },
      { stage: '总结', speaker: '正方三', text: 'C1', startMs: 15000 }
    ])
  })

  it('stageTimes 为空 → 返回单个无 stage/speaker 的整段（文本按行合并）', () => {
    const res = bucketByStage(segs, [], [])
    expect(res).toHaveLength(1)
    expect(res[0].text).toBe('A1\nA2\nB1\nC1')
    expect(res[0].startMs).toBe(0)
    expect('stage' in res[0]).toBe(false)
    expect('speaker' in res[0]).toBe(false)
  })

  it('无有效标签（labels 全 undefined）→ 同样归为单段', () => {
    const res = bucketByStage(segs, [0, 6000], [undefined, undefined])
    expect(res).toHaveLength(1)
    expect(res[0].text).toBe('A1\nA2\nB1\nC1')
    expect('stage' in res[0]).toBe(false)
  })

  it('segs 为空且无标记（stageTimes 为空）→ 返回单个空文本段（startMs 为 0）', () => {
    const res = bucketByStage([], [], [])
    expect(res).toEqual([{ text: '', startMs: 0 }])
  })
})

describe('resolveSttLocalEngine（本地引擎实现解析）', () => {
  it('funasr 原样返回，其余（未定义/非法/whisper）回退 whisper', () => {
    expect(resolveSttLocalEngine('funasr')).toBe('funasr')
    expect(resolveSttLocalEngine('whisper')).toBe('whisper')
    expect(resolveSttLocalEngine(undefined)).toBe('whisper')
    expect(resolveSttLocalEngine('bogus')).toBe('whisper')
    expect(resolveSttLocalEngine(null)).toBe('whisper')
  })
})

describe('asFunAsrModel（FunASR 模型名白名单校验）', () => {
  it('仅接受 FUNASR_MODELS 白名单项，其余回退缺省 paraformer-zh', () => {
    expect(asFunAsrModel('paraformer-zh')).toBe('paraformer-zh')
    expect(asFunAsrModel('sensevoicesmall-zh')).toBe('sensevoicesmall-zh')
    expect(asFunAsrModel('not-a-model')).toBe('paraformer-zh')
    expect(asFunAsrModel(undefined)).toBe('paraformer-zh')
    expect(asFunAsrModel('')).toBe('paraformer-zh')
  })
})

describe('funasr 依赖探针（T1）probeDepsCode', () => {
  it('探针源码按序 import 全部推理依赖，且输出合法 JSON 结构', () => {
    const code = probeDepsCode()
    for (const mod of FUNASR_DEPS) {
      expect(code).toContain(mod)
    }
    // 仅捕获 ModuleNotFoundError → 收进 missing（其它异常不误报缺失）
    expect(code).toContain('ModuleNotFoundError')
    expect(code).toContain('missing.append')
    expect(code).toContain('json.dumps({"ok": len(missing) == 0, "missing": missing})')
  })

  it('FUNASR_DEPS 清单覆盖 torch/torchaudio/torchvision', () => {
    expect([...FUNASR_DEPS]).toEqual(['torch', 'torchaudio', 'torchvision'])
  })
})

describe('funasr 依赖探针输出解析 parseProbeOutput（T1）', () => {
  it('有用 JSON：全部依赖装上 → parsed=true, ok=true, missing=[]', () => {
    expect(parseProbeOutput('{"ok":true,"missing":[]}')).toEqual({
      parsed: true,
      ok: true,
      missing: []
    })
  })

  it('缺失列表提取：ok=false 时按序取出缺失模块名', () => {
    expect(parseProbeOutput('{"ok":false,"missing":["torchaudio"]}')).toEqual({
      parsed: true,
      ok: false,
      missing: ['torchaudio']
    })
    expect(parseProbeOutput('{"ok":false,"missing":["torch","torchaudio","torchvision"]}')).toEqual({
      parsed: true,
      ok: false,
      missing: ['torch', 'torchaudio', 'torchvision']
    })
  })

  it('缺失列表过滤掉非字符串项（如 null/true/嵌套对象）', () => {
    const res = parseProbeOutput('{"ok":false,"missing":["torchaudio",null,true,{"m":1},3]}')
    expect(res.parsed).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual(['torchaudio'])
  })

  it('前面有 import 告警噪声时，仍取最后一个 JSON 对象解析', () => {
    const noisy = 'some warning line\n{"ok":false,"missing":["torchvision"]}'
    expect(parseProbeOutput(noisy)).toEqual({ parsed: true, ok: false, missing: ['torchvision'] })
  })

  it('无 JSON / 结构化损坏 → parsed=false、missing=[]（视为环境异常，非缺依赖）', () => {
    // 空字符串
    expect(parseProbeOutput('')).toEqual({ parsed: false, ok: false, missing: [] })
    // 不是 JSON
    expect(parseProbeOutput('Traceback ... ModuleNotFoundError: No module named torchaudio')).toMatchObject({
      parsed: false,
      missing: []
    })
    // 只有左括号 / 不完整 JSON
    expect(parseProbeOutput('{"ok":true')).toMatchObject({ parsed: false, missing: [] })
    // 有括号但不是质数对象（数组）
    expect(parseProbeOutput('[1,2,3]')).toMatchObject({ parsed: false, missing: [] })
  })
})

describe('funasr 依赖探测 checkFunAsrDeps（T1 错误分支）', () => {
  it('spawn 不存在的解释器 → environmentError=true、missing=[]（环境异常，不当作缺依赖）', async () => {
    const res = await checkFunAsrDeps('definitely-not-a-python-xyz-12345')
    expect(res.environmentError).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual([])
    expect(typeof res.output).toBe('string')
  })
})

describe('parseTranscribeOutput（FunASR 转写输出解析——忽略 torchaudio 噪声行）', () => {
  it('stdout 仅为 JSON 数组时正常返回数组', () => {
    const out = '[{"start_ms":0,"end_ms":1000,"text":"你好"},{"start_ms":1000,"end_ms":2000,"text":"再见"}]'
    const res = parseTranscribeOutput(out)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(2)
  })

  it('stdout 混入 torchaudio `Notice: ffmpeg is not installed` 噪声行时仍能解析出 JSON 数组', () => {
    const noisy = [
      'Notice: ffmpeg is not installed. torchaudio is used to load audio',
      'If you want to use ffmpeg backend to load audio, please install it by:',
      '    sudo apt install ffmpeg # ubuntu',
      '# brew install ffmpeg # mac',
      '[{"start_ms":0,"end_ms":800,"text":"正方立论"}]'
    ].join('\n')
    const res = parseTranscribeOutput(noisy)
    expect(Array.isArray(res)).toBe(true)
    expect(res).toEqual([{ start_ms: 0, end_ms: 800, text: '正方立论' }])
  })

  it('JSON 数组前有空白占位符行也能正确提取', () => {
    const noisy = '\n\n  \n[{"start_ms":10,"end_ms":20,"text":"x"}]'
    const res = parseTranscribeOutput(noisy)
    expect(res).toEqual([{ start_ms: 10, end_ms: 20, text: 'x' }])
  })

  it('stdout 找不到 JSON 数组时抛错，错误信息包含输出片段', () => {
    expect(() => parseTranscribeOutput('纯文本，没有任何方括号')).toThrow(/FunASR 输出无法解析/)
  })
})