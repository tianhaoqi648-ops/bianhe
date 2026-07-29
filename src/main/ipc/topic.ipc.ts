// ============================================================
// topic.ipc.ts — 题库相关 IPC handler
//
// 注册通道：
//   topic:list / topic:get / topic:create / topic:update / topic:delete
//   topic:batchDelete / topic:updateStatus / topic:updateWeight / topic:count
//
// 对应 topicRepo 的 9 个方法。每个 handler 用 wrap() 包装统一错误处理。
// ============================================================

import { ipcMain } from 'electron'
import {
  topicRepo,
  type TopicFilter,
  type TopicCreateInput,
  type TopicUpdateInput,
  type CountableDimension
} from '../db/repository/topic.repo'
import { IPC_CHANNELS } from '../../shared/types'
import { withUndoLog } from '../services/undo-service'
import { wrap, wrapWithUndo } from './utils'

export function registerTopicIpc(): void {
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST, (_e, filter?: TopicFilter) =>
    wrap(() => topicRepo.listTopics(filter))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_GET, (_e, id: string) =>
    wrap(() => topicRepo.getTopicById(id))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_CREATE, (_e, data: TopicCreateInput) =>
    wrapWithUndo(() =>
      withUndoLog({
        storeName: 'topic',
        action: 'create',
        targetType: 'topic',
        targetId: null, // id 在 execute 后才知道
        label: `创建辩题`,
        getBefore: () => null,
        execute: () => topicRepo.createTopic(data),
        getAfter: (result) => result // execute 返回值即 after
      })
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.TOPIC_UPDATE,
    (_e, id: string, data: TopicUpdateInput) =>
      wrapWithUndo(() =>
        withUndoLog({
          storeName: 'topic',
          action: 'update',
          targetType: 'topic',
          targetId: id,
          label: `更新辩题 ${id.slice(0, 8)}`,
          getBefore: () => topicRepo.getTopicById(id) ?? null,
          execute: () => topicRepo.updateTopic(id, data),
          getAfter: () => topicRepo.getTopicById(id) ?? null
        })
      )
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_DELETE, (_e, id: string) =>
    wrapWithUndo(() => {
      const before = topicRepo.getTopicById(id)
      return withUndoLog({
        storeName: 'topic',
        action: 'delete',
        targetType: 'topic',
        targetId: id,
        label: `删除辩题 ${before?.title ?? id.slice(0, 8)}`,
        getBefore: () => before,
        execute: () => topicRepo.deleteTopic(id),
        getAfter: () => null
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_BATCH_DELETE, (_e, ids: string[]) =>
    wrapWithUndo(() => {
      // 采集 before 快照（删除前的所有 topic）
      const beforeTopics = ids
        .map((id) => topicRepo.getTopicById(id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
      return withUndoLog({
        storeName: 'topic',
        action: 'batchDelete',
        targetType: 'topic',
        targetId: null,
        label: `批量删除 ${ids.length} 条辩题`,
        getBefore: () => ({ topics: beforeTopics }),
        execute: () => topicRepo.batchDeleteTopics(ids),
        getAfter: () => null
      })
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.TOPIC_UPDATE_STATUS,
    (_e, id: string, status: string) =>
      wrapWithUndo(() =>
        withUndoLog({
          storeName: 'topic',
          action: 'updateStatus',
          targetType: 'topic',
          targetId: id,
          label: `修改辩题状态`,
          getBefore: () => topicRepo.getTopicById(id) ?? null,
          execute: () => topicRepo.updateStatus(id, status),
          getAfter: () => topicRepo.getTopicById(id) ?? null
        })
      )
  )

  ipcMain.handle(
    IPC_CHANNELS.TOPIC_UPDATE_WEIGHT,
    (_e, id: string, weight: number) =>
      wrapWithUndo(() =>
        withUndoLog({
          storeName: 'topic',
          action: 'updateWeight',
          targetType: 'topic',
          targetId: id,
          label: `修改辩题权重`,
          getBefore: () => topicRepo.getTopicById(id) ?? null,
          execute: () => topicRepo.updateWeight(id, weight),
          getAfter: () => topicRepo.getTopicById(id) ?? null
        })
      )
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_COUNT, (_e, filter?: TopicFilter) =>
    wrap(() => topicRepo.countByFilter(filter))
  )

  // 按维度分组统计全库分布（用于分类树计数）
  ipcMain.handle(
    IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION,
    (_e, dimension: CountableDimension) =>
      wrap(() => topicRepo.countByDimension(dimension))
  )

  // 聚合所有 active 题的 tags，返回每个标签的出现次数（用于「标签」维度分类树）
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS, () =>
    wrap(() => topicRepo.listAllTags())
  )

  // 批量拉取系统字段的 distinct 值（用于 FilterPanel 候选值合并）
  // 入参 fields: string[]，如 ['type','domain','difficulty','source','source_type']
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST_VALUES, (_e, fields: string[]) =>
    wrap(() => topicRepo.listDistinctValues(fields))
  )

  // 聚合某个 tags 类型自定义字段的全部 tag 值与出现次数（用于「自定义 tags」维度分类树）
  // 入参 fieldKey: string，如 'event_tags'
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST_CUSTOM_FIELD_TAGS, (_e, fieldKey: string) =>
    wrap(() => topicRepo.listCustomFieldTags(fieldKey))
  )
}
