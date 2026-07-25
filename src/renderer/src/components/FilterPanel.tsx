import { Input, Select, Tag, Space, Button, Divider, theme } from 'antd';
import { SearchOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { TopicFilter } from '../../../shared/types';
import { SYSTEM_CANDIDATES } from '../../../shared/constants';
import { cardStyle } from '../styles/shared';
import { spacing } from '../styles/tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { loadTagDisplayConfig } from '../utils/tagDisplay';

// 维度选项：统一引用 SYSTEM_CANDIDATES 单一来源，
// 避免与 import-engine 候选值不一致。
// 保留具名导出以兼容 TopicLibrary.tsx 现有 import。
export const TYPE_OPTIONS = SYSTEM_CANDIDATES.type;
export const DOMAIN_OPTIONS = SYSTEM_CANDIDATES.domain;
export const DIFFICULTY_OPTIONS = SYSTEM_CANDIDATES.difficulty;
export const SOURCE_OPTIONS = SYSTEM_CANDIDATES.source;
export const SOURCE_TYPE_OPTIONS = SYSTEM_CANDIDATES.source_type;
export const STATUS_OPTIONS = ['active', 'favorited', 'blacklisted'];

export interface FilterPanelProps {
  filter: TopicFilter;
  onChange: (filter: Partial<TopicFilter>) => void;
  onReset: () => void;
  /** 标签筛选候选列表（动态从库中拉取） */
  tagOptions?: string[];
  /** 关键词包含列表 */
  includeKeywords?: string[];
  /** 关键词排除列表 */
  excludeKeywords?: string[];
  onIncludeKeywordsChange?: (kws: string[]) => void;
  onExcludeKeywordsChange?: (kws: string[]) => void;
}

/**
 * 按场景配置过滤维度候选
 * - 类别关闭：返回 null（表示该维度整体隐藏）
 * - selectedValues 非空：只保留选中的候选
 * - selectedValues 空：返回原候选
 */
function filterOptions(
  options: readonly string[],
  enabled: boolean,
  selected: string[]
): string[] | null {
  if (!enabled) return null;
  if (selected.length === 0) return [...options];
  return options.filter((o) => selected.includes(o));
}

export default function FilterPanel({
  filter,
  onChange,
  onReset,
  tagOptions = [],
  includeKeywords = [],
  excludeKeywords = [],
  onIncludeKeywordsChange,
  onExcludeKeywordsChange
}: FilterPanelProps) {
  const { token } = theme.useToken();
  const settings = useSettingsStore((s) => s.settings);

  // 根据 filter 场景配置过滤各维度候选
  // 类别关闭 → 该维度整体隐藏（不渲染字段）
  // selectedValues 非空 → 只显示选中的候选
  // selectedValues 空 → 显示全部候选
  const cfg = loadTagDisplayConfig(settings);
  const filterScene = cfg.scenes.filter;
  const typeOpts = filterOptions(TYPE_OPTIONS, filterScene.categoryEnabled.type, filterScene.selectedValues.type);
  const diffOpts = filterOptions(DIFFICULTY_OPTIONS, filterScene.categoryEnabled.difficulty, filterScene.selectedValues.difficulty);
  const sourceTypeOpts = filterOptions(SOURCE_TYPE_OPTIONS, filterScene.categoryEnabled.source_type, filterScene.selectedValues.source_type);
  const visibleTagOptions = filterScene.categoryEnabled.custom
    ? (filterScene.selectedValues.custom.length > 0
        ? tagOptions.filter((t) => filterScene.selectedValues.custom.includes(t))
        : tagOptions)
    : [];

  return (
    <div
      style={{
        ...cardStyle,
        padding: spacing.lg,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* 搜索框 */}
      <Input
        allowClear
        size="middle"
        placeholder="搜索辩题标题关键词"
        prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
        value={filter.keyword ?? ''}
        onChange={(e) => onChange({ keyword: e.target.value || undefined })}
        style={{ marginBottom: spacing.md }}
      />

      {/* 关键词包含/排除 */}
      <div style={{ marginBottom: spacing.md }}>
        <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
          <div>
            <span style={{ fontSize: 12, color: token.colorTextSecondary, marginRight: spacing.sm }}>
              包含关键词：
            </span>
            <Select
              mode="tags"
              size="small"
              style={{ minWidth: 200, maxWidth: '100%' }}
              placeholder="标题必须包含的词"
              value={includeKeywords}
              onChange={(v) => onIncludeKeywordsChange?.(v as string[])}
            />
          </div>
          <div>
            <span style={{ fontSize: 12, color: token.colorTextSecondary, marginRight: spacing.sm }}>
              排除关键词：
            </span>
            <Select
              mode="tags"
              size="small"
              style={{ minWidth: 200, maxWidth: '100%' }}
              placeholder="标题不能包含的词"
              value={excludeKeywords}
              onChange={(v) => onExcludeKeywordsChange?.(v as string[])}
            />
          </div>
        </Space>
      </div>

      {/* 维度筛选（受 filter 场景配置控制：类别关闭则隐藏整个字段） */}
      {(typeOpts || diffOpts || sourceTypeOpts) && (
        <>
          <Divider orientation="left" plain style={{ margin: `${spacing.sm} 0` }}>
            维度筛选
          </Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
            {/* 类型（如果 filter 场景关闭了 type 类别则隐藏） */}
            {typeOpts && (
              <Field label="类型">
                <Select
                  size="small"
                  allowClear
                  mode="multiple"
                  maxTagCount="responsive"
                  placeholder="全部"
                  style={{ width: '100%' }}
                  value={filter.types ?? []}
                  onChange={(v) => onChange({ types: v as string[] | undefined, type: undefined })}
                  options={typeOpts.map((v) => ({ label: v, value: v }))}
                />
              </Field>
            )}
            <Field label="领域">
              <Select
                size="small"
                allowClear
                mode="multiple"
                maxTagCount="responsive"
                placeholder="全部"
                style={{ width: '100%' }}
                value={filter.domains ?? []}
                onChange={(v) => onChange({ domains: v as string[] | undefined, domain: undefined })}
                options={DOMAIN_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Field>
            {/* 难度（如果 filter 场景关闭了 difficulty 类别则隐藏） */}
            {diffOpts && (
              <Field label="难度">
                <Select
                  size="small"
                  allowClear
                  mode="multiple"
                  maxTagCount="responsive"
                  placeholder="全部"
                  style={{ width: '100%' }}
                  value={filter.difficulties ?? []}
                  onChange={(v) => onChange({ difficulties: v as string[] | undefined, difficulty: undefined })}
                  options={diffOpts.map((v) => ({ label: v, value: v }))}
                />
              </Field>
            )}
            <Field label="来源">
              <Select
                size="small"
                allowClear
                placeholder="全部"
                style={{ width: '100%' }}
                value={filter.source}
                onChange={(v) => onChange({ source: v ?? undefined })}
                options={SOURCE_OPTIONS.map((v) => ({ label: v, value: v }))}
              />
            </Field>
            {/* 来源类型（如果 filter 场景关闭了 source_type 类别则隐藏） */}
            {sourceTypeOpts && (
              <Field label="来源类型">
                <Select
                  size="small"
                  allowClear
                  placeholder="全部"
                  style={{ width: '100%' }}
                  value={filter.source_type}
                  onChange={(v) => onChange({ source_type: v ?? undefined })}
                  options={sourceTypeOpts.map((v) => ({ label: v, value: v }))}
                />
              </Field>
            )}
            <Field label="状态">
              <Select
                size="small"
                allowClear
                placeholder="全部"
                style={{ width: '100%' }}
                value={filter.status}
                onChange={(v) => onChange({ status: v ?? undefined })}
                options={STATUS_OPTIONS.map((v) => ({
                  label:
                    v === 'active' ? '正常' : v === 'favorited' ? '收藏' : '黑名单',
                  value: v
                }))}
              />
            </Field>
          </div>
        </>
      )}

      {/* 标签筛选（仅当 filter 场景 custom 类别开启且有可见候选时显示） */}
      {visibleTagOptions.length > 0 && (
        <>
          <Divider orientation="left" plain style={{ margin: `${spacing.sm} 0` }}>
            标签
          </Divider>
          <div>
            <span style={{ fontSize: 12, color: token.colorTextSecondary, marginRight: spacing.sm }}>
              标签：
            </span>
            <Select
              mode="multiple"
              size="small"
              allowClear
              placeholder="选择标签"
              style={{ width: '100%', marginTop: spacing.xs }}
              value={filter.tags}
              onChange={(v) => onChange({ tags: v as string[] | undefined })}
              options={visibleTagOptions.map((t) => ({ label: `#${t}`, value: t }))}
              tagRender={(props) => (
                <Tag
                  closable
                  onClose={props.onClose}
                  style={{ margin: 2 }}
                >
                  {props.label}
                </Tag>
              )}
            />
          </div>
        </>
      )}

      {/* 已选摘要 + 重置 */}
      <Divider style={{ margin: `${spacing.sm} 0` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
          已筛选维度：{countActiveFilters(filter) + includeKeywords.length + excludeKeywords.length} 项
        </span>
        <Button size="middle" type="link" icon={<CloseCircleOutlined />} onClick={onReset}>
          重置
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

function countActiveFilters(f: TopicFilter): number {
  let n = 0;
  if (f.types?.length || f.type) n++;
  if (f.domains?.length || f.domain) n++;
  if (f.difficulties?.length || f.difficulty) n++;
  if (f.source) n++;
  if (f.source_type) n++;
  if (f.status) n++;
  if (f.keyword) n++;
  if (f.tags && f.tags.length > 0) n++;
  return n;
}
