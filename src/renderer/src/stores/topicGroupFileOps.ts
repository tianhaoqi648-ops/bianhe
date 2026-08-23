import type { TopicGroup, GroupTopic } from '../../../shared/types';

/**
 * 文件式题库操作的纯逻辑（T2/T3 共享）。
 *
 * 只做可测试的派生计算，不直接触碰 window.groupAPI；
 * 存取经由 topicGroupStore 与 useTopicGroupFileOps hook 完成。
 * 导出以便单测。
 */

export interface GroupMemberMaps {
  /** groupId → 成员 topicId 列表 */
  memberTopicIdsByGroup: Record<string, string[]>
  /** topicId → 所属题组名列表（用于题库行徽标） */
  topicToGroupNameMap: Record<string, string[]>
}

/**
 * 由题组列表 + 每组成员，构建 topic↔group 双端映射。
 * - 徽标源：topicId → 所属题库名列表
 * - 筛选源：groupId → 成员 topicId 列表
 */
export function buildGroupMemberMaps(
  groups: TopicGroup[],
  membersByGroup: Record<string, GroupTopic[]>
): GroupMemberMaps {
  const memberTopicIdsByGroup: Record<string, string[]> = {}
  const topicToGroupNameMap: Record<string, string[]> = {}
  const nameById: Record<string, string> = {}
  for (const g of groups) nameById[g.id] = g.name
  for (const g of groups) {
    const ids = (membersByGroup[g.id] ?? []).map((m) => m.id)
    memberTopicIdsByGroup[g.id] = ids
    for (const id of ids) {
      if (!topicToGroupNameMap[id]) topicToGroupNameMap[id] = []
      topicToGroupNameMap[id].push(nameById[g.id] ?? g.name)
    }
  }
  return { memberTopicIdsByGroup, topicToGroupNameMap }
}

/** 某题组成员的 topicId 集合（用于「按题库筛选」与去重判断）。 */
export function groupMemberIdSet(
  membersByGroup: Record<string, GroupTopic[]>,
  groupId: string
): Set<string> {
  return new Set((membersByGroup[groupId] ?? []).map((m) => m.id))
}

/** 若干题「复制」的目标去重：仅返回目标题库中尚未存在的 topicId。 */
export function topicsToCopy(
  topicIds: string[],
  existingInTarget: Set<string>
): string[] {
  return topicIds.filter((id) => !existingInTarget.has(id))
}

/** 若干题「移动」规划：目标去重（toAdd）+ 源去重（toRemove，仅统计实际存在于源的）。 */
export function planMoveTopics(
  topicIds: string[],
  existingInTarget: Set<string>,
  existingInSource: Set<string>
): { toAdd: string[]; toRemove: string[] } {
  return {
    toAdd: topicsToCopy(topicIds, existingInTarget),
    toRemove: topicIds.filter((id) => existingInSource.has(id))
  }
}