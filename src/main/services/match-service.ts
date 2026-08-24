// ============================================================
// services/match-service.ts — 比赛（matches）领域跨 Repository 编排服务
//
//  governance「事务边界统一到 Application Service」：
//  match.repo.create 仅负责写入 matches 表（单库单动作，内部不开事务）；
//  一旦以「一次用户动作」为边界需要显式事务时，由 Service/IPC 编排层包裹
//  db.transaction。本服务即 MATCH_CREATE 这一入口的编排层：
//    - createMatch：把 resolve(名称快照) + INSERT + hydrate 纳入一个显式事务，
//      失败整动作回滚，成功整动作提交（由 better-sqlite3 的 transaction 保证）。
//  注意：不进 repo 内部散落事务；若调用方自身已处于外层事务（如
//  DRAW_CONFIRM_SESSION 对 upsertFromDraw 的包裹），应继续用 matchRepo 原语
//  以免触发 better-sqlite3 的 savepoint 嵌套（见 match.ipc 使用说明）。
// ============================================================

import { getDb } from '../db/index'
import { matchRepo } from '../db/repository/match.repo'
import type { Match, MatchCreateInput } from '../../shared/types'

/**
 * 创建比赛（显式事务边界）。
 * - 只有没有外层事务的顶层入口（如 IPC MATCH_CREATE）应经此服务；
 *   已在外层事务内的调用（如 upsertFromDraw）请直接使用 matchRepo.create。
 *
 * @returns 创建后的比赛（含裁判列表与评决）
 */
export function createMatch(data: MatchCreateInput): Match {
  const db = getDb()
  const doCreate = db.transaction(() => matchRepo.create(data))
  return doCreate()
}