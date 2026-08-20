// ============================================================
// UpdateCard.tsx — 应用更新检查卡片
//
// 在「设置 → 关于」Tab 展示，提供：
// - 启动时自动检查开关
// - 手动检查更新按钮
// - 7 种状态展示（idle/checking/available/not-available/downloading/downloaded/error）
// - macOS 降级：按钮文案改为「前往下载」，点击打开浏览器
// ============================================================

import { useEffect, useState } from 'react'
import { Card, Button, Switch, Space, Typography, Alert, Progress, Tag, Spin, notification } from 'antd'
import {
  SyncOutlined,
  DownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  CloudSyncOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { version } from '../../../../../package.json'
import { useUpdater } from '../../hooks/useUpdater'
import { useToast } from '../../hooks/useToast'
import { useSettingsStore } from '../../stores/settingsStore'
import { spacing } from '../../styles/tokens'

const { Text, Link } = Typography

/** 设置项 key */
const AUTO_CHECK_KEY = 'auto_update_check'
/** 当前应用版本号 */
const APP_VERSION = `v${version}`

/**
 * 格式化字节数为可读字符串。
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 应用更新检查卡片。
 *
 * 用法：
 * ```tsx
 * <UpdateCard />
 * ```
 */
export default function UpdateCard(): JSX.Element {
  const { status, info, progress, error, isMacos, checkForUpdates, downloadUpdate, installUpdate, setAutoCheck } =
    useUpdater()
  const settingsStore = useSettingsStore()
  const toast = useToast()
  const [autoCheckEnabled, setAutoCheckEnabled] = useState<boolean>(true)
  const [loadingSetting, setLoadingSetting] = useState<boolean>(true)
  /** 是否打包环境（开发环境不执行更新检查） */
  const [isPackaged, setIsPackaged] = useState<boolean>(true)

  // 读取应用运行元信息（是否打包环境）
  useEffect(() => {
    let mounted = true
    window.updaterAPI
      ?.getMeta()
      .then((res) => {
        if (mounted && res.success) {
          setIsPackaged(res.data?.isPackaged ?? true)
        }
      })
      .catch(() => {
        // 忽略失败，默认视为打包环境
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 加载 auto_update_check 设置项
  useEffect(() => {
    let mounted = true
    ;(async (): Promise<void> => {
      try {
        const value = await settingsStore.get(AUTO_CHECK_KEY)
        if (mounted) {
          // 无记录时默认 true
          setAutoCheckEnabled(value === undefined || value === null || value === true)
        }
      } catch {
        // 读取失败默认 true
      } finally {
        if (mounted) setLoadingSetting(false)
      }
    })()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 启动后自动检查触发的 available 状态，弹右下角通知
  const [notified, setNotified] = useState(false)
  useEffect(() => {
    if (status === 'available' && info && !notified) {
      setNotified(true)
      notification.info({
        message: '发现新版本',
        description: `辩盒 v${info.version} 已发布，点击「关于」页查看详情`,
        placement: 'bottomRight',
        duration: 8
      })
    }
    // 重置通知标记：用户手动重新检查时允许再次通知
    if (status === 'checking') {
      setNotified(false)
    }
  }, [status, info, notified])

  /** 切换自动检查开关 */
  const handleToggleAutoCheck = async (checked: boolean): Promise<void> => {
    setAutoCheckEnabled(checked)
    try {
      await setAutoCheck(checked)
      await settingsStore.set(AUTO_CHECK_KEY, checked)
      if (checked) {
        if (isPackaged) {
          // 打包环境：立即检查一次并备忘
          void checkForUpdates()
          toast.info('已开启，下次启动将自动检查（已立即检查一次）')
        } else {
          toast.info('已开启，下次启动生效（开发环境不执行更新检查）')
        }
      } else {
        toast.info('已关闭，下次启动不再自动检查')
      }
    } catch (e) {
      // 持久化失败回滚 UI
      setAutoCheckEnabled(!checked)
    }
  }

  /** 渲染状态展示区 */
  const renderStatusArea = (): JSX.Element => {
    switch (status) {
      case 'idle':
        return (
          <Text type="secondary">
            <InfoCircleOutlined style={{ marginRight: 6 }} />
            点击「检查更新」查看是否有新版本
          </Text>
        )

      case 'checking':
        return (
          <Space>
            <Spin size="small" />
            <Text type="secondary">正在检查...</Text>
          </Space>
        )

      case 'available':
        return (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message={
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text>
                  发现新版本 <Tag color="green">v{info?.version}</Tag>
                </Text>
                <Space>
                  <Button
                    type="primary"
                    icon={isMacos ? <LinkOutlined /> : <DownloadOutlined />}
                    onClick={() => downloadUpdate()}
                  >
                    {isMacos ? '前往下载' : '立即下载'}
                  </Button>
                  <Link href={info?.releaseUrl} target="_blank">
                    查看更新日志
                  </Link>
                </Space>
                {isMacos && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    macOS 暂不支持应用内自动更新，将在浏览器中打开下载页面
                  </Text>
                )}
              </Space>
            }
          />
        )

      case 'not-available':
        return (
          <Alert
            type="info"
            showIcon
            message="已是最新版本"
            description={`当前版本已是最新，无需更新。`}
          />
        )

      case 'downloading':
        return (
          <div>
            <Progress
              percent={Math.round(progress?.percent ?? 0)}
              status="active"
              format={(p) => `${p}%`}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(progress?.transferred ?? 0)} / {formatBytes(progress?.total ?? 0)}
              （{formatBytes(progress?.bytesPerSecond ?? 0)}/s）
            </Text>
          </div>
        )

      case 'downloaded':
        return (
          <Alert
            type="success"
            showIcon
            message="下载完成"
            description={
              <Space>
                <Button type="primary" icon={<ReloadOutlined />} onClick={() => installUpdate()}>
                  立即重启安装
                </Button>
                <Button>稍后</Button>
              </Space>
            }
          />
        )

      case 'error':
        return (
          <Alert
            type="error"
            showIcon
            icon={<WarningOutlined />}
            message="检查/下载失败"
            description={
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {error}
                </Text>
                <Button icon={<SyncOutlined />} onClick={() => checkForUpdates()}>
                  重试
                </Button>
              </Space>
            }
          />
        )

      default:
        return <Text type="secondary">未知状态</Text>
    }
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <CloudSyncOutlined style={{ color: '#1677ff' }} />
          <span>应用更新</span>
        </Space>
      }
      style={{ marginBottom: spacing.md }}
    >
      {/* 顶部：自动检查开关 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.sm
        }}
      >
        <Text>启动时自动检查更新</Text>
        <Switch
          checked={autoCheckEnabled}
          loading={loadingSetting}
          onChange={handleToggleAutoCheck}
        />
      </div>

      {/* 开发（未打包）环境提示：不执行更新检查，开关仍可切换 */}
      {!isPackaged && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: spacing.md }}
          message="开发（未打包）环境不执行更新检查，安装包版本才生效"
        />
      )}

      {/* 中部：检查按钮 + 当前版本 */}
      <div style={{ marginBottom: spacing.md }}>
        <Space>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            loading={status === 'checking'}
            onClick={() => checkForUpdates()}
          >
            检查更新
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前版本：{APP_VERSION}
          </Text>
        </Space>
      </div>

      {/* 底部：状态展示区 */}
      {renderStatusArea()}
    </Card>
  )
}
