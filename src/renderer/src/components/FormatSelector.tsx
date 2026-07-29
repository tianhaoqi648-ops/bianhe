// ============================================================
// FormatSelector.tsx — 赛制选择器
// ============================================================

import { Select, Tag, Space, Typography } from 'antd'
import type { DebateFormat } from '../../../shared/types'

const { Text } = Typography

interface FormatSelectorProps {
  formats: DebateFormat[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

export default function FormatSelector({ formats, value, onChange, disabled }: FormatSelectorProps) {
  return (
    <Select
      value={value ?? undefined}
      onChange={onChange}
      disabled={disabled}
      style={{ minWidth: 240 }}
      placeholder="选择赛制"
      optionLabelProp="label"
      options={formats.map((f) => ({
        value: f.id,
        label: f.name,
        data: f
      }))}
      optionRender={(option) => {
        const f = option.data.data as DebateFormat
        return (
          <Space direction="vertical" size={0}>
            <Space>
              <Text strong>{f.name}</Text>
              {f.isPreset && <Tag color="blue">预设</Tag>}
            </Space>
            {f.description && <Text type="secondary" style={{ fontSize: 12 }}>{f.description}</Text>}
          </Space>
        )
      }}
    />
  )
}
