// ============================================================
// node-sqlite.d.ts — node:sqlite 类型声明（全局，跨环境稳定）
//
// 背景：
//   - Node 运行时（v22.5+ / v24）原生提供 node:sqlite；
//   - 但 tsconfig.node.json 的 `types: ["electron-vite/node"]` 只加载
//     该白名单包，且不同机器/CI 的 @types/node 版本不一（v20 无
//     node:sqlite 类型），导致 `migrations.test.ts` 在 tsc --noEmit 下
//     报 TS2307 "Cannot find module 'node:sqlite'"（CI 三个平台均复现）。
//
// 处理：在本文件用 declare module 为该模块提供宽松但够用的类型，
// 使类型检查在所有环境（含 CI npm ci 的 @types/node）稳定通过；
// 仅影响类型检查，不影响运行时。
// ============================================================

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path?: string, options?: Record<string, unknown>)
    exec(sql: string): void
    // 其它成员（prepare/all/run/pragma 等）按需从调用点兼容；宽松兜底
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
}