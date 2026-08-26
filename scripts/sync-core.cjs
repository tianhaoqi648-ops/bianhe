// ============================================================
// sync-core.js — Bianhe Core 同步脚本（桌面仓 → 小程序仓）
//
// Core 暂存于桌面仓 src/core/，但架构上不得将 Desktop 视为永久 Core owner；
// 本脚本 + manifest hash 为未来 Core 独立仓库保留迁移空间。
//
// 功能：
//   1. 复制 src/core/**（排除 __tests__）→ <target>/src/core/（TS 原样，Taro 前端 import）
//   2. esbuild 转译（cjs/node16/bundle:false）→ <target>/cloud/functions/common/core/（云函数 require）
//   3. 写 manifest：<target>/cloud/functions/common/core/.core-manifest.json
//      （generatedAt + 各源文件 sha256，供 check-core-sync 与 CI diff 校验）
//
// 用法：node scripts/sync-core.js [--target <Mini 仓根>]
// 安全：逐文件 mkdir+copyFile（不用 cpSync/rmSync，规避本机安全删除机制拦截）
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

/** 递归收集相对路径列表（排除 __tests__ 与 .test.ts） */
function listCoreFiles(dir, base) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(base, abs)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...listCoreFiles(abs, base))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(rel)
    }
  }
  return out
}

/** golden 目录（跨端 golden 测试 + fixtures，随 core 同步，但不进 esbuild/cloud） */
const GOLDEN_DIR = path.join(DESKTOP_CORE, '__tests__', 'golden')

/** 递归收集 golden 全部文件（.ts/.test.ts/.json/.md 原样） */
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

/** 逐文件复制（保持目录结构） */
function copyFiles(files, srcBase, destBase) {
  for (const rel of files) {
    const src = path.join(srcBase, rel)
    const dest = path.join(destBase, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function main() {
  const { target } = parseArgs(process.argv.slice(2))
  const files = listCoreFiles(DESKTOP_CORE, DESKTOP_CORE)
  if (files.length === 0) {
    console.error('[sync-core] src/core 无源文件')
    process.exit(1)
  }

  // 1. TS 源复制 → 小程序 src/core
  const miniSrcCore = path.join(target, 'src', 'core')
  copyFiles(files, DESKTOP_CORE, miniSrcCore)
  console.log(`[sync-core] TS 源 → ${miniSrcCore} (${files.length} 文件)`)

  // 2. golden 同步（原样复制全部文件 → 小程序 src/core/__tests__/golden；不进 esbuild、不进 cloud）
  const goldenFiles = listGoldenFiles()
  const miniGolden = path.join(target, 'src', 'core', '__tests__', 'golden')
  copyFiles(goldenFiles, GOLDEN_DIR, miniGolden)
  console.log(`[sync-core] golden → ${miniGolden} (${goldenFiles.length} 文件)`)

  // 3. esbuild 转译 CJS → 小程序 cloud/functions/common/core
  //    （write:false + 手动写盘：绕开 esbuild 原生文件句柄在 Windows 下的 Access-denied 竞态，
  //      与本机安全机制/编辑器监视器共存；与 check-core-sync 的内存重算模式一致）
  const outDir = path.join(target, 'cloud', 'functions', 'common', 'core')
  const entryPoints = files.map((rel) => path.join(DESKTOP_CORE, rel))
  const result = await build({
    entryPoints,
    outdir: outDir,
    outbase: DESKTOP_CORE,
    bundle: false,
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    write: false,
    logLevel: 'silent'
  })
  if (result.errors && result.errors.length > 0) {
    console.error('[sync-core] esbuild 转译失败：', result.errors)
    process.exit(1)
  }
  let written = 0
  for (const out of result.outputFiles) {
    const rel = path.relative(outDir, out.path)
    const dest = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out.contents)
    written++
  }
  console.log(`[sync-core] CJS 产物 → ${outDir} (${written} 文件)`)

  // 4. manifest（源文件 hash + golden hash）
  const sources = {}
  for (const rel of files) {
    sources[rel] = sha256(path.join(DESKTOP_CORE, rel))
  }
  const golden = {}
  for (const rel of goldenFiles) {
    golden[rel] = sha256(path.join(GOLDEN_DIR, rel))
  }
  const manifest = { generatedAt: new Date().toISOString(), source: 'desktop/src/core', sources, golden }
  fs.writeFileSync(path.join(outDir, '.core-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[sync-core] manifest 已写入 ${outDir}/.core-manifest.json`)

  console.log('[sync-core] 完成 ✔ 请在小程序仓执行 npm run sync 分发 common/core 到各函数目录')
}

main().catch((e) => {
  console.error('[sync-core] 失败：', e)
  process.exit(1)
})
