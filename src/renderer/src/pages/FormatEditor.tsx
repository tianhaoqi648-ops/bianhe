// ============================================================
// FormatEditor.tsx — 赛制编辑器主页（辨之竹风格：左预览+右卡片）
// ============================================================

import { useState, useEffect } from 'react'
import { Card, List, Typography, Input, Alert, Tag, Space, Button, Segmented, Drawer, theme as antdTheme } from 'antd'
import { CopyOutlined, GiftOutlined, PlusOutlined } from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import EmptyState from '../components/common/EmptyState'
import AccentCard from '../components/common/AccentCard'
import PageHeader from '../components/common/PageHeader'
import type {
  StageDef,
  TimerTheme
} from '../../../shared/debate-formats/types'
import { useFormatStore } from '../stores/formatStore'
import FormatToolbar from '../components/format-editor/FormatToolbar'
import FormatPreview from '../components/format-editor/FormatPreview'
import StageCardList from '../components/format-editor/StageCardList'
import StageEditDrawer from '../components/format-editor/StageEditDrawer'
import FormatTemplateModal from '../components/format-editor/FormatTemplateModal'
import { spacing, fontSize } from '../styles/tokens'
import { useToast } from '../hooks/useToast'
import { useMediaQuery } from '../hooks/useMediaQuery'

const { Text } = Typography

export default function FormatEditor() {
  const formatStore = useFormatStore()
  const toast = useToast()
  const { token } = antdTheme.useToken()
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null)
  const [editingStages, setEditingStages] = useState<StageDef[]>([])
  const [editingName, setEditingName] = useState('')
  const [editingDesc, setEditingDesc] = useState('')
  const [editingStageIdx, setEditingStageIdx] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [theme, setTheme] = useState<TimerTheme | null>(null)
  // 移动端断点检测与单栏视图切换（Task 19）
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [mobileView, setMobileView] = useState<'list' | 'edit' | 'preview'>('list')
  // Task 14.3：从模板创建赛制 Modal 开关
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // 桌面端预览侧抽屉开关（三栏 → 两栏 + 预览抽屉）
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    void formatStore.fetchAll()
    void window.timerAPI.getTheme().then((res) => {
      if (res.success && res.data) setTheme(res.data)
    })
  }, [])

  useEffect(() => {
    if (!selectedFormatId) return
    const fmt = formatStore.formats.find((f) => f.id === selectedFormatId)
    if (fmt) {
      setEditingStages(fmt.formatData.stages.map((s) => ({ ...s, bells: [...s.bells] })))
      setEditingName(fmt.name)
      setEditingDesc(fmt.description ?? '')
      setDirty(false)
      setEditingStageIdx(null)
    }
  }, [selectedFormatId, formatStore.formats])

  const selectedFormat = formatStore.formats.find((f) => f.id === selectedFormatId) ?? null
  const isPreset = selectedFormat?.isPreset ?? false

  const handleNew = async () => {
    const fmt = await formatStore.createFormat({
      name: '新赛制',
      formatData: { totalDurationMs: 0, stages: [] }
    })
    if (fmt) {
      setSelectedFormatId(fmt.id)
      setMobileView('edit')
      toast.success('已创建新赛制')
    }
  }

  /** Task 14.3：从模板创建后选中并进入编辑 */
  const handleCreateFromTemplate = (formatId: string) => {
    setSelectedFormatId(formatId)
    setMobileView('edit')
  }

  const handleSave = async () => {
    if (!selectedFormat || isPreset) return
    const totalDurationMs = editingStages.reduce((sum, s) => sum + s.durationMs, 0)
    const fmt = await formatStore.updateFormat(selectedFormat.id, {
      name: editingName,
      description: editingDesc,
      formatData: { stages: editingStages, totalDurationMs }
    })
    if (fmt) {
      setDirty(false)
      toast.success('已保存')
    }
  }

  const handleDuplicate = async () => {
    if (!selectedFormat) return
    const fmt = await formatStore.duplicateFormat(selectedFormat.id)
    if (fmt) {
      setSelectedFormatId(fmt.id)
      setMobileView('edit')
      toast.success('已复制')
    }
  }

  const handleExport = async () => {
    if (!selectedFormat) return
    const data = await formatStore.exportFormat(selectedFormat.id)
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const fmt = await formatStore.importFormat(data)
      if (fmt) toast.success(`已导入：${fmt.name}`)
    } catch {
      toast.error('导入失败：JSON 格式错误')
    }
  }

  const handleDelete = async () => {
    if (!selectedFormat) return
    const ok = await formatStore.deleteFormat(selectedFormat.id)
    if (ok) {
      setSelectedFormatId(null)
      toast.success('已删除')
    }
  }

  const updateStage = (idx: number, stage: StageDef) => {
    setEditingStages((prev) => prev.map((s, i) => (i === idx ? stage : s)))
    setDirty(true)
  }

  /** 新建赛制后首个环节（EmptyState「请添加环节」的入口；与 StageCardList 的 handleAdd 同构） */
  const handleAddFirstStage = () => {
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
    setEditingStages([newStage])
    setEditingStageIdx(0)
    setDirty(true)
  }

  // === 桌面端 / 移动端共用内容片段（Task 19） ===
  // 赛制列表 List（点击赛制时同步切换移动端到 edit 视图）
  const formatListContent = (
    <List
      dataSource={formatStore.formats}
      renderItem={(fmt) => (
        <List.Item
          onClick={() => { setSelectedFormatId(fmt.id); setMobileView('edit') }}
          style={{
            cursor: 'pointer',
            background: selectedFormatId === fmt.id ? token.colorPrimaryBg : undefined,
            padding: `${spacing.sm}px ${spacing.md}px`
          }}
        >
          <List.Item.Meta
            title={<Text strong>{fmt.name}</Text>}
            description={
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                {fmt.formatData.stages.length} 环节
              </Text>
            }
          />
        </List.Item>
      )}
    />
  )

  // 实时预览内容（未选赛制或无环节时显示 EmptyState）
  const previewContent = selectedFormat && editingStages.length > 0 ? (
    <FormatPreview
      format={{
        stages: editingStages,
        totalDurationMs: editingStages.reduce((s, x) => s + x.durationMs, 0)
      }}
      currentStageIndex={editingStageIdx ?? 0}
      theme={theme}
    />
  ) : (
    <EmptyState
      type="default"
      description="请选择赛制"
      style={{ marginTop: 60 }}
      cta={[
        { text: '新建赛制', icon: <PlusOutlined />, onClick: handleNew },
        { text: '从模板创建', icon: <GiftOutlined />, onClick: () => setTemplateModalOpen(true) }
      ]}
    />
  )

  // 环节配置内容（未选赛制时显示 EmptyState，桌面端提示「请选择左侧赛制」，移动端提示「请选择赛制」）
  const stageConfigContent = selectedFormat ? (
    editingStages.length === 0 ? (
      <EmptyState
        type="default"
        description="请添加环节"
        style={{ marginTop: 60 }}
        cta={[{ text: '添加环节', icon: <PlusOutlined />, onClick: handleAddFirstStage }]}
      />
    ) : (
      <StageCardList
        stages={editingStages}
        onChange={(s) => {
          setEditingStages(s)
          setDirty(true)
        }}
        editingIndex={editingStageIdx}
        onEditIndex={setEditingStageIdx}
        readOnly={isPreset}
        onTimingModeToggle={(idx) => {
          const stage = editingStages[idx]
          if (!stage) return
          const newMode = stage.timingMode === 'untimed' ? undefined : 'untimed'
          updateStage(idx, { ...stage, timingMode: newMode })
        }}
      />
    )
  ) : (
    <EmptyState
      type="default"
      description={isMobile ? '请选择赛制' : '请选择左侧赛制'}
      style={{ marginTop: 60 }}
      cta={[
        { text: '新建赛制', icon: <PlusOutlined />, onClick: handleNew },
        { text: '从模板创建', icon: <GiftOutlined />, onClick: () => setTemplateModalOpen(true) }
      ]}
    />
  )

  // 赛制信息卡片（桌面端始终显示；移动端仅在 edit 视图显示）
  const formatInfoCard = selectedFormat && (!isMobile || mobileView === 'edit') ? (
    <AccentCard
      title="赛制信息"
      size="small"
      style={{ marginBottom: spacing.lg }}
      extra={
        isPreset ? (
          <Space>
            <Tag color="blue">内置预设</Tag>
            <Button size="small" icon={<CopyOutlined />} onClick={handleDuplicate}>
              另存为可编辑
            </Button>
          </Space>
        ) : null
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
        <span style={{ width: 80, textAlign: 'right', color: token.colorTextSecondary }}>赛制名称</span>
        <Input
          value={editingName}
          onChange={isPreset ? undefined : (e) => { setEditingName(e.target.value); setDirty(true) }}
          placeholder="请输入赛制名称"
          readOnly={isPreset}
          style={{ flex: 1, maxWidth: 320, ...(isPreset ? { backgroundColor: token.colorFillQuaternary, color: '#999' } : {}) }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md }}>
        <span style={{ width: 80, textAlign: 'right', color: token.colorTextSecondary, paddingTop: 6 }}>赛制描述</span>
        <Input.TextArea
          value={editingDesc}
          onChange={isPreset ? undefined : (e) => { setEditingDesc(e.target.value); setDirty(true) }}
          placeholder="可选，赛制描述"
          autoSize={{ minRows: 1, maxRows: 3 }}
          readOnly={isPreset}
          style={{ flex: 1, maxWidth: 480, ...(isPreset ? { backgroundColor: token.colorFillQuaternary, color: '#999' } : {}) }}
        />
      </div>
      {isPreset && (
        <Alert
          type="info"
          showIcon
          banner
          message="内置预设不可直接编辑，点击「另存为」可复制为自定义赛制后修改"
          style={{ marginTop: spacing.md }}
        />
      )}
    </AccentCard>
  ) : null

  // Task 14.3：从模板创建按钮（列表 Card 标题区 extra）
  const templateButton = (
    <Button
      size="small"
      type="text"
      icon={<GiftOutlined />}
      onClick={() => setTemplateModalOpen(true)}
      aria-label="从模板创建赛制"
    >
      从模板创建
    </Button>
  )

  return (
    <div style={{ padding: spacing.lg }}>
      <PageHeader title="赛制编辑器" subtitle="自定义辩论赛制与环节" />
      <FormatToolbar
        format={selectedFormat}
        dirty={dirty}
        onSave={handleSave}
        onDuplicate={handleDuplicate}
        onImport={handleImport}
        onExport={handleExport}
        onDelete={handleDelete}
        onNew={handleNew}
        onPreview={() => setPreviewOpen(true)}
      />

      {formatInfoCard}

      {isMobile ? (
        // ===== 移动端单栏布局 + Segmented 切换（Task 19） =====
        <div>
          <Segmented
            block
            options={[
              { label: '列表', value: 'list' },
              { label: '编辑', value: 'edit' },
              { label: '预览', value: 'preview' }
            ]}
            value={mobileView}
            onChange={(v) => setMobileView(v as 'list' | 'edit' | 'preview')}
            style={{ marginBottom: spacing.lg }}
          />
          {mobileView === 'list' && (
            <Card title="赛制列表" size="small" extra={templateButton}>
              {formatListContent}
            </Card>
          )}
          {mobileView === 'edit' && (
            <AccentCard
              title={selectedFormat ? `环节配置 (${selectedFormat.name})` : '环节配置'}
              size="small"
            >
              {stageConfigContent}
            </AccentCard>
          )}
          {mobileView === 'preview' && (
            <Card title="实时预览" size="small">
              {previewContent}
            </Card>
          )}
        </div>
      ) : (
        // ===== 桌面端两栏布局（列表 + 环节配置，预览走侧抽屉） =====
        <div style={{ display: 'flex', gap: spacing.lg, minHeight: '60vh' }}>
          {/* 左侧：赛制列表 */}
          <Card title="赛制列表" size="small" extra={templateButton} style={{ width: 240 }}>
            {formatListContent}
          </Card>

          {/* 右侧：环节卡片列表 + 编辑抽屉 */}
          <AccentCard
            title={selectedFormat ? `环节配置 (${selectedFormat.name})` : '环节配置'}
            size="small"
            style={{ flex: 1 }}
          >
            {stageConfigContent}
          </AccentCard>
        </div>
      )}

      <StageEditDrawer
        open={editingStageIdx !== null && editingStageIdx < editingStages.length}
        stage={editingStageIdx !== null ? editingStages[editingStageIdx] : null}
        onClose={() => setEditingStageIdx(null)}
        onChange={(s) => editingStageIdx !== null && updateStage(editingStageIdx, s)}
        readOnly={isPreset}
      />

      {/* Task 14.3：从模板创建赛制 Modal */}
      <FormatTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSelect={handleCreateFromTemplate}
      />

      {/* 桌面端预览侧抽屉（三栏 → 两栏 + 预览抽屉） */}
      <Drawer
        title="赛制预览"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        width={480}
        placement="right"
      >
        {selectedFormat && editingStages.length > 0 ? (
          <FormatPreview
            format={{
              stages: editingStages,
              totalDurationMs: editingStages.reduce((s, x) => s + x.durationMs, 0)
            }}
            currentStageIndex={editingStageIdx ?? 0}
            theme={theme}
          />
        ) : (
          <EmptyState type="default" description="请选择赛制" />
        )}
      </Drawer>
    </div>
  )
}
