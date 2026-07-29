import { Card, Tag, Space, Typography, theme } from 'antd';
import type { Topic, DrawSessionItem, Team } from '../../../../shared/types';
import { normalizeStances } from '../../../../shared/stance-utils';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../../utils/tagDisplay';
import DimensionTag from '../common/DimensionTag';
import { fontSize, radius, colorGold } from '../../styles/tokens';

const DIFFICULTY_COLOR: Record<string, string> = {
  入门级: 'green',
  进阶级: 'orange',
  专业级: 'red'
};

/**
 * SubTask 18.3：难度色点映射
 * 根据辩题 difficulty 字段返回彩色圆点颜色（简单→绿 / 中等→金 / 困难→红）
 * 兼容多种常见取值（简单/入门级/easy、中等/进阶级/medium、困难/专业级/hard）。
 */
const DIFFICULTY_DOT_COLOR: Record<string, string> = {
  // 简单
  简单: '#52c41a',
  入门级: '#52c41a',
  初级: '#52c41a',
  基础: '#52c41a',
  easy: '#52c41a',
  // 中等
  中等: '#faad14',
  进阶级: '#faad14',
  中级: '#faad14',
  medium: '#faad14',
  // 困难
  困难: '#ff4d4f',
  专业级: '#ff4d4f',
  高级: '#ff4d4f',
  专家: '#ff4d4f',
  hard: '#ff4d4f'
};

/** 取难度色点颜色，未知难度回退到中性灰 */
function getDifficultyDotColor(difficulty: string | null | undefined): string | null {
  if (!difficulty) return null;
  // 精确匹配
  if (DIFFICULTY_DOT_COLOR[difficulty]) return DIFFICULTY_DOT_COLOR[difficulty];
  // 模糊匹配（包含关键词）
  const lower = difficulty.toLowerCase();
  if (lower.includes('简') || lower.includes('入门') || lower.includes('easy') || lower.includes('初') || lower.includes('基础')) {
    return '#52c41a';
  }
  if (lower.includes('中') || lower.includes('进阶') || lower.includes('medium')) {
    return '#faad14';
  }
  if (lower.includes('难') || lower.includes('专业') || lower.includes('hard') || lower.includes('高') || lower.includes('专家')) {
    return '#ff4d4f';
  }
  return null;
}

export interface DrawResultCardProps {
  index: number;
  topic: Topic;
  item: DrawSessionItem;
  teams: Team[];
}

export default function DrawResultCard({ index, topic, item, teams }: DrawResultCardProps) {
  const { token } = theme.useToken();
  const settings = useSettingsStore((s) => s.settings);
  const teamA = teams.find((t) => t.id === item.team_a_id);
  const teamB = teams.find((t) => t.id === item.team_b_id);

  // group/multi_team 模式：解析 team_ids
  const teamIds = Array.isArray(item.team_ids) ? item.team_ids : [];
  const isGroupMode = teamIds.length > 0;

  // 难度色点颜色（SubTask 18.3）
  const dotColor = getDifficultyDotColor(topic.difficulty);
  // 编号水印：01/02/03/04（SubTask 18.3）
  const watermarkNumber = String(index + 1).padStart(2, '0');

  return (
    <Card
      size="small"
      className="card-hover"
      style={{
        borderColor: token.colorPrimary,
        borderWidth: 1,
        background: token.colorBgContainer,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* SubTask 7.4：金色色条左侧装饰 */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: colorGold,
          zIndex: 1
        }}
      />
      {/* SubTask 18.3：大号编号水印，绝对定位在卡片右上角 */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -8,
          right: 12,
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1,
          color: token.colorPrimary,
          opacity: 0.08,
          pointerEvents: 'none',
          userSelect: 'none',
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '-2px'
        }}
      >
        {watermarkNumber}
      </span>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 序号 + 难度色点 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: token.colorPrimary,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: fontSize.h4
            }}
          >
            {index + 1}
          </div>
          {dotColor && (
            <span
              title={topic.difficulty ?? ''}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: dotColor,
                boxShadow: `0 0 0 2px ${token.colorBgContainer}`,
                display: 'inline-block'
              }}
            />
          )}
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            {topic.title}
          </Typography.Title>
          <Space size={4} wrap style={{ marginBottom: item.team_a_id || isGroupMode ? 12 : 0 }}>
            {(() => {
              const cfg = loadTagDisplayConfig(settings);
              const typeTag = filterTag(cfg, topic.type, 'type', 'drawResult');
              const diffTag = filterTag(cfg, topic.difficulty, 'difficulty', 'drawResult');
              const sourceTag = filterTag(cfg, topic.source_type, 'source_type', 'drawResult');
              const customTags = filterTags(cfg, topic.tags, 'custom', 'drawResult');
              return (
                <>
                  {/* SubTask 18.3：type / domain 维度使用 DimensionTag */}
                  {typeTag && <DimensionTag dimension="type">{typeTag}</DimensionTag>}
                  {topic.domain && <DimensionTag dimension="domain">{topic.domain}</DimensionTag>}
                  {diffTag && (
                    <Tag color={DIFFICULTY_COLOR[diffTag] ?? 'default'}>{diffTag}</Tag>
                  )}
                  {sourceTag && <Tag>{sourceTag}</Tag>}
                  {customTags.map((t) => (
                    <Tag key={t}>#{t}</Tag>
                  ))}
                </>
              );
            })()}
          </Space>

          {/* group/multi_team 模式：两两配对 VS 布局 */}
          {isGroupMode && (
            <div
              style={{
                padding: '8px 12px',
                background: token.colorBgLayout,
                borderRadius: radius.md
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <Tag color="purple">{teamIds.length} 队同题</Tag>
              </div>
              {(() => {
                if (teamIds.length === 0) {
                  return (
                    <span style={{ color: token.colorTextSecondary, fontSize: fontSize.caption }}>
                      （队伍已删除）
                    </span>
                  );
                }
                // 循环赛检测：team_stances 全为空字符串
                const stances = item.team_stances ?? [];
                const isRoundRobin = stances.length > 0 && stances.every((s) => !s);
                // 循环赛：只显示队伍名列表
                if (isRoundRobin) {
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {teamIds.map((tid, i) => {
                        const teamName =
                          item.team_names?.[i] ??
                          teams.find((t) => t.id === tid)?.name ??
                          '（已删除队伍）';
                        return (
                          <Tag key={tid} color="blue" style={{ marginBottom: 0 }}>{teamName}</Tag>
                        );
                      })}
                    </div>
                  );
                }
                // 非循环赛：两两配对 VS 布局
                // Task 10：渲染层防御性持方修正（不修改原 item.team_stances）
                const normalizedStances = normalizeStances(stances);
                const pairs: Array<{ left: { id: string; name: string; stance?: string }; right: { id: string; name: string; stance?: string } | null }> = [];
                for (let i = 0; i < teamIds.length; i += 2) {
                  const leftId = teamIds[i];
                  const leftName = item.team_names?.[i] ?? teams.find((t) => t.id === leftId)?.name ?? '（已删除队伍）';
                  const leftStance = normalizedStances[i];
                  const left = { id: leftId, name: leftName, stance: leftStance };
                  let right: { id: string; name: string; stance?: string } | null = null;
                  if (i + 1 < teamIds.length) {
                    const rightId = teamIds[i + 1];
                    const rightName = item.team_names?.[i + 1] ?? teams.find((t) => t.id === rightId)?.name ?? '（已删除队伍）';
                    const rightStance = normalizedStances[i + 1];
                    right = { id: rightId, name: rightName, stance: rightStance };
                  }
                  pairs.push({ left, right });
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pairs.map((pair, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '6px 8px',
                          background: token.colorBgContainer,
                          borderRadius: radius.sm
                        }}
                      >
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          {pair.left.stance && (
                            <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>{pair.left.stance}</div>
                          )}
                          <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{pair.left.name}</div>
                        </div>
                        {pair.right ? (
                          <>
                            <Typography.Text strong style={{ color: token.colorError, fontSize: fontSize.h4 }}>
                              VS
                            </Typography.Text>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                              {pair.right.stance && (
                                <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>{pair.right.stance}</div>
                              )}
                              <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{pair.right.name}</div>
                            </div>
                          </>
                        ) : (
                          <Tag style={{ marginLeft: 8 }}>轮空</Tag>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* 持方对阵
           * - 对战模式（team_a_id + team_b_id 均非空）：渲染双方 VS
           * - 单人模式（team_b_id 为 null）：只渲染一方持方 + 队伍名，不渲染 VS 与 B 方
           */}
          {!isGroupMode && item.team_a_id && teamA && teamB && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '8px 12px',
                background: token.colorBgLayout,
                borderRadius: radius.md
              }}
            >
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>{item.stance_a}</div>
                <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{teamA.name}</div>
              </div>
              <Typography.Text strong style={{ color: token.colorError, fontSize: fontSize.h3 }}>
                VS
              </Typography.Text>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>{item.stance_b}</div>
                <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{teamB.name}</div>
              </div>
            </div>
          )}
          {/* 单人模式：team_b_id 为 null 时只渲染一方持方 + 队伍名 */}
          {!isGroupMode && item.team_a_id && teamA && !teamB && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '8px 12px',
                background: token.colorBgLayout,
                borderRadius: radius.md
              }}
            >
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>{item.stance_a}</div>
                <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{teamA.name}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
