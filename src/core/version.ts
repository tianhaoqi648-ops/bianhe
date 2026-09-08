// ============================================================
// version.ts — Bianhe Core 唯一版本真源（Phase 7.7-7B）
// 升级规则：
//   PATCH (x.y.Z)  Core 内部 bugfix，不改协议语义 → CompatibilityVersion 不变
//   MINOR (x.Y.0)  向后兼容新能力/字段            → CompatibilityVersion 不变
//   MAJOR (X.0.0)  schema/public API/Backup/跨端协议 breaking → CompatibilityVersion 递增
// 改版本后运行 npm run core:sync 并提交生成物（CI core:check 校验）。
// ============================================================
export const CORE_VERSION = '1.0.0'
export const CORE_COMPATIBILITY_VERSION = 1
