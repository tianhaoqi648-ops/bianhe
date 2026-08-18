// ============================================================
// context-manager.test.ts — 按会话隔离测试（2026-08-18 改造）
//
// 覆盖：两会话的消息历史/业务上下文互不覆盖；无 sessionId 落默认桶；
// resetSession 清理；buildLLMMessages 按会话取历史。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  addMessage,
  getMessages,
  setMessages,
  setContext,
  getContext,
  clearContext,
  clear,
  buildLLMMessages,
  resetSession,
  lock,
  unlock
} from '../context-manager'

beforeEach(() => {
  // 清理所有会话状态（含默认桶）
  resetSession(undefined)
  resetSession('s1')
  resetSession('s2')
})

const msg = (
  role: 'user' | 'assistant',
  content: string
): { role: 'user' | 'assistant'; content: string } => ({ role, content })

describe('按会话隔离：消息历史', () => {
  it('两会话的消息互不覆盖', () => {
    addMessage('s1', msg('user', 'A1'))
    addMessage('s2', msg('user', 'B1'))
    addMessage('s1', msg('assistant', 'A2'))

    expect(getMessages('s1').map((m) => m.content)).toEqual(['A1', 'A2'])
    expect(getMessages('s2').map((m) => m.content)).toEqual(['B1'])
  })

  it('无 sessionId 与有 sessionId 互不影响（默认桶）', () => {
    addMessage(undefined, msg('user', 'default'))
    addMessage('s1', msg('user', 's1'))

    expect(getMessages(undefined)).toHaveLength(1)
    expect(getMessages('s1')).toHaveLength(1)
    expect(getMessages('s2')).toHaveLength(0)
  })

  it('setMessages 按会话覆盖', () => {
    setMessages('s1', [msg('user', 'X')])
    setMessages('s2', [msg('user', 'Y')])
    expect(getMessages('s1')[0].content).toBe('X')
    expect(getMessages('s2')[0].content).toBe('Y')
  })

  it('resetSession 只清理指定会话', () => {
    addMessage('s1', msg('user', 'A'))
    addMessage('s2', msg('user', 'B'))
    resetSession('s1')
    expect(getMessages('s1')).toHaveLength(0)
    expect(getMessages('s2')).toHaveLength(1)
  })
})

describe('按会话隔离：业务上下文', () => {
  it('两会话的上下文互不覆盖', () => {
    setContext('s1', { currentTopic: { id: 'T1', title: '辩题A' } })
    setContext('s2', { currentTopic: { id: 'T2', title: '辩题B' } })
    expect(getContext('s1').currentTopic?.title).toBe('辩题A')
    expect(getContext('s2').currentTopic?.title).toBe('辩题B')
  })

  it('clearContext 只清指定会话', () => {
    setContext('s1', { currentTopic: { id: 'T1', title: 'A' } })
    setContext('s2', { currentTopic: { id: 'T2', title: 'B' } })
    clearContext('s1')
    expect(getContext('s1').currentTopic).toBeUndefined()
    expect(getContext('s2').currentTopic?.title).toBe('B')
  })

  it('lock 只影响指定会话', () => {
    setContext('s1', { currentTopic: { id: 'T1', title: 'A' } })
    setContext('s2', { currentTopic: { id: 'T2', title: 'B' } })
    lock('s1')
    setContext('s1', {
      currentTopic: { id: 'T1', title: 'A2' },
      currentEvent: { id: 'E1', name: 'E1' }
    })
    setContext('s2', { currentTopic: { id: 'T2', title: 'B2' } })
    expect(getContext('s1').currentTopic?.title).toBe('A') // 锁定：不覆盖
    expect(getContext('s1').currentEvent?.id).toBe('E1') // 锁定：追加新字段
    expect(getContext('s2').currentTopic?.title).toBe('B2') // 未锁定：正常覆盖
    unlock('s1')
  })

  it('clear 只清指定会话的历史与上下文', () => {
    addMessage('s1', msg('user', 'A'))
    setContext('s1', { currentTopic: { id: 'T1', title: 'A' } })
    addMessage('s2', msg('user', 'B'))
    setContext('s2', { currentTopic: { id: 'T2', title: 'B' } })
    clear('s1')
    expect(getMessages('s1')).toHaveLength(0)
    expect(getContext('s1').currentTopic).toBeUndefined()
    expect(getMessages('s2')).toHaveLength(1)
    expect(getContext('s2').currentTopic?.title).toBe('B')
  })
})

describe('按会话隔离：buildLLMMessages', () => {
  it('按会话历史构建，插入 system', () => {
    addMessage('s1', msg('user', 'A'))
    const msgs = buildLLMMessages('s1', 'sys-prompt')
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'sys-prompt' })
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'A' })
    // s2 不受影响
    expect(buildLLMMessages('s2', 'sys-prompt')).toHaveLength(1)
  })
})
