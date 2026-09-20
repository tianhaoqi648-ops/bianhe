// ============================================================
// agent-path-guard.test.ts — P5-014 Agent 文件工具路径防护回归
// （真实 tool execute + 真实 pathGuard + 真实 fs 副作用验证）
//
// 覆盖三个 Agent 文件工具（LLM 可控路径 → guard → filesystem side effect 链）：
//   Read  import_event_batch：合法 temp ✅ / Windows 敏感根 ❌ / traversal ❌
//         （拒绝时 parseFile spy 零调用——敏感内容不进 LLM 上下文）
//   Read  import_event_schedule：同上三例（parseScheduleXlsx spy）
//   Write export_event_schedule：合法 temp（文件真实写入）✅ / 敏感 outPath ❌ +
//         目标不存在 / traversal ❌ + 目标不存在 / 缺省 outPath（真实写入）✅
//
// 注入边界：仅 mock 解析/生成 service 与 repo（xlsx 生成等非本批关注点）；
// pathGuard 真实执行、fs/promises（mkdir/writeFile）真实执行、敏感根取当前
// 平台 process.env 真实值（与 helper 内部逻辑同源，避免大小写/归一化偏差）。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---- hoisted 状态 ----
const h = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  parseFile: vi.fn(),
  parseScheduleXlsx: vi.fn(),
  computeScheduleDiff: vi.fn(),
  buildScheduleRows: vi.fn(() => []),
  buildScheduleWorkbookBuffer: vi.fn(() => Buffer.from('xlsx-bytes')),
  scheduleKey: vi.fn(() => 'k'),
  applyScheduleDiff: vi.fn(),
  eventRepo: {
    getEventById: vi.fn(),
    listTeamsByEvent: vi.fn(() => []),
    listRoundsByEvent: vi.fn(() => [])
  },
  matchRepo: { listByEvent: vi.fn(() => []) },
  topicRepo: { listTopics: vi.fn(() => ({ items: [], total: 0 })) }
}))

vi.mock('electron', () => ({ app: h.mockApp }))

// 解析/生成 service（工具路径在 guard 之后才触达；合法路径下返回固定结构）
vi.mock('@main/services/import-engine', () => ({
  parseFile: h.parseFile,
  applyFieldMapping: vi.fn()
}))
// 注意：工具文件内为 '../../services/schedule-io'（相对 tools/）；测试文件相对
// __tests__ 需多一级，vitest 按 resolved path 匹配，两者指向同一模块。
vi.mock('../../../services/schedule-io', () => ({
  parseScheduleXlsx: h.parseScheduleXlsx,
  computeScheduleDiff: h.computeScheduleDiff,
  buildScheduleRows: h.buildScheduleRows,
  buildScheduleWorkbookBuffer: h.buildScheduleWorkbookBuffer,
  scheduleKey: h.scheduleKey,
  applyScheduleDiff: h.applyScheduleDiff
}))

// repo / db（静态依赖隔离，EXECUTE 的合法路径不触库或仅触假数据）
vi.mock('@main/db/repository/event.repo', () => ({ eventRepo: h.eventRepo }))
vi.mock('@main/db/repository/match.repo', () => ({ matchRepo: h.matchRepo }))
vi.mock('@main/db/repository/topic.repo', () => ({ topicRepo: h.topicRepo }))
vi.mock('@main/db/index', () => ({ getDb: vi.fn() }))
vi.mock('@main/db', () => ({ getDb: vi.fn() }))

// ---- 被测模块（真实 tool + 真实 pathGuard）----
import { importEventBatchTool } from '../import-event-batch.tool'
import { scheduleImportTool } from '../schedule-import.tool'
import { scheduleExportTool, defaultExportDir } from '../schedule-export.tool'

const isWin = process.platform === 'win32'
const sysRoot = path.resolve(
  (isWin && (process.env.SystemRoot || process.env.windir)) || (isWin ? 'C:\\Windows' : '/')
)

let tmpUserData = ''
let tmpFileDir = ''

/** 当前平台敏感根下的真实命中路径（与 helper 的 sensitiveRoots 同源构造） */
function sensitivePath(name: string): string {
  return path.join(sysRoot, 'system32', 'config', name)
}

/** traversal：经 .. 归一化后落回敏感根（resolve 语义验证）。
 *  必须字符串拼接——path.join 会提前归一化消耗 '..'，测不到 resolve 防线。
 *  单层 '..'：sysRoot\dummy\..\evil.xlsx --resolve--> sysRoot\evil.xlsx（命中）。 */
function traversalPath(name: string): string {
  return `${sysRoot}${path.sep}dummy${path.sep}..${path.sep}${name}`
}

/** 合法临时文件（真实存在，供合法读取用例） */
function makeTempFile(name: string, content = 'dummy-content'): string {
  const p = path.join(tmpFileDir, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

beforeEach(() => {
  vi.clearAllMocks()
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-agentguard-u-'))
  tmpFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-agentguard-f-'))
  h.mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath: ${key}`)
  })
  // 合法路径下解析器返回固定结构（guard 在其之前，拒绝时不会被调用）
  h.parseFile.mockResolvedValue({
    mapping: {},
    rawTable: { headers: ['队伍名'], rows: [] }
  })
  h.parseScheduleXlsx.mockReturnValue({ rows: [], warnings: [] })
  h.computeScheduleDiff.mockReturnValue({
    additions: [],
    updates: [],
    deletions: [],
    unchanged: [],
    warnings: []
  })
  h.eventRepo.getEventById.mockReturnValue({ id: 'evt-1', name: '测试赛事' })
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
    fs.rmSync(tmpFileDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('P5-014 import_event_batch（Read）路径防护', () => {
  it('合法 temp 路径 → 正常解析', async () => {
    const p = makeTempFile('roster.xlsx')
    const res = await importEventBatchTool.execute({ filePath: p, fileType: 'xlsx' })
    expect(h.parseFile).toHaveBeenCalledTimes(1)
    expect(res.needFieldMapping).toBe(true)
  })

  it.runIf(isWin)('Windows 敏感根路径 → 拒绝且 parseFile 零调用', async () => {
    const p = sensitivePath('sensitive.xlsx')
    await expect(
      importEventBatchTool.execute({ filePath: p, fileType: 'xlsx' })
    ).rejects.toThrow(/系统受保护目录/)
    expect(h.parseFile).not.toHaveBeenCalled() // 敏感内容未进入 tool result / LLM 上下文
  })

  it.runIf(isWin)('traversal 归一化命中敏感根 → 拒绝且 parseFile 零调用', async () => {
    const p = traversalPath('evil.xlsx')
    await expect(
      importEventBatchTool.execute({ filePath: p, fileType: 'xlsx' })
    ).rejects.toThrow(/系统受保护目录/)
    expect(h.parseFile).not.toHaveBeenCalled()
  })
})

describe('P5-014 import_event_schedule（Read）路径防护', () => {
  it('合法 temp 路径 → 正常解析', async () => {
    const p = makeTempFile('schedule.xlsx')
    const res = await scheduleImportTool.execute({ eventId: 'evt-1', filePath: p })
    expect(h.parseScheduleXlsx).toHaveBeenCalledTimes(1)
    expect(res.applied).toBe(false)
    expect(res.eventId).toBe('evt-1')
  })

  it.runIf(isWin)('Windows 敏感根路径 → 拒绝且 parseScheduleXlsx 零调用', async () => {
    const p = sensitivePath('sensitive.xlsx')
    await expect(
      scheduleImportTool.execute({ eventId: 'evt-1', filePath: p })
    ).rejects.toThrow(/系统受保护目录/)
    expect(h.parseScheduleXlsx).not.toHaveBeenCalled()
  })

  it.runIf(isWin)('traversal 归一化命中敏感根 → 拒绝且 parseScheduleXlsx 零调用', async () => {
    const p = traversalPath('evil.xlsx')
    await expect(
      scheduleImportTool.execute({ eventId: 'evt-1', filePath: p })
    ).rejects.toThrow(/系统受保护目录/)
    expect(h.parseScheduleXlsx).not.toHaveBeenCalled()
  })
})

describe('P5-014 export_event_schedule（Write）路径防护', () => {
  it('合法 temp outPath → 文件真实写入', async () => {
    const out = path.join(tmpFileDir, 'out', 'plan.xlsx')
    const res = await scheduleExportTool.execute({ eventId: 'evt-1', outPath: out })
    expect(fs.existsSync(out)).toBe(true)
    expect(fs.readFileSync(out).equals(Buffer.from('xlsx-bytes'))).toBe(true)
    expect(res.filePath).toBe(path.resolve(out))
  })

  it('缺省 outPath → 写入 userData/exports（真实写入）', async () => {
    const res = await scheduleExportTool.execute({ eventId: 'evt-1' })
    const expectedDir = path.join(tmpUserData, 'exports')
    expect(res.filePath.startsWith(expectedDir)).toBe(true)
    expect(defaultExportDir()).toBe(expectedDir)
    expect(fs.existsSync(res.filePath)).toBe(true)
  })

  it.runIf(isWin)('敏感根 outPath → 拒绝且无文件副作用', async () => {
    const out = sensitivePath('evil.xlsx')
    await expect(scheduleExportTool.execute({ eventId: 'evt-1', outPath: out })).rejects.toThrow(
      /系统受保护目录/
    )
    expect(fs.existsSync(out)).toBe(false) // 目标未被创建
  })

  it.runIf(isWin)('traversal outPath → 拒绝且无文件副作用', async () => {
    const out = traversalPath('evil.xlsx')
    await expect(scheduleExportTool.execute({ eventId: 'evt-1', outPath: out })).rejects.toThrow(
      /系统受保护目录/
    )
    expect(fs.existsSync(out)).toBe(false)
  })
})
