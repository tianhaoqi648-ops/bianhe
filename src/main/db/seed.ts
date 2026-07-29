// ============================================================
// seed.ts — 首次启动加载官方题库
//
// 策略：
//   - 启动时检查 settings 表的 'official_topics_seeded' 标记
//   - 未标记时读取 data/official-topics.json 并批量插入 topics 表
//   - source_type 字段统一为 '官方'
//   - 完成后写入标记，避免重复加载
//
// 文件路径解析：
//   开发环境：app.getAppPath() 指向项目根，data/ 完整存在
//   生产环境：data/ 通过 electron-builder extraResources 配置复制到
//             process.resourcesPath/data/ 目录
//   两种情况分别解析路径，若文件缺失则跳过（不阻断启动）
// ============================================================

import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from './index'
import { auditRepo } from './repository/audit.repo'
import { v4 as uuidv4 } from 'uuid'

interface OfficialTopic {
  title: string
  type: string
  domain: string
  difficulty: string
  source: string
  tags: string[]
}

interface OfficialTopicsFile {
  version: string
  description: string
  topics: OfficialTopic[]
}

/**
 * 解析官方题库文件路径。
 * - 开发环境：<项目根>/data/official-topics.json
 * - 生产环境：<resourcesPath>/data/official-topics.json
 */
function resolveOfficialTopicsPath(): string {
  // 生产环境优先：process.resourcesPath 指向 electron-builder 的 resources 目录
  if (!process.env.ELECTRON_IS_DEV && process.resourcesPath) {
    const prodPath = join(process.resourcesPath, 'data', 'official-topics.json')
    if (existsSync(prodPath)) return prodPath
  }
  // 开发环境或回退：app.getAppPath()/data/official-topics.json
  return join(app.getAppPath(), 'data', 'official-topics.json')
}

/**
 * 检查是否已加载过官方题库。
 */
function isSeeded(): boolean {
  const v = auditRepo.getSetting('official_topics_seeded')
  return v === true
}

/**
 * 标记已加载完成。
 */
function markSeeded(count: number): void {
  auditRepo.setSetting('official_topics_seeded', true)
  auditRepo.setSetting('official_topics_version', '1.0.0')
  auditRepo.setSetting('official_topics_count', count)
}

/**
 * 加载官方题库到数据库。
 *
 * - 若已加载过则跳过
 * - 文件不存在则跳过（不抛错）
 * - 使用事务批量插入，避免逐条写入开销
 * - 已存在的 title 通过 UNIQUE 约束自动跳过（若 schema 有 UNIQUE）
 *   若无 UNIQUE 约束，则先查询再插入
 *
 * 返回实际插入的条数。
 */
export function seedOfficialTopics(): number {
  // 已加载过则跳过
  if (isSeeded()) {
    console.log('[seed] Official topics already seeded, skip')
    return 0
  }

  // 文件路径解析
  const filePath = resolveOfficialTopicsPath()
  if (!existsSync(filePath)) {
    console.warn('[seed] Official topics file not found:', filePath, ', skip seeding')
    return 0
  }

  let fileData: OfficialTopicsFile
  try {
    const raw = readFileSync(filePath, 'utf-8')
    fileData = JSON.parse(raw) as OfficialTopicsFile
  } catch (e) {
    console.error('[seed] Failed to parse official topics file:', e)
    return 0
  }

  if (!fileData.topics || fileData.topics.length === 0) {
    console.warn('[seed] Official topics file is empty, skip')
    return 0
  }

  const db = getDb()
  const now = new Date().toISOString()

  // 先查询已存在的 title 集合，避免重复插入
  const existingTitles = new Set<string>()
  const rows = db.prepare('SELECT title FROM topics').all() as Array<{ title: string }>
  for (const r of rows) {
    existingTitles.add(r.title)
  }

  const insertStmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let inserted = 0
  const tx = db.transaction((topics: OfficialTopic[]) => {
    for (const t of topics) {
      if (existingTitles.has(t.title)) continue
      const id = uuidv4()
      const tagsJson = JSON.stringify(t.tags ?? [])
      insertStmt.run(
        id,
        t.title,
        t.type ?? null,
        t.domain ?? null,
        t.difficulty ?? null,
        t.source ?? null,
        '官方',
        tagsJson,
        1.0,
        'active',
        now,
        now
      )
      inserted++
    }
  })

  try {
    tx(fileData.topics)
    markSeeded(inserted)
    auditRepo.addLog({
      action: 'system',
      target_type: 'topic',
      target_id: 'official-seed',
      operator: 'system',
      detail: { action: 'seed_official_topics', count: inserted, version: fileData.version }
    })
    console.log(`[seed] Official topics seeded: ${inserted} topics inserted`)
    return inserted
  } catch (e) {
    console.error('[seed] Failed to seed official topics:', e)
    return 0
  }
}
