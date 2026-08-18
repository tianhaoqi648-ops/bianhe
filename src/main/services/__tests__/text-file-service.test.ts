// ============================================================
// text-file-service.test.ts — 稿子文件读取测试（2026-08-18）
//
// 覆盖：txt/md 读取、docx 解析（mock mammoth）、非法扩展名、超限、文件不存在、读取失败。
// mock：fs.promises（readFile/stat）与 mammoth（extractRawText）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockReadFile, mockStat, mockExtractRawText } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockExtractRawText: vi.fn()
}))

vi.mock('fs', () => ({
  promises: {
    readFile: mockReadFile,
    stat: mockStat
  }
}))

vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText }
}))

import { readTextFileContent, SPEECH_FILE_EXTENSIONS } from '../text-file-service'

beforeEach(() => {
  mockReadFile.mockReset()
  mockStat.mockReset()
  mockExtractRawText.mockReset()
})

describe('readTextFileContent', () => {
  it('支持 txt/md/docx 三种扩展名', () => {
    expect(SPEECH_FILE_EXTENSIONS).toEqual(['txt', 'md', 'docx'])
  })

  it('txt 文件 → utf-8 读取返回内容', async () => {
    mockStat.mockResolvedValue({ size: 100 })
    mockReadFile.mockResolvedValue('立论稿内容')
    const res = await readTextFileContent('C:/speech/aff.txt')
    expect(res.ok).toBe(true)
    expect(res.content).toBe('立论稿内容')
    expect(mockReadFile).toHaveBeenCalledWith('C:/speech/aff.txt', 'utf-8')
  })

  it('md 文件 → utf-8 读取', async () => {
    mockStat.mockResolvedValue({ size: 50 })
    mockReadFile.mockResolvedValue('# 辩词')
    const res = await readTextFileContent('C:/speech/neg.md')
    expect(res.ok).toBe(true)
    expect(res.content).toBe('# 辩词')
  })

  it('docx 文件 → mammoth.extractRawText 提取纯文本', async () => {
    mockStat.mockResolvedValue({ size: 500 })
    mockExtractRawText.mockResolvedValue({ value: '从 docx 提取的辩词' })
    const res = await readTextFileContent('C:/speech/aff.docx')
    expect(res.ok).toBe(true)
    expect(res.content).toBe('从 docx 提取的辩词')
    expect(mockExtractRawText).toHaveBeenCalledWith({ path: 'C:/speech/aff.docx' })
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('非法扩展名 → unsupported_type', async () => {
    const res = await readTextFileContent('C:/speech/aff.pdf')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('unsupported_type')
    expect(mockStat).not.toHaveBeenCalled()
  })

  it('文件超过 2MB → file_too_large', async () => {
    mockStat.mockResolvedValue({ size: 2 * 1024 * 1024 + 1 })
    const res = await readTextFileContent('C:/speech/aff.txt')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('file_too_large')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('文件不存在 → not_found', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))
    const res = await readTextFileContent('C:/speech/missing.txt')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('not_found')
  })

  it('读取异常 → read_failed', async () => {
    mockStat.mockResolvedValue({ size: 10 })
    mockReadFile.mockRejectedValue(new Error('EACCES'))
    const res = await readTextFileContent('C:/speech/aff.txt')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('read_failed')
    expect(res.message).toContain('EACCES')
  })
})
