// ============================================================
// MatchupTable.tsx — 对阵表视图（参考复赛对阵表 Excel 截图）
//
// SubTask 7.3：3 列对阵表
// - 标题栏：<轮次名>对阵表 <抽取日期>
// - 3 列：场次 | 正方 | 反方
// - 表头深色背景白字（#1466e0）
// - 行高 ≥80px，垂直居中
// - 右上角打印按钮（window.print）
// - @media print 隐藏工具栏
// - group/multi_team 模式合并为「同题队伍」单列
// ============================================================

import { Button, Tag, Typography, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { DrawSession, DrawSessionItem } from '../../../../shared/types';
import { normalizeStancePair } from '../../../../shared/stance-utils';
import { spacing, fontSize, radius, colorPrimary } from '../../styles/tokens';

/** 中文数字（场次数） */
const CHINESE_NUMERALS = [
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'
];

/** 获取场次中文名 */
function getMatchLabel(idx: number): string {
  return `第${CHINESE_NUMERALS[idx] ?? idx + 1}场`;
}

/** 队伍信息（含可选分组） */
interface TeamInfo {
  name: string;
  group_id?: string | null;
}

export interface MatchupTableProps {
  /** 抽取会话明细项 */
  items: DrawSessionItem[];
  /** 抽取会话（用于 round_id / draw_time） */
  session: DrawSession;
  /** 轮次 id → 轮次名映射 */
  roundsMap?: Map<string, string>;
  /** 队伍 id → 队伍信息映射 */
  teamsMap?: Map<string, TeamInfo>;
  /** 分组 id → 分组名映射 */
  groupsMap?: Map<string, string>;
  /** 辩题 id → 辩题标题映射 */
  topicsMap?: Map<string, string>;
}

export default function MatchupTable({
  items,
  session,
  roundsMap,
  teamsMap,
  groupsMap,
  topicsMap
}: MatchupTableProps) {
  const { token } = theme.useToken();

  // 推断轮次名
  const roundName = (() => {
    if (session.round_id && roundsMap?.has(session.round_id)) {
      return roundsMap.get(session.round_id)!;
    }
    return '抽取';
  })();

  // 抽取日期
  const drawDate = session.draw_time
    ? dayjs(session.draw_time).format('YYYY-MM-DD')
    : '';

  // 标题：轮次名 + 对阵表 + 日期
  const title = `${roundName}对阵表${drawDate ? `  ${drawDate}` : ''}`;

  // 判断是否为 group/multi_team 模式（任一 item 有 team_ids）
  const isGroupMode = items.some((it) => {
    const teamIds = (it as unknown as { team_ids?: unknown }).team_ids;
    return Array.isArray(teamIds) && teamIds.length > 0;
  });

  // 解析队伍名
  const resolveTeamName = (teamId: string | null, fallback?: string | null): string => {
    if (!teamId) return fallback || '-';
    return teamsMap?.get(teamId)?.name ?? fallback ?? '（已删除队伍）';
  };

  // 解析队伍备注（分组/班级）
  const resolveTeamNote = (teamId: string | null): string | null => {
    if (!teamId) return null;
    const team = teamsMap?.get(teamId);
    if (!team?.group_id) return null;
    return groupsMap?.get(team.group_id) ?? null;
  };

  // 解析辩题标题
  const resolveTopicTitle = (item: DrawSessionItem): string => {
    if (item.topic_id && topicsMap?.has(item.topic_id)) {
      return topicsMap.get(item.topic_id)!;
    }
    return item.topic_title ?? '（已删除辩题）';
  };

  // 解析同题队伍列表（group 模式）
  const resolveTeamIds = (item: DrawSessionItem): string[] => {
    const teamIds = (item as unknown as { team_ids?: string[] }).team_ids;
    return Array.isArray(teamIds) ? teamIds : [];
  };

  // 表头背景色（深色背景白字）
  const headerBg = colorPrimary;
  const headerColor = '#ffffff';

  // 单元格样式
  const cellStyle: React.CSSProperties = {
    padding: `${spacing.md} ${spacing.lg}`,
    verticalAlign: 'middle',
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
    height: 80
  };

  return (
    <div className="matchup-print-target" style={{ width: '100%' }}>
      {/* 标题栏 + 打印按钮 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.md
        }}
      >
        <Typography.Title level={4} style={{ margin: 0, fontWeight: 700 }}>
          {title}
        </Typography.Title>
        <Button
          icon={<PrinterOutlined />}
          onClick={() => window.print()}
          className="matchup-no-print"
        >
          打印
        </Button>
      </div>

      {/* 对阵表格 */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          borderRadius: radius.lg,
          overflow: 'hidden',
          border: `1px solid ${token.colorBorderSecondary}`,
          tableLayout: 'fixed'
        }}
      >
        <colgroup>
          {isGroupMode ? (
            <>
              <col style={{ width: '40%' }} />
              <col style={{ width: '60%' }} />
            </>
          ) : (
            <>
              <col style={{ width: '34%' }} />
              <col style={{ width: '33%' }} />
              <col style={{ width: '33%' }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            <th
              style={{
                background: headerBg,
                color: headerColor,
                padding: `${spacing.md} ${spacing.lg}`,
                fontSize: fontSize.h4,
                fontWeight: 600,
                textAlign: 'center',
                borderRight: '1px solid rgba(255,255,255,0.2)'
              }}
            >
              场次
            </th>
            {isGroupMode ? (
              <th
                style={{
                  background: headerBg,
                  color: headerColor,
                  padding: `${spacing.md} ${spacing.lg}`,
                  fontSize: fontSize.h4,
                  fontWeight: 600,
                  textAlign: 'center'
                }}
              >
                同题队伍
              </th>
            ) : (
              <>
                <th
                  style={{
                    background: headerBg,
                    color: headerColor,
                    padding: `${spacing.md} ${spacing.lg}`,
                    fontSize: fontSize.h4,
                    fontWeight: 600,
                    textAlign: 'center',
                    borderRight: '1px solid rgba(255,255,255,0.2)'
                  }}
                >
                  正方
                </th>
                <th
                  style={{
                    background: headerBg,
                    color: headerColor,
                    padding: `${spacing.md} ${spacing.lg}`,
                    fontSize: fontSize.h4,
                    fontWeight: 600,
                    textAlign: 'center'
                  }}
                >
                  反方
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const matchLabel = getMatchLabel(idx);
            const topicTitle = resolveTopicTitle(item);

            if (isGroupMode) {
              // group/multi_team 模式：单列「同题队伍」 + 持方 Tag
              const teamIds = resolveTeamIds(item);
              const stances = item.team_stances;
              const teamNames = item.team_names;
              return (
                <tr key={item.id}>
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 600, fontSize: fontSize.h4, marginBottom: spacing.xs }}>
                      {matchLabel}
                    </div>
                    <div
                      style={{
                        fontSize: fontSize.caption,
                        color: token.colorTextSecondary,
                        fontStyle: 'italic',
                        lineHeight: 1.5
                      }}
                    >
                      {topicTitle}
                    </div>
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
                      {teamIds.map((tid, i) => {
                        // 优先使用 team_names 快照，fallback 到 teamsMap 关联查询
                        const name = teamNames?.[i] ?? resolveTeamName(tid);
                        const note = resolveTeamNote(tid);
                        // team_stances 与 team_ids 一一对应；循环赛为空字符串 → 不显示
                        const stance = stances?.[i];
                        return (
                          <div key={tid} style={{ display: 'flex', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{name}</span>
                            {stance && (
                              <Tag
                                color={stance === '正方' ? 'gold' : 'silver'}
                                style={{ marginBottom: 0 }}
                              >
                                {stance}
                              </Tag>
                            )}
                            {note && (
                              <span style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>
                                （{note}）
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {teamIds.length === 0 && (
                        <span style={{ color: token.colorTextSecondary }}>-</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }

            // 标准对战模式：正方 | 反方
            const teamAName = resolveTeamName(item.team_a_id, item.team_a_name);
            const teamBName = resolveTeamName(item.team_b_id, item.team_b_name);
            const teamANote = resolveTeamNote(item.team_a_id);
            const teamBNote = resolveTeamNote(item.team_b_id);

            // Task 11：渲染层防御性持方修正（不修改原 item.stance_a / stance_b）
            const [normA, normB] = normalizeStancePair(item.stance_a ?? null, item.stance_b ?? null);
            // 根据持方决定正方列/反方列显示哪个队伍
            // normA='正方' → 正方列=teamA，反方列=teamB（原逻辑）
            // normA='反方' → 正方列=teamB，反方列=teamA
            // normA=null → fallback 原逻辑
            const aIsPro = normA === '正方' || (normA == null && normB == null);
            const proSideName = aIsPro ? teamAName : teamBName;
            const conSideName = aIsPro ? teamBName : teamAName;
            const proSideNote = aIsPro ? teamANote : teamBNote;
            const conSideNote = aIsPro ? teamBNote : teamANote;

            return (
              <tr key={item.id}>
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600, fontSize: fontSize.h4, marginBottom: spacing.xs }}>
                    {matchLabel}
                  </div>
                  <div
                    style={{
                      fontSize: fontSize.caption,
                      color: token.colorTextSecondary,
                      fontStyle: 'italic',
                      lineHeight: 1.5
                    }}
                  >
                    {topicTitle}
                  </div>
                </td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${token.colorBorderSecondary}` }}>
                  <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{proSideName}</div>
                  {proSideNote && (
                    <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary, marginTop: spacing.xs }}>
                      （{proSideNote}）
                    </div>
                  )}
                </td>
                <td style={{ ...cellStyle, borderLeft: `1px solid ${token.colorBorderSecondary}` }}>
                  <div style={{ fontWeight: 600, fontSize: fontSize.h4 }}>{conSideName}</div>
                  {conSideNote && (
                    <div style={{ fontSize: fontSize.caption, color: token.colorTextSecondary, marginTop: spacing.xs }}>
                      （{conSideNote}）
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
