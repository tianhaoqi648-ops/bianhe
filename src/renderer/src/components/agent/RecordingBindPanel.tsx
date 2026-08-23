// ============================================================
// RecordingBindPanel.tsx — 多录音绑定管理（T4）
//
// 列出该场比赛所有 BoundRecording（whole 整场 / stage 单环节），
// 支持 添加(wav/mp3/m4a/flac) / 移除 / 重新选择 / 整组清空，
// 统一走 recordingAPI.bind（add/remove/replace/set）持久化到
// matches.recording_meta。对每份展示文件是否存在（缺失态，T3）。
//
// 与 JudgeArena 的关系：挂在「录音与转写」块内，通过 onChanged
// 通知父级刷新本场录音列表与存在性。纯展示 + IPC，不含评审逻辑。
// ============================================================

import { useCallback, useState } from 'react'
import {
  Button,
  Empty,
  Radio,
  Space,
  Tag,
  Typography,
  Modal,
  Input
} from 'antd'
import {
  AudioOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useToast } from '../../hooks/useToast'
import type {
  BoundRecording,
  RecordingBindAction
} from '../../../../shared/types'
import {
  withExists,
  filenameOf,
  type RecordingExistsMap
} from '../../utils/matchRecordingKit'

const { Text } = Typography

/** 录音类型选择（添加时） */
type AddKind = 'whole' | 'stage'

const RECORDING_EXT = ['wav', 'mp3', 'm4a', 'flac']

export interface RecordingBindPanelProps {
  matchId: string
  /** 当前这场比赛的有序录音列表（listForMatch 的结果；未绑定场次时 null/空则整体禁用） */
  recordings: BoundRecording[] | null
  /** 存在性映射（recording.id → 文件是否存在），由父级经 recordingAPI.exists 校验后传入 */
  existsMap: RecordingExistsMap
  /** 绑定变更成功后回调（父级重新拉取录音列表 + 存在性） */
  onChanged: () => void
  /** 是否在转写中（禁用部分操作） */
  busy?: boolean
}

/**
 * 多录音绑定管理面板。
 * 由于父级 JudgeArena 需要把「不存在」的录音如实反映（T3），本组件直接消费传入的 existsMap。
 */
export function RecordingBindPanel({
  matchId,
  recordings,
  existsMap,
  onChanged,
  busy
}: RecordingBindPanelProps): JSX.Element | null {
  const toast = useToast()
  const [bindBusy, setBindBusy] = useState(false)

  // 添加 弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<AddKind>('whole')
  const [addStageId] = useState<string | undefined>(undefined)
  const [addStageName, setAddStageName] = useState('')

  const list = withExists(recordings ?? [], existsMap)
  const missingCount = list.filter((r) => !r.exists).length

  /** 主进程 bind 封装，带 loading 与错误提示 */
  const runBind = useCallback(
    async (action: RecordingBindAction): Promise<BoundRecording[] | null> => {
      setBindBusy(true)
      try {
        const res = await window.recordingAPI.bind(action)
        if (!res.success) {
          toast.error(res.error || '录音绑定失败')
          return null
        }
        onChanged()
        return res.data ?? null
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setBindBusy(false)
      }
    },
    [onChanged, toast]
  )

  /** 选择音频文件（wav/mp3/m4a/flac） */
  const pickAudio = async (): Promise<string | null> => {
    const w = window as unknown as {
      fileAPI?: {
        pickFile: (f: Array<{ name: string; extensions: string[] }>) => Promise<{ success: boolean; data?: string | null; error?: string }>
      }
    }
    const fileAPI = w.fileAPI
    if (!fileAPI) {
      toast.error('文件服务未就绪（window.fileAPI 不可用）')
      return null
    }
    try {
      const picked = await fileAPI.pickFile([{ name: '录音文件', extensions: RECORDING_EXT }])
      if (!picked.success) {
        toast.error(picked.error ?? '选择录音文件失败')
        return null
      }
      return picked.data ?? null
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  /** 构造一份新 BoundRecording（添加时使用，id 以文件路径稳定生成） */
  const buildRecording = (filePath: string, kind: AddKind): BoundRecording => {
    const base = filenameOf(filePath || `rec-${Date.now()}`)
    const id = base.replace(/\.[^.]+$/, '')
    if (kind === 'stage') {
      return {
        id: id || `rec-${Date.now()}`,
        kind: 'stage',
        filePath,
        stageId: addStageId || undefined,
        tsMs: null,
        markers: [
          {
            tsMs: 0,
            stageId: addStageId || 'stage',
            stageName: addStageName.trim() || '环节',
            side: null,
            speaker: null,
            filePath
          }
        ]
      }
    }
    return { id: id || `rec-${Date.now()}`, kind: 'whole', filePath, markers: [] }
  }

  /** 添加一份录音 */
  const handleAdd = async (): Promise<void> => {
    const fp = await pickAudio()
    if (!fp) return // 用户取消
    const rec = buildRecording(fp, addKind)
    const next = await runBind({ kind: 'add', matchId, recording: rec })
    if (next) setAddOpen(false)
  }

  /** 移除一份录音 */
  const handleRemove = async (id: string): Promise<void> => {
    await runBind({ kind: 'remove', matchId, id })
  }

  /** 重新选择：替换某份录音的文件（保留其类型与环节归属，仅换 filePath） */
  const handleReplace = async (rec: BoundRecording): Promise<void> => {
    const fp = await pickAudio()
    if (!fp) return
    await runBind({ kind: 'replace', matchId, id: rec.id, recording: { ...rec, filePath: fp } })
  }

  /** 整组清空 */
  const handleClearAll = async (): Promise<void> => {
    await runBind({ kind: 'set', matchId, recordings: null })
  }

  if (!matchId) return null

  return (
    <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 10, marginTop: 6 }}>
      <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
        <Space>
          <AudioOutlined />
          <Text strong style={{ fontSize: 13 }}>录音绑定</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {list.length > 0 ? `${list.length} 份` : '未绑定'}
          </Text>
          {missingCount > 0 ? (
            <Tag color="red" icon={<WarningOutlined />} style={{ marginRight: 0 }}>
              {missingCount} 份缺失
            </Tag>
          ) : null}
        </Space>
        <Space size={4}>
          <Button size="small" icon={<PlusOutlined />} disabled={bindBusy || busy} onClick={() => setAddOpen(true)}>
            添加录音
          </Button>
          {list.length > 0 ? (
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              disabled={bindBusy || busy}
              onClick={() => void handleClearAll()}
            >
              清空
            </Button>
          ) : null}
        </Space>
      </Space>

      {list.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="secondary" style={{ fontSize: 12 }}>尚无绑定录音。点击「添加录音」选择 wav/mp3/m4a/flac 文件。</Text>}
          style={{ margin: '4px 0' }}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          {list.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Tag color={item.recording.kind === 'whole' ? 'purple' : 'orange'} style={{ marginRight: 0, minWidth: 48, textAlign: 'center' }}>
                {item.recording.kind === 'whole' ? '整场' : '环节'}
              </Tag>
              {item.recording.markers?.[0]?.stageName || item.recording.stageId ? (
                <Text type="secondary" style={{ fontSize: 12, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.recording.markers?.[0]?.stageName || item.recording.stageId}
                </Text>
              ) : null}
              <Text
                style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                type={item.exists ? undefined : 'danger'}
              >
                {item.exists ? filenameOf(item.recording.filePath) : '（录音文件缺失/已删除）'}
              </Text>
              <Tag color={item.exists ? 'green' : 'red'} style={{ marginRight: 0 }}>
                {item.exists ? '可用' : '缺失'}
              </Tag>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                disabled={bindBusy || busy}
                title="重新选择录音文件"
                onClick={() => void handleReplace(item.recording)}
              >
                重选
              </Button>
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={bindBusy || busy}
                title="移除该录音"
                onClick={() => void handleRemove(item.id)}
              />
            </div>
          ))}
        </Space>
      )}

      {missingCount > 0 ? (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          存在已失效/被删除的录音引用，相关录音功能将跳过缺失部分或不可用。可「重选」或「移除」后重新绑定。
        </Text>
      ) : null}

      {/* 添加录音弹窗 */}
      <Modal
        title="添加录音"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        okText="选择文件并绑定"
        confirmLoading={bindBusy}
        width={420}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <div>
            <Text strong style={{ fontSize: 13 }}>录音类型</Text>
            <Radio.Group
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as AddKind)}
              options={[
                { value: 'whole', label: '整场整轨' },
                { value: 'stage', label: '单环节成轨' }
              ]}
            />
          </div>
          {addKind === 'stage' ? (
            <Input
              placeholder="环节名（如 开篇立论 / 质询；留空则用「环节」）"
              value={addStageName}
              onChange={(e) => setAddStageName(e.target.value)}
            />
          ) : null}
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持 wav / mp3 / m4a / flac。选择文件后即绑定到本场比赛（写入 recording_meta）。
          </Text>
        </Space>
      </Modal>
    </div>
  )
}

export default RecordingBindPanel