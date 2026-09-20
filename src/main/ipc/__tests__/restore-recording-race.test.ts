// ============================================================
// restore-recording-race.test.ts — P5-012 restore↔recording 竞态回归
// （真 SQLite 文件 + 真 restoreBackup + 真 RECORDING_ACTIVE handler）
//
// 覆盖：
//   Case A（关键，原 TOCTOU 窗口）：restore 通过初始检查后、进入 critical
//     section 前录音启动（经 opChain 排队注入）→ restore 进入 critical
//     section 时复核拒绝，db 未被替换。
//     —— 修复前：restore 不复核，直接 swap = 录音中恢复（数据丢失风险）。
//   Case B（critical section 不重叠）：restore 处于 critical section
//     （flag 已置位、恢复挂起）时 RECORDING_ACTIVE(true) 被拒绝、
//     setRecordingActive 不执行；restore 完成后录音可正常启动。
//   Case C（recording active → restore）：录音活跃时 restore 初始检查拒绝。
//   Case D（失败释放）：corrupted candidate restore 失败 → flag 释放，
//     录音立即可启动（无永久阻塞）。
//
// 注入方式（生产代码零 test hook）：
//   - '../../db' mock 工厂返回受控 pending promise：restore critical
//     section 内的第一个 `await import('../db')`（checkpoint 步骤）挂起于
//     flag 置位之后，为 Case B 提供确定性暂停点。挂起前提是该 mock 不被
//     静态 import 触达——因此 match.repo / recording-scan-service /
//     recording-storage（recording.ipc 的 db 依赖链）全部 mock 掉。
//   - opChain 占位（Case A）：backupDatabase 经受控 stub.backup promise
//     挂住操作链，restore 排队其后，复现「初始检查与 critical section
//     之间的窗口」。
//   - better-sqlite3 → node:sqlite 适配器（restore 验证真实执行，同
//     restore-backup-safety 模式）。
// ============================================================
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'

const h = vi.hoisted(() => {
  let resolveDb!: (mod: unknown) => void
  // 受控 pending promise：'../../db' 的模块工厂在首次 import 时挂起，
  // 由测试在精确时机 resolve（Case B 的 critical section 内 / Case A 前）。
  const dbGate = new Promise<unknown>((res) => {
    resolveDb = res
  })
  return {
    dbGate,
    resolveDb,
    mockApp: { getPath: vi.fn() },
    handleCalls: new Map<string, unknown>()
  }
})

vi.mock('electron', () => ({
  app: h.mockApp,
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      h.handleCalls.set(channel, handler)
    })
  },
  BrowserWindow: {},
  dialog: {}
}))

// ---- '../../db'：受控 pending 工厂（挂点见文件头注释）----
vi.mock('../../db', () => h.dbGate)

// ---- 隔绝 recording.ipc 的静态 db 依赖链（保证 dbGate 不被提前触达）----
vi.mock('../../db/repository/match.repo', () => ({
  matchRepo: {
    findAll: vi.fn(() => []),
    update: vi.fn(),
    findById: vi.fn()
  }
}))
vi.mock('../../services/recording-scan-service', () => ({
  scanRecordingDirectories: vi.fn()
}))
vi.mock('../../services/recording-storage', () => ({
  saveRecording: vi.fn(),
  listRecordings: vi.fn(() => []),
  readRecordingFile: vi.fn(),
  deleteRecording: vi.fn(),
  recordingFileExists: vi.fn(),
  recordingsDir: vi.fn(),
  getConfiguredRecordingDir: vi.fn(),
  dataRootDir: vi.fn(),
  ensureRecordingsInDir: vi.fn()
}))

// ---- better-sqlite3 → node:sqlite 适配（restore 三项验证真实执行）----
vi.mock('better-sqlite3', async () => {
  const { createFileDbClass } = await import(
    '../../services/__tests__/helpers/node-sqlite-adapter'
  )
  return { default: createFileDbClass() }
})

// ---- 被测模块（mock 之后导入）----
import { restoreBackup, backupDatabase } from '../../backup'
import {
  setRecordingActive,
  isRecordingActive,
  isRestoreInProgress
} from '../../services/recording-active'
import { registerRecordingIpc } from '../recording.ipc'
import { IPC_CHANNELS } from '../../../shared/types'

let tmpUserData = ''

/** 当前 getDb() 返回的 stub（dbGate resolve 后生效，测试按需替换） */
let currentDbStub: unknown = { memory: true }

function dbPath(): string {
  return path.join(tmpUserData, 'debate-drawer.db')
}

function backupsPath(name: string): string {
  return path.join(tmpUserData, 'backups', name)
}

function recordingActiveHandler(): (_e: unknown, active: boolean) => {
  success: boolean
  error?: string
} {
  const handler = h.handleCalls.get(IPC_CHANNELS.RECORDING_ACTIVE) as
    | ((e: unknown, active: boolean) => { success: boolean; error?: string })
    | undefined
  expect(handler, 'RECORDING_ACTIVE handler 未注册').toBeTruthy()
  return handler!
}

/** 轮询等待条件成立（竞态测试的确定性同步点） */
async function waitUntil(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error('waitUntil 超时：条件未在时限内成立')
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** 生成内容为 tag 的合法 sqlite 备份源（checkpoint + close） */
function makeSourceDb(tag: string): string {
  const p = backupsPath(`race-${tag}-${Math.random().toString(36).slice(2)}.db`)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const db = new DatabaseSync(p)
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, tag TEXT)')
  db.prepare('INSERT INTO items (tag) VALUES (?)').run(tag)
  db.close()
  return p
}

beforeAll(() => {
  registerRecordingIpc()
})

/** 幂等解除 '../../db' 挂点（dbGate 已 resolve 时为 no-op） */
function releaseDbGate(): void {
  h.resolveDb({ getDb: () => currentDbStub })
}

beforeEach(() => {
  vi.clearAllMocks()
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-race-'))
  h.mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath: ${key}`)
  })
  setRecordingActive(false)
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('P5-012 restore↔recording 竞态回归（真文件 + 真 handler）', () => {
  it('Case B：restore critical section 内 RECORDING_ACTIVE(true) 被拒，完成后放行', async () => {
    const src = makeSourceDb('cs-b')
    // active 库先存在（restore 需要旧库回退副本路径成立）
    fs.writeFileSync(dbPath(), 'active-old-not-sqlite')

    // restore 挂起于 critical section 内的 await import('../db')（dbGate pending）
    const restorePromise = restoreBackup(path.basename(src))
    await waitUntil(() => isRestoreInProgress())
    // 挂起点 = checkpoint 步骤：flag 已置位、录音未被触碰
    expect(isRecordingActive()).toBe(false)

    // critical section 期间录音启动 → 被拒、不置位（两个 critical section 不重叠）
    const res = recordingActiveHandler()(null, true)
    expect(res.success).toBe(false)
    expect(res.error).toContain('备份恢复')
    expect(isRecordingActive()).toBe(false)

    // 释放挂点 → restore 完成（critical section 退出、flag 释放）
    releaseDbGate()
    await restorePromise
    expect(isRestoreInProgress()).toBe(false)

    // 恢复内容生效
    const check = new DatabaseSync(dbPath())
    const rows = check.prepare('SELECT tag FROM items').all() as Array<{ tag: string }>
    check.close()
    expect(rows).toEqual([{ tag: 'cs-b' }])

    // restore 完成后录音可正常启动（成功释放）
    const ok = recordingActiveHandler()(null, true)
    expect(ok.success).toBe(true)
    expect(isRecordingActive()).toBe(true)
    recordingActiveHandler()(null, false)
  })

  it('Case A：初始检查后、critical section 前录音启动 → restore 复核拒绝、db 未替换', async () => {
    releaseDbGate() // 幂等：Case B 已解除过（或单跑本用例时在此解除）
    const src = makeSourceDb('cs-a')
    fs.writeFileSync(dbPath(), 'active-old-not-sqlite')

    // 占住 opChain：backupDatabase 挂在受控 stub.backup 上
    let releaseBackup!: () => void
    const backupGate = new Promise<void>((r) => {
      releaseBackup = r
    })
    currentDbStub = {
      memory: false,
      pragma: () => undefined,
      backup: () => backupGate
    }
    const backupPromise = backupDatabase()
    await new Promise((r) => setTimeout(r, 20)) // 让 backup 进入 serialize 并挂起

    // restore 发起：通过初始检查与 pre-serialize 版本校验后排队于 opChain
    const restorePromise = restoreBackup(path.basename(src))
    await new Promise((r) => setTimeout(r, 20))

    // 原 TOCTOU 窗口内注入录音启动：此刻 restore 尚未进入 critical section
    // （flag=false，录音侧守卫不触发——这正是为什么 restore 侧必须复核）
    expect(isRestoreInProgress()).toBe(false)
    const res = recordingActiveHandler()(null, true)
    expect(res.success).toBe(true)
    expect(isRecordingActive()).toBe(true)

    // 释放 backup → restore 进入 critical section → 复核发现录音 → 拒绝
    releaseBackup()
    await backupPromise
    await expect(restorePromise).rejects.toThrow('当前正在录音')

    // db 未被替换（fail-safe）、flag 已释放
    expect(fs.readFileSync(dbPath(), 'utf8')).toBe('active-old-not-sqlite')
    expect(isRestoreInProgress()).toBe(false)

    // 复位录音状态，供后续断言/清理
    recordingActiveHandler()(null, false)
  })

  it('Case C：录音活跃时 restore 被初始检查拒绝、db 未替换', async () => {
    const src = makeSourceDb('cs-c')
    fs.writeFileSync(dbPath(), 'active-old-not-sqlite')

    const res = recordingActiveHandler()(null, true)
    expect(res.success).toBe(true)

    await expect(restoreBackup(path.basename(src))).rejects.toThrow('当前正在录音')
    expect(fs.readFileSync(dbPath(), 'utf8')).toBe('active-old-not-sqlite')
    expect(isRestoreInProgress()).toBe(false)

    recordingActiveHandler()(null, false)
  })

  it('Case D：corrupted candidate restore 失败 → flag 释放、录音立即可启动', async () => {
    releaseDbGate() // 幂等：checkpoint 步骤需 getDb 可用（或单跑本用例时在此解除）
    fs.mkdirSync(backupsPath(''), { recursive: true })
    const corrupt = backupsPath('corrupt.db')
    fs.writeFileSync(corrupt, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xdead, 0x00]))
    fs.writeFileSync(dbPath(), 'active-old-not-sqlite')

    // fail-closed：垃圾字节源在 verify 阶段抛错（critical section 内部失败路径）
    await expect(restoreBackup(corrupt)).rejects.toThrow()
    // finally 已释放 flag：录音立即可启动（无永久阻塞）
    expect(isRestoreInProgress()).toBe(false)
    const res = recordingActiveHandler()(null, true)
    expect(res.success).toBe(true)
    recordingActiveHandler()(null, false)
  })
})
