// ============================================================
// StageEditDrawer.tsx — 环节编辑抽屉（右侧滑出）
// ============================================================

import { Drawer, Form, Input, InputNumber, Select, Switch, Divider } from 'antd'
import type { StageDef, StageSide } from '../../../../shared/debate-formats/types'
import BellEditor from './BellEditor'

const SIDE_OPTIONS: { label: string; value: StageSide }[] = [
  { label: '正方', value: 'aff' },
  { label: '反方', value: 'neg' },
  { label: '双方（自由辩论）', value: 'both' },
  { label: '上院政府 (OG)', value: 'og' },
  { label: '上院反对 (OO)', value: 'oo' },
  { label: '下院政府 (CG)', value: 'cg' },
  { label: '下院反对 (CO)', value: 'co' }
]

interface StageEditDrawerProps {
  open: boolean
  stage: StageDef | null
  onClose: () => void
  onChange: (stage: StageDef) => void
  readOnly?: boolean
}

export default function StageEditDrawer({
  open,
  stage,
  onClose,
  onChange,
  readOnly
}: StageEditDrawerProps) {
  if (!stage) return null
  const update = (patch: Partial<StageDef>) => onChange({ ...stage, ...patch })

  return (
    <Drawer title="编辑环节" open={open} onClose={onClose} width={420} mask={false}>
      <Form layout="vertical" disabled={readOnly}>
        <Form.Item label="环节名称">
          <Input
            value={stage.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="如：正方立论"
          />
        </Form.Item>
        <Form.Item label="发言方">
          <Select
            value={stage.side}
            onChange={(v) => update({ side: v })}
            options={SIDE_OPTIONS}
          />
        </Form.Item>
        <Form.Item label="时长（分钟）">
          <InputNumber
            min={0.5}
            max={30}
            step={0.5}
            value={stage.durationMs / 60000}
            onChange={(v) => update({ durationMs: (v ?? 1) * 60 * 1000 })}
            style={{ width: '100%' }}
            disabled={stage.timingMode === 'untimed'}
          />
        </Form.Item>
        <Form.Item label="宽限时间（秒，可选）">
          <InputNumber
            min={0}
            max={60}
            step={5}
            value={(stage.graceMs ?? 0) / 1000}
            onChange={(v) => update({ graceMs: (v ?? 0) * 1000 })}
            style={{ width: '100%' }}
            disabled={stage.timingMode === 'untimed'}
          />
        </Form.Item>
        <Form.Item label="自由辩论环节（允许 Space 切换发言方）">
          <Switch
            checked={!!stage.isFreeDebate}
            onChange={(c) => update({ isFreeDebate: c || undefined })}
            disabled={stage.timingMode === 'untimed'}
          />
        </Form.Item>
        <Form.Item label="计时模式">
          <Switch
            checked={stage.timingMode !== 'untimed'}
            onChange={(c) => update({ timingMode: c ? undefined : 'untimed' })}
            checkedChildren="倒计时"
            unCheckedChildren="不计时"
          />
        </Form.Item>
        {stage.timingMode === 'untimed' && (
          <Form.Item
            label="作为铃声试听环节"
            tooltip="勾选后，进入此环节时自动收集所有倒计时环节的铃声，按剩余时间倒序展示，主席可逐条试听"
          >
            <Switch
              checked={!!stage.isBellPreview}
              onChange={(c) => update({ isBellPreview: c || undefined })}
              checkedChildren="铃声试听"
              unCheckedChildren="普通"
            />
          </Form.Item>
        )}
        <Divider>铃响点</Divider>
        <BellEditor value={stage.bells} onChange={(bells) => update({ bells })} />
      </Form>
    </Drawer>
  )
}
