import { describe, it, expect } from 'vitest'
import {
  workspaceImportTarget,
  candidatesForBankImport,
  moveOutCandidates
} from '../topicBankWorkspace'

describe('workspaceImportTarget（导入方向组装）', () => {
  it('把另一题库复制/移动到本库时，目标固定为当前工作区题库', () => {
    expect(workspaceImportTarget('cur-group')).toEqual(['cur-group'])
  })

  it('工作区题库 id 为空时返回空目标（不执行）', () => {
    expect(workspaceImportTarget('')).toEqual([])
    expect(workspaceImportTarget(undefined as never)).toEqual([])
  })
})

describe('candidatesForBankImport（从全局题库导入候选）', () => {
  it('剔除已是本库成员的题', () => {
    const all = [{ id: '1' }, { id: '2' }, { id: '3' }]
    expect(candidatesForBankImport(all, ['1', '3'])).toEqual([{ id: '2' }])
  })

  it('空成员集合时原样返回全部', () => {
    const all = [{ id: '1' }, { id: '2' }]
    expect(candidatesForBankImport(all, [])).toEqual([{ id: '1' }, { id: '2' }])
  })
})

describe('moveOutCandidates（移出目标筛选）', () => {
  it('排除本库自身作为移动目标', () => {
    const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(moveOutCandidates(groups, 'a')).toEqual(['b', 'c'])
  })

  it('仅当前一个题库时无可移动目标', () => {
    expect(moveOutCandidates([{ id: 'a' }], 'a')).toEqual([])
  })

  it('无工作区上下文时返回全部题库', () => {
    const groups = [{ id: 'a' }, { id: 'b' }]
    expect(moveOutCandidates(groups, '')).toEqual(['a', 'b'])
  })
})