// ============================================================
// transcription-dir.test.ts — resolveSttDir 目录归一化纯函数单测（T4）
//
// 覆盖：resolveSttDir 把「用户配置的数据根目录」归一成实际引擎目录 <根>/stt：
//   - root 为空/空白 → 用默认 userData/stt（此处 mock app.getPath 返 '', 只断言以 'stt' 结尾）
//   - root 最后一段已是 stt（大小写不敏感，精确整段）→ 直接返回 root，避免 stt/stt
//   - 否则（含 stt 子串但末尾段不是 stt，如 market/my-stt）→ join(root, 'stt')
// 说明：basename('C:\Data\stt\') 在 Windows/Node path.basename 正确给 'stt'，故带尾斜杠
//       仍命中「不追加」；但单测运行平台未必是 Windows，故主体用例用 posix 风格路径。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'

// tolerance.ts 模块顶部依赖 electron，这里 mock 掉 app.getPath
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

import { resolveSttDir } from '../transcription'
import { STT_DIR_NAME } from '../../../shared/types'

describe('resolveSttDir（转写引擎目录归一化）', () => {
  it('空 root → 返回以 stt 结尾的默认目录，不抛错', () => {
    const res = resolveSttDir('')
    expect(res).toMatch(new RegExp(`(^|[\\\\/])${STT_DIR_NAME}$`))
  })

  it('全空白 root → 同上（以 stt 结尾，不抛错）', () => {
    const res = resolveSttDir('   ')
    expect(res).toMatch(new RegExp(`(^|[\\\\/])${STT_DIR_NAME}$`))
  })

  it('/data/model（末尾段非 stt）→ 追加为 /data/model/stt', () => {
    expect(resolveSttDir('/data/model')).toBe(join('/data/model', 'stt'))
  })

  it('/data/stt（末尾段正是 stt）→ 原样返回，不追加', () => {
    expect(resolveSttDir('/data/stt')).toBe('/data/stt')
  })

  it('/data/stt/（带尾斜杠）→ 原样返回，不追加', () => {
    expect(resolveSttDir('/data/stt/')).toBe('/data/stt/')
  })

  it('/data/STT（大小写不敏感）→ 原样返回，不追加', () => {
    expect(resolveSttDir('/data/STT')).toBe('/data/STT')
  })

  it('/data/market（含 stt 子串但末尾段不是 stt）→ 追加为 /data/market/stt', () => {
    expect(resolveSttDir('/data/market')).toBe(join('/data/market', 'stt'))
  })

  it('/data/my-stt（末尾段不是精确 stt）→ 追加为 /data/my-stt/stt', () => {
    expect(resolveSttDir('/data/my-stt')).toBe(join('/data/my-stt', 'stt'))
  })
})