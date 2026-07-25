import { describe, it, expect } from 'vitest';
import type { TagDisplayConfig } from '../../../../shared/types';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../tagDisplay';

describe('tagDisplay utils', () => {
  describe('DEFAULT_TAG_DISPLAY_CONFIG', () => {
    it('默认开启显示', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.enabled).toBe(true);
    });

    it('默认 selectedTags 为空数组（显示全部）', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedTags).toEqual([]);
    });
  });

  describe('loadTagDisplayConfig', () => {
    it('无配置时返回默认', () => {
      expect(loadTagDisplayConfig({})).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('字符串配置正确解析', () => {
      const settings = {
        'ui.tagDisplay': JSON.stringify({ enabled: false, selectedTags: ['价值辩'] })
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(false);
      expect(cfg.selectedTags).toEqual(['价值辩']);
    });

    it('对象配置直接合并', () => {
      const settings = {
        'ui.tagDisplay': { enabled: true, selectedTags: ['入门级'] }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual(['入门级']);
    });

    it('损坏的 JSON 返回默认', () => {
      const settings = { 'ui.tagDisplay': '{not valid json' };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('向后兼容旧格式（categoryEnabled + hiddenValues + bigScreenOverrides）转换为默认', () => {
      const oldConfig = {
        categoryEnabled: { type: true, difficulty: true, source: true, customTags: true },
        hiddenValues: { type: [], difficulty: [], source: [], customTags: [] },
        bigScreenOverrides: { categoryEnabled: { type: false, difficulty: false, source: false, customTags: false } }
      };
      const settings = { 'ui.tagDisplay': oldConfig };
      const cfg = loadTagDisplayConfig(settings);
      // 旧格式无 enabled 字段，保守转为默认（显示全部）
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual([]);
    });

    it('部分字段缺失时合并默认值', () => {
      const settings = { 'ui.tagDisplay': { enabled: true } };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual([]);
    });
  });

  describe('filterTag', () => {
    it('enabled=false 返回 null', () => {
      const config: TagDisplayConfig = { enabled: false, selectedTags: [] };
      expect(filterTag(config, '价值辩')).toBe(null);
    });

    it('enabled=true + selectedTags 空 = 显示全部（返回原值）', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTag(config, '价值辩')).toBe('价值辩');
      expect(filterTag(config, '入门级')).toBe('入门级');
    });

    it('enabled=true + selectedTags 非空 = 只显示选中的', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: ['价值辩', '入门级'] };
      expect(filterTag(config, '价值辩')).toBe('价值辩');
      expect(filterTag(config, '入门级')).toBe('入门级');
      expect(filterTag(config, '事实辩')).toBe(null);
    });

    it('空值返回 null', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTag(config, '')).toBe(null);
      expect(filterTag(config, null)).toBe(null);
      expect(filterTag(config, undefined)).toBe(null);
    });
  });

  describe('filterTags', () => {
    it('enabled=false 返回空数组', () => {
      const config: TagDisplayConfig = { enabled: false, selectedTags: [] };
      expect(filterTags(config, ['成长', '环境'])).toEqual([]);
    });

    it('enabled=true + selectedTags 空 = 返回全部', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, ['成长', '环境'])).toEqual(['成长', '环境']);
    });

    it('enabled=true + selectedTags 非空 = 只保留选中的', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: ['成长', '入门级'] };
      expect(filterTags(config, ['成长', '996', '环境', '入门级'])).toEqual(['成长', '入门级']);
    });

    it('null/undefined 返回空数组', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, null)).toEqual([]);
      expect(filterTags(config, undefined)).toEqual([]);
    });

    it('空数组返回空数组', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, [])).toEqual([]);
    });
  });
});
