import { describe, it, expect } from 'vitest';
import {
  buildGroupMemberMaps,
  groupMemberIdSet,
  topicsToCopy,
  planMoveTopics
} from '../topicGroupFileOps';
import type { TopicGroup, GroupTopic } from '../../../../shared/types';

const DEF: TopicGroup = { id: 'default', name: '默认题库', isDefault: true, createdAt: null };
const G1: TopicGroup = { id: 'g1', name: '备赛题库', isDefault: false, createdAt: null };
const G2: TopicGroup = { id: 'g2', name: '储备题库', isDefault: false, createdAt: null };

function gt(id: string): GroupTopic {
  return {
    id,
    title: `题-${id}`,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: null,
    tags: null,
    status: 'active',
    created_at: ''
  };
}

describe('buildGroupMemberMaps：组成员 → 徽标映射', () => {
  it('按成员构造 groupId→topicIds 与 topicId→题库名', () => {
    const membersByGroup: Record<string, GroupTopic[]> = {
      default: [gt('t1'), gt('t2')],
      g1: [gt('t2'), gt('t3')],
      g2: []
    };
    const { memberTopicIdsByGroup, topicToGroupNameMap } = buildGroupMemberMaps(
      [DEF, G1, G2],
      membersByGroup
    );

    expect(memberTopicIdsByGroup.default).toEqual(['t1', 't2']);
    expect(memberTopicIdsByGroup.g1).toEqual(['t2', 't3']);
    expect(memberTopicIdsByGroup.g2).toEqual([]);

    // 一道题可属多个题库（徽标为多值）
    expect(topicToGroupNameMap.t1).toEqual(['默认题库']);
    expect(topicToGroupNameMap.t2.sort()).toEqual(['备赛题库', '默认题库']);
    expect(topicToGroupNameMap.t3).toEqual(['备赛题库']);
  });

  it('未出现在任何组的题不在徽标映射中', () => {
    const { topicToGroupNameMap } = buildGroupMemberMaps([DEF], { default: [gt('t1')] });
    expect(topicToGroupNameMap.t9).toBeUndefined();
  });
});

describe('groupMemberIdSet：筛选某库成员', () => {
  it('返回某题库成员 id 集，空组返回空集', () => {
    const membersByGroup: Record<string, GroupTopic[]> = {
      g1: [gt('a'), gt('b')],
      g2: []
    };
    const set = groupMemberIdSet(membersByGroup, 'g1');
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(false);
    expect(groupMemberIdSet(membersByGroup, 'g2').size).toBe(0);
    expect(groupMemberIdSet(membersByGroup, 'missing').size).toBe(0);
  });
});

describe('若干题复制/移动的目标/源去重', () => {
  it('topicsToCopy 过滤掉目标题库中已存在的题', () => {
    const existing = new Set(['t2', 't3']);
    expect(topicsToCopy(['t1', 't2', 't3', 't4'], existing)).toEqual(['t1', 't4']);
  });

  it('planMoveTopics 目标去重（toAdd）+ 源去重（toRemove）', () => {
    const existingInTarget = new Set(['t2']);
    const existingInSource = new Set(['t1', 't2', 't3']);
    const { toAdd, toRemove } = planMoveTopics(
      ['t1', 't2', 't3', 't9'],
      existingInTarget,
      existingInSource
    );
    // 目标已有 t2，故不加；t9 不参与（不在源也不在目标逻辑）——按设计仍尝试加入
    expect(toAdd).toEqual(['t1', 't3', 't9']);
    // 只移除真实存在于源中的题（t9 不在源，不移除）
    expect(toRemove).toEqual(['t1', 't2', 't3']);
  });

  it('全已在目标 / 全不在源 时得到空数组', () => {
    expect(topicsToCopy(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
    const p = planMoveTopics(['x'], new Set(), new Set());
    expect(p.toAdd).toEqual(['x']);
    expect(p.toRemove).toEqual([]);
  });
});