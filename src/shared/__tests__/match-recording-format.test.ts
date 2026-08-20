// ============================================================
// match-recording-format.test.ts — 录音格式解析与文件名归一（T7.1）
// ============================================================

import { describe, it, expect } from 'vitest'
import { resolveRecordingFormat, buildRecordingFileName, describeRecordingFormatExt } from '../match-recording'

describe('resolveRecordingFormat', () => {
  it('显式 wav → wav', () => {
    expect(resolveRecordingFormat('wav')).toBe('wav')
  })

  it('显式 webm → webm', () => {
    expect(resolveRecordingFormat('webm')).toBe('webm')
  })

  it('显式 m4a → m4a', () => {
    expect(resolveRecordingFormat('m4a')).toBe('m4a')
  })

  it('undefined（缺失）→ 默认 wav', () => {
    expect(resolveRecordingFormat(undefined)).toBe('wav')
  })

  it('非法/未知值 → 默认 wav', () => {
    expect(resolveRecordingFormat('mp3')).toBe('wav')
    expect(resolveRecordingFormat(null)).toBe('wav')
    expect(resolveRecordingFormat(123)).toBe('wav')
  })
})

describe('buildRecordingFileName', () => {
  it('不传 format：按 mimeType 推断扩展名', () => {
    expect(buildRecordingFileName('m1', 100, 'audio/webm')).toBe('match-m1-100.webm')
    expect(buildRecordingFileName('m1', 100, 'audio/webm;codecs=opus')).toBe('match-m1-100.webm')
    expect(buildRecordingFileName('m1', 100, 'audio/mp4')).toBe('match-m1-100.mp4')
  })

  it('传 format wav → .wav（即使 mimeType 是 webm）', () => {
    expect(buildRecordingFileName('m1', 100, 'audio/webm', undefined, 'wav')).toBe('match-m1-100.wav')
  })

  it('传 format webm → .webm（即使 mimeType 是 wav）', () => {
    expect(buildRecordingFileName('m1', 100, 'audio/wav', undefined, 'webm')).toBe('match-m1-100.webm')
  })

  it('传 format m4a → .m4a（即使 mimeType 是 webm）', () => {
    expect(buildRecordingFileName('m1', 100, 'audio/webm', undefined, 'm4a')).toBe('match-m1-100.m4a')
  })
})

describe('describeRecordingFormatExt', () => {
  it('.wav → WAV（可拖动进度条）', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1.wav')).toBe('WAV（可拖动进度条）')
    expect(describeRecordingFormatExt('MATCH-1.WAV')).toBe('WAV（可拖动进度条）')
  })

  it('.m4a → M4A（AAC）', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1.m4a')).toBe('M4A（AAC）')
  })

  it('.mp4 → M4A（AAC）', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1.MP4')).toBe('M4A（AAC）')
  })

  it('.webm → WebM/未知，可能无法拖动进度条', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1.webm')).toBe('WebM/未知，可能无法拖动进度条')
  })

  it('无扩展名 → WebM/未知，可能无法拖动进度条', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1')).toBe('WebM/未知，可能无法拖动进度条')
  })

  it('未知扩展名 → WebM/未知，可能无法拖动进度条', () => {
    expect(describeRecordingFormatExt('/rec/match-abc-1.mp3')).toBe('WebM/未知，可能无法拖动进度条')
  })
})