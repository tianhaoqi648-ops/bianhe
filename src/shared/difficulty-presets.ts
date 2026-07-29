// ============================================================
// difficulty-presets.ts — 难度梯度一键预设方案（共享常量）
//
// 由 EventManage 和 EventWizardModal 共同引用，避免重复定义。
// ============================================================

export interface DifficultyPresetRound {
  name: string;
  round_number: number;
  difficulty_override: string;
}

export interface DifficultyPreset {
  key: string;
  label: string;
  presets: DifficultyPresetRound[];
}

/** 难度梯度一键预设方案 */
export const DIFFICULTY_PRESETS: DifficultyPreset[] = [
  {
    key: 'standard',
    label: '标准赛制（分组赛→复赛→决赛）',
    presets: [
      { name: '分组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '复赛', round_number: 2, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 3, difficulty_override: '专业级' }
    ]
  },
  {
    key: 'compact',
    label: '紧凑赛制（初赛→决赛）',
    presets: [
      { name: '初赛', round_number: 1, difficulty_override: '入门级' },
      { name: '决赛', round_number: 2, difficulty_override: '进阶级' }
    ]
  },
  {
    key: 'extended',
    label: '长赛制（小组赛→淘汰赛→半决赛→决赛）',
    presets: [
      { name: '小组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '淘汰赛', round_number: 2, difficulty_override: '入门级' },
      { name: '半决赛', round_number: 3, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 4, difficulty_override: '专业级' }
    ]
  }
];

/** 难度可选项（用于 Select 下拉） */
export const DIFFICULTY_OPTIONS = ['入门级', '进阶级', '专业级', '大师级'];
