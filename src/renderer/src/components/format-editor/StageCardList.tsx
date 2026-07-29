// ============================================================
// StageCardList.tsx — 卡片化环节列表（拖拽排序 + 复制粘贴 + 预设，辨之竹风格）
//
// Task 12: @dnd-kit 拖拽排序（PointerSensor 长按 200ms + KeyboardSensor）
// Task 13: 复制/粘贴（单条 + 批量多选）
// Task 15: 顶部"添加预设"Dropdown
// ============================================================

import { useEffect, useState } from 'react'
import { Button, Space, Tooltip, Dropdown, Checkbox, theme as antdTheme } from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  SnippetsOutlined,
  CheckSquareOutlined,
  CopyOutlined
} from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import type { PointerActivationConstraint } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { StageDef, StageSide } from '../../../../shared/debate-formats/types'
import StageCard from './StageCard'
import EmptyState from '../common/EmptyState'
import { STAGE_PRESETS } from '../../data/stage-presets'
import { useToast } from '../../hooks/useToast'

interface StageCardListProps {
  stages: StageDef[]
  onChange: (stages: StageDef[]) => void
  editingIndex: number | null
  onEditIndex: (idx: number | null) => void
  readOnly?: boolean
  /** 计时模式 Tag 快捷切换回调（按索引触发） */
  onTimingModeToggle?: (index: number) => void
}

/** 合法的 StageSide 值集合 */
const VALID_SIDES: readonly StageSide[] = ['aff', 'neg', 'both', 'og', 'oo', 'cg', 'co']

/** 校验剪贴板解析对象是否为合法 StageDef（关键字段存在且类型正确） */
function isValidStage(obj: unknown): obj is StageDef {
  if (!obj || typeof obj !== 'object') return false
  const s = obj as Record<string, unknown>
  const hasName = typeof s.name === 'string' && s.name.length > 0
  const hasDuration = typeof s.durationMs === 'number' && s.durationMs >= 0
  const hasSide = typeof s.side === 'string' && (VALID_SIDES as readonly string[]).includes(s.side)
  const bellsOk = s.bells === undefined || Array.isArray(s.bells)
  return hasName && hasDuration && hasSide && bellsOk
}

/** 将 Partial<StageDef> 补全为完整 StageDef（生成 id + 默认值） */
function completeStage(partial: Partial<StageDef>): StageDef {
  return {
    id: uuidv4(),
    name: partial.name ?? '新环节',
    side: partial.side ?? 'aff',
    durationMs: partial.durationMs ?? 0,
    bells: partial.bells ?? [],
    ...(partial.isFreeDebate ? { isFreeDebate: true } : {}),
    ...(partial.timingMode ? { timingMode: partial.timingMode } : {}),
    ...(partial.isBellPreview ? { isBellPreview: true } : {}),
    ...(partial.graceMs !== undefined ? { graceMs: partial.graceMs } : {})
  }
}

/** 深拷贝 stage 并重新生成 id（用于粘贴时避免 id 冲突） */
function cloneStageWithNewId(stage: StageDef): StageDef {
  return {
    ...stage,
    id: uuidv4(),
    bells: stage.bells.map((b) => ({ ...b }))
  }
}

function SortableStageCard({
  stage,
  index,
  total,
  isEditing,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onCopy,
  onTimingModeToggle,
  selectable,
  selected,
  onSelectToggle
}: {
  stage: StageDef
  index: number
  total: number
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onCopy: () => void
  onTimingModeToggle?: () => void
  selectable: boolean
  selected: boolean
  onSelectToggle: (checked: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }
  return (
    <div ref={setNodeRef} style={style}>
      <StageCard
        stage={stage}
        index={index}
        total={total}
        isEditing={isEditing}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandleProps={attributes}
        listeners={listeners}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onCopy={onCopy}
        selectable={selectable}
        selected={selected}
        onSelectToggle={onSelectToggle}
        onTimingModeToggle={onTimingModeToggle}
      />
    </div>
  )
}

export default function StageCardList({
  stages,
  onChange,
  editingIndex,
  onEditIndex,
  readOnly,
  onTimingModeToggle
}: StageCardListProps) {
  const toast = useToast()
  const { token } = antdTheme.useToken()
  // Task 13.2：多选状态
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([])

  // stages 变化时清理失效的选中 id（避免删除/粘贴后残留）
  useEffect(() => {
    setSelectedStageIds((prev) => prev.filter((id) => stages.some((s) => s.id === id)))
  }, [stages])

  // Task 12.2：PointerSensor 长按 200ms 触发拖拽（移动端友好，避免误触）
  // tolerance 8px：长按期间轻微移动仍视为长按
  const activationConstraint: PointerActivationConstraint = {
    delay: 200,
    tolerance: 8
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = stages.findIndex((s) => s.id === active.id)
    const newIndex = stages.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(stages, oldIndex, newIndex))
  }

  /** Task 12.4：键盘可达性备选 — 上移 */
  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return
    onChange(arrayMove(stages, idx, idx - 1))
  }

  /** Task 12.4：键盘可达性备选 — 下移 */
  const handleMoveDown = (idx: number) => {
    if (idx >= stages.length - 1) return
    onChange(arrayMove(stages, idx, idx + 1))
  }

  const handleAdd = () => {
    const newStage: StageDef = {
      id: uuidv4(),
      name: '新环节',
      side: 'aff',
      durationMs: 3 * 60 * 1000,
      bells: [
        { atMs: 30 * 1000, sound: 'beep' },
        { atMs: 0, sound: 'time_up' }
      ]
    }
    onChange([...stages, newStage])
    onEditIndex(stages.length)
  }

  /** Task 15.2：从预设添加环节 */
  const handleAddPreset = (presetId: string) => {
    const preset = STAGE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const newStage = completeStage(preset.stage)
    onChange([...stages, newStage])
    // 自动选中编辑
    onEditIndex(stages.length)
    toast.success(`已添加预设：${preset.name}`)
  }

  const handleDelete = (idx: number) => {
    onChange(stages.filter((_, i) => i !== idx))
    if (editingIndex === idx) onEditIndex(null)
  }

  /** Task 13.1：复制单条环节到剪贴板 */
  const handleCopy = async (stage: StageDef) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(stage))
      toast.success('已复制环节')
    } catch {
      toast.error('复制失败：剪贴板不可用')
    }
  }

  /** Task 13.2：批量复制选中环节 */
  const handleCopySelected = async () => {
    const selected = stages.filter((s) => selectedStageIds.includes(s.id))
    if (selected.length === 0) {
      toast.warning('请先选择环节')
      return
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(selected))
      toast.success(`已复制 ${selected.length} 个环节`)
    } catch {
      toast.error('复制失败：剪贴板不可用')
    }
  }

  /** Task 13.1/13.2：粘贴环节（支持单条或数组） */
  const handlePaste = async () => {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      toast.error('粘贴失败：剪贴板不可用')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      toast.error('剪贴板内容不是有效环节')
      return
    }
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(isValidStage)
      if (valid.length === 0) {
        toast.error('剪贴板内容不是有效环节')
        return
      }
      const newStages = valid.map(cloneStageWithNewId)
      onChange([...stages, ...newStages])
      toast.success(`已粘贴 ${newStages.length} 个环节`)
    } else if (isValidStage(parsed)) {
      const newStage = cloneStageWithNewId(parsed)
      onChange([...stages, newStage])
      onEditIndex(stages.length)
      toast.success('已粘贴环节')
    } else {
      toast.error('剪贴板内容不是有效环节')
    }
  }

  /** 多选切换 */
  const handleSelectToggle = (stageId: string, checked: boolean) => {
    setSelectedStageIds((prev) =>
      checked ? [...prev, stageId] : prev.filter((id) => id !== stageId)
    )
  }

  const handleSelectAll = () => {
    setSelectedStageIds(stages.map((s) => s.id))
  }

  const handleClearSelection = () => {
    setSelectedStageIds([])
  }

  const handleToggleMultiSelect = () => {
    setMultiSelectMode((prev) => {
      if (prev) {
        // 退出多选时清空选中
        setSelectedStageIds([])
      }
      return !prev
    })
  }

  // Task 15.2：添加预设 Dropdown 菜单项
  const presetMenuItems: MenuProps['items'] = STAGE_PRESETS.map((p) => ({
    key: p.id,
    label: p.name,
    title: p.description
  }))
  const presetMenuProps: MenuProps = {
    items: presetMenuItems,
    onClick: ({ key }) => handleAddPreset(key)
  }

  return (
    <div>
      {/* Task 13/15：顶部工具栏 — 添加预设 / 粘贴 / 多选切换 */}
      {!readOnly && (
        <Space size={8} wrap style={{ marginBottom: 8 }}>
          <Dropdown menu={presetMenuProps} trigger={['click']}>
            <Button icon={<PlusOutlined />} aria-label="添加预设环节">
              添加预设
            </Button>
          </Dropdown>
          <Tooltip title="从剪贴板粘贴环节（支持单条或数组）">
            <Button
              icon={<SnippetsOutlined />}
              onClick={() => void handlePaste()}
              aria-label="粘贴环节"
            >
              粘贴环节
            </Button>
          </Tooltip>
          <Button
            type={multiSelectMode ? 'primary' : 'default'}
            icon={<CheckSquareOutlined />}
            onClick={handleToggleMultiSelect}
            aria-pressed={multiSelectMode}
            aria-label={multiSelectMode ? '退出多选模式' : '进入多选模式'}
          >
            {multiSelectMode ? '退出多选' : '多选'}
          </Button>
        </Space>
      )}

      {/* Task 13.2：多选模式工具栏 */}
      {!readOnly && multiSelectMode && (
        <Space
          size={8}
          wrap
          style={{
            marginBottom: 8,
            padding: '6px 10px',
            background: token.colorPrimaryBg,
            borderRadius: 6
          }}
        >
          <Checkbox
            checked={
              stages.length > 0 && selectedStageIds.length === stages.length
            }
            indeterminate={
              selectedStageIds.length > 0 && selectedStageIds.length < stages.length
            }
            onChange={(e) => {
              if (e.target.checked) handleSelectAll()
              else handleClearSelection()
            }}
            disabled={stages.length === 0}
          >
            全选
          </Checkbox>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => void handleCopySelected()}
            disabled={selectedStageIds.length === 0}
          >
            复制选中 ({selectedStageIds.length})
          </Button>
          {selectedStageIds.length > 0 && (
            <Button size="small" onClick={handleClearSelection}>
              取消选择
            </Button>
          )}
        </Space>
      )}

      {stages.length === 0 ? (
        <EmptyState type="default" description="暂无环节，点击下方按钮添加" style={{ margin: '40px 0' }} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={stages.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {stages.map((stage, idx) => (
              <SortableStageCard
                key={stage.id}
                stage={stage}
                index={idx}
                total={stages.length}
                isEditing={editingIndex === idx}
                onEdit={() => onEditIndex(idx)}
                onDelete={() => handleDelete(idx)}
                onMoveUp={() => handleMoveUp(idx)}
                onMoveDown={() => handleMoveDown(idx)}
                onCopy={() => void handleCopy(stage)}
                onTimingModeToggle={
                  !readOnly && onTimingModeToggle ? () => onTimingModeToggle(idx) : undefined
                }
                selectable={!readOnly && multiSelectMode}
                selected={selectedStageIds.includes(stage.id)}
                onSelectToggle={(checked) => handleSelectToggle(stage.id, checked)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {!readOnly && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          block
          style={{ marginTop: 8 }}
        >
          添加环节
        </Button>
      )}
    </div>
  )
}
