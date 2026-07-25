import { describe, it, expect } from 'vitest';
import type { TagCategory, TagDisplayConfig } from '../../../../shared/types';
import {
  DEFAULT_SCENE_CONFIG,
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig,
  filterTag,
  filterTags,
  SCENE_KEYS,
  CATEGORY_KEYS
} from '../tagDisplay';

describe('tagDisplay utils', () => {
  describe('DEFAULT_TAG_DISPLAY_CONFIG', () => {
    it('包含 5 个场景', () => {
      SCENE_KEYS.forEach((scene) => {
        expect(DEFAULT_TAG_DISPLAY_CONFIG.scenes[scene]).toBeDefined();
      });
    });

    it('所有场景所有类别默认开启', () => {
      SCENE_KEYS.forEach((scene) => {
        CATEGORY_KEYS.forEach((cat) => {
          expect(DEFAULT_TAG_DISPLAY_CONFIG.scenes[scene].categoryEnabled[cat]).toBe(true);
        });
      });
    });

    it('所有场景所有 selectedValues 默认为空数组', () => {
      SCENE_KEYS.forEach((scene) => {
        CATEGORY_KEYS.forEach((cat) => {
          expect(DEFAULT_TAG_DISPLAY_CONFIG.scenes[scene].selectedValues[cat]).toEqual([]);
        });
      });
    });

    it('DEFAULT_SCENE_CONFIG 等价于任一场景默认值', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.scenes.library).toEqual(DEFAULT_SCENE_CONFIG);
    });
  });

  describe('loadTagDisplayConfig', () => {
    it('无配置时返回默认', () => {
      expect(loadTagDisplayConfig({})).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('字符串配置正确解析', () => {
      const settings = {
        'ui.tagDisplay': JSON.stringify({
          scenes: {
            library: {
              categoryEnabled: { type: false, difficulty: true, source_type: true, custom: true },
              selectedValues: { type: [], difficulty: ['入门级'], source_type: [], custom: [] }
            },
            drawResult: { ...DEFAULT_SCENE_CONFIG },
            bigScreen: { ...DEFAULT_SCENE_CONFIG },
            filter: { ...DEFAULT_SCENE_CONFIG },
            dedup: { ...DEFAULT_SCENE_CONFIG }
          }
        })
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.scenes.library.categoryEnabled.type).toBe(false);
      expect(cfg.scenes.library.selectedValues.difficulty).toEqual(['入门级']);
    });

    it('对象配置直接合并', () => {
      const settings = {
        'ui.tagDisplay': {
          scenes: {
            library: { ...DEFAULT_SCENE_CONFIG },
            drawResult: { ...DEFAULT_SCENE_CONFIG },
            bigScreen: {
              categoryEnabled: { type: true, difficulty: false, source_type: true, custom: true },
              selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
            },
            filter: { ...DEFAULT_SCENE_CONFIG },
            dedup: { ...DEFAULT_SCENE_CONFIG }
          }
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.scenes.bigScreen.categoryEnabled.difficulty).toBe(false);
    });

    it('损坏的 JSON 返回默认', () => {
      const settings = { 'ui.tagDisplay': '{not valid json' };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('旧格式 v3（直接 categoryEnabled）转换为默认', () => {
      const oldV3 = {
        categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
        selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
      };
      const settings = { 'ui.tagDisplay': oldV3 };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('旧格式 v2（enabled + selectedTags）转换为默认', () => {
      const oldV2 = { enabled: false, selectedTags: ['价值辩'] };
      const settings = { 'ui.tagDisplay': oldV2 };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('旧格式 v1（hiddenValues + bigScreenOverrides）转换为默认', () => {
      const oldV1 = {
        categoryEnabled: { type: true, difficulty: true, source: true, customTags: true },
        hiddenValues: { type: [], difficulty: [], source: [], customTags: [] },
        bigScreenOverrides: { categoryEnabled: { type: false, difficulty: false, source: false, customTags: false } }
      };
      const settings = { 'ui.tagDisplay': oldV1 };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('部分场景缺失时合并默认值', () => {
      const settings = {
        'ui.tagDisplay': {
          scenes: {
            library: {
              categoryEnabled: { type: false, difficulty: true, source_type: true, custom: true },
              selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
            }
            // 缺少其他 4 个场景
          }
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.scenes.library.categoryEnabled.type).toBe(false);
      expect(cfg.scenes.drawResult).toEqual(DEFAULT_SCENE_CONFIG);
      expect(cfg.scenes.bigScreen).toEqual(DEFAULT_SCENE_CONFIG);
      expect(cfg.scenes.filter).toEqual(DEFAULT_SCENE_CONFIG);
      expect(cfg.scenes.dedup).toEqual(DEFAULT_SCENE_CONFIG);
    });

    it('单场景部分字段缺失时合并默认值', () => {
      const settings = {
        'ui.tagDisplay': {
          scenes: {
            library: {
              categoryEnabled: { type: false, difficulty: true, source_type: true, custom: true }
              // 缺少 selectedValues
            }
          }
        }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.scenes.library.categoryEnabled.type).toBe(false);
      expect(cfg.scenes.library.selectedValues.type).toEqual([]);
      expect(cfg.scenes.library.selectedValues.difficulty).toEqual([]);
    });
  });

  describe('filterTag', () => {
    SCENE_KEYS.forEach((scene) => {
      CATEGORY_KEYS.forEach((cat) => {
        describe(`场景 ${scene} × 类别 ${cat}`, () => {
          it('类别关闭返回 null', () => {
            const config: TagDisplayConfig = {
              scenes: {
                ...DEFAULT_TAG_DISPLAY_CONFIG.scenes,
                [scene]: {
                  categoryEnabled: {
                    type: cat === 'type' ? false : true,
                    difficulty: cat === 'difficulty' ? false : true,
                    source_type: cat === 'source_type' ? false : true,
                    custom: cat === 'custom' ? false : true
                  },
                  selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
                }
              }
            };
            expect(filterTag(config, '某值', cat, scene)).toBe(null);
          });

          it('类别开启 + selectedValues 空 = 显示全部', () => {
            const config: TagDisplayConfig = DEFAULT_TAG_DISPLAY_CONFIG;
            expect(filterTag(config, '价值辩', cat, scene)).toBe('价值辩');
          });

          it('类别开启 + selectedValues 非空 = 只显示选中的', () => {
            const selectedMap: Record<TagCategory, string[]> = {
              type: ['价值辩'],
              difficulty: ['入门级'],
              source_type: ['官方'],
              custom: ['成长']
            };
            const config: TagDisplayConfig = {
              scenes: {
                ...DEFAULT_TAG_DISPLAY_CONFIG.scenes,
                [scene]: {
                  categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
                  selectedValues: selectedMap
                }
              }
            };
            // 选中的值 → 显示
            expect(filterTag(config, selectedMap[cat][0], cat, scene)).toBe(selectedMap[cat][0]);
            // 未选中的值 → null
            expect(filterTag(config, '其他未选中的值', cat, scene)).toBe(null);
            // 其他场景不受影响（仍显示全部）
            SCENE_KEYS.filter((s) => s !== scene).forEach((otherScene) => {
              expect(filterTag(config, '其他未选中的值', cat, otherScene)).toBe('其他未选中的值');
            });
          });

          it('空值返回 null', () => {
            const config: TagDisplayConfig = DEFAULT_TAG_DISPLAY_CONFIG;
            expect(filterTag(config, '', cat, scene)).toBe(null);
            expect(filterTag(config, null, cat, scene)).toBe(null);
            expect(filterTag(config, undefined, cat, scene)).toBe(null);
          });
        });
      });
    });
  });

  describe('filterTags', () => {
    SCENE_KEYS.forEach((scene) => {
      CATEGORY_KEYS.forEach((cat) => {
        describe(`场景 ${scene} × 类别 ${cat}`, () => {
          it('类别关闭返回空数组', () => {
            const config: TagDisplayConfig = {
              scenes: {
                ...DEFAULT_TAG_DISPLAY_CONFIG.scenes,
                [scene]: {
                  categoryEnabled: {
                    type: cat === 'type' ? false : true,
                    difficulty: cat === 'difficulty' ? false : true,
                    source_type: cat === 'source_type' ? false : true,
                    custom: cat === 'custom' ? false : true
                  },
                  selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
                }
              }
            };
            expect(filterTags(config, ['a', 'b'], cat, scene)).toEqual([]);
          });

          it('类别开启 + selectedValues 空 = 返回全部', () => {
            const config: TagDisplayConfig = DEFAULT_TAG_DISPLAY_CONFIG;
            expect(filterTags(config, ['a', 'b', 'c'], cat, scene)).toEqual(['a', 'b', 'c']);
          });

          it('类别开启 + selectedValues 非空 = 只保留选中的', () => {
            const selectedMap: Record<TagCategory, string[]> = {
              type: ['价值辩'],
              difficulty: ['入门级'],
              source_type: ['官方'],
              custom: ['成长', '环境']
            };
            const config: TagDisplayConfig = {
              scenes: {
                ...DEFAULT_TAG_DISPLAY_CONFIG.scenes,
                [scene]: {
                  categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
                  selectedValues: selectedMap
                }
              }
            };
            const input = ['价值辩', '入门级', '官方', '成长', '其他'];
            const expected = input.filter((v) => selectedMap[cat].includes(v));
            expect(filterTags(config, input, cat, scene)).toEqual(expected);
            // 其他场景不受影响（返回全部）
            SCENE_KEYS.filter((s) => s !== scene).forEach((otherScene) => {
              expect(filterTags(config, input, cat, otherScene)).toEqual(input);
            });
          });

          it('null/undefined/空数组返回空数组', () => {
            const config: TagDisplayConfig = DEFAULT_TAG_DISPLAY_CONFIG;
            expect(filterTags(config, null, cat, scene)).toEqual([]);
            expect(filterTags(config, undefined, cat, scene)).toEqual([]);
            expect(filterTags(config, [], cat, scene)).toEqual([]);
          });
        });
      });
    });
  });
});
