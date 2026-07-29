// ============================================================
// FormatToolbar.tsx — 赛制编辑器工具栏
// 按钮：保存 / 另存为 / 导入 / 导出 / 复制 / 删除
// ============================================================

import { Button, Space, Upload, Popconfirm, Tag, Alert } from 'antd'
import {
  SaveOutlined,
  CopyOutlined,
  ImportOutlined,
  ExportOutlined,
  DeleteOutlined,
  PlusOutlined,
  EyeOutlined
} from '@ant-design/icons'
import type { DebateFormat } from '../../../../shared/types'

interface FormatToolbarProps {
  format: DebateFormat | null
  dirty: boolean
  onSave: () => void
  onDuplicate: () => void
  onImport: (file: File) => void
  onExport: () => void
  onDelete: () => void
  onNew: () => void
  onPreview?: () => void
}

export default function FormatToolbar({
  format,
  dirty,
  onSave,
  onDuplicate,
  onImport,
  onExport,
  onDelete,
  onNew,
  onPreview
}: FormatToolbarProps) {
  const isPreset = format?.isPreset ?? false

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>
          新建赛制
        </Button>
        <Upload
          beforeUpload={(file) => {
            onImport(file)
            return false
          }}
          accept=".json"
          showUploadList={false}
        >
          <Button icon={<ImportOutlined />}>导入</Button>
        </Upload>
        <Button icon={<EyeOutlined />} onClick={onPreview}>
          预览
        </Button>
        {format && (
          <>
            {isPreset ? (
              <Tag color="blue">内置预设（不可编辑）</Tag>
            ) : (
              <Button type="primary" className="btn-press" icon={<SaveOutlined />} onClick={onSave} disabled={!dirty}>
                保存
              </Button>
            )}
            <Button icon={<CopyOutlined />} onClick={onDuplicate}>
              另存为
            </Button>
            <Button icon={<ExportOutlined />} onClick={onExport}>
              导出
            </Button>
            {!isPreset && (
              <Popconfirm title="确认删除此赛制？" onConfirm={onDelete}>
                <Button danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </>
        )}
      </Space>
      <Alert
        message="导入支持 .json 格式，应为本应用导出的赛制文件"
        type="info"
        showIcon
        banner
        style={{ marginBottom: 12 }}
      />
    </div>
  )
}
