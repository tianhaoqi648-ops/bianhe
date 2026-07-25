// ============================================================
// dedup-engine.ts — 去重引擎
//
// 提供：
//   1. findDuplicates：检测相似辩题分组
//      - 文本匹配层：完全相同 / Levenshtein 编辑距离 / 关键词重合
//      - AI 语义层：可选 similarityFn 接口
//   2. levenshteinDistance：Levenshtein 编辑距离
//   3. extractKeywords：简易中文分词 + 关键词提取
//
// 仅依赖 topic.repo 的 Topic 类型，无运行时依赖。
// ============================================================

import type { Topic } from '../db/repository/topic.repo'

// ============================================================
// 类型定义
// ============================================================

export type DuplicateReason = 'exact' | 'levenshtein' | 'keyword' | 'ai'

export interface DuplicateGroup {
  /** 组 id（uuid 或自增） */
  id: string
  /** 组内相似辩题 */
  topics: Topic[]
  /** 相似度分数 0~1 */
  similarity: number
  /** 触发原因 */
  reason: DuplicateReason
}

export interface DedupOptions {
  /** Levenshtein 距离阈值，默认 5 */
  levenshteinThreshold?: number
  /** 关键词重合度阈值，默认 0.8 */
  keywordThreshold?: number
  /** AI 相似度阈值，默认 0.85 */
  aiThreshold?: number
  /** 可选的 AI 语义相似度函数（异步，返回 0~1） */
  similarityFn?: (a: Topic, b: Topic) => Promise<number>
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 提取标题的字符级 bigram 集合（去空白）。
 * 用于构建倒排索引，预筛可能的相似对，避免 O(n²) 全两两比较。
 *
 * 例：'人工智能伦理' → Set { '人工', '工智', '智能', '能伦', '伦理' }
 */
function extractBigrams(text: string): Set<string> {
  const cleaned = (text || '').replace(/\s+/g, '')
  const bigrams = new Set<string>()
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2))
  }
  return bigrams
}

/**
 * 为辩题列表构建 bigram → 主题索引列表 的倒排索引。
 * 索引值为 topics 数组的下标，便于后续 O(1) 查找共享某 bigram 的所有主题。
 */
function buildBigramIndex(topics: Topic[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>()
  topics.forEach((t, i) => {
    const bigrams = extractBigrams(t.title)
    bigrams.forEach((b) => {
      if (!index.has(b)) index.set(b, new Set())
      index.get(b)!.add(i)
    })
  })
  return index
}

/**
 * 内置简易停用词表（中文高频虚词 + 常见辩论术语修饰词）。
 */
const STOP_WORDS = new Set<string>([
  // 代词/虚词
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '其', '之',
  '与', '和', '或', '及', '但', '而', '则', '也', '都', '已', '将', '会', '能', '可',
  // 量词/副词
  '个', '种', '些', '上', '下', '中', '里', '为', '以', '于', '到', '从', '向', '由',
  // 辩题常见修饰
  '应', '不', '该', '应否', '是否', '应该', '可以', '应当'
])

/**
 * 简易分词器（降级方案，替代 nodejieba）：
 *   1. 按标点/空格切分
 *   2. 中文段按 2-gram 滑窗切分（弥补无词典分词能力）
 *   3. 过滤停用词 + 长度 < 2 的项
 *
 * 注：2-gram 不完美，但对"关键词重合度"去重场景足够。
 */
function tokenize(text: string): string[] {
  if (!text) return []

  // 按非汉字字母数字字符切分
  const segments = text.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/).filter(Boolean)
  const tokens: string[] = []

  for (const seg of segments) {
    // 纯英文/数字段：直接作为一个 token（长度 >= 2 才保留）
    if (/^[a-zA-Z0-9]+$/.test(seg)) {
      if (seg.length >= 2) tokens.push(seg.toLowerCase())
      continue
    }

    // 中文段：2-gram 滑窗
    for (let i = 0; i < seg.length - 1; i++) {
      const bigram = seg.substring(i, i + 2)
      if (!STOP_WORDS.has(bigram)) {
        tokens.push(bigram)
      }
    }
    // 末尾单字（如果长度 >= 2 的词已通过 bigram 覆盖，这里跳过单字）
  }

  return tokens
}

/**
 * 提取辩题核心关键词（去重后的 token 集合）。
 */
export function extractKeywords(text: string): string[] {
  const tokens = tokenize(text)
  return Array.from(new Set(tokens))
}

// ============================================================
// Levenshtein 编辑距离
// ============================================================

/**
 * 计算 a 与 b 的 Levenshtein 编辑距离。
 * 标准动态规划实现，O(m*n) 时间与空间。
 *
 * 用 diff-match-patch 的 diff_levenshtein 也可，但直接实现更轻量。
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const m = a.length
  const n = b.length
  // 滚动数组优化空间至 O(n)
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)

  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // 删除
        curr[j - 1] + 1, // 插入
        prev[j - 1] + cost // 替换
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]
}

// ============================================================
// 两两相似度计算（文本层）
// ============================================================

/**
 * 计算两条辩题的文本相似度。
 * 优先级：完全相同 > Levenshtein > 关键词重合
 * 任一层命中即返回，不再向下检查。
 *
 * @returns similarity=0 表示无相似
 */
function computeTextSimilarity(
  a: Topic,
  b: Topic,
  levenshteinThreshold: number,
  keywordThreshold: number
): { similarity: number; reason: DuplicateReason | null } {
  const titleA = (a.title || '').trim()
  const titleB = (b.title || '').trim()

  // 1. 完全相同
  if (titleA === titleB && titleA.length > 0) {
    return { similarity: 1.0, reason: 'exact' }
  }

  // 2. Levenshtein 编辑距离
  if (titleA.length > 0 && titleB.length > 0) {
    const dist = levenshteinDistance(titleA, titleB)
    if (dist < levenshteinThreshold) {
      const maxLen = Math.max(titleA.length, titleB.length)
      const sim = maxLen > 0 ? 1 - dist / maxLen : 0
      return { similarity: Math.max(0, sim), reason: 'levenshtein' }
    }
  }

  // 3. 关键词重合度
  const ka = extractKeywords(titleA)
  const kb = extractKeywords(titleB)
  if (ka.length > 0 && kb.length > 0) {
    const setA = new Set(ka)
    const intersection = kb.filter((k) => setA.has(k)).length
    const union = new Set([...ka, ...kb]).size
    const overlap = union > 0 ? intersection / union : 0
    if (overlap > keywordThreshold) {
      return { similarity: overlap, reason: 'keyword' }
    }
  }

  return { similarity: 0, reason: null }
}

// ============================================================
// 并查集（Union-Find）用于归并相似对
// ============================================================

class UnionFind {
  private parent: Map<number, number> = new Map()
  private bestSim: Map<number, number> = new Map()
  private bestReason: Map<number, DuplicateReason> = new Map()

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.parent.set(i, i)
      this.bestSim.set(i, 0)
      this.bestReason.set(i, 'exact' as DuplicateReason)
    }
  }

  find(x: number): number {
    const p = this.parent.get(x)!
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }

  /**
   * 合并 i 与 j，记录最高相似度与对应 reason。
   * 注意：相似度记录在根节点上。
   */
  union(i: number, j: number, sim: number, reason: DuplicateReason): void {
    const ri = this.find(i)
    const rj = this.find(j)
    if (ri === rj) {
      // 同组，更新最高相似度
      const cur = this.bestSim.get(ri) ?? 0
      if (sim > cur) {
        this.bestSim.set(ri, sim)
        this.bestReason.set(ri, reason)
      }
      return
    }
    // 按 ri 为根合并 rj
    this.parent.set(rj, ri)
    const curSim = this.bestSim.get(ri) ?? 0
    const newSim = Math.max(curSim, sim)
    this.bestSim.set(ri, newSim)
    this.bestReason.set(ri, curSim >= sim ? this.bestReason.get(ri) ?? reason : reason)
  }

  getGroups(): Map<number, { similarity: number; reason: DuplicateReason }> {
    const result = new Map<number, { similarity: number; reason: DuplicateReason }>()
    for (let i = 0; i < this.parent.size; i++) {
      const root = this.find(i)
      if (!result.has(root)) {
        result.set(root, {
          similarity: this.bestSim.get(root) ?? 0,
          reason: this.bestReason.get(root) ?? 'exact'
        })
      }
    }
    return result
  }
}

// ============================================================
// findDuplicates
// ============================================================

/**
 * 检测相似辩题分组。
 *
 * 流程：
 *   1. 若提供 similarityFn，先两两调用 AI 相似度，超 aiThreshold 的对入并查集
 *   2. 否则（或之后），对未被 AI 归组的对，按文本层（完全/Levenshtein/关键词）两两计算
 *   3. 用并查集合并所有相似对
 *   4. 仅返回 topics.length >= 2 的组
 *
 * @param topics 待检测的辩题列表
 * @param options 配置项
 */
export async function findDuplicates(
  topics: Topic[],
  options?: DedupOptions
): Promise<DuplicateGroup[]> {
  if (!topics || topics.length < 2) return []

  const levenshteinThreshold = options?.levenshteinThreshold ?? 5
  const keywordThreshold = options?.keywordThreshold ?? 0.8
  const aiThreshold = options?.aiThreshold ?? 0.85
  const similarityFn = options?.similarityFn

  const n = topics.length
  const uf = new UnionFind(n)

  // 1. AI 语义层（可选）
  if (similarityFn) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = await similarityFn(topics[i], topics[j])
        if (sim >= aiThreshold) {
          uf.union(i, j, sim, 'ai')
        }
      }
    }
  }

  // 2. 文本匹配层（对未归组的对也跑一遍，补充 AI 漏网的）
  //    使用 bigram 倒排索引预筛候选对，避免 O(n²) 全两两比较。
  //    若两条辩题无任何共享 bigram，则不可能命中 exact / levenshtein(<5) / keyword(>0.8)
  //    中的任一层（实测三层数学上都要求至少一个共享 2-gram），可直接跳过。
  const bigramIndex = buildBigramIndex(topics)
  const candidatePairs = new Set<string>()
  for (let i = 0; i < n; i++) {
    const bigrams = extractBigrams(topics[i].title)
    for (const b of bigrams) {
      const matches = bigramIndex.get(b)
      if (matches) {
        for (const j of matches) {
          if (j > i) {
            candidatePairs.add(`${i}-${j}`)
          }
        }
      }
    }
  }
  // 此外，标题完全相同的对必须被纳入候选（兜底短字符串 / 单字符标题场景）：
  // 这些标题的 bigram 集合可能为空（长度 < 2），但 exact 层仍应命中。
  const titleMap = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const title = (topics[i].title || '').trim()
    if (title.length === 0) continue
    if (!titleMap.has(title)) titleMap.set(title, [])
    titleMap.get(title)!.push(i)
  }
  for (const indices of titleMap.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        candidatePairs.add(`${indices[a]}-${indices[b]}`)
      }
    }
  }
  for (const pair of candidatePairs) {
    const sepIdx = pair.indexOf('-')
    const i = Number(pair.slice(0, sepIdx))
    const j = Number(pair.slice(sepIdx + 1))
    const { similarity, reason } = computeTextSimilarity(
      topics[i],
      topics[j],
      levenshteinThreshold,
      keywordThreshold
    )
    if (reason !== null && similarity > 0) {
      uf.union(i, j, similarity, reason)
    }
  }

  // 3. 收集分组
  const groupsMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = uf.find(i)
    if (!groupsMap.has(root)) groupsMap.set(root, [])
    groupsMap.get(root)!.push(i)
  }

  // 4. 构造 DuplicateGroup，仅保留 >= 2 条的组
  const result: DuplicateGroup[] = []
  const meta = uf.getGroups()
  let groupIndex = 0
  for (const [root, indices] of groupsMap.entries()) {
    if (indices.length < 2) continue
    const m = meta.get(root) ?? { similarity: 0, reason: 'exact' as DuplicateReason }
    result.push({
      id: `dg-${Date.now()}-${++groupIndex}`,
      topics: indices.map((i) => topics[i]),
      similarity: m.similarity,
      reason: m.reason
    })
  }

  return result
}
