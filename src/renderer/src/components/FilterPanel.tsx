import { Input, Select, Tag, Space, Button, Divider, theme } from 'antd';
import { SearchOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { TopicFilter } from '../../../shared/types';
import { cardStyle } from '../styles/shared';
import { spacing } from '../styles/tokens';

// 维度选项（与设计文档 4.1 节字段对齐）
export const TYPE_OPTIONS = ['价值辩', '政策辩', '事实辩', '哲理辩', '娱乐辩'];
export const DOMAIN_OPTIONS = [
  '社会热点',
  '科技伦理',
  '教育文化',
  '法律政策',
  '经济商业',
  '环保公益',
  '情感人际'
];
export const DIFFICULTY_OPTIONS = ['入门级', '进阶级', '专业级'];
export const SOURCE_OPTIONS = ['新国辩', '华语辩论世界杯', '老友赛', '世锦赛', '年度原创'];
export const SOURCE_TYPE_OPTIONS = ['官方', '自定义'];
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

      <Divider orientation="left" plain style={{ margin: `${spacing.sm} 0` }}>
        维度筛选
      </Divider>

      {/* 维度筛选 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
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
            options={TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
          />
        </Field>
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
            options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
          />
        </Field>
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
        <Field label="来源类型">
          <Select
            size="small"
            allowClear
            placeholder="全部"
            style={{ width: '100%' }}
            value={filter.source_type}
            onChange={(v) => onChange({ source_type: v ?? undefined })}
            options={SOURCE_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
          />
        </Field>
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

      {/* 标签筛选 */}
      {tagOptions.length > 0 && (
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
              options={tagOptions.map((t) => ({ label: `#${t}`, value: t }))}
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
