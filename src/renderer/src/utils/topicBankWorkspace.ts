// ============================================================
// topicBankWorkspace.ts — 题库工作区下钻纯逻辑（T4）
//
// 只做可测试的派生计算，与 IPC 完全解耦：
//   workspaceImportTarget   把「另一题库」复制/移动到本库时的目标组装
//   candidatesForBankImport 从全局题库勾选导入本库的候选（剔除已是本库成员）
//   moveOutCandidates       把本库若干/全部题移动到其他题库的可选目标
// ============================================================

/**
 * 工作区导入方向：把「另一题库」复制/移动到当前工作区题库时，
 * 目标固定为当前工作区题库 id（copyGroupToGroup/moveGroupToGroup 的 targetGroupIds）。
 */
export function workspaceImportTarget(workspaceGroupId: string): string[] {
  return workspaceGroupId ? [workspaceGroupId] : []
}

/**
 * 从全局题库勾选若干题加入本库的候选：剔除已是本库成员的题（避免重复加入）。
 */
export function candidatesForBankImport<T extends { id: string }>(
  allTopics: T[],
  existingMemberIds: string[]
): T[] {
  const set = new Set(existingMemberIds)
  return allTopics.filter((t) => !set.has(t.id))
}

/**
 * 把本库若干/全部题移动到其他题库时，可选目标应排除本库自身。
 */
export function moveOutCandidates(
  groups: { id: string }[],
  workspaceGroupId: string
): string[] {
  return groups.filter((g) => g.id !== workspaceGroupId).map((g) => g.id)
}