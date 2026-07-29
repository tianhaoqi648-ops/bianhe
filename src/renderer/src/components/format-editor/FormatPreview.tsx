// ============================================================
// FormatPreview.tsx — 赛制实时预览（mini TimerDisplay，辨之竹左侧）
//
// 显示当前选中环节的模拟计时器外观：
// - 双队对阵布局（正方 vs 反方）
// - 当前环节名 + 模拟倒计时
// - 用户点击环节卡片时，预览切换到该环节
// ============================================================

import { Typography, Tag } from 'antd'
import type {
  DebateFormatData,
  StageDef,
  StageSide,
  TimerTheme
} from '../../../../shared/debate-formats/types'
import { formatTime } from '../../utils/timer-bells'
import { spacing, fontSize, radius } from '../../styles/tokens'

const { Text, Title } = Typography

const SIDE_LABELS: Record<StageSide, string> = {
  aff: '正方', neg: '反方', both: '双方',
  og: '上院政府', oo: '上院反对', cg: '下院政府', co: '下院反对'
}

interface FormatPreviewProps {
  format: DebateFormatData
  currentStageIndex: number
  theme?: TimerTheme | null
}

export default function FormatPreview({ format, currentStageIndex, theme }: FormatPreviewProps) {
  const stage: StageDef | undefined = format.stages[currentStageIndex]
  const t = theme ?? {
    affColor: '#1677ff',
    negColor: '#ff4d4f',
    affLabel: '正方',
    negLabel: '反方',
    accentColor: '#faad14'
  }

  if (!stage) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
        <Text type="secondary">请在右侧添加环节</Text>
      </div>
    )
  }

  const isAff = ['aff', 'og', 'cg'].includes(stage.side)
  const isNeg = ['neg', 'oo', 'co'].includes(stage.side)
  const isBoth = stage.side === 'both'

  return (
    <div
      style={{
        background: '#000',
        color: '#fff',
        borderRadius: radius.lg,
        padding: spacing.xxl,
        minHeight: 400,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 双队对阵 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          marginBottom: 24
        }}
      >
        <div style={{ opacity: isNeg && !isAff ? 0.3 : 1, textAlign: 'center' }}>
          <div style={{ fontSize: fontSize.h3, fontWeight: 700, color: t.affColor }}>{t.affLabel}</div>
        </div>
        <div style={{ fontSize: fontSize.h4, color: '#666' }}>VS</div>
        <div style={{ opacity: isAff && !isNeg ? 0.3 : 1, textAlign: 'center' }}>
          <div style={{ fontSize: fontSize.h3, fontWeight: 700, color: t.negColor }}>{t.negLabel}</div>
        </div>
      </div>

      {/* 当前环节 */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <Text style={{ color: '#999', fontSize: fontSize.caption }}>第 {currentStageIndex + 1} 环节</Text>
        <Title level={4} style={{ color: t.accentColor, margin: '4px 0' }}>
          {stage.name}
        </Title>
        <Tag color={isBoth ? 'purple' : isAff ? 'blue' : 'red'}>{SIDE_LABELS[stage.side]}</Tag>
      </div>

      {/* 模拟倒计时 */}
      <div
        style={{
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          style={{
            fontSize: '72px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: '#fff',
            lineHeight: 1,
            fontFamily: 'monospace'
          }}
        >
          {formatTime(stage.durationMs)}
        </div>
      </div>

      {/* 铃响点提示 */}
      {stage.bells.length > 0 && (
        <div style={{ textAlign: 'center', color: '#666', fontSize: fontSize.caption }}>
          铃响点：{stage.bells.map((b) => `${b.atMs / 1000}s`).join(' / ')}
        </div>
      )}
    </div>
  )
}
