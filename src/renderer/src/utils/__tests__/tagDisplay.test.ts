import { describe, it, expect } from 'vitest';
import type { TagDisplayConfig, TagCategory } from '../../../../shared/types';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../tagDisplay';

describe('tagDisplay utils', () => {
  describe('DEFAULT_TAG_DISPLAY_CONFIG', () => {
    it('所有类别默认开启', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.type).toBe(true);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.difficulty).toBe(true);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.source_type).toBe(true);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.custom).toBe(true);
    });

    it('所有 selectedValues 默认为空数组（显示全部）', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedValues.type).toEqual([]);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedValues.difficulty).toEqual([]);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedValues.source_type).toEqual([]);
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedValues.custom).toEqual([]);
    });
  });

  describe('loadTagDisplayConfig', () => {
    it('无配置时返回默认', () => {
      expect(loadTagDisplayConfig({})).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('字符串配置正确解析', () => {
      const settings = {
        'ui.tagDisplay': JSON.stringify({
          categoryEnabled: { type: false, difficulty: true, source_type: true, custom: true },
          selectedValues: { type: [], difficulty: ['入门级'], source_type: [], custom: [] }
        })
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.categoryEnabled.type).toBe(false);
      expect(cfg.selectedValues.difficulty).toEqual(['入门级']);
    });

    it('对象配置直接合并', () => {
      const settings = {
        'ui.tagDisplay': {
          categoryEnabled: { type: true, difficulty: true, source_type: false, custom: true },
          selectedValues: { type: ['价值辩'], difficulty: [], source_type: [], custom: [] }
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.categoryEnabled.source_type).toBe(false);
      expect(cfg.selectedValues.type).toEqual(['价值辩']);
    });

    it('损坏的 JSON 返回默认', () => {
      const settings = { 'ui.tagDisplay': '{not valid json' };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('旧格式 v2（enabled + selectedTags）转换为默认', () => {
      const oldV2 = { enabled: false, selectedTags: ['价值辩'] };
      const settings = { 'ui.tagDisplay': oldV2 };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('旧格式 v1（categoryEnabled + hiddenValues + bigScreenOverrides）转换为默认', () => {
      const oldV1 = {
        categoryEnabled: { type: true, difficulty: true, source: true, customTags: true },
        hiddenValues: { type: [], difficulty: [], source: [], customTags: [] },
        bigScreenOverrides: { categoryEnabled: { type: false, difficulty: false, source: false, customTags: false } }
      };
      const settings = { 'ui.tagDisplay': oldV1 };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('部分字段缺失时合并默认值', () => {
      const settings = {
        'ui.tagDisplay': {
          categoryEnabled: { type: false, difficulty: true, source_type: true, custom: true }
          // 缺少 selectedValues
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.categoryEnabled.type).toBe(false);
      expect(cfg.selectedValues.type).toEqual([]);
      expect(cfg.selectedValues.difficulty).toEqual([]);
    });

    it('部分 selectedValues 字段缺失时合并默认值', () => {
      const settings = {
        'ui.tagDisplay': {
          categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
          selectedValues: { type: ['价值辩'] }
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.selectedValues.type).toEqual(['价值辩']);
      expect(cfg.selectedValues.difficulty).toEqual([]);
      expect(cfg.selectedValues.source_type).toEqual([]);
      expect(cfg.selectedValues.custom).toEqual([]);
    });
  });

  describe('filterTag', () => {
    const categories: TagCategory[] = ['type', 'difficulty', 'source_type', 'custom'];
    categories.forEach((cat) => {
      describe(`类别 ${cat}`, () => {
        it('类别关闭返回 null', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: false },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          // 仅测试当前类别关闭的情况
          const closedConfig: TagDisplayConfig = {
            ...config,
            categoryEnabled: {
              type: cat === 'type' ? false : true,
              difficulty: cat === 'difficulty' ? false : true,
              source_type: cat === 'source_type' ? false : true,
              custom: cat === 'custom' ? false : true
            }
          };
          expect(filterTag(closedConfig, '某值', cat)).toBe(null);
        });

        it('类别开启 + selectedValues 空 = 显示全部', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          expect(filterTag(config, '价值辩', cat)).toBe('价值辩');
        });

        it('类别开启 + selectedValues 非空 = 只显示选中的', () => {
          const selectedMap: Record<TagCategory, string[]> = {
            type: ['价值辩'],
            difficulty: ['入门级'],
            source_type: ['官方'],
            custom: ['成长']
          };
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: selectedMap
          };
          // 选中的值 → 显示
          expect(filterTag(config, selectedMap[cat][0], cat)).toBe(selectedMap[cat][0]);
          // 未选中的值 → null
          expect(filterTag(config, '其他未选中的值', cat)).toBe(null);
        });

        it('空值返回 null', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          expect(filterTag(config, '', cat)).toBe(null);
          expect(filterTag(config, null, cat)).toBe(null);
          expect(filterTag(config, undefined, cat)).toBe(null);
        });
      });
    });
  });

  describe('filterTags', () => {
    const categories: TagCategory[] = ['type', 'difficulty', 'source_type', 'custom'];
    categories.forEach((cat) => {
      describe(`类别 ${cat}`, () => {
        it('类别关闭返回空数组', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          const closedConfig: TagDisplayConfig = {
            ...config,
            categoryEnabled: {
              type: cat === 'type' ? false : true,
              difficulty: cat === 'difficulty' ? false : true,
              source_type: cat === 'source_type' ? false : true,
              custom: cat === 'custom' ? false : true
            }
          };
          expect(filterTags(closedConfig, ['a', 'b'], cat)).toEqual([]);
        });

        it('类别开启 + selectedValues 空 = 返回全部', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          expect(filterTags(config, ['a', 'b', 'c'], cat)).toEqual(['a', 'b', 'c']);
        });

        it('类别开启 + selectedValues 非空 = 只保留选中的', () => {
          const selectedMap: Record<TagCategory, string[]> = {
            type: ['价值辩'],
            difficulty: ['入门级'],
            source_type: ['官方'],
            custom: ['成长', '环境']
          };
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: selectedMap
          };
          const input = ['价值辩', '入门级', '官方', '成长', '其他'];
          const expected = input.filter((v) => selectedMap[cat].includes(v));
          expect(filterTags(config, input, cat)).toEqual(expected);
        });

        it('null/undefined/空数组返回空数组', () => {
          const config: TagDisplayConfig = {
            categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
            selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
          };
          expect(filterTags(config, null, cat)).toEqual([]);
          expect(filterTags(config, undefined, cat)).toEqual([]);
          expect(filterTags(config, [], cat)).toEqual([]);
        });
      });
    });
  });
});
