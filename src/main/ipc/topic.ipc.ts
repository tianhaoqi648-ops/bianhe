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
  type TopicUpdateInput
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
}
