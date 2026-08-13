// ============================================================
// SchedulePreviewModal.tsx — 赛程预览弹窗（AI Agent v1.3.0 Week 8 Task 49.4）
//
// 职责：
// 1. 由 agentStore.pendingSchedulePreview 驱动显隐
// 2. 按轮次展示赛程（每轮一个 Card，含轮次名 + 比赛列表）
// 3. 每场比赛显示：主队 vs 客队 + 日期
// 4. TBD 队伍（ID 以 "TBD" 开头）显示为「待定」
// 5. bye（homeTeamId/awayTeamId 为 null）显示为「轮空」
// 6. 关闭时调用 clearPendingSchedulePreview 清空状态
//
// 依赖：
// - antd Modal / Card / Typography / Tag / Empty / Space / theme
// - @ant-design/icons CalendarOutlined / TrophyOutlined
// - useAgentStore：pendingSchedulePreview + clearPendingSchedulePreview
// - useEventStore：根据 teamId 查询队伍名称（可选，找不到则显示 ID）
// - ScheduleRound / ScheduleMatch 类型来自 shared/agent-types
//
// 设计要点：
// - Modal 宽度 720px，maxHeight 70vh，内容区可滚动
// - 每轮 Card 标题：🏆 第 N 轮（含比赛场数 Tag）
// - 每场比赛一行：主队 [vs] 客队 · 日期
// - TBD/轮空 用 Tag 区分颜色（TBD=橙色 processing，轮空=灰色 default）
// ============================================================

import React from 'react'
import { Modal, Card, Typography, Tag, Empty, Space, theme } from 'antd'
import { CalendarOutlined, TrophyOutlined } from '@ant-design/icons'
import { useAgentStore } from '../../stores/agentStore'
import { useEventStore } from '../../stores/eventStore'
import type { ScheduleRound, ScheduleMatch } from '../../../../shared/agent-types'

const { Text } = Typography

/**
 * 判断 teamId 是否为 TBD（待定）占位。
 * schedule-engine 用 `TBD-W{r}-{m}` / `TBD-L{r}-{m}-H` 等前缀表示后续轮次的占位队伍。
 */
function isTBD(teamId: string | null): boolean {
  return teamId !== null && teamId.startsWith('TBD')
}

/**
 * 渲染单个队伍标签。
 * - null → 灰色「轮空」Tag
 * - TBD 前缀 → 橙色「待定」Tag
 * - 其他 → 查询 eventStore.teams 获取名称，找不到则显示 ID
 */
function renderTeamTag(
  teamId: string | null,
  teamNameMap: Map<string, string>,
  token: ReturnType<typeof theme.useToken>['token']
): React.ReactNode {
  if (teamId === null) {
    return (
      <Tag color="default" style={{ margin: 0 }}>
        轮空
      </Tag>
    )
  }
  if (isTBD(teamId)) {
    return (
      <Tag color="processing" style={{ margin: 0 }}>
        待定
      </Tag>
    )
  }
  const name = teamNameMap.get(teamId)
  return (
    <Text style={{ fontSize: 13, color: token.colorText }}>
      {name ?? teamId}
    </Text>
  )
}

/** 单轮赛程卡片 */
function RoundCard({
  round,
  teamNameMap
}: {
  round: ScheduleRound
  teamNameMap: Map<string, string>
}): JSX.Element {
  const { token } = theme.useToken()
  return (
    <Card
      size="small"
      style={{
        borderColor: token.colorBorderSecondary,
        marginBottom: 12
      }}
      styles={{ body: { padding: '8px 12px' } }}
      title={
        <Space size={6}>
          <TrophyOutlined style={{ color: token.colorPrimary }} />
          <Text strong>第 {round.roundIndex} 轮</Text>
          <Tag color="blue" style={{ marginInlineStart: 4 }}>
            {round.matches.length} 场
          </Tag>
        </Space>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {round.matches.map((match: ScheduleMatch) => (
          <div
            key={match.matchIndex}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              borderBottom: `1px dashed ${token.colorBorderSecondary}`
            }}
          >
            <Text type="secondary" style={{ fontSize: 12, minWidth: 32 }}>
              #{match.matchIndex}
            </Text>
            {renderTeamTag(match.homeTeamId, teamNameMap, token)}
            <Text type="secondary" style={{ fontSize: 12 }}>
              vs
            </Text>
            {renderTeamTag(match.awayTeamId, teamNameMap, token)}
            <Space
              size={4}
              style={{ marginLeft: 'auto', color: token.colorTextSecondary, fontSize: 12 }}
            >
              <CalendarOutlined />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {match.date}
              </Text>
            </Space>
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * SchedulePreviewModal — 赛程预览弹窗
 *
 * 由 agentStore.pendingSchedulePreview 驱动显隐。
 * 当 pendingSchedulePreview 非 null 时显示，关闭时调用 clearPendingSchedulePreview。
 */
export function SchedulePreviewModal(): JSX.Element {
  const { token } = theme.useToken()
  const pendingSchedulePreview = useAgentStore((s) => s.pendingSchedulePreview)
  const clearPendingSchedulePreview = useAgentStore((s) => s.clearPendingSchedulePreview)
  const teams = useEventStore((s) => s.teams)

  // 构建 teamId → teamName 映射（用于显示队伍名称而非 ID）
  const teamNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const t of teams) {
      map.set(t.id, t.name)
    }
    return map
  }, [teams])

  const open = pendingSchedulePreview !== null && pendingSchedulePreview.length > 0

  return (
    <Modal
      title={
        <Space size={6}>
          <CalendarOutlined style={{ color: token.colorPrimary }} />
          <span>赛程预览</span>
          {open && (
            <Tag color="blue" style={{ marginInlineStart: 4 }}>
              {pendingSchedulePreview!.length} 轮
            </Tag>
          )}
        </Space>
      }
      open={open}
      onCancel={clearPendingSchedulePreview}
      footer={null}
      width={720}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      {open ? (
        pendingSchedulePreview!.map((round) => (
          <RoundCard
            key={`round-${round.roundIndex}`}
            round={round}
            teamNameMap={teamNameMap}
          />
        ))
      ) : (
        <Empty description="暂无赛程数据" />
      )}
    </Modal>
  )
}
