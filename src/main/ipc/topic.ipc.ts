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
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

/**
 * 统一包装：捕获异常，返回 ApiResponse。
 */
function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerTopicIpc(): void {
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST, (_e, filter?: TopicFilter) =>
    wrap(() => topicRepo.listTopics(filter))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_GET, (_e, id: string) =>
    wrap(() => topicRepo.getTopicById(id))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_CREATE, (_e, data: TopicCreateInput) =>
    wrap(() => topicRepo.createTopic(data))
  )

  ipcMain.handle(
    IPC_CHANNELS.TOPIC_UPDATE,
    (_e, id: string, data: TopicUpdateInput) => wrap(() => topicRepo.updateTopic(id, data))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_DELETE, (_e, id: string) =>
    wrap(() => topicRepo.deleteTopic(id))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_BATCH_DELETE, (_e, ids: string[]) =>
    wrap(() => topicRepo.batchDeleteTopics(ids))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_UPDATE_STATUS, (_e, id: string, status: string) =>
    wrap(() => topicRepo.updateStatus(id, status))
  )

  ipcMain.handle(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, (_e, id: string, weight: number) =>
    wrap(() => topicRepo.updateWeight(id, weight))
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
