// ============================================================
// event.ipc.ts — 赛事/轮次/队伍/队伍分组/队伍历史 IPC handler
//
// 注册通道：
//   event:list / event:get / event:create / event:update / event:delete
//   round:listByEvent / round:get / round:create / round:update / round:delete
//   team:listByEvent / team:get / team:create / team:update / team:delete
//   group:list / group:create / group:update / group:delete
//   team:assignGroup  将队伍分配到分组（或移出分组）
//   teamHistory:list / teamHistory:listByEvent / teamHistory:add / teamHistory:delete
//   draw:confirmSession  确认抽取结果（写入队伍历史 + 标记 session 已确认）
// ============================================================

import { ipcMain } from 'electron'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { matchRepo } from '../db/repository/match.repo'
import { getDb } from '../db/index'
import { createEvent as createEventWithDefaultGroup } from '../services/event-service'
import type {
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TeamHistoryCreateInput,
  TeamGroupCreateInput,
  TeamGroupUpdateInput
} from '../db/repository/event.repo'
import { IPC_CHANNELS } from '../../shared/types'
import type { RandomAssignGroupParams } from '../../shared/types'
import { withUndoLog, collectEventAggregateSnapshot } from '../services/undo-service'
import { wrap, wrapWithUndo } from './utils'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap/wrapWithUndo 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/**
 * Governance-8.3：为随机分组 fasten 组 undo 快照，
 * 记录事件的每支队伍的 {id, group_id}，供 undo/redo 恢复分组归属。
 */
function snapshotTeamGroups(
  teams: Array<{ id: string; group_id?: string | null }>
): Array<{ id: string; group_id: string | null }> {
  return teams.map((t) => ({ id: t.id, group_id: t.group_id ?? null }))
}

export function registerEventIpc(): void {
  // ---------- event ----------
  ipcMain.handle(IPC_CHANNELS.EVENT_LIST, (_e, filter?: EventFilter) =>
    wrap(() => eventRepo.listEvents(filter))
  )
  // 批量统计多赛事的 轮次数/队伍数/已完成轮数（N+1 优化，一次 IPC 替代逐赛事 ×3 组调用）
  ipcMain.handle(IPC_CHANNELS.EVENT_STATS_BULK, (_e, eventIds: string[]) => {
    return wrap(() => {
      assertParam(Array.isArray(eventIds), '参数 eventIds 必须为数组')
      return Array.from(eventRepo.getEventStats(eventIds).values())
    })
  })
  ipcMain.handle(IPC_CHANNELS.EVENT_GET, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return eventRepo.getEventById(id)
    })
  })
  ipcMain.handle(IPC_CHANNELS.EVENT_CREATE, (_e, data: EventCreateInput) => {
    return wrapWithUndo(() => {
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      assertNonEmptyString(data.name, 'name')
      return withUndoLog({
        storeName: 'event',
        action: 'create',
        targetType: 'event',
        targetId: null,
        label: `创建赛事`,
        getBefore: () => null,
        execute: () => createEventWithDefaultGroup(data),
        // Phase 1.1-fix R3：after 升级为聚合快照（undo 完整清场 / redo 完整重建）
        getAfter: (result) => collectEventAggregateSnapshot(result.id)
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.EVENT_UPDATE, (_e, id: string, data: EventUpdateInput) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      return withUndoLog({
        storeName: 'event',
        action: 'update',
        targetType: 'event',
        targetId: id,
        label: `更新赛事`,
        getBefore: () => eventRepo.getEventById(id) ?? null,
        execute: () => eventRepo.updateEvent(id, data),
        getAfter: () => eventRepo.getEventById(id) ?? null
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.EVENT_DELETE, (_e, id: string) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      const before = eventRepo.getEventById(id)
      return withUndoLog({
        storeName: 'event',
        action: 'delete',
        targetType: 'event',
        targetId: id,
        label: `删除赛事 ${before?.name ?? id.slice(0, 8)}（可通过撤销完整恢复；计时器与评委历史除外）`,
        // Phase 1.1-fix R1：删除前采集完整聚合快照（undo 按原 id 完整重建全部子表）
        getBefore: () => collectEventAggregateSnapshot(id),
        execute: () => eventRepo.deleteEvent(id),
        getAfter: () => null
      })
    })
  })

  // ---------- round ----------
  ipcMain.handle(IPC_CHANNELS.ROUND_LIST_BY_EVENT, (_e, eventId: string) => {
    return wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return eventRepo.listRoundsByEvent(eventId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.ROUND_GET, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return eventRepo.getRoundById(id)
    })
  })
  ipcMain.handle(IPC_CHANNELS.ROUND_CREATE, (_e, data: RoundCreateInput) => {
    return wrapWithUndo(() => {
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      assertNonEmptyString(data.event_id, 'event_id')
      return withUndoLog({
        storeName: 'event',
        action: 'create',
        targetType: 'round',
        targetId: null,
        label: `创建轮次`,
        getBefore: () => null,
        execute: () => eventRepo.createRound(data),
        getAfter: (result) => result
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.ROUND_UPDATE, (_e, id: string, data: RoundUpdateInput) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      return withUndoLog({
        storeName: 'event',
        action: 'update',
        targetType: 'round',
        targetId: id,
        label: `更新轮次`,
        getBefore: () => eventRepo.getRoundById(id) ?? null,
        execute: () => eventRepo.updateRound(id, data),
        getAfter: () => eventRepo.getRoundById(id) ?? null
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.ROUND_DELETE, (_e, id: string) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      const before = eventRepo.getRoundById(id)
      return withUndoLog({
        storeName: 'event',
        action: 'delete',
        targetType: 'round',
        targetId: id,
        label: `删除轮次 ${before?.name ?? id.slice(0, 8)}`,
        getBefore: () => before,
        execute: () => eventRepo.deleteRound(id),
        getAfter: () => null
      })
    })
  })

  // ---------- team ----------
  ipcMain.handle(IPC_CHANNELS.TEAM_LIST_BY_EVENT, (_e, eventId: string) => {
    return wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return eventRepo.listTeamsByEvent(eventId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_GET, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return eventRepo.getTeamById(id)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_CREATE, (_e, data: TeamCreateInput) => {
    return wrapWithUndo(() => {
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      assertNonEmptyString(data.event_id, 'event_id')
      assertNonEmptyString(data.name, 'name')
      return withUndoLog({
        storeName: 'event',
        action: 'create',
        targetType: 'team',
        targetId: null,
        label: `创建队伍`,
        getBefore: () => null,
        execute: () => eventRepo.createTeam(data),
        getAfter: (result) => result
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_UPDATE, (_e, id: string, data: TeamUpdateInput) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      return withUndoLog({
        storeName: 'event',
        action: 'update',
        targetType: 'team',
        targetId: id,
        label: `更新队伍`,
        getBefore: () => eventRepo.getTeamById(id) ?? null,
        execute: () => eventRepo.updateTeam(id, data),
        getAfter: () => eventRepo.getTeamById(id) ?? null
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_DELETE, (_e, id: string) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      const before = eventRepo.getTeamById(id)
      return withUndoLog({
        storeName: 'event',
        action: 'delete',
        targetType: 'team',
        targetId: id,
        label: `删除队伍 ${before?.name ?? id.slice(0, 8)}`,
        getBefore: () => before,
        execute: () => eventRepo.deleteTeam(id),
        getAfter: () => null
      })
    })
  })

  // ---------- team group ----------
  // 分组 CRUD：与 team CRUD 保持一致，写操作走 wrapWithUndo 支持撤销
  ipcMain.handle(IPC_CHANNELS.TEAM_GROUP_LIST, (_e, eventId: string) => {
    return wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return eventRepo.listGroupsByEvent(eventId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_GROUP_CREATE, (_e, data: TeamGroupCreateInput) => {
    return wrapWithUndo(() => {
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      assertNonEmptyString(data.event_id, 'event_id')
      assertNonEmptyString(data.name, 'name')
      return withUndoLog({
        storeName: 'event',
        action: 'create',
        targetType: 'team_group',
        targetId: null,
        label: `创建分组`,
        getBefore: () => null,
        execute: () => eventRepo.createGroup(data),
        getAfter: (result) => result
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_GROUP_UPDATE, (_e, id: string, data: TeamGroupUpdateInput) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      return withUndoLog({
        storeName: 'event',
        action: 'update',
        targetType: 'team_group',
        targetId: id,
        label: `更新分组`,
        getBefore: () => eventRepo.getGroupById(id) ?? null,
        execute: () => eventRepo.updateGroup(id, data),
        getAfter: () => eventRepo.getGroupById(id) ?? null
      })
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_GROUP_DELETE, (_e, id: string) => {
    return wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      const before = eventRepo.getGroupById(id)
      return withUndoLog({
        storeName: 'event',
        action: 'delete',
        targetType: 'team_group',
        targetId: id,
        label: `删除分组 ${before?.name ?? id.slice(0, 8)}`,
        getBefore: () => before,
        execute: () => eventRepo.deleteGroup(id),
        getAfter: () => null
      })
    })
  })
  // 将队伍分配到分组（groupId=null 表示移出分组）
  // Governance-8.3：接入 undo（action='assignGroup'），保证可撤销/重做。
  ipcMain.handle(
    IPC_CHANNELS.TEAM_ASSIGN_GROUP,
    (_e, teamId: string, groupId: string | null) => {
      assertNonEmptyString(teamId, 'teamId')
      const before = eventRepo.getTeamById(teamId)
      return wrapWithUndo(() => {
        return withUndoLog({
          storeName: 'event',
          action: 'assignGroup',
          targetType: 'team',
          targetId: teamId,
          label: `移动队伍到分组`,
          getBefore: () => ({ id: teamId, group_id: before?.group_id ?? null }),
          execute: () => {
            eventRepo.assignTeamToGroup(teamId, groupId)
            return true
          },
          getAfter: () => ({ id: teamId, group_id: groupId })
        })
      })
    }
  )
  // 随机分组：将赛事下的队伍随机分配到多个分组
  // Governance-8.3：非 dry-run 接入 undo（action='randomAssignGroup'）；dry-run 纯预览不入 undo。
  ipcMain.handle(
    IPC_CHANNELS.TEAM_RANDOM_ASSIGN_GROUP,
    async (_event, params: RandomAssignGroupParams) => {
      assertParam(params && typeof params === 'object', '参数 params 必须为对象')
      assertNonEmptyString(params.event_id, 'event_id')
      assertParam(typeof params.count === 'number' && params.count > 0, '参数 count 必须为正整数')
      const dryRun = params.dry_run ?? false
      if (dryRun) {
        return wrap(() => {
          return eventRepo.randomAssignGroups(
            params.event_id,
            params.strategy,
            params.count,
            params.group_names,
            params.overwrite,
            true
          )
        })
      }
      return wrapWithUndo(() => {
        return withUndoLog({
          storeName: 'event',
          action: 'randomAssignGroup',
          targetType: 'event',
          targetId: params.event_id,
          label: '随机分组',
          getBefore: () => ({ teams: snapshotTeamGroups(eventRepo.listTeamsByEvent(params.event_id)) }),
          execute: () =>
            eventRepo.randomAssignGroups(
              params.event_id,
              params.strategy,
              params.count,
              params.group_names,
              params.overwrite,
              false
            ),
          getAfter: () => ({ teams: snapshotTeamGroups(eventRepo.listTeamsByEvent(params.event_id)) })
        })
      })
    }
  )

  // ---------- team history ----------
  // P2-17：TEAM_HISTORY_ADD/DELETE 跳过改用 wrapWithUndo。原因：
  //   undo-service 的 applyEventReverse 未实现 team_history 的 add/delete 反向操作
  //   （需按 before/after 快照恢复对应 team_history 行）。改用 wrapWithUndo 后撤销会抛
  //   "unsupported action"，需先扩展 undo-service，超出本 Bug 修复范围。
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST, (_e, teamId: string) => {
    return wrap(() => {
      assertNonEmptyString(teamId, 'teamId')
      return eventRepo.listTeamHistory(teamId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, (_e, eventId: string) => {
    return wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return eventRepo.listTeamHistoryByEvent(eventId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_ADD, (_e, data: TeamHistoryCreateInput) => {
    return wrap(() => {
      assertParam(data && typeof data === 'object', '参数 data 必须为对象')
      assertNonEmptyString(data.team_id, 'team_id')
      assertNonEmptyString(data.topic_id, 'topic_id')
      assertNonEmptyString(data.event_id, 'event_id')
      return eventRepo.addTeamHistory(data)
    })
  })
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_DELETE, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return eventRepo.deleteTeamHistory(id)
    })
  })

  // ---------- draw session confirm ----------
  // 确认抽取结果：把 session 的每个 item 写入队伍历史，并标记 session.settings.confirmed=true。
  // 流程：
  //   1. 先 deleteTeamHistoryBySession 删除该 session 旧的历史记录（重抽后再次确认时去重）
  //   2. 查询 session 详情（含 items）
  //   3. 对每个 item：
  //      - 对战模式（team_b_id 非空）：两支队伍都写历史
  //      - 单人模式（team_b_id 为 null）：只写 team_a
  //      ⚠️ 测试模式（settings.is_test=true）跳过 addTeamHistory，避免污染队伍历史
  //   4. 更新 session.settings.confirmed = true
  //   5. 返回更新后的 session（含 items）
  //
  // 事务安全（P0-3）：1-4 步均为写操作，必须用 db.transaction() 包裹，
  // 否则中途失败会导致旧历史已删、新历史未写、settings 未更新等不可恢复状态。
  //
  // P2-16：跳过改用 wrapWithUndo。原因：
  //   DRAW_CONFIRM_SESSION 是多步复合事务（删除旧 team_history + 写入新 team_history + 更新
  //   session.settings.confirmed）。undo-service 的 applyDrawReverse 仅实现 'execute'/'redraw'
  //   两个 action 的反向操作，未实现 'confirmSession' action（需重建旧 team_history + 删除新
  //   team_history + 回滚 settings.confirmed）。直接改用 wrapWithUndo 后，撤销时会抛出
  //   "unsupported action" 错误。需要先扩展 undo-service 实现 confirmSession 的
  //   applyReverse/applyForward，超出本 Bug 修复范围。当前保留 wrap + db.transaction 保证原子性。
  ipcMain.handle(IPC_CHANNELS.DRAW_CONFIRM_SESSION, (_e, sessionId: string) =>
    wrap(() => {
      assertNonEmptyString(sessionId, 'sessionId')
      // 事务包裹整个操作序列：delete 旧历史 → 查询详情 → add 新历史 → 更新 settings
      // better-sqlite3 事务为同步，任一步骤抛错会自动回滚所有写操作
      const db = getDb()
      const doConfirm = db.transaction(() => {
        // 1. 删除该 session 旧历史
        eventRepo.deleteTeamHistoryBySession(sessionId)

        // 2. 查询 session 详情
        const detail = drawRepo.getSessionById(sessionId)
        if (!detail) {
          throw new Error(`[confirmDrawSession] session 不存在：${sessionId}`)
        }

        // 3. 为每个 item 写入队伍历史
        // 测试模式守卫：is_test=true 时跳过 addTeamHistory，避免测试抽取污染队伍历史
        if (!detail.settings?.is_test) {
          const playedAt = new Date().toISOString()
          for (const item of detail.items) {
            // versus/solo mode: process team_a_id / team_b_id
            if (item.team_a_id) {
              eventRepo.addTeamHistory({
                team_id: item.team_a_id,
                topic_id: item.topic_id,
                event_id: detail.event_id,
                played_at: playedAt,
                session_id: sessionId,
                stance: item.stance_a ?? null
              })
            }
            if (item.team_b_id) {
              eventRepo.addTeamHistory({
                team_id: item.team_b_id,
                topic_id: item.topic_id,
                event_id: detail.event_id,
                played_at: playedAt,
                session_id: sessionId,
                stance: item.stance_b ?? null
              })
            }

            // group/multi_team mode: process team_ids array
            const teamIds = Array.isArray(item.team_ids) ? item.team_ids : []
            const stances = item.team_stances ?? []
            for (let i = 0; i < teamIds.length; i++) {
              const tid = teamIds[i]
              // Avoid duplicates with team_a_id/team_b_id (versus mode has empty team_ids)
              if (tid === item.team_a_id || tid === item.team_b_id) continue
              eventRepo.addTeamHistory({
                team_id: tid,
                topic_id: item.topic_id,
                event_id: detail.event_id,
                played_at: playedAt,
                session_id: sessionId,
                stance: stances[i] ?? null
              })
            }
          }
        }

        // 3.5 抽题结果自动归入该轮相应「比赛」（以比赛为中心联动）
        // 仅非测试、versus 对阵（team_a_id + team_b_id）时，为该轮创建/更新 matches，
        // 实现 "抽题结果计入那个轮次的相应比赛"。group/multi_team 无双方对阵，跳过。
        if (!detail.settings?.is_test) {
          const roundId = detail.round_id ?? null
          for (const item of detail.items) {
            if (item.team_a_id && item.team_b_id) {
              matchRepo.upsertFromDraw({
                eventId: detail.event_id,
                roundId,
                teamAffId: item.team_a_id,
                teamNegId: item.team_b_id,
                topicId: item.topic_id,
                drawItemId: item.id,
                stanceAff: item.stance_a ?? null,
                stanceNeg: item.stance_b ?? null
              })
            }
          }
        }

        // 4. 更新 settings.confirmed = true
        const updated = drawRepo.updateSessionSettings(sessionId, { confirmed: true })
        if (!updated) {
          throw new Error(`[confirmDrawSession] 更新 session settings 失败：${sessionId}`)
        }
      })

      // 执行事务（失败自动回滚，wrap 会将错误转成 ApiResponse.error 返回前端）
      doConfirm()

      // 5. 返回包含 items 的完整 detail（前端 store 会替换 lastResult.session）
      return drawRepo.getSessionById(sessionId)
    })
  )
}
