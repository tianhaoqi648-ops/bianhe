// ============================================================
// golden/rng.ts — 确定性随机源（Cross-End Golden Tests 共享）
//
// 目的：两端测试运行同一文件、同一种子 → 同一 Math.random 序列
//       → draw 等随机函数的输出可直接精确比较（A === B）。
// 用法：draw golden 的随机 case 用 withSeed(seed, () => { ... }) 包裹；
//       withSeed 内只允许被测函数消费随机数，测试自身不得调用 Math.random。
// 铁律：零外部 import；随 sync-core 同步到小程序仓。
// ============================================================

/** mulberry32 伪随机数生成器（确定性，标准实现） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** golden 默认种子（draw.json fixture 顶层 seed 与此一致） */
export const GOLDEN_SEED = 20260115

/** 以种子随机源临时替换 Math.random 执行 fn，结束后恢复原样 */
export function withSeed<T>(seed: number, fn: () => T): T {
  const orig = Math.random
  Math.random = mulberry32(seed)
  try {
    return fn()
  } finally {
    Math.random = orig
  }
}
