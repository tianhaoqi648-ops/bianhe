// ============================================================
// 系统候选值单一来源
//
// FilterPanel、import-engine、candidate-service 全部引用此处。
// 避免历史不一致：FilterPanel 难度 3 项 vs import-engine 难度 5 项。
//
// 用户可通过「加入候选」机制扩展这些数组（持久化到 settings 表
// key='system.candidates'，启动时由 candidate-service 合并到此处
// 导出的数组）。
// ============================================================

export const SYSTEM_CANDIDATES = {
  type: ['价值辩', '政策辩', '事实辩', '哲理辩', '娱乐辩'],
  domain: [
    '社会热点',
    '科技伦理',
    '教育文化',
    '法律政策',
    '经济商业',
    '环保公益',
    '情感人际'
  ],
  difficulty: ['入门级', '进阶级', '专业级'],
  source: ['新国辩', '华语辩论世界杯', '老友赛', '世锦赛', '年度原创'],
  source_type: ['官方', '自定义']
} as const

export type CandidateField = keyof typeof SYSTEM_CANDIDATES

// ============================================================
// 全量数据备份类别
//
// 每个类别对应一组业务表，导出/导入按类别勾选执行。
// 表名需与 schema.sql 中保持一致（注意 import_batch 为单数）。
//
// ── 逐表核对表（governance Task1）：备份? 恢复? ─────────────
//   每张真实业务表是否纳入「导出（备份）」与「导入（恢复）」。
//   （恢复能力即 TABLE_COLUMNS 白名单 + BACKUP_CATEGORIES 中的顺序写入）
//
//   topics / topic_custom_fields .......... 备份✓ 恢复✓  (topics)
//   events / rounds / team_groups / teams .. 备份✓ 恢复✓  (events)
//   draw_sessions / draw_session_items / team_history . 备份✓ 恢复✓  (draw_records)
//   matches / match_judges / match_judge_votes ....... 备份✓ 恢复✓  (match_records, 本次补进)
//   timer_sessions / timer_records .......... 备份✓ 恢复✓  (timer)
//   debate_formats / bell_assets ............ 备份✓ 恢复✓  (formats_bells + bell_files 文件本体)
//   settings ................................ 备份✓ 恢复✓  (settings)
//   audit_log / import_batch / batch_edit_history / batch_edit_history_item / undo_log . 备份✓ 恢复✓  (audit_history)
//   judge_history ........................... 备份✓ 恢复✓  (judge_history)
//   agent_sessions / agent_messages ......... 备份✓ 恢复✓  (agent_sessions, governance Task3 判定为 A 用户历史)
//   badges / team_bindings / badge_files .... 备份✓ 恢复✓  (badges, 文件型虚拟表)
//   topic_groups / topic_group_items / event_topic_groups / round_topic_groups .. 备份✓ 恢复✓  (topic_groups)
//
//   未纳入备份类别（governance Task3 判定为 B runtime/cache，保持排除）：
//     __migrations .......................... 备份✗ 恢复✗  (内部迁移登记表，按设计排除)
//   疑难/系统表：无
// ============================================================

export const BACKUP_CATEGORIES = [
  { key: 'topics', label: '辩题库', tables: ['topics', 'topic_custom_fields'] },
  { key: 'events', label: '赛事体系', tables: ['events', 'rounds', 'team_groups', 'teams'] },
  { key: 'draw_records', label: '抽取记录', tables: ['draw_sessions', 'draw_session_items', 'team_history'] },
  { key: 'match_records', label: '比赛赛果', tables: ['matches', 'match_judges', 'match_judge_votes'] },
  { key: 'timer', label: '计时数据', tables: ['timer_sessions', 'timer_records'] },
  { key: 'formats_bells', label: '赛制与铃声', tables: ['debate_formats', 'bell_assets'] },
  { key: 'settings', label: '设置配置', tables: ['settings'] },
  { key: 'audit_history', label: '审计与历史', tables: ['audit_log', 'import_batch', 'batch_edit_history', 'batch_edit_history_item', 'undo_log'] },
  { key: 'judge_history', label: 'AI 裁判历史', tables: ['judge_history'] },
  { key: 'agent_sessions', label: 'Agent 会话', tables: ['agent_sessions', 'agent_messages'] },
  { key: 'badges', label: '队徽库', tables: ['badges', 'team_bindings', 'badge_files'] },
  { key: 'topic_groups', label: '赛事题库', tables: ['topic_groups', 'topic_group_items', 'event_topic_groups', 'round_topic_groups'] }
] as const

export type BackupCategoryKey = (typeof BACKUP_CATEGORIES)[number]['key']

export const DEFAULT_BACKUP_CATEGORIES = [
  'topics',
  'events',
  'draw_records',
  'timer',
  'formats_bells'
] as const

export const SUPPORTED_BACKUP_VERSION = '1.0'

/** 备份恢复时按外键依赖顺序排序类别 */
export const BACKUP_RESTORE_ORDER: BackupCategoryKey[] = [
  'topics', // topics 是 team_history / draw_session_items.topic_id / topic_group_items 的父表
  'events', // events 是 rounds/team_groups/teams/team_history 的父表
  'draw_records', // 依赖 topics + events（draw_session_items→teams/topics/team_groups，team_history→teams/topics）
  'match_records', // matches 依赖 topics + events（rounds/teams）+ draw_records；match_judges→matches；match_judge_votes→matches+match_judges
  'timer', // 独立（timer_sessions.match_id 非外键约束）
  'formats_bells', // 独立
  'settings', // 独立
  'audit_history', // 独立
  'judge_history', // 独立
  'agent_sessions', // 独立（agent_messages.session_id 外键依赖同类别内的 agent_sessions，父表先于子表）
  'badges', // 独立
  'topic_groups' // topic_groups 依赖 topics + events（topic_group_items→topics，event_topic_groups→events）
]
