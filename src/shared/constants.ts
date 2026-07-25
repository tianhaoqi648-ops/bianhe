// ============================================================
// 系统候选值单一来源
//
// FilterPanel、import-engine、candidate-service 全部引用此处。
// 避免历史不一致：FilterPanel 难度 3 项 vs import-engine 难度 5 项。
//
// 用户可通过「加入候选」机制扩展这些数组（持久化到 settings 表
// key='system.candidates'，启动时由 candidate-service 合并到此处
// 导出的数组）。
// ============================================================

export const SYSTEM_CANDIDATES = {
  type: ['价值辩', '政策辩', '事实辩', '哲理辩', '娱乐辩'],
  domain: [
    '社会热点',
    '科技伦理',
    '教育文化',
    '法律政策',
    '经济商业',
    '环保公益',
    '情感人际'
  ],
  difficulty: ['入门级', '进阶级', '专业级'],
  source: ['新国辩', '华语辩论世界杯', '老友赛', '世锦赛', '年度原创'],
  source_type: ['官方', '自定义']
} as const

export type CandidateField = keyof typeof SYSTEM_CANDIDATES
