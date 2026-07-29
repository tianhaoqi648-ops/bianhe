// ============================================================
// BellManager.tsx — 铃声资源管理
//
// 职责：
//   - 表格展示所有铃声资源（名称 / 来源 / 时长 / 操作）
//   - 试听：调用 bellPlayer 单例，按钮图标随状态切换
//   - 上传：读取文件为 base64 后调用 bellAPI.upload
//   - 删除：Popconfirm 二次确认后调用 bellAPI.delete
//
// 注：
//   - 当前 bell_assets 表无 source 字段，所有记录均为用户上传，
//     来源列统一显示"用户"；若未来新增 system 字段可扩展。
//   - bell-asset.ipc.ts 暂无 rename handler，故不实现重命名功能。
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { Table, Button, Space, Popconfirm, Upload, Tag, Tooltip, Typography, Alert } from 'antd'
import type { UploadProps } from 'antd'
import {
  SoundOutlined,
  PauseOutlined,
  DeleteOutlined,
  UploadOutlined,
  ReloadOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import type { BellAsset } from '../../../shared/debate-formats/types'
import { bellPlayer, type BellPlayerState } from '../utils/bell-player'
import { useToast } from '../hooks/useToast'

const { Text } = Typography

/** 格式化时长（毫秒 → m:ss 或 sss ms） */
function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '-'
  if (ms < 1000) return `${ms} ms`
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}秒`
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function BellManager() {
  const [bells, setBells] = useState<BellAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [playerState, setPlayerState] = useState<BellPlayerState>(bellPlayer.getState())
  const toast = useToast()

  /** 拉取铃声列表 */
  const loadBells = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.bellAPI.list()
      if (res.success && res.data) {
        setBells(res.data)
      } else if (!res.success) {
        toast.error(res.error ?? '加载铃声列表失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载铃声列表失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  // 挂载时加载 + 订阅 bellPlayer 状态变化
  useEffect(() => {
    void loadBells()
  }, [loadBells])

  useEffect(() => {
    const unsubscribe = bellPlayer.onStateChange((state) => {
      setPlayerState(state)
    })
    return () => {
      unsubscribe()
      // 卸载时停止播放，避免遗留状态
      bellPlayer.stop()
    }
  }, [])

  /** 试听 / 停止 */
  const handlePlay = useCallback(async (bellId: string) => {
    try {
      await bellPlayer.play(bellId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '播放失败')
    }
  }, [toast])

  /** 删除 */
  const handleDelete = useCallback(
    async (bellId: string) => {
      try {
        // 若正在播放该铃声，先停止
        if (playerState.currentBellId === bellId) {
          bellPlayer.stop()
        }
        const res = await window.bellAPI.delete(bellId)
        if (res.success) {
          toast.success('已删除')
          await loadBells()
        } else {
          toast.error(res.error ?? '删除失败')
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '删除失败')
      }
    },
    [loadBells, toast, playerState.currentBellId]
  )

  /** 上传：读取文件为 base64 后调用 bellAPI.upload */
  const uploadProps: UploadProps = {
    accept: 'audio/mp3,audio/mpeg,audio/wav,audio/ogg',
    showUploadList: false,
    multiple: false,
    beforeUpload: (file) => {
      // 校验大小（1MB 上限，与主进程一致）
      const MAX_SIZE = 1 * 1024 * 1024
      if (file.size > MAX_SIZE) {
        toast.error(`文件过大：${formatSize(file.size)}（上限 1MB）`)
        return Upload.LIST_IGNORE
      }
      // 校验 MIME
      const allowedMime = [
        'audio/mp3',
        'audio/mpeg',
        'audio/wav',
        'audio/wave',
        'audio/x-wav',
        'audio/ogg'
      ]
      const mime = file.type || 'application/octet-stream'
      if (!allowedMime.includes(mime)) {
        toast.error(`不支持的格式：${mime}（仅支持 mp3/wav/ogg）`)
        return Upload.LIST_IGNORE
      }
      // 读取 base64
      const reader = new FileReader()
      reader.onload = async () => {
        const base64Full = String(reader.result ?? '')
        const base64 = base64Full.split(',')[1] ?? ''
        // 用文件名（去扩展名）作为初始名称
        const name = file.name.replace(/\.[^.]+$/, '')
        try {
          const res = await window.bellAPI.upload({
            name,
            fileName: file.name,
            base64,
            mimeType: mime
          })
          if (res.success) {
            toast.success(`已上传：${res.data?.name ?? name}`)
            await loadBells()
          } else {
            toast.error(res.error ?? '上传失败')
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : '上传失败')
        }
      }
      reader.onerror = () => {
        toast.error('读取文件失败')
      }
      reader.readAsDataURL(file)
      // 返回 false 阻止 antd 自动上传
      return false
    }
  }

  /** 判断某行是否正在播放（loading 或 playing 均视为"激活"） */
  const isBellActive = (bellId: string): boolean =>
    playerState.currentBellId === bellId && playerState.state !== 'idle'

  const isBellLoading = (bellId: string): boolean =>
    playerState.currentBellId === bellId && playerState.state === 'loading'

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: BellAsset) => (
        <Space>
          <SoundOutlined style={{ color: '#1677ff' }} />
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatSize(record.fileSize)}
          </Text>
        </Space>
      )
    },
    {
      title: '来源',
      key: 'source',
      width: 100,
      render: () => <Tag color="blue">用户</Tag>
    },
    {
      title: '时长',
      key: 'duration',
      width: 100,
      render: (_v: unknown, record: BellAsset) => formatDuration(record.durationMs)
    },
    {
      title: '格式',
      dataIndex: 'mimeType',
      key: 'mimeType',
      width: 110,
      render: (mime: string) => <Tag>{mime.replace('audio/', '').toUpperCase()}</Tag>
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_v: unknown, record: BellAsset) => {
        const active = isBellActive(record.id)
        const loadingBell = isBellLoading(record.id)
        return (
          <Space size="small">
            <Tooltip title={active ? '停止' : '试听'}>
              <Button
                type="text"
                shape="circle"
                icon={
                  loadingBell ? (
                    <LoadingOutlined />
                  ) : active ? (
                    <PauseOutlined style={{ color: '#ff4d4f' }} />
                  ) : (
                    <SoundOutlined style={{ color: '#1677ff' }} />
                  )
                }
                onClick={() => void handlePlay(record.id)}
              />
            </Tooltip>
            <Popconfirm
              title="确认删除该铃声？"
              description="删除后不可恢复，引用此铃声的赛制将回退到默认铃。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => void handleDelete(record.id)}
            >
              <Button type="text" shape="circle" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        )
      }
    }
  ]

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Upload {...uploadProps}>
          <Button type="primary" icon={<UploadOutlined />}>
            上传铃声
          </Button>
        </Upload>
        <Button icon={<ReloadOutlined />} onClick={() => void loadBells()} loading={loading}>
          刷新
        </Button>
      </div>
      <Alert
        message="支持 mp3 / wav / ogg 格式，单文件不超过 1MB"
        type="info"
        showIcon
        banner
        style={{ marginBottom: 12 }}
      />

      <Table<BellAsset>
        rowKey="id"
        columns={columns}
        dataSource={bells}
        loading={loading}
        size="small"
        pagination={false}
        locale={{ emptyText: '暂无铃声，点击「上传铃声」添加' }}
      />
    </>
  )
}
