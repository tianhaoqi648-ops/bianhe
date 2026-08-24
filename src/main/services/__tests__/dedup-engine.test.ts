import { describe, it, expect } from 'vitest'
import {
  findDuplicates,
  levenshteinDistance,
  extractKeywords,
  type DedupOptions
} from '../dedup-engine'
import type { Topic } from '../../db/repository/topic.repo'

// ============================================================
// 辅助：构造 Topic
// ============================================================

function makeTopic(id: string, title: string): Topic {
  return {
    id,
    title,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: null,
    tags: null,
    weight: 1,
    status: 'active',
    batch_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

// ============================================================
// levenshteinDistance
// ============================================================

describe('levenshteinDistance', () => {
  it('相同字符串距离为 0', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0)
  })

  it('空字符串', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('abc', '')).toBe(3)
    expect(levenshteinDistance('', '')).toBe(0)
  })

  it('已知距离', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
    expect(levenshteinDistance('flaw', 'lawn')).toBe(2)
    expect(levenshteinDistance('abc', 'abd')).toBe(1)
  })
})

// ============================================================
// extractKeywords
// ============================================================

describe('extractKeywords', () => {
  it('空字符串返回空', () => {
    expect(extractKeywords('')).toEqual([])
  })

  it('提取中文 2-gram', () => {
    const kws = extractKeywords('人工智能伦理')
    // 应包含 ai-、工-智、智-能、能-伦、伦-理 等 bigram
    expect(kws.length).toBeGreaterThan(0)
    expect(kws).toContain('人工')
    expect(kws).toContain('智能')
  })

  it('英文 token 保留（小写化）', () => {
    const kws = extractKeywords('AI 技术伦理')
    expect(kws).toContain('ai')
  })

  it('去重', () => {
    const kws = extractKeywords('人工智能 人工智能')
    const set = new Set(kws)
    expect(kws.length).toBe(set.size)
  })
})

// ============================================================
// findDuplicates
// ============================================================

describe('findDuplicates', () => {
  it('空数组返回空', async () => {
    expect(await findDuplicates([])).toEqual([])
  })

  it('单条辩题返回空', async () => {
    expect(await findDuplicates([makeTopic('1', '唯一辩题')])).toEqual([])
  })

  it('完全相同检测', async () => {
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止'),
      makeTopic('3', '完全无关的另一道辩题')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(2)
    expect(groups[0].similarity).toBe(1.0)
    expect(groups[0].reason).toBe('exact')
  })

  it('完全相同 - 首尾空格不影响', async () => {
    const topics = [
      makeTopic('1', '  人工智能是否应该被禁止  '),
      makeTopic('2', '人工智能是否应该被禁止')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('exact')
  })

  it('编辑距离检测 - 改动 < 阈值', async () => {
    // 距离 1
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止的')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('levenshtein')
    expect(groups[0].similarity).toBeGreaterThan(0.9)
  })

  it('编辑距离检测 - 距离 >= 阈值不归组', async () => {
    // 距离 > 5
    const topics = [
      makeTopic('1', '人工智能是否应该被完全禁止使用'),
      makeTopic('2', '人类是否应该探索火星殖民地')
    ]
    const groups = await findDuplicates(topics, { levenshteinThreshold: 5 })
    // 编辑距离检测应不命中，可能命中关键词检测
    const levenshteinGroups = groups.filter((g) => g.reason === 'levenshtein')
    expect(levenshteinGroups).toHaveLength(0)
  })

  it('关键词重合检测', async () => {
    // 高度重合关键词但编辑距离较大
    // 1 的 bigram: 人工/工智/智能/能伦/伦理 = 5
    // 2 的 bigram: 人工/工智/智能/能伦/伦理/理研/研究 = 7
    // 交集 5，并集 7，重合度 = 5/7 ≈ 0.71
    const topics = [
      makeTopic('1', '人工智能伦理'),
      makeTopic('2', '人工智能伦理研究')
    ]
    const groups = await findDuplicates(topics, {
      levenshteinThreshold: 1, // 提高编辑距离门槛，强制走关键词层
      keywordThreshold: 0.5
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(2)
    // 编辑距离 = 2 (添加 "研究")，阈值 1 → 不命中 levenshtein
    // 关键词重合度 0.71 > 0.5 → 命中 keyword
    expect(groups[0].reason).toBe('keyword')
  })

  it('AI 语义层 - 提供 similarityFn', async () => {
    const topics = [
      makeTopic('1', 'AI 是否应该被禁止'),
      makeTopic('2', '机器智能是否应被限制'),
      makeTopic('3', '环保政策')
    ]
    const options: DedupOptions = {
      similarityFn: async (a, b) => {
        if (a.id === '1' && b.id === '2') return 0.92
        return 0.1
      }
    }
    const groups = await findDuplicates(topics, options)
    // 应有 1 个组包含 topic 1 和 2
    expect(groups).toHaveLength(1)
    expect(groups[0].topics.map((t) => t.id).sort()).toEqual(['1', '2'])
    expect(groups[0].reason).toBe('ai')
  })

  it('AI 相似度低于阈值不归组', async () => {
    const topics = [
      makeTopic('1', '辩题一'),
      makeTopic('2', '辩题二')
    ]
    const options: DedupOptions = {
      similarityFn: async () => 0.5,
      aiThreshold: 0.85
    }
    const groups = await findDuplicates(topics, options)
    // 文本层也未必命中，但 AI 层应不归组
    const aiGroups = groups.filter((g) => g.reason === 'ai')
    expect(aiGroups).toHaveLength(0)
  })

  it('同一辩题只出现在一个组（贪心合并）', async () => {
    // 三条互相相似：1=2, 2=3
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止的'),
      makeTopic('3', '人工智能是否应该被禁止了吗')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(3)
  })

  it('多个独立组', async () => {
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止'),
      makeTopic('3', '环保政策是否应该立即执行'),
      makeTopic('4', '环保政策是否应该立即执行'),
      makeTopic('5', '完全独立的一道辩题')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(2)
    const sizes = groups.map((g) => g.topics.length).sort()
    expect(sizes).toEqual([2, 2])
  })
})

// ============================================================
// Task 5.3：批量数据 / 无关题目 / 独立性补充
// ============================================================

describe('findDuplicates：批量数据（Task 5.3）', () => {
  it('大批量互不重复辩题 → 无任何组', async () => {
    // 每个标题用不同关键词，避免 bigram 重合触发误归组
    const titles = [
      '人工智能伦理治理',
      '环境保护与经济发展',
      '大学生创新创业教育',
      '城市交通拥堵治理',
      '网络隐私与个人数据',
      '传统文化传承创新',
      '医疗健康与公共资源',
      '教育公平与区域发展',
      '新能源汽车推广应用',
      '乡村文旅融合发展',
      '数字经济与就业结构',
      '公共安全应急管理',
      '青少年心理健康教育',
      '粮食安全与耕地保护',
      '国际文化交流互鉴'
    ]
    const topics = titles.map((t, i) => makeTopic(String(i + 1), t))
    // 同一条加入 2 份用于验证唯一性处理（不同 id、相同标题）
    const duplicated = [...topics, makeTopic('dup-a', titles[0]), makeTopic('dup-b', titles[0])]
    const groups = await findDuplicates(duplicated)
    // 仅 titles[0] 有 3 份 → 只有 1 个组，组内 3 条
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(3)
    expect(groups[0].reason).toBe('exact')
  })

  it('批量含多组重复 → 每组正确归并', async () => {
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止'),
      makeTopic('3', '人工智能是否应该被禁止的'), // 距离 1 → levenshtein
      makeTopic('4', '环保政策是否立即执行'),
      makeTopic('5', '环保政策是否立即执行'),
      makeTopic('6', '完全独立的一道命题'),
      makeTopic('7', '另一个完全不同的命题'),
      makeTopic('8', '再一个不同命题讨论')
    ]
    const groups = await findDuplicates(topics)
    // 组1: 1,2,3；组2: 4,5；其余独立
    expect(groups).toHaveLength(2)
    const sizes = groups.map((g) => g.topics.length).sort()
    expect(sizes).toEqual([2, 3])
  })

  it('大量无关题不互相误归组', async () => {
    // 语义互异、彼此编辑距离 >5 且关键词重合度 <0.8 的 25 道无关题
    const titles = [
      '人工智能是否应该被用于教育评估',
      '城市垃圾分类究竟由谁负责',
      '线上教学取代线下课堂是否可行',
      '短视频平台应否限制未成年人使用',
      '共享单车治理的关键在政府还是企业',
      '高校扩招是否加剧了就业压力',
      '新能源汽车补贴是否应当取消',
      '公共交通免费政策利大于弊还是弊大于利',
      '外卖骑手权益保障谁之责',
      '数字人民币普及对货币体系的影响',
      '图书馆是否应延长夜间开放时间',
      '电子竞技应否纳入正式体育项目',
      '跨境数据流动如何平衡安全与发展',
      '老旧小区改造的资金从何而来',
      '直播带货是否值得长期信赖',
      '城市河道生态修复的难点所在',
      '青少年体育锻炼与学业如何兼顾',
      '满汉全席式公务接待应否禁止',
      '纳米科技产业化进程是否会受阻',
      '志愿者服务时长能否折算学分',
      '供应链国产化替代是否必然',
      '沉浸式展览是否只是昙花一现',
      '双碳目标下传统能源行业何去何从',
      '预制菜进校园究竟该不该',
      '宠物经济能否成为新增长引擎'
    ]
    const topics = titles.map((t, i) => makeTopic(`t${i}`, t))
    const groups = await findDuplicates(topics)
    // 全部语义无关，不应产生任何组
    expect(groups).toHaveLength(0)
  })
})
