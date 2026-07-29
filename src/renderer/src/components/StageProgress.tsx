// ============================================================
// StageProgress.tsx — 环节进度条
// ============================================================

import { Steps } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { DebateFormatData } from '../../../shared/types'

interface StageProgressProps {
  format: DebateFormatData
  currentIndex: number
  status: 'idle' | 'running' | 'paused' | 'finished'
}

export default function StageProgress({ format, currentIndex, status }: StageProgressProps) {
  return (
    <Steps
      size="small"
      current={currentIndex}
      status={status === 'finished' ? 'finish' : status === 'running' ? 'process' : 'wait'}
      items={format.stages.map((stage, idx) => ({
        title: stage.name,
        description: `${Math.floor(stage.durationMs / 60000)}分${Math.floor((stage.durationMs % 60000) / 1000)}秒`,
        icon: idx < currentIndex ? <CheckCircleOutlined /> : idx === currentIndex ? <ClockCircleOutlined /> : undefined
      }))}
    />
  )
}
