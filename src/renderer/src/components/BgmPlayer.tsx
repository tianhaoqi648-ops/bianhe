// ============================================================
// BgmPlayer.tsx — BGM 播放器组件（P3.1 Task 3）
//
// 提供播放/暂停/切换曲目的 UI 控件，并通过 forwardRef 暴露
// imperative API（play / stop / setVolume），供父组件命令式调用。
//
// 使用场景：
// - Settings 试听 BGM
// - 抽辩过程手动控制 BGM
// ============================================================

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Button, Space, Select, Slider, Typography } from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SoundOutlined
} from '@ant-design/icons'
import { useSoundManager, type BgmTrackId, type BgmPlayOptions } from './SoundManager'

export interface BgmPlayerHandle {
  /** 播放指定曲目 */
  play: (trackId: BgmTrackId, opts?: BgmPlayOptions) => void
  /** 停止播放（支持淡出） */
  stop: (fadeMs?: number) => void
  /** 设置音量（0-1） */
  setVolume: (v: number) => void
}

export interface BgmPlayerProps {
  /** 初始曲目 */
  trackId?: BgmTrackId
  /** 初始音量（0-100，内部转换为 0-1） */
  volume?: number
  /** 是否自动播放 */
  autoPlay?: boolean
  /** 是否显示控件（false 时仅暴露 imperative API） */
  showControls?: boolean
}

const TRACK_OPTIONS: Array<{ value: BgmTrackId; label: string }> = [
  { value: 'ethereal', label: '空灵（ethereal）' },
  { value: 'solemn', label: '庄重（solemn）' },
  { value: 'stirring', label: '激昂（stirring）' }
]

const BgmPlayer = forwardRef<BgmPlayerHandle, BgmPlayerProps>(function BgmPlayer(
  {
    trackId: initialTrackId = 'ethereal',
    volume: initialVolume = 50,
    autoPlay = false,
    showControls = true
  },
  ref
) {
  const { playBgm, stopBgm, setBgmVolume } = useSoundManager()
  const [trackId, setTrackId] = useState<BgmTrackId>(initialTrackId)
  const [volume, setVolume] = useState<number>(initialVolume)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)

  // autoPlay 时自动播放
  useEffect(() => {
    if (autoPlay) {
      playBgm(trackId, { loop: true, volume: volume / 100 })
      setIsPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 暴露 imperative API
  useImperativeHandle(ref, () => ({
    play: (tid: BgmTrackId, opts?: BgmPlayOptions) => {
      setTrackId(tid)
      if (opts?.volume != null) setVolume(opts.volume * 100)
      playBgm(tid, opts)
      setIsPlaying(true)
    },
    stop: (fadeMs?: number) => {
      stopBgm(fadeMs)
      setIsPlaying(false)
    },
    setVolume: (v: number) => {
      setVolume(v * 100)
      setBgmVolume(v)
    }
  }), [playBgm, stopBgm, setBgmVolume])

  const handlePlayPause = () => {
    if (isPlaying) {
      stopBgm(300)
      setIsPlaying(false)
    } else {
      playBgm(trackId, { loop: true, volume: volume / 100 })
      setIsPlaying(true)
    }
  }

  const handleTrackChange = (tid: BgmTrackId) => {
    setTrackId(tid)
    if (isPlaying) {
      playBgm(tid, { loop: true, volume: volume / 100 })
    }
  }

  const handleVolumeChange = (v: number) => {
    setVolume(v)
    setBgmVolume(v / 100)
  }

  if (!showControls) return null

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Button
          type={isPlaying ? 'primary' : 'default'}
          icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={handlePlayPause}
        >
          {isPlaying ? '暂停' : '播放'}
        </Button>
        <Select<BgmTrackId>
          value={trackId}
          onChange={handleTrackChange}
          options={TRACK_OPTIONS}
          style={{ width: 180 }}
        />
      </Space>
      <Space align="center" style={{ width: '100%' }}>
        <SoundOutlined style={{ fontSize: 16, color: '#999' }} />
        <Slider
          min={0}
          max={100}
          value={volume}
          onChange={handleVolumeChange}
          style={{ flex: 1, minWidth: 200 }}
          tooltip={{ formatter: (v) => `${v}%` }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 40 }}>
          {volume}%
        </Typography.Text>
      </Space>
    </Space>
  )
})

export default BgmPlayer
