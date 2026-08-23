import { useCallback } from 'react';
import type { GroupCopyResult } from '../../../shared/types';

/**
 * 文件式题库操作共享 hook（T2/T3）。
 *
 * 在 TopicLibrary（全局题库）与 TopicGroupManagerModal（题组管理）间复用同一套操作：
 * - 加入 / 移出若干题
 * - 若干题复制 / 移动到目标题库
 * - 整库复制 / 移动到多个目标题库
 *
 * 不维护本地状态；调用后由调用方负责刷新成员映射 / 组列表。
 */
export function useTopicGroupFileOps() {
  /** 若干题同时加入多个题库（去重：后端忽略已存在成员）。返回实际新增数。 */
  const addTopicsToGroups = useCallback(
    async (topicIds: string[], groupIds: string[]): Promise<number> => {
      if (topicIds.length === 0 || groupIds.length === 0) return 0
      const res = await window.groupAPI.batchAddToGroups({ topicIds, groupIds })
      if (!res.success) throw new Error(res.error || '加入题库失败')
      return res.data ?? 0
    },
    []
  )

  /** 从某题库移除若干题。返回实际移除数。 */
  const removeTopicsFromGroup = useCallback(
    async (groupId: string, topicIds: string[]): Promise<number> => {
      if (groupId && topicIds.length === 0) return 0
      const res = await window.groupAPI.batchRemoveFromGroup({ groupId, topicIds })
      if (!res.success) throw new Error(res.error || '移出题库失败')
      return res.data ?? 0
    },
    []
  )

  /** 若干题复制到目标题库（目标去重由后端 addTopicsToGroup 保证，源保留）。 */
  const copySelectedTopicsToGroups = useCallback(
    async (topicIds: string[], targetGroupIds: string[]): Promise<number> => {
      return addTopicsToGroups(topicIds, targetGroupIds)
    },
    [addTopicsToGroups]
  )

  /** 若干题移动到目标题库：加入目标 + 从源移除。可选择默认题库除外等逻辑由调用方控制源。 */
  const moveSelectedTopicsToGroups = useCallback(
    async (
      topicIds: string[],
      targetGroupIds: string[],
      sourceGroupId: string
    ): Promise<number> => {
      const added = await addTopicsToGroups(topicIds, targetGroupIds)
      if (sourceGroupId) {
        await removeTopicsFromGroup(sourceGroupId, topicIds)
      }
      return added
    },
    [addTopicsToGroups, removeTopicsFromGroup]
  )

  /** 整库复制：把源题库全部题复制到多个目标题库（去重，同库跳过）。 */
  const copyWholeGroupToGroups = useCallback(
    async (srcGroupId: string, targetGroupIds: string[]): Promise<GroupCopyResult[]> => {
      if (targetGroupIds.length === 0) return []
      const res = await window.groupAPI.copyGroupToGroup({
        srcGroupId,
        targetGroupIds
      })
      if (!res.success) throw new Error(res.error || '复制题库失败')
      return res.data ?? []
    },
    []
  )

  /** 整库移动：把源题库全部题移到多个目标题库，随后清空源。 */
  const moveWholeGroupToGroups = useCallback(
    async (srcGroupId: string, targetGroupIds: string[]): Promise<GroupCopyResult[]> => {
      if (targetGroupIds.length === 0) return []
      const res = await window.groupAPI.moveGroupToGroup({
        srcGroupId,
        targetGroupIds
      })
      if (!res.success) throw new Error(res.error || '移动题库失败')
      return res.data ?? []
    },
    []
  )

  return {
    addTopicsToGroups,
    removeTopicsFromGroup,
    copySelectedTopicsToGroups,
    moveSelectedTopicsToGroups,
    copyWholeGroupToGroups,
    moveWholeGroupToGroups
  }
}