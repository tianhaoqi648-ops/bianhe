// ============================================================
// get-timer-state.tool.test.ts — get_current_timer_state 工具测试
//
// 覆盖 get-timer-state.tool.ts 的状态分支：
//   - 无会话（listRecent 返回 []）→ { active: false, message }
//   - 最近会话已结束（status='finished'）→ { active: false, message }
//   - 活动会话（idle/running/paused）→ { active: true, session, currentStageName }
//   - currentStageIndex 越界 → currentStageName=null
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock timerSessionRepo.listRecent，隔离工具层分支逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TimerSession } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockListRecent } = vi.hoisted(() => ({
  mockListRecent: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/timer-session.repo', () => ({
  timerSessionRepo: {
    listRecent: mockListRecent
  }
}))

// 导入被测模块（在 mock 之后）
import { getTimerStateTool as _getTimerStateTool } from '../get-timer-state.tool'

// ToolDefinition.execute 默认返回 Promise<unknown>，测试中需断言为具体返回类型
interface TimerStateResult {
  active: boolean
  message?: string
  session?: TimerSession
  currentStageName?: string | null
}
interface TimerStateTool {
  name: string
  riskLevel: string
  parameters: { properties: Record<string, unknown>; required?: string[] }
  execute: (args: Record<string, unknown>) => Promise<TimerStateResult>
}
const getTimerStateTool = _getTimerStateTool as unknown as TimerStateTool

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条 TimerSession，可指定 status 与 currentStageIndex */
function makeSession(
  status: TimerSession['status'],
  currentStageIndex = 0
): TimerSession {
  return {
    id: 'session-1',
    eventId: 'event-1',
    roundId: null,
    teamAffId: 'ta',
    teamNegId: 'tn',
    topicId: 't1',
    formatId: 'fmt-1',
    formatSnapshot: {
      stages: [
        { id: 's1', name: '立论', side: 'aff', durationMs: 180000, bells: [] },
        { id: 's2', name: '驳论', side: 'neg', durationMs: 180000, bells: [] },
        { id: 's3', name: '自由辩论', side: 'both', durationMs: 240000, bells: [] }
      ],
      totalDurationMs: 600000
    },
    status,
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: status === 'finished' ? '2026-01-01T11:00:00.000Z' : null,
    currentStageIndex,
    currentSide: 'aff',
    remainingMs: 120000,
    themeSnapshot: null,
    label: '初赛第1场',
    createdAt: '2026-01-01T09:50:00.000Z',
    stageRemainingCache: null,
    affRemainingMs: null,
    negRemainingMs: null,
    eventName: '春季赛',
    teamAffName: '清华队',
    teamNegName: '北大队',
    topicTitle: '大学生是否应该兼职'
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockListRecent.mockReturnValue([])
})

describe('get_current_timer_state：无活动会话', () => {
  it('listRecent 返回空 → { active: false, message }', async () => {
    mockListRecent.mockReturnValue([])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(false)
    expect(result.message).toBe('当前无活动计时器会话')
    // 仅传 1 取最近一条
    expect(mockListRecent).toHaveBeenCalledWith(1)
  })

  it('最近会话 status=finished → { active: false, message }', async () => {
    mockListRecent.mockReturnValue([makeSession('finished')])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(false)
    expect(result.message).toBe('最近一次计时会话已结束')
  })
})

describe('get_current_timer_state：活动会话', () => {
  it('status=idle → { active: true, session, currentStageName }', async () => {
    const session = makeSession('idle', 0)
    mockListRecent.mockReturnValue([session])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(true)
    expect(result.session).toEqual(session)
    expect(result.currentStageName).toBe('立论')
  })

  it('status=running → 返回当前环节名', async () => {
    const session = makeSession('running', 1)
    mockListRecent.mockReturnValue([session])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(true)
    expect(result.currentStageName).toBe('驳论')
  })

  it('status=paused → 仍视为活动会话', async () => {
    const session = makeSession('paused', 2)
    mockListRecent.mockReturnValue([session])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(true)
    expect(result.currentStageName).toBe('自由辩论')
  })

  it('currentStageIndex 越界 → currentStageName=null', async () => {
    // stages 长度为 3，index=99 越界
    const session = makeSession('running', 99)
    mockListRecent.mockReturnValue([session])

    const result = await getTimerStateTool.execute({})

    expect(result.active).toBe(true)
    expect(result.currentStageName).toBeNull()
  })

  it('返回的 session 为完整对象（含 formatSnapshot）', async () => {
    const session = makeSession('running', 0)
    mockListRecent.mockReturnValue([session])

    const result = await getTimerStateTool.execute({})

    expect(result.session?.formatSnapshot.stages).toHaveLength(3)
    expect(result.session?.label).toBe('初赛第1场')
  })
})

describe('get_current_timer_state：repo 错误透传', () => {
  it('listRecent 抛错 → 工具抛出同一错误', async () => {
    mockListRecent.mockImplementation(() => {
      throw new Error('DB 计时器查询失败')
    })

    await expect(
      getTimerStateTool.execute({})
    ).rejects.toThrow(/DB 计时器查询失败/)
  })
})

describe('get_current_timer_state：工具元数据', () => {
  it('name 应为 get_current_timer_state', () => {
    expect(getTimerStateTool.name).toBe('get_current_timer_state')
  })

  it('riskLevel 应为 low', () => {
    expect(getTimerStateTool.riskLevel).toBe('low')
  })

  it('parameters 为空对象（无入参）', () => {
    expect(getTimerStateTool.parameters.properties).toEqual({})
    expect(getTimerStateTool.parameters.required ?? []).toEqual([])
  })
})
