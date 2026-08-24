// ============================================================
// topic-group.ipc.ts — 题组（题库）IPC handlers
//
// 提供 题组 CRUD / 成员增删查 / 赛事绑定 / 默认题库 四个维度的通道，
// 数据取自主进程 topicGroupRepo（见 src/main/db/repository/topic-group.repo.ts）。
// 渲染进程通过 preload 暴露的 window.groupAPI 调用。
//
// 覆盖：
//   - 题组：list / createGroup / rename / delete（删除默认题库被 repo 拒绝）
//   - 成员：listTopicsByGroup / addTopicsToGroup / removeTopicsFromGroup
//   - 赛事绑定：listGroupsByEvent / bindEventGroups / unbindEventGroup
//   - 默认：getDefaultTopicGroup
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  TopicGroup,
  GroupTopic,
  TopicGroupCreateInput,
  TopicGroupRenameInput,
  TopicGroupAddTopicsInput,
  TopicGroupRemoveTopicsInput,
  TopicGroupBatchAddInput,
  TopicGroupBatchRemoveInput,
  TopicGroupCopyInput,
  GroupCopyResult,
  EventBindGroupsInput,
  EventUnbindGroupInput,
  EventBankConfig,
  EventSetBankConfigInput,
  RoundBindGroupsInput,
  RoundUnbindGroupInput
} from '../../shared/types'
import { topicGroupRepo } from '../db/repository/topic-group.repo'
import { validateBankConfig } from '../../shared/config-validator'
import { wrap, wrapWithUndo } from './utils'
import { withUndoLog } from '../services/undo-service'

/** 参数校验（仿 judge.ipc.ts / import.ipc.ts） */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/** 校验非空字符串数组（每个元素必须是非空字符串） */
function assertIdList(value: unknown, name: string): asserts value is string[] {
  assertParam(Array.isArray(value), `参数 ${name} 必须为字符串数组`)
  assertParam(value.every((v) => typeof v === 'string' && v.length > 0), `参数 ${name} 必须为非空字符串数组`)
}

export function registerTopicGroupIpc(): void {
  // ---------- 题组 ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_LIST, () =>
    wrap<TopicGroup[]>(() => topicGroupRepo.list())
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_GET_DEFAULT, () =>
    wrap<TopicGroup>(() => topicGroupRepo.getDefault())
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_CREATE, (_e, input: TopicGroupCreateInput) =>
    wrap<TopicGroup>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      assertNonEmptyString(name, 'input.name')
      return topicGroupRepo.createGroup(name)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_RENAME, (_e, input: TopicGroupRenameInput) =>
    wrap<TopicGroup | undefined>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.id, 'input.id')
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      assertNonEmptyString(name, 'input.name')
      const updated = topicGroupRepo.rename(input.id, name)
      if (!updated) throw new Error('题组不存在')
      return updated
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_DELETE, (_e, id: string) =>
    wrap<boolean>(() => {
      assertNonEmptyString(id, 'id')
      // repo.delete 对默认题库会抛错，wrap 统一转为 ApiResponse.error
      return topicGroupRepo.delete(id)
    })
  )

  // ---------- 成员 ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_LIST_TOPICS, (_e, groupId: string) =>
    wrap<GroupTopic[]>(() => {
      assertNonEmptyString(groupId, 'groupId')
      return topicGroupRepo.listTopicsByGroup(groupId)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.GROUP_TOPIC_ADD_TOPICS,
    (_e, input: TopicGroupAddTopicsInput) =>
      wrap<number>(() => {
        assertParam(input && typeof input === 'object', '参数 input 必须为对象')
        assertNonEmptyString(input.groupId, 'input.groupId')
        assertIdList(input.topicIds, 'input.topicIds')
        return topicGroupRepo.addTopicsToGroup(input.groupId, input.topicIds)
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.GROUP_TOPIC_REMOVE_TOPICS,
    (_e, input: TopicGroupRemoveTopicsInput) =>
      wrap<number>(() => {
        assertParam(input && typeof input === 'object', '参数 input 必须为对象')
        assertNonEmptyString(input.groupId, 'input.groupId')
        assertIdList(input.topicIds, 'input.topicIds')
        return topicGroupRepo.removeTopicsFromGroup(input.groupId, input.topicIds)
      })
  )

  // ---------- 批量增减 与 整库复制/移动（T1：赛事题库 UX 后端操作 helper） ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, (_e, input: TopicGroupBatchAddInput) =>
    wrap<number>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertIdList(input.topicIds, 'input.topicIds')
      assertIdList(input.groupIds, 'input.groupIds')
      return topicGroupRepo.batchAddToGroups(input.topicIds, input.groupIds)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.GROUP_TOPIC_BATCH_REMOVE,
    (_e, input: TopicGroupBatchRemoveInput) =>
      wrap<number>(() => {
        assertParam(input && typeof input === 'object', '参数 input 必须为对象')
        assertNonEmptyString(input.groupId, 'input.groupId')
        assertIdList(input.topicIds, 'input.topicIds')
        return topicGroupRepo.batchRemoveFromGroup(input.groupId, input.topicIds)
      })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_COPY_GROUP, (_e, input: TopicGroupCopyInput) =>
    wrap<GroupCopyResult[]>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.srcGroupId, 'input.srcGroupId')
      assertIdList(input.targetGroupIds, 'input.targetGroupIds')
      return topicGroupRepo.copyGroupToGroup(input.srcGroupId, input.targetGroupIds)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_MOVE_GROUP, (_e, input: TopicGroupCopyInput) =>
    wrap<GroupCopyResult[]>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.srcGroupId, 'input.srcGroupId')
      assertIdList(input.targetGroupIds, 'input.targetGroupIds')
      return topicGroupRepo.moveGroupToGroup(input.srcGroupId, input.targetGroupIds)
    })
  )

  // ---------- 赛事绑定 ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap<TopicGroup[]>(() => {
      assertNonEmptyString(eventId, 'eventId')
      return topicGroupRepo.listGroupsByEvent(eventId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_BIND_EVENT, (_e, input: EventBindGroupsInput) =>
    wrapWithUndo(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      assertIdList(input.groupIds, 'input.groupIds')
      // Governance-8.3：bind/unbind 统一走 'bindEvent' 全量快照 undo（before/after 为绑定 id 集合）
      return withUndoLog({
        storeName: 'topicGroup',
        action: 'bindEvent',
        targetType: 'event',
        targetId: input.eventId,
        label: '绑定赛事题库',
        getBefore: () => ({
          id: input.eventId,
          group_ids: topicGroupRepo.listGroupsByEvent(input.eventId).map((g) => g.id)
        }),
        execute: () => {
          return topicGroupRepo.bindEventGroups(input.eventId, input.groupIds)
        },
        getAfter: () => ({
          id: input.eventId,
          group_ids: topicGroupRepo.listGroupsByEvent(input.eventId).map((g) => g.id)
        })
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_UNBIND_EVENT, (_e, input: EventUnbindGroupInput) =>
    wrapWithUndo(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      assertNonEmptyString(input.groupId, 'input.groupId')
      return withUndoLog({
        storeName: 'topicGroup',
        action: 'bindEvent',
        targetType: 'event',
        targetId: input.eventId,
        label: `解绑赛事题库 ${input.groupId.slice(0, 8)}`,
        getBefore: () => ({
          id: input.eventId,
          group_ids: topicGroupRepo.listGroupsByEvent(input.eventId).map((g) => g.id)
        }),
        execute: () => {
          topicGroupRepo.unbindEventGroup(input.eventId, input.groupId)
          return true
        },
        getAfter: () => ({
          id: input.eventId,
          group_ids: topicGroupRepo.listGroupsByEvent(input.eventId).map((g) => g.id)
        })
      })
    })
  )

  // ---------- 赛事选题模式配置（read/write events.bank_config） ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_GET_EVENT_BANK_CONFIG, (_e, eventId: string) =>
    wrap<EventBankConfig>(() => {
      assertNonEmptyString(eventId, 'eventId')
      return topicGroupRepo.getEventBankConfig(eventId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_SET_EVENT_BANK_CONFIG, (_e, input: EventSetBankConfigInput) =>
    wrapWithUndo(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      const config = input.config
      const vc = validateBankConfig(config)
      if (!vc.ok) throw new Error(vc.error)
      // Governance-8.3：bank 配置接入 undo（action='setBankConfig'）
      return withUndoLog({
        storeName: 'topicGroup',
        action: 'setBankConfig',
        targetType: 'event',
        targetId: input.eventId,
        label: '更新选题模式',
        getBefore: () => ({
          id: input.eventId,
          config: topicGroupRepo.getEventBankConfig(input.eventId)
        }),
        execute: () => topicGroupRepo.setEventBankConfig(input.eventId, config),
        getAfter: () => ({
          id: input.eventId,
          config: topicGroupRepo.getEventBankConfig(input.eventId)
        })
      })
    })
  )

  // ---------- 轮次库绑定（round_topic_groups） ----------
  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_LIST_BY_ROUND, (_e, roundId: string) =>
    wrap<TopicGroup[]>(() => {
      assertNonEmptyString(roundId, 'roundId')
      return topicGroupRepo.listGroupsByRound(roundId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_BIND_ROUND_GROUPS, (_e, input: RoundBindGroupsInput) =>
    wrapWithUndo(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.roundId, 'input.roundId')
      assertIdList(input.groupIds, 'input.groupIds')
      // Governance-8.3：bind/unbind 统一走 'bindRound' 全量快照 undo
      return withUndoLog({
        storeName: 'topicGroup',
        action: 'bindRound',
        targetType: 'round',
        targetId: input.roundId,
        label: '绑定轮次题库',
        getBefore: () => ({
          id: input.roundId,
          group_ids: topicGroupRepo.listGroupsByRound(input.roundId).map((g) => g.id)
        }),
        execute: () => {
          return topicGroupRepo.bindRoundGroups(input.roundId, input.groupIds)
        },
        getAfter: () => ({
          id: input.roundId,
          group_ids: topicGroupRepo.listGroupsByRound(input.roundId).map((g) => g.id)
        })
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_UNBIND_ROUND_GROUP, (_e, input: RoundUnbindGroupInput) =>
    wrapWithUndo(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.roundId, 'input.roundId')
      assertNonEmptyString(input.groupId, 'input.groupId')
      return withUndoLog({
        storeName: 'topicGroup',
        action: 'bindRound',
        targetType: 'round',
        targetId: input.roundId,
        label: `解绑轮次题库 ${input.groupId.slice(0, 8)}`,
        getBefore: () => ({
          id: input.roundId,
          group_ids: topicGroupRepo.listGroupsByRound(input.roundId).map((g) => g.id)
        }),
        execute: () => {
          topicGroupRepo.unbindRoundGroup(input.roundId, input.groupId)
          return true
        },
        getAfter: () => ({
          id: input.roundId,
          group_ids: topicGroupRepo.listGroupsByRound(input.roundId).map((g) => g.id)
        })
      })
    })
  )
}