import { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Radio,
  InputNumber,
  Divider,
  message
} from 'antd';
import dayjs from 'dayjs';
import type {
  EventCreateInput,
  RoundCreateInput,
  TeamCreateInput
} from '../../../shared/types';
import { primaryButtonStyle } from '../styles/shared';

export interface EventWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (eventId: string) => void;
}

// 难度梯度一键预设方案（与 EventManage 中的 DIFFICULTY_PRESETS 保持一致）
const DIFFICULTY_PRESETS: Array<{
  key: string;
  label: string;
  presets: Array<{ name: string; round_number: number; difficulty_override: string }>;
}> = [
  {
    key: 'standard',
    label: '标准赛制（分组赛→复赛→决赛）',
    presets: [
      { name: '分组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '复赛', round_number: 2, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 3, difficulty_override: '专业级' }
    ]
  },
  {
    key: 'compact',
    label: '紧凑赛制（初赛→决赛）',
    presets: [
      { name: '初赛', round_number: 1, difficulty_override: '入门级' },
      { name: '决赛', round_number: 2, difficulty_override: '进阶级' }
    ]
  },
  {
    key: 'extended',
    label: '长赛制（小组赛→淘汰赛→半决赛→决赛）',
    presets: [
      { name: '小组赛', round_number: 1, difficulty_override: '入门级' },
      { name: '淘汰赛', round_number: 2, difficulty_override: '入门级' },
      { name: '半决赛', round_number: 3, difficulty_override: '进阶级' },
      { name: '决赛', round_number: 4, difficulty_override: '专业级' }
    ]
  }
];

const STATUS_OPTIONS = [
  { label: '筹备中', value: 'preparing' },
  { label: '进行中', value: 'ongoing' },
  { label: '已结束', value: 'finished' }
];

// 默认值常量
const DEFAULT_ROUND_PRESET = 'standard';
const DEFAULT_TOPIC_COUNT = 4;
const DEFAULT_TEAM_MODE: 'none' | 'auto' | 'custom' = 'auto';
const DEFAULT_TEAM_COUNT = 8;
const DEFAULT_TEAM_TEXT = '';

export default function EventWizardModal({
  open,
  onClose,
  onSuccess
}: EventWizardModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [roundPreset, setRoundPreset] = useState<string>(DEFAULT_ROUND_PRESET);
  const [topicCount, setTopicCount] = useState<number>(DEFAULT_TOPIC_COUNT);
  const [teamMode, setTeamMode] = useState<'none' | 'auto' | 'custom'>(DEFAULT_TEAM_MODE);
  const [teamCount, setTeamCount] = useState<number>(DEFAULT_TEAM_COUNT);
  const [teamText, setTeamText] = useState<string>(DEFAULT_TEAM_TEXT);

  // 重置所有 state 到默认值
  const resetState = () => {
    form.resetFields();
    form.setFieldsValue({
      status: 'preparing',
      start_date: dayjs(),
      end_date: dayjs().add(7, 'day')
    });
    setRoundPreset(DEFAULT_ROUND_PRESET);
    setTopicCount(DEFAULT_TOPIC_COUNT);
    setTeamMode(DEFAULT_TEAM_MODE);
    setTeamCount(DEFAULT_TEAM_COUNT);
    setTeamText(DEFAULT_TEAM_TEXT);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      // 1. 创建赛事
      const eventData: EventCreateInput = {
        name: values.name,
        status: values.status,
        start_date: values.start_date
          ? dayjs(values.start_date).format('YYYY-MM-DD')
          : null,
        end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : null
      };
      const eventRes = await window.eventAPI.createEvent(eventData);
      if (!eventRes.success || !eventRes.data) {
        throw new Error(eventRes.error || '创建赛事失败');
      }
      const eventId = eventRes.data.id;

      // 2. 创建轮次（如果选了预设）
      if (roundPreset !== 'none') {
        const preset = DIFFICULTY_PRESETS.find((p) => p.key === roundPreset);
        if (preset) {
          for (const r of preset.presets) {
            const roundData: RoundCreateInput = {
              event_id: eventId,
              name: r.name,
              round_number: r.round_number,
              difficulty_override: r.difficulty_override,
              topic_count: topicCount
            };
            const res = await window.eventAPI.createRound(roundData);
            if (!res.success) {
              throw new Error(`创建轮次"${r.name}"失败：${res.error}`);
            }
          }
        }
      }

      // 3. 创建队伍
      if (teamMode === 'auto') {
        for (let i = 1; i <= teamCount; i++) {
          const teamData: TeamCreateInput = {
            name: `队伍 ${i}`,
            event_id: eventId
          };
          const res = await window.eventAPI.createTeam(teamData);
          if (!res.success) {
            throw new Error(`创建队伍 ${i} 失败：${res.error}`);
          }
        }
      } else if (teamMode === 'custom') {
        const lines = teamText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const teamData: TeamCreateInput = {
            name: lines[i],
            event_id: eventId
          };
          const res = await window.eventAPI.createTeam(teamData);
          if (!res.success) {
            throw new Error(`创建队伍"${lines[i]}"失败：${res.error}`);
          }
        }
      }

      messageApi.success('赛事创建成功');
      onSuccess?.(eventId);
      handleClose();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="新建赛事向导"
      open={open}
      onCancel={handleClose}
      width={640}
      destroyOnClose
      maskClosable={!creating}
      okText="创建"
      cancelText="取消"
      confirmLoading={creating}
      okButtonProps={{ style: primaryButtonStyle }}
      onOk={handleCreate}
    >
      {contextHolder}
      <Form form={form} layout="vertical" preserve={false} initialValues={{ status: 'preparing' }}>
        <Divider orientation="left" plain>
          📌 赛事信息
        </Divider>

        <Form.Item
          name="name"
          label="赛事名称"
          rules={[{ required: true, message: '请输入赛事名称' }]}
        >
          <Input placeholder="如：2026 校园辩论赛" maxLength={100} />
        </Form.Item>

        <Form.Item name="start_date" label="开始日期">
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择开始日期" />
        </Form.Item>

        <Form.Item name="end_date" label="结束日期">
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择结束日期" />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>

        <Divider orientation="left" plain>
          🔄 轮次预设
        </Divider>

        <Form.Item label="赛制方案">
          <Radio.Group
            value={roundPreset}
            onChange={(e) => setRoundPreset(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="none">不创建轮次</Radio>
            {DIFFICULTY_PRESETS.map((p) => (
              <Radio key={p.key} value={p.key}>
                {p.label}
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>

        <Form.Item label="本轮题量">
          <InputNumber
            min={1}
            max={50}
            value={topicCount}
            onChange={(v) => setTopicCount(typeof v === 'number' ? v : DEFAULT_TOPIC_COUNT)}
            disabled={roundPreset === 'none'}
            style={{ width: 120 }}
          />
        </Form.Item>

        <Divider orientation="left" plain>
          👥 队伍配置
        </Divider>

        <Form.Item label="队伍生成方式">
          <Radio.Group
            value={teamMode}
            onChange={(e) => setTeamMode(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="none">不创建队伍</Radio>
            <Radio value="auto">自动生成 N 支占位队伍</Radio>
            <Radio value="custom">自定义队伍名（每行一支）</Radio>
          </Radio.Group>
        </Form.Item>

        {teamMode === 'auto' && (
          <Form.Item label="队伍数量">
            <InputNumber
              min={1}
              max={128}
              value={teamCount}
              onChange={(v) => setTeamCount(typeof v === 'number' ? v : DEFAULT_TEAM_COUNT)}
              style={{ width: 120 }}
            />
          </Form.Item>
        )}

        {teamMode === 'custom' && (
          <Form.Item label="队伍名（每行一支）">
            <Input.TextArea
              value={teamText}
              onChange={(e) => setTeamText(e.target.value)}
              rows={6}
              placeholder={'队伍 1\n队伍 2\n队伍 3'}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
