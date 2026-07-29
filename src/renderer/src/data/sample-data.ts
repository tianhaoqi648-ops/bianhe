// ============================================================
// sample-data.ts — 首次启动示例数据
//
// 提供 20 条示例辩题（覆盖不同类型/难度/领域，含标签）+ 1 条预设赛制（国赛制 4 环节）。
// 用户首次启动应用且数据库为空时，可选择填充以快速体验功能。
// ============================================================

import type { TopicCreateInput } from '../../../shared/types';
import type { DebateFormatData, StageDef } from '../../../shared/debate-formats/types';

/** 20 条示例辩题（覆盖不同类型/难度/领域，含标签） */
export const SAMPLE_TOPICS: TopicCreateInput[] = [
  {
    title: '人工智能是否会取代人类的工作',
    type: '价值辩题',
    domain: '科技',
    difficulty: '入门',
    source: '示例数据',
    source_type: '自定义',
    tags: ['经典', '科技', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '大学生是否应该在校园内兼职',
    type: '政策辩题',
    domain: '教育',
    difficulty: '简单',
    source: '示例数据',
    source_type: '自定义',
    tags: ['校园', '实战'],
    weight: 5,
    status: 'active'
  },
  {
    title: '网络舆论对司法审判的利大于弊还是弊大于利',
    type: '价值辩题',
    domain: '法律',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['法律', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '当代年轻人更应该追求理想还是务实',
    type: '价值辩题',
    domain: '哲学',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['哲学', '经典'],
    weight: 5,
    status: 'active'
  },
  {
    title: '社交媒体对人际关系的利大于弊还是弊大于利',
    type: '事实辩题',
    domain: '社会',
    difficulty: '简单',
    source: '示例数据',
    source_type: '自定义',
    tags: ['社会', '时事'],
    weight: 5,
    status: 'active'
  },
  {
    title: '是否应该立法禁止塑料袋的使用',
    type: '政策辩题',
    domain: '环境',
    difficulty: '入门',
    source: '示例数据',
    source_type: '自定义',
    tags: ['环境', '政策'],
    weight: 5,
    status: 'active'
  },
  {
    title: '高考是否应该取消文理分科',
    type: '政策辩题',
    domain: '教育',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['教育', '经典'],
    weight: 5,
    status: 'active'
  },
  {
    title: '金钱是否能买到幸福',
    type: '价值辩题',
    domain: '哲学',
    difficulty: '入门',
    source: '示例数据',
    source_type: '自定义',
    tags: ['哲学', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '远程办公是否应该成为企业的常态',
    type: '政策辩题',
    domain: '经济',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['时事', '经济'],
    weight: 5,
    status: 'active'
  },
  {
    title: '传统文化是否应该在现代社会中被强制传承',
    type: '价值辩题',
    domain: '文化',
    difficulty: '困难',
    source: '示例数据',
    source_type: '自定义',
    tags: ['文化', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '基因编辑技术是否应该被应用于人类胚胎',
    type: '政策辩题',
    domain: '科技',
    difficulty: '困难',
    source: '示例数据',
    source_type: '自定义',
    tags: ['科技', '伦理'],
    weight: 5,
    status: 'active'
  },
  {
    title: '城市是否应该限制私家车的使用',
    type: '政策辩题',
    domain: '环境',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['环境', '政策'],
    weight: 5,
    status: 'active'
  },
  {
    title: '电竞赛事是否应该被纳入奥运会正式项目',
    type: '价值辩题',
    domain: '文化',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['文化', '时事'],
    weight: 5,
    status: 'active'
  },
  {
    title: '人工智能是否应该拥有法律人格',
    type: '价值辩题',
    domain: '法律',
    difficulty: '专家',
    source: '示例数据',
    source_type: '自定义',
    tags: ['法律', '科技', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '是否应该全面禁止野生动物表演',
    type: '政策辩题',
    domain: '环境',
    difficulty: '简单',
    source: '示例数据',
    source_type: '自定义',
    tags: ['环境', '伦理'],
    weight: 5,
    status: 'active'
  },
  {
    title: '高等教育应该更加注重通识教育还是专业教育',
    type: '价值辩题',
    domain: '教育',
    difficulty: '困难',
    source: '示例数据',
    source_type: '自定义',
    tags: ['教育', '思辨'],
    weight: 5,
    status: 'active'
  },
  {
    title: '区块链技术的应用前景是否被高估',
    type: '事实辩题',
    domain: '科技',
    difficulty: '困难',
    source: '示例数据',
    source_type: '自定义',
    tags: ['科技', '经济'],
    weight: 5,
    status: 'active'
  },
  {
    title: '是否应该对网红经济征收更高的税',
    type: '政策辩题',
    domain: '经济',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['经济', '时事'],
    weight: 5,
    status: 'active'
  },
  {
    title: '老字号品牌应该在传承中创新还是坚守传统',
    type: '价值辩题',
    domain: '文化',
    difficulty: '中等',
    source: '示例数据',
    source_type: '自定义',
    tags: ['文化', '经济'],
    weight: 5,
    status: 'active'
  },
  {
    title: '宇宙探索是否应该优先于地球环境保护',
    type: '价值辩题',
    domain: '科技',
    difficulty: '专家',
    source: '示例数据',
    source_type: '自定义',
    tags: ['科技', '环境', '思辨'],
    weight: 5,
    status: 'active'
  }
];

/** 国赛制 4 环节 stages 定义 */
const GUOSAI_STAGES: StageDef[] = [
  {
    id: 'stage-opening',
    name: '开篇立论',
    side: 'aff',
    durationMs: 180000, // 3 分钟
    graceMs: 30000,
    bells: [
      { atMs: 30000, sound: 'beep' },
      { atMs: 0, sound: 'double_bell' }
    ]
  },
  {
    id: 'stage-cross',
    name: '攻辩',
    side: 'both',
    durationMs: 90000, // 1.5 分钟
    graceMs: 15000,
    bells: [
      { atMs: 30000, sound: 'beep' },
      { atMs: 0, sound: 'double_bell' }
    ]
  },
  {
    id: 'stage-free',
    name: '自由辩论',
    side: 'both',
    durationMs: 240000, // 4 分钟
    graceMs: 30000,
    isFreeDebate: true,
    bells: [
      { atMs: 30000, sound: 'beep' },
      { atMs: 0, sound: 'double_bell' }
    ]
  },
  {
    id: 'stage-closing',
    name: '总结陈词',
    side: 'neg',
    durationMs: 180000, // 3 分钟
    graceMs: 30000,
    bells: [
      { atMs: 30000, sound: 'beep' },
      { atMs: 0, sound: 'double_bell' }
    ]
  }
];

/** 国赛制 formatData */
const SAMPLE_FORMAT_DATA: DebateFormatData = {
  stages: GUOSAI_STAGES,
  totalDurationMs: GUOSAI_STAGES.reduce((sum, s) => sum + s.durationMs, 0) // 690000ms = 11.5 分钟
};

/** 示例赛制：国赛制（4 环节） */
export const SAMPLE_FORMAT = {
  name: '国赛制（示例）',
  description: '示例赛制：开篇立论 3min + 攻辩 1.5min + 自由辩论 4min + 总结陈词 3min',
  formatData: SAMPLE_FORMAT_DATA
};
