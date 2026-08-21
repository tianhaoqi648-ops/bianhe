// ============================================================
// BadgePickerModal.tsx — 队徽库选择弹窗（P1-6）
//
// 用于赛事队伍「绑定队徽」：
//   - 展示内置 + 自定义队徽（关键字搜索）
//   - 支持上传新队徽（读取文件为 base64 → badgeAPI.upload）
//   - 点击选择 → onSaved(badgeId)；不选返回 null
// 队徽图片经 badgeAPI.getDataUrl 即时拉取 dataUrl 渲染。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, Modal, Space, Spin, Upload, Tag } from 'antd'
import { UploadOutlined, CheckOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { BadgeItem } from '../../../../shared/types'

function BadgeThumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.badgeAPI.getDataUrl(id).then((res) => {
      if (alive && res.success && res.data) setSrc(res.data)
    })
    return () => {
      alive = false
    }
  }, [id])
  if (!src) return <Spin size="small" />
  return <img src={src} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
}

/** 小尺寸队徽缩略图（列表/表格展示用） */
export function BadgeThumbSmall({ id, size = 24 }: { id: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.badgeAPI.getDataUrl(id).then((res) => {
      if (alive && res.success && res.data) setSrc(res.data)
    })
    return () => {
      alive = false
    }
  }, [id])
  if (!src) return <Spin size="small" />
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }} />
}

export default function BadgePickerModal({
  open,
  teamName,
  currentBadgeId,
  onClose,
  onSaved,
  onToast
}: {
  open: boolean
  teamName: string
  currentBadgeId?: string | null
  onClose: () => void
  onSaved: (badgeId: string | null) => void
  onToast?: { success: (m: string) => void; error: (m: string) => void }
}) {
  const [list, setList] = useState<BadgeItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const res = await window.badgeAPI.list(keyword.trim() || undefined)
    if (res.success && res.data) setList(res.data)
  }, [keyword])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const uploadProps: UploadProps = {
    accept: '.png,.jpg,.jpeg,.gif,.webp,.svg,image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
    showUploadList: false,
    multiple: true,
    beforeUpload: (file) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const full = String(reader.result ?? '')
        const base64 = full.split(',')[1] ?? ''
        const name = file.name.replace(/\.[^.]+$/, '')
        setUploading(true)
        try {
          const res = await window.badgeAPI.upload({ name, fileName: file.name, base64 })
          if (res.success) {
            onToast?.success(`已上传：${res.data?.name ?? name}`)
            await load()
          } else {
            onToast?.error(res.error ?? '上传失败')
          }
        } catch (e) {
          onToast?.error(e instanceof Error ? e.message : '上传失败')
        } finally {
          setUploading(false)
        }
      }
      reader.onerror = () => onToast?.error('读取文件失败')
      reader.readAsDataURL(file)
      return false // 阻止 antd 自动上传
    }
  }

  return (
    <Modal
      title="选择队徽"
      open={open}
      onCancel={onClose}
      width={560}
      footer={[
        <Button key="clear" danger onClick={() => onSaved(null)}>
          不设队徽
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            allowClear
            placeholder="搜索队徽名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
            style={{ flex: 1 }}
          />
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />} loading={uploading}>
              批量上传
            </Button>
          </Upload>
        </div>
        <Tag>{teamName}</Tag>
        {list.length === 0 ? (
          <Empty description="无队徽，可上传" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 360, overflow: 'auto' }}>
            {list.map((b) => {
              const selected = b.id === currentBadgeId
              return (
                <div
                  key={b.id}
                  onClick={() => onSaved(b.id)}
                  title={b.name}
                  style={{
                    width: 84,
                    padding: 8,
                    border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selected && <CheckOutlined style={{ color: '#1677ff' }} />}
                    <BadgeThumb id={b.id} />
                  </div>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Space>
    </Modal>
  )
}