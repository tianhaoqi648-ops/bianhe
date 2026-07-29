// ============================================================
// TimerBackgroundPicker.tsx — 计时器背景选择器弹窗
//
// 功能：
// 1. 网格展示 6 张预设渐变背景（深蓝/暗金/黑红/墨绿/银灰/紫罗兰）
// 2. 自定义分类：上传图片按钮 + 已上传背景列表
// 3. 选中态：金色边框 + 勾选图标
// 4. 底部「应用」/「取消」按钮
//
// 数据流：
// - 当前背景从 settingsStore 读取（key=timer.background）
// - 应用时调 settingsStore.set 写入
// - 上传逻辑由 Task 10 实现的 backgroundAPI 接线，本组件先用 console.log 占位
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Modal, Button, Typography, Alert } from 'antd'
import BrandSpin from './common/BrandSpin'
import { CheckCircleFilled, PlusOutlined, PictureOutlined } from '@ant-design/icons'
import {
  PRESET_BACKGROUNDS,
  DEFAULT_TIMER_BACKGROUND,
  TIMER_BACKGROUND_KEY,
  type TimerBackgroundSetting
} from '../../../shared/timer-backgrounds'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../hooks/useToast'
import { spacing, radius, shadow } from '../styles/tokens'

const { Text } = Typography

/** 上传文件大小上限：2MB */
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024
/** 允许的上传文件扩展名 */
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

export interface TimerBackgroundPickerProps {
  open: boolean
  onClose: () => void
}

/** 自定义背景条目（Task 10 接线后从主进程拉取） */
interface CustomBackgroundItem {
  /** 文件名（唯一标识） */
  fileName: string
  /** 完整 file:// 路径或 data URL（用于缩略图预览） */
  previewUrl: string
}

/** 选中态判断 */
function isSelected(
  current: TimerBackgroundSetting,
  type: 'preset' | 'custom',
  value: string
): boolean {
  return current.type === type && current.value === value
}

/** 单个背景缩略图卡片 */
function BackgroundCard({
  label,
  backgroundCss,
  selected,
  onClick,
  width = 140,
  height = 90
}: {
  label: string
  backgroundCss: string
  selected: boolean
  onClick: () => void
  width?: number
  height?: number
}) {
  const containerStyle: CSSProperties = {
    width,
    height,
    background: backgroundCss,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    borderRadius: radius.lg,
    border: selected
      ? `2px solid #faad14`
      : `1px solid rgba(255, 255, 255, 0.15)`,
    boxShadow: selected ? shadow.xl : 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.2s ease',
    overflow: 'hidden'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={containerStyle} onClick={onClick}>
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              color: '#faad14',
              fontSize: 18,
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
            }}
          >
            <CheckCircleFilled />
          </div>
        )}
      </div>
      <Text
        style={{
          fontSize: 12,
          color: selected ? '#faad14' : 'rgba(255, 255, 255, 0.85)'
        }}
      >
        {label}
      </Text>
    </div>
  )
}

export default function TimerBackgroundPicker({
  open,
  onClose
}: TimerBackgroundPickerProps) {
  const toast = useToast()
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.set)

  // 弹窗内本地选中态（应用前可调整，取消则丢弃）
  const [selected, setSelected] = useState<TimerBackgroundSetting>(
    DEFAULT_TIMER_BACKGROUND
  )
  const [saving, setSaving] = useState(false)
  // 自定义背景列表（Task 10 接线后从主进程拉取，目前为空数组占位）
  const [customList, setCustomList] = useState<CustomBackgroundItem[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 弹窗打开时同步当前 settings 中的背景到本地选中态
  useEffect(() => {
    if (!open) return
    const raw = settings[TIMER_BACKGROUND_KEY] as
      | Partial<TimerBackgroundSetting>
      | null
      | undefined
    if (raw && (raw.type === 'preset' || raw.type === 'custom') && raw.value) {
      setSelected({ type: raw.type, value: raw.value })
    } else {
      setSelected({ ...DEFAULT_TIMER_BACKGROUND })
    }
  }, [open, settings])

  // 选择预设
  const handleSelectPreset = (id: string) => {
    setSelected({ type: 'preset', value: id })
  }

  // 选择自定义
  const handleSelectCustom = (fileName: string) => {
    setSelected({ type: 'custom', value: fileName })
  }

  // 文件选择回调（Task 10 接线前用 console.log 占位）
  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    // 重置 input value 允许同一文件再次选择
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    // 校验扩展名
    const lowerName = file.name.toLowerCase()
    const extOk = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    if (!extOk) {
      toast.error('仅支持 jpg / png / webp 格式')
      return
    }
    // 校验大小
    if (file.size > MAX_UPLOAD_SIZE) {
      toast.error('图片大小不能超过 2MB')
      return
    }

    setUploading(true)
    try {
      // Task 10 接线：调 window.backgroundAPI.upload(file) 持久化到 userData/backgrounds/
      // 当前先用 FileReader 生成 data URL 作为本地预览，刷新后丢失
      console.log('[TimerBackgroundPicker] 上传文件占位：', {
        name: file.name,
        size: file.size,
        type: file.type
      })

      const previewUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })

      setCustomList((prev) => {
        const filtered = prev.filter((c) => c.fileName !== file.name)
        return [
          ...filtered,
          { fileName: file.name, previewUrl }
        ]
      })
      setSelected({ type: 'custom', value: file.name })
      toast.success(`已暂存图片「${file.name}」（Task 10 后才永久保存）`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 触发文件选择对话框
  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  // 应用：写入 settingsStore
  const handleApply = async () => {
    setSaving(true)
    try {
      await setSetting(TIMER_BACKGROUND_KEY, selected)
      toast.success('背景已应用')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 取消
  const handleCancel = () => {
    onClose()
  }

  // 当前选中是否匹配某个预设/自定义
  const isPresetSelected = (id: string) =>
    isSelected(selected, 'preset', id)
  const isCustomSelected = (fileName: string) =>
    isSelected(selected, 'custom', fileName)

  // 隐藏的 file input
  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  )

  // 弹窗内容容器（深色主题）
  const contentContainerStyle: CSSProperties = {
    background: '#0f172a',
    color: '#fff',
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '60vh',
    overflowY: 'auto'
  }

  // 分组标题样式
  const sectionTitleStyle: CSSProperties = {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.65)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    margin: `${spacing.md} 0 ${spacing.sm}`,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs
  }

  // 网格容器
  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: spacing.md,
    justifyItems: 'center'
  }

  // 上传按钮卡片样式
  const uploadCardStyle: CSSProperties = {
    width: 140,
    height: 90,
    borderRadius: radius.lg,
    border: '1px dashed rgba(255, 255, 255, 0.3)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    cursor: 'pointer',
    color: 'rgba(255, 255, 255, 0.7)',
    background: 'rgba(255, 255, 255, 0.04)',
    transition: 'all 0.2s ease'
  }

  // 自定义背景空状态文案
  const customEmptyText = useMemo(
    () => '暂无自定义背景，点击上方按钮上传',
    []
  )

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <PictureOutlined style={{ color: '#faad14' }} />
          <span>选择背景</span>
        </div>
      }
      open={open}
      onCancel={handleCancel}
      width={560}
      destroyOnClose
      maskClosable={!saving && !uploading}
      centered
      footer={(_, { CancelBtn }) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
          <CancelBtn />
          <Button
            type="primary"
            loading={saving}
            onClick={handleApply}
            style={{
              background: '#faad14',
              borderColor: '#faad14',
              fontWeight: 600
            }}
          >
            应用
          </Button>
        </div>
      )}
    >
      {hiddenFileInput}
      <BrandSpin spinning={uploading} tip="上传中...">
        <div style={contentContainerStyle}>
          {/* 预设背景区 */}
          <div style={sectionTitleStyle}>
            <span>预设</span>
            <Text style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)' }}>
              共 {PRESET_BACKGROUNDS.length} 款渐变
            </Text>
          </div>
          <div style={gridStyle}>
            {PRESET_BACKGROUNDS.map((bg) => (
              <BackgroundCard
                key={bg.id}
                label={bg.name}
                backgroundCss={bg.css}
                selected={isPresetSelected(bg.id)}
                onClick={() => handleSelectPreset(bg.id)}
              />
            ))}
          </div>

          {/* 自定义背景区 */}
          <div style={{ ...sectionTitleStyle, marginTop: spacing.xl }}>
            <span>自定义</span>
          </div>
          <Alert
            message="支持 jpg / png / webp 格式，单文件不超过 2MB"
            type="info"
            showIcon
            banner
            style={{ marginBottom: spacing.md }}
          />
          <div style={gridStyle}>
            {/* 上传按钮卡片 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                style={uploadCardStyle}
                onClick={handleUploadClick}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#faad14'
                  e.currentTarget.style.color = '#faad14'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                }}
              >
                <PlusOutlined style={{ fontSize: 22 }} />
                <Text style={{ fontSize: 12, color: 'inherit' }}>上传图片</Text>
              </div>
              <Text style={{ fontSize: 12, color: 'transparent' }}>上传</Text>
            </div>

            {/* 已上传自定义背景列表 */}
            {customList.map((item) => (
              <BackgroundCard
                key={item.fileName}
                label={item.fileName.length > 10 ? `${item.fileName.slice(0, 8)}…` : item.fileName}
                backgroundCss={`url("${item.previewUrl}")`}
                selected={isCustomSelected(item.fileName)}
                onClick={() => handleSelectCustom(item.fileName)}
              />
            ))}
          </div>

          {/* 自定义空状态 */}
          {customList.length === 0 && (
            <div
              style={{
                marginTop: spacing.md,
                padding: `${spacing.md} ${spacing.lg}`,
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: radius.md,
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: 'rgba(255, 255, 255, 0.45)',
                  display: 'block',
                  textAlign: 'center'
                }}
              >
                {customEmptyText}
              </Text>
            </div>
          )}

          {/* 当前选中信息 */}
          <div
            style={{
              marginTop: spacing.xl,
              padding: spacing.sm,
              background: 'rgba(250, 173, 20, 0.08)',
              borderRadius: radius.sm,
              border: '1px solid rgba(250, 173, 20, 0.2)'
            }}
          >
            <Text style={{ fontSize: 12, color: '#faad14' }}>
              当前选中：
              {selected.type === 'preset'
                ? `预设 · ${
                    PRESET_BACKGROUNDS.find((b) => b.id === selected.value)?.name ??
                    selected.value
                  }`
                : `自定义 · ${selected.value}`}
            </Text>
          </div>
        </div>
      </BrandSpin>
    </Modal>
  )
}
