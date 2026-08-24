// ============================================================
// event-service.ts — 赛事领域跨 Repository 编排服务
//
//  Governance-6「Repository 去直接依赖」：
//  event.repo.createEvent 仅负责写入 events 表（单库单动作）；
//  「创建即绑定默认题库」这一跨库业务编排（event.repo × topic-group.repo）
//  上移到此 Service，事务边界也在此统一维护。
// ============================================================

import { getDb } from '../db/index'
import { eventRepo } from '../db/repository/event.repo'
import { topicGroupRepo } from '../db/repository/topic-group.repo'
import type { Event, EventCreateInput } from '../db/repository/event.repo'

/**
 * 创建赛事并自动绑定默认题库。
 * - eventRepo.createEvent 写入 events 表
 * - topicGroupRepo.getDefault 幂等保证默认题库存在
 * - topicGroupRepo.bindEventGroups 将新赛事绑定到默认题库
 * - 整体在一个事务内执行：任一失败整体回滚（既有的「创建即绑定」一致性）
 *
 * @returns 创建后的赛事（含 id）
 */
export function createEvent(data: EventCreateInput): Event {
  const db = getDb()
  const doCreate = db.transaction(() => {
    const created = eventRepo.createEvent(data)
    const defaultGroup = topicGroupRepo.getDefault()
    topicGroupRepo.bindEventGroups(created.id, [defaultGroup.id])
    return created
  })
  return doCreate()
}