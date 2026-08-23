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
import { wrap } from './utils'

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
    wrap<number>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      assertIdList(input.groupIds, 'input.groupIds')
      return topicGroupRepo.bindEventGroups(input.eventId, input.groupIds)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_UNBIND_EVENT, (_e, input: EventUnbindGroupInput) =>
    wrap<boolean>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      assertNonEmptyString(input.groupId, 'input.groupId')
      return topicGroupRepo.unbindEventGroup(input.eventId, input.groupId)
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
    wrap<EventBankConfig | undefined>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      const config = input.config
      assertParam(config && typeof config === 'object' && !!config.mode, 'input.config 必须含合法 mode')
      return topicGroupRepo.setEventBankConfig(input.eventId, config)
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
    wrap<number>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.roundId, 'input.roundId')
      assertIdList(input.groupIds, 'input.groupIds')
      return topicGroupRepo.bindRoundGroups(input.roundId, input.groupIds)
    })
  )

  ipcMain.handle(IPC_CHANNELS.GROUP_TOPIC_UNBIND_ROUND_GROUP, (_e, input: RoundUnbindGroupInput) =>
    wrap<boolean>(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.roundId, 'input.roundId')
      assertNonEmptyString(input.groupId, 'input.groupId')
      return topicGroupRepo.unbindRoundGroup(input.roundId, input.groupId)
    })
  )
}