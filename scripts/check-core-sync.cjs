// ============================================================
// check-core-sync.js — Bianhe Core 一致性校验（只读，exit 1 = 不一致）
//
// 校验 4 项：
//   1. 桌面 src/core TS 源 ↔ 小程序 src/core 逐字节比对
//   2. esbuild 内存重算 common/core JS hash ↔ 磁盘实际产物（确认产物与当前源一致）
//   3. golden 文件（src/core/__tests__/golden/**）Desktop ↔ Mini 逐字节比对
//   4. manifest sources + golden hash ↔ 桌面当前源
//   5. manifest coreVersion/compatibilityVersion ↔ 桌面 version.ts 唯一版本真源
//
// 用法：node scripts/check-core-sync.js [--target <Mini 仓根>]
// ============================================================

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { build } = require('esbuild')

const DESKTOP_CORE = path.resolve(__dirname, '..', 'src', 'core')
const DEFAULT_TARGET = path.resolve(__dirname, '..', '..', 'bianhe-miniprogram')

function parseArgs(argv) {
  const idx = argv.indexOf('--target')
  const target = idx >= 0 && argv[idx + 1] ? path.resolve(argv[idx + 1]) : DEFAULT_TARGET
  return { target }
}

function listCoreFiles(dir, base) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...listCoreFiles(abs, base))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(path.relative(base, abs))
    }
  }
  return out
}

/** golden 目录 + 递归收集（与 sync-core 对齐） */
const GOLDEN_DIR = path.join(DESKTOP_CORE, '__tests__', 'golden')

function listGoldenFiles(dir = GOLDEN_DIR, base = GOLDEN_DIR) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listGoldenFiles(abs, base))
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs))
    }
  }
  return out
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/** 解析 Desktop src/core/version.ts（唯一版本真源）→ { version, compatibility } */
function readCoreVersion() {
  const p = path.join(DESKTOP_CORE, 'version.ts')
  const text = fs.readFileSync(p, 'utf8')
  const vm = text.match(/export const CORE_VERSION\s*=\s*'([^']+)'/)
  const cm = text.match(/export const CORE_COMPATIBILITY_VERSION\s*=\s*(\d+)/)
  if (!vm || !cm) {
    throw new Error('[check-core-sync] 无法解析 ' + p + ' 中的 CORE_VERSION / CORE_COMPATIBILITY_VERSION')
  }
  return { version: vm[1], compatibility: Number(cm[1]) }
}

// 结构化失败输出：保留原原因 + 统一前缀 + 关键路径/定位信息。
// kind ∈ { src | artifact | golden | manifest }
function fail({ kind, file, source, target, why }) {
  console.error('Core drift detected')
  console.error(`  kind   = ${kind}`)
  console.error(`  file   = ${file}`)
  console.error(`  source = ${source}`)
  console.error(`  target = ${target}`)
  console.error(`  reason = ${why}`)
  console.error('Run `npm run core:sync` to sync Mini artifacts, then commit.')
  process.exit(1)
}

async function main() {
  const { target } = parseArgs(process.argv.slice(2))
  const files = listCoreFiles(DESKTOP_CORE, DESKTOP_CORE)
  const miniSrcCore = path.join(target, 'src', 'core')
  const commonCore = path.join(target, 'cloud', 'functions', 'common', 'core')

  // 1. TS 源逐字节比对（src）
  for (const rel of files) {
    const src = path.join(DESKTOP_CORE, rel)
    const dest = path.join(miniSrcCore, rel)
    if (!fs.existsSync(dest)) {
      fail({ kind: 'src', file: rel, source: src, target: dest, why: 'Mini src/core 缺文件' })
    }
    if (fs.readFileSync(src).toString() !== fs.readFileSync(dest).toString()) {
      fail({ kind: 'src', file: rel, source: src, target: dest, why: 'Mini src/core 与桌面源不一致（请运行 npm run core:sync）' })
    }
  }

  // 2. esbuild 内存重算产物 hash ↔ 磁盘（artifact；outdir 用系统临时目录，Windows 路径安全）
  const entryPoints = files.map((rel) => path.join(DESKTOP_CORE, rel))
  const checkOutDir = path.join(require('os').tmpdir(), 'core-check-' + Date.now())
  const result = await build({
    entryPoints,
    outdir: checkOutDir,
    outbase: DESKTOP_CORE,
    bundle: false,
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    write: false,
    logLevel: 'silent'
  })
  const expectedJs = new Map()
  for (const out of result.outputFiles) {
    const rel = path.relative(checkOutDir, out.path)
    expectedJs.set(rel, crypto.createHash('sha256').update(out.contents).digest('hex'))
  }
  for (const [rel, hash] of expectedJs) {
    const dest = path.join(commonCore, rel)
    // 桌面产物由对应 .ts 源生成，定位到桌面源路径便于排查
    const srcRel = rel.endsWith('.js') ? rel.slice(0, -3) + '.ts' : rel
    const src = path.join(DESKTOP_CORE, srcRel)
    if (!fs.existsSync(dest)) {
      fail({ kind: 'artifact', file: rel, source: src, target: dest, why: 'Mini common/core 缺产物' })
    }
    if (sha256(dest) !== hash) {
      fail({ kind: 'artifact', file: rel, source: src, target: dest, why: 'Mini common/core 产物与当前源不一致（请运行 npm run core:sync）' })
    }
  }

  // 3. golden 文件逐字节比对（Golden Desktop ↔ Mini src/core/__tests__/golden）
  const goldenFiles = listGoldenFiles()
  const miniGolden = path.join(target, 'src', 'core', '__tests__', 'golden')
  for (const rel of goldenFiles) {
    const src = path.join(GOLDEN_DIR, rel)
    const dest = path.join(miniGolden, rel)
    if (!fs.existsSync(dest)) {
      fail({ kind: 'golden', file: rel, source: src, target: dest, why: 'Mini golden 缺文件' })
    }
    if (fs.readFileSync(src).toString() !== fs.readFileSync(dest).toString()) {
      fail({ kind: 'golden', file: rel, source: src, target: dest, why: 'Mini golden 与桌面源不一致（请运行 npm run core:sync）' })
    }
  }

  // 4. manifest 校验（manifest：sources + golden hash ↔ 桌面当前源）
  const manifestPath = path.join(commonCore, '.core-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    fail({ kind: 'manifest', file: '.core-manifest.json', source: manifestPath, target: manifestPath, why: '缺少 .core-manifest.json' })
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const rel of files) {
    if (manifest.sources[rel] !== sha256(path.join(DESKTOP_CORE, rel))) {
      fail({ kind: 'manifest', file: rel, source: path.join(DESKTOP_CORE, rel), target: manifestPath, why: 'manifest 与桌面源不一致' })
    }
  }
  for (const rel of goldenFiles) {
    if (!manifest.golden || manifest.golden[rel] !== sha256(path.join(GOLDEN_DIR, rel))) {
      fail({ kind: 'manifest', file: rel, source: path.join(GOLDEN_DIR, rel), target: manifestPath, why: 'manifest.golden 与桌面 golden 源不一致' })
    }
  }

  // 5. version 校验（Desktop version.ts 唯一真源 ↔ Mini manifest）
  const expectedVersion = readCoreVersion()
  if (manifest.coreVersion !== expectedVersion.version || manifest.compatibilityVersion !== expectedVersion.compatibility) {
    fail({
      kind: 'manifest',
      file: '.core-manifest.json',
      source: path.join(DESKTOP_CORE, 'version.ts'),
      target: manifestPath,
      why: 'manifest 版本与桌面 version.ts 不一致（期望 coreVersion=' + expectedVersion.version + ' / compatibilityVersion=' + expectedVersion.compatibility + '）'
    })
  }

  console.log(`[check-core-sync] ok（${files.length} 源文件 + ${goldenFiles.length} golden 文件 + 产物 + manifest 一致）`)
}

main().catch((e) => {
  console.error('[check-core-sync] 失败：', e)
  process.exit(1)
})