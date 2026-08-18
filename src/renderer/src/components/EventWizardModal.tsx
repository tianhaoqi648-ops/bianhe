import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Radio,
  InputNumber,
  Divider,
  Table,
  Button,
  Space,
  Popconfirm,
  Typography,
  Tag,
  Switch,
  Tooltip
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type {
  Event,
  EventCreateInput,
  EventUpdateInput,
  Round,
  RoundCreateInput,
  RoundUpdateInput,
  Team,
  TeamCreateInput,
  TeamGroup,
  TeamGroupCreateInput
} from '../../../shared/types';
import { useToast } from '../hooks/useToast';
import { primaryButtonStyle } from '../styles/shared';
import { PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons';
// P4-18 修复：提取公共常量到 shared/difficulty-presets.ts，避免与 EventManage 重复定义
import { DIFFICULTY_PRESETS, DIFFICULTY_OPTIONS } from '../../../shared/difficulty-presets';

export interface EventWizardModalProps {
  open: boolean;
  /** 传入 event 进入编辑模式；null/undefined 为新建 */
  event?: Event | null;
  onClose: () => void;
  onSuccess?: (eventId: string) => void;
}

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
const DEFAULT_GROUP_TEXT = '';

// 编辑模式下使用的轮次行（携带 id 标识，null 表示新增未持久化）
interface RoundRow {
  id: string | null;
  name: string;
  round_number: number;
  difficulty_override: string | null;
  topic_count: number;
}

const { Text } = Typography;

export default function EventWizardModal({
  open,
  event,
  onClose,
  onSuccess
}: EventWizardModalProps) {
  const toast = useToast();
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [roundPreset, setRoundPreset] = useState<string>(DEFAULT_ROUND_PRESET);
  const [topicCount, setTopicCount] = useState<number>(DEFAULT_TOPIC_COUNT);
  const [teamMode, setTeamMode] = useState<'none' | 'auto' | 'custom'>(DEFAULT_TEAM_MODE);
  const [teamCount, setTeamCount] = useState<number>(DEFAULT_TEAM_COUNT);
  const [teamText, setTeamText] = useState<string>(DEFAULT_TEAM_TEXT);
  // 新建模式：预设分组（每行一个分组名）
  const [groupText, setGroupText] = useState<string>(DEFAULT_GROUP_TEXT);

  // 编辑模式专用 state
  const isEdit = !!event;
  const [loading, setLoading] = useState(false);
  // 编辑模式下的轮次行（可编辑/删除/新增）
  const [roundRows, setRoundRows] = useState<RoundRow[]>([]);
  // 编辑模式下原始轮次/队伍/分组快照（保存时用于差异比对）
  const [originalRounds, setOriginalRounds] = useState<Round[]>([]);
  const [originalTeams, setOriginalTeams] = useState<Team[]>([]);
  const [originalGroups, setOriginalGroups] = useState<TeamGroup[]>([]);
  // 编辑模式下的队伍/分组文本（按行编辑）
  const [editTeamText, setEditTeamText] = useState<string>('');
  const [editGroupText, setEditGroupText] = useState<string>('');
  // 新增轮次的内联表单
  const [newRoundName, setNewRoundName] = useState('');
  const [newRoundNumber, setNewRoundNumber] = useState<number>(1);
  const [newRoundDifficulty, setNewRoundDifficulty] = useState<string | null>('入门级');
  const [newRoundTopicCount, setNewRoundTopicCount] = useState<number>(4);
  // P3-21 修复：cancelled 标志，防止并发调用 loadEventData 时旧响应覆盖新数据
  const loadCancelledRef = useRef(false);

  // ====== 打开时初始化（新建 / 编辑） ======
  useEffect(() => {
    if (!open) return;
    // P3-21 修复：每次打开时重置 cancelled 标志，关闭/切换 event 时置为 true
    loadCancelledRef.current = false;
    if (event) {
      // 编辑模式：延迟到下一事件循环，确保 Form.Item 完成注册后再设值
      // P2-37 修复：queueMicrotask 在微任务阶段执行，此时 Form.Item 可能尚未完成注册
      // （Modal 的 destroyOnHidden 会让 Form.Item 在打开时重新挂载，需等注册完成）
      // 改用 setTimeout(0) 推到下一个宏任务，给 Form.Item 充分的注册时间
      // allow_repeat (number) -> boolean 给 Switch（0 → false, 1 → true）
      setTimeout(() => {
        form.setFieldsValue({
          name: event.name,
          status: event.status ?? 'preparing',
          start_date: event.start_date ? dayjs(event.start_date, 'YYYY-MM-DD') : undefined,
          end_date: event.end_date ? dayjs(event.end_date, 'YYYY-MM-DD') : undefined,
          allow_repeat: !!event.allow_repeat
        });
      }, 0);
      // 拉取该赛事的轮次 / 队伍 / 分组
      void loadEventData(event.id);
    } else {
      // 新建模式：默认值；允许重复默认关闭
      form.resetFields();
      form.setFieldsValue({
        status: 'preparing',
        start_date: dayjs(),
        end_date: dayjs().add(7, 'day'),
        allow_repeat: false
      });
      setRoundPreset(DEFAULT_ROUND_PRESET);
      setTopicCount(DEFAULT_TOPIC_COUNT);
      setTeamMode(DEFAULT_TEAM_MODE);
      setTeamCount(DEFAULT_TEAM_COUNT);
      setTeamText(DEFAULT_TEAM_TEXT);
      setGroupText(DEFAULT_GROUP_TEXT);
      setRoundRows([]);
      setOriginalRounds([]);
      setOriginalTeams([]);
      setOriginalGroups([]);
      setEditTeamText('');
      setEditGroupText('');
    }
    // P3-21 修复：cleanup 时置 cancelled=true，使进行中的 loadEventData 不再写入 state
    return () => {
      loadCancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event]);

  const loadEventData = async (eventId: string) => {
    setLoading(true);
    try {
      const [roundsRes, teamsRes, groupsRes] = await Promise.all([
        window.eventAPI.listRoundsByEvent(eventId),
        window.eventAPI.listTeamsByEvent(eventId),
        window.eventAPI.listGroups(eventId)
      ]);
      // P3-21 修复：并发调用时若已被取消（用户切换 event / 关闭弹窗），丢弃旧响应
      if (loadCancelledRef.current) return;
      const rounds = roundsRes.success && roundsRes.data ? (roundsRes.data as Round[]) : [];
      const teams = teamsRes.success && teamsRes.data ? (teamsRes.data as Team[]) : [];
      const groups = groupsRes.success && groupsRes.data ? (groupsRes.data as TeamGroup[]) : [];
      setOriginalRounds(rounds);
      setOriginalTeams(teams);
      setOriginalGroups(groups);
      setRoundRows(
        rounds.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          round_number: r.round_number ?? 1,
          difficulty_override: r.difficulty_override ?? null,
          topic_count: r.topic_count ?? 4
        }))
      );
      setEditTeamText(teams.map((t) => t.name).join('\n'));
      setEditGroupText(groups.map((g) => g.name).join('\n'));
    } catch (e) {
      if (loadCancelledRef.current) return;
      toast.error(e instanceof Error ? e.message : '加载赛事数据失败');
    } finally {
      if (!loadCancelledRef.current) setLoading(false);
    }
  };

  // ====== 编辑模式：轮次行操作 ======
  const handleAddRoundRow = () => {
    if (!newRoundName.trim()) {
      toast.error('请输入轮次名称');
      return;
    }
    setRoundRows((prev) => [
      ...prev,
      {
        id: null,
        name: newRoundName.trim(),
        round_number: newRoundNumber,
        difficulty_override: newRoundDifficulty,
        topic_count: newRoundTopicCount
      }
    ]);
    // 重置新增表单
    setNewRoundName('');
    setNewRoundNumber((prev) => prev + 1);
    setNewRoundDifficulty('入门级');
    setNewRoundTopicCount(4);
  };

  const handleDeleteRoundRow = (idx: number) => {
    setRoundRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateRoundRow = (idx: number, patch: Partial<RoundRow>) => {
    setRoundRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // ====== 关闭弹窗 ======
  const handleClose = () => {
    onClose();
  };

  // ====== 新建模式：创建赛事 + 批量创建子项 ======
  const handleCreateNew = async () => {
    const values = await form.validateFields();
    // 1. 创建赛事
    // allow_repeat: Switch 的 boolean -> number（1/0）传给后端
    const eventData: EventCreateInput = {
      name: values.name,
      status: values.status,
      start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : null,
      end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : null,
      allow_repeat: values.allow_repeat ? 1 : 0
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
      const lines = teamText.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const teamData: TeamCreateInput = { name: line, event_id: eventId };
        const res = await window.eventAPI.createTeam(teamData);
        if (!res.success) {
          throw new Error(`创建队伍"${line}"失败：${res.error}`);
        }
      }
    }

    // 4. 创建分组（每行一个分组名）
    const groupLines = groupText.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < groupLines.length; i++) {
      const groupData: TeamGroupCreateInput = {
        event_id: eventId,
        name: groupLines[i],
        sort_order: i + 1
      };
      const res = await window.eventAPI.createGroup(groupData);
      if (!res.success) {
        throw new Error(`创建分组"${groupLines[i]}"失败：${res.error}`);
      }
    }

    return eventId;
  };

  // ====== 编辑模式：更新赛事 + 差异同步子项 ======
  const handleUpdateExisting = async () => {
    if (!event) throw new Error('编辑模式缺少 event');
    const values = await form.validateFields();
    const eventId = event.id;

    // 1. 更新赛事基本字段
    // allow_repeat: Switch 的 boolean -> number（1/0）传给后端
    const updateData: EventUpdateInput = {
      name: values.name,
      status: values.status,
      start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : null,
      end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : null,
      allow_repeat: values.allow_repeat ? 1 : 0
    };
    const updateRes = await window.eventAPI.updateEvent(eventId, updateData);
    if (!updateRes.success) {
      throw new Error(updateRes.error || '更新赛事失败');
    }

    // 2. 同步轮次：按 id 匹配，新增的 create，删除的 delete，修改的 update
    const originalRoundIds = new Set(originalRounds.map((r) => r.id));
    const currentRoundIds = new Set(roundRows.filter((r) => r.id).map((r) => r.id as string));
    // 删除：原列表中存在，当前列表中不存在
    for (const r of originalRounds) {
      if (!currentRoundIds.has(r.id)) {
        const res = await window.eventAPI.deleteRound(r.id);
        if (!res.success) {
          throw new Error(`删除轮次"${r.name}"失败：${res.error}`);
        }
      }
    }
    // 新增 + 修改
    for (const row of roundRows) {
      if (!row.id) {
        // 新增
        const createData: RoundCreateInput = {
          event_id: eventId,
          name: row.name,
          round_number: row.round_number,
          difficulty_override: row.difficulty_override,
          topic_count: row.topic_count
        };
        const res = await window.eventAPI.createRound(createData);
        if (!res.success) {
          throw new Error(`创建轮次"${row.name}"失败：${res.error}`);
        }
      } else if (originalRoundIds.has(row.id)) {
        // 修改：与原数据比对，有变化才 update
        const orig = originalRounds.find((r) => r.id === row.id);
        if (
          orig &&
          (orig.name !== row.name ||
            (orig.round_number ?? null) !== row.round_number ||
            (orig.difficulty_override ?? null) !== (row.difficulty_override ?? null) ||
            (orig.topic_count ?? null) !== row.topic_count)
        ) {
          const patch: RoundUpdateInput = {
            name: row.name,
            round_number: row.round_number,
            difficulty_override: row.difficulty_override,
            topic_count: row.topic_count
          };
          const res = await window.eventAPI.updateRound(row.id, patch);
          if (!res.success) {
            throw new Error(`更新轮次"${row.name}"失败：${res.error}`);
          }
        }
      }
    }

    // 3. 同步队伍：textarea 按行匹配
    // 策略：按行号对应原队伍（前 min 行 update），多出的 delete，新增的 create
    const teamLines = editTeamText.split('\n').map((l) => l.trim()).filter(Boolean);
    // 修改：前 min(原长度, 当前长度) 行 update
    const updateCount = Math.min(originalTeams.length, teamLines.length);
    for (let i = 0; i < updateCount; i++) {
      const orig = originalTeams[i];
      if (orig.name !== teamLines[i]) {
        const res = await window.eventAPI.updateTeam(orig.id, { name: teamLines[i] });
        if (!res.success) {
          throw new Error(`更新队伍"${teamLines[i]}"失败：${res.error}`);
        }
      }
    }
    // 删除：原列表多于当前行数的部分
    if (originalTeams.length > teamLines.length) {
      for (let i = teamLines.length; i < originalTeams.length; i++) {
        const res = await window.eventAPI.deleteTeam(originalTeams[i].id);
        if (!res.success) {
          throw new Error(`删除队伍"${originalTeams[i].name}"失败：${res.error}`);
        }
      }
    }
    // 新增：当前行数多于原列表的部分
    if (teamLines.length > originalTeams.length) {
      for (let i = originalTeams.length; i < teamLines.length; i++) {
        const res = await window.eventAPI.createTeam({
          name: teamLines[i],
          event_id: eventId
        });
        if (!res.success) {
          throw new Error(`创建队伍"${teamLines[i]}"失败：${res.error}`);
        }
      }
    }

    // 4. 同步分组：textarea 按行匹配
    const groupLines = editGroupText.split('\n').map((l) => l.trim()).filter(Boolean);
    const updateGroupCount = Math.min(originalGroups.length, groupLines.length);
    for (let i = 0; i < updateGroupCount; i++) {
      const orig = originalGroups[i];
      if (orig.name !== groupLines[i]) {
        const res = await window.eventAPI.updateGroup(orig.id, {
          name: groupLines[i],
          sort_order: i + 1
        });
        if (!res.success) {
          throw new Error(`更新分组"${groupLines[i]}"失败：${res.error}`);
        }
      }
    }
    if (originalGroups.length > groupLines.length) {
      for (let i = groupLines.length; i < originalGroups.length; i++) {
        const res = await window.eventAPI.deleteGroup(originalGroups[i].id);
        if (!res.success) {
          throw new Error(`删除分组"${originalGroups[i].name}"失败：${res.error}`);
        }
      }
    }
    if (groupLines.length > originalGroups.length) {
      for (let i = originalGroups.length; i < groupLines.length; i++) {
        const res = await window.eventAPI.createGroup({
          event_id: eventId,
          name: groupLines[i],
          sort_order: i + 1
        });
        if (!res.success) {
          throw new Error(`创建分组"${groupLines[i]}"失败：${res.error}`);
        }
      }
    }

    return eventId;
  };

  // ====== 主提交入口 ======
  const handleSubmit = async () => {
    setCreating(true);
    try {
      const eventId = isEdit ? await handleUpdateExisting() : await handleCreateNew();
      toast.success(isEdit ? '赛事已更新' : '赛事创建成功');
      onSuccess?.(eventId);
      handleClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isEdit ? '更新失败' : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // ====== 编辑模式：轮次表格列定义 ======
  const roundRowColumns: ColumnsType<RoundRow> = useMemo(
    () => [
      {
        title: '#',
        key: 'round_number',
        width: 70,
        render: (_: any, record: RoundRow) => (
          <InputNumber
            min={1}
            max={99}
            value={record.round_number}
            onChange={(v) =>
              handleUpdateRoundRow(roundRows.indexOf(record), {
                round_number: typeof v === 'number' ? v : 1
              })
            }
            style={{ width: '100%' }}
          />
        )
      },
      {
        title: '轮次名称',
        key: 'name',
        render: (_: any, record: RoundRow) => (
          <Input
            value={record.name}
            onChange={(e) =>
              handleUpdateRoundRow(roundRows.indexOf(record), { name: e.target.value })
            }
            placeholder="如：分组赛"
          />
        )
      },
      {
        title: '难度',
        key: 'difficulty_override',
        width: 130,
        render: (_: any, record: RoundRow) => (
          <Select
            allowClear
            value={record.difficulty_override ?? undefined}
            onChange={(v) =>
              handleUpdateRoundRow(roundRows.indexOf(record), {
                difficulty_override: v ?? null
              })
            }
            options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
            placeholder="不限"
            style={{ width: '100%' }}
          />
        )
      },
      {
        title: '题量',
        key: 'topic_count',
        width: 90,
        render: (_: any, record: RoundRow) => (
          <InputNumber
            min={1}
            max={50}
            value={record.topic_count}
            onChange={(v) =>
              handleUpdateRoundRow(roundRows.indexOf(record), {
                topic_count: typeof v === 'number' ? v : 4
              })
            }
            style={{ width: '100%' }}
          />
        )
      },
      {
        title: '',
        key: 'action',
        width: 60,
        render: (_: any, record: RoundRow) => (
          <Popconfirm
            title="确认删除该轮次？"
            onConfirm={() => handleDeleteRoundRow(roundRows.indexOf(record))}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        )
      }
    ],
    [roundRows]
  );

  return (
    <Modal
      title={isEdit ? '编辑赛事' : '新建赛事向导'}
      open={open}
      onCancel={handleClose}
      width={720}
      destroyOnHidden
      maskClosable={!creating}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={creating || loading}
      okButtonProps={{ style: primaryButtonStyle }}
      onOk={handleSubmit}
    >
      <Form form={form} layout="vertical" initialValues={{ status: 'preparing' }}>
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

        {/* 允许辩题重复：开启后该赛事抽取时允许同一辩题被多次抽出（有放回抽样） */}
        <Form.Item
          name="allow_repeat"
          label={
            <span>
              允许辩题重复&nbsp;
              <Tooltip title="开启后该赛事抽取时允许同一辩题被多次抽出（有放回抽样）">
                <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
              </Tooltip>
            </span>
          }
          valuePropName="checked"
        >
          <Switch checkedChildren="允许" unCheckedChildren="不允许" />
        </Form.Item>

        {isEdit ? (
          <>
            {/* ====== 编辑模式：轮次列表（可编辑/删除/新增） ====== */}
            <Divider orientation="left" plain>
              🔄 轮次设置（{roundRows.length}）
            </Divider>
            <Table
              columns={roundRowColumns}
              dataSource={roundRows}
              rowKey={(r, idx) => r.id ?? `new-${idx}`}
              size="small"
              pagination={false}
              locale={{ emptyText: '暂无轮次' }}
            />
            {/* 新增轮次内联表单 */}
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: '#fafafa',
                border: '1px dashed #d9d9d9',
                borderRadius: 6
              }}
            >
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                <PlusOutlined /> 新增轮次
              </Text>
              <Space wrap>
                <InputNumber
                  min={1}
                  max={99}
                  value={newRoundNumber}
                  onChange={(v) => setNewRoundNumber(typeof v === 'number' ? v : 1)}
                  placeholder="序号"
                  style={{ width: 80 }}
                />
                <Input
                  value={newRoundName}
                  onChange={(e) => setNewRoundName(e.target.value)}
                  placeholder="轮次名称"
                  style={{ width: 180 }}
                  maxLength={50}
                />
                <Select
                  allowClear
                  value={newRoundDifficulty ?? undefined}
                  onChange={(v) => setNewRoundDifficulty(v ?? null)}
                  options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
                  placeholder="难度"
                  style={{ width: 120 }}
                />
                <InputNumber
                  min={1}
                  max={50}
                  value={newRoundTopicCount}
                  onChange={(v) => setNewRoundTopicCount(typeof v === 'number' ? v : 4)}
                  placeholder="题量"
                  style={{ width: 90 }}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRoundRow}>
                  添加
                </Button>
              </Space>
            </div>

            {/* ====== 编辑模式：队伍（按行编辑） ====== */}
            <Divider orientation="left" plain>
              👥 队伍列表（每行一支，{editTeamText.split('\n').filter((l) => l.trim()).length} 支）
            </Divider>
            <Form.Item label="队伍名（每行一支，空行忽略）">
              <Input.TextArea
                value={editTeamText}
                onChange={(e) => setEditTeamText(e.target.value)}
                rows={6}
                placeholder={'北京大学辩论队\n清华大学辩论队\n复旦大学辩论队'}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                原队伍数：<Tag color="blue">{originalTeams.length}</Tag> ·
                当前行数：
                <Tag color="purple">
                  {editTeamText.split('\n').filter((l) => l.trim()).length}
                </Tag>
                · 按行位置匹配：前 min(原, 现) 行更新，多出删除，新增追加
              </Text>
            </div>

            {/* ====== 编辑模式：分组（按行编辑） ====== */}
            <Divider orientation="left" plain>
              🏷️ 分组列表（每行一个，{editGroupText.split('\n').filter((l) => l.trim()).length} 个）
            </Divider>
            <Form.Item label="分组名（每行一个，空行忽略）">
              <Input.TextArea
                value={editGroupText}
                onChange={(e) => setEditGroupText(e.target.value)}
                rows={4}
                placeholder={'A 组\nB 组\nC 组'}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                原分组数：<Tag color="blue">{originalGroups.length}</Tag> ·
                当前行数：
                <Tag color="purple">
                  {editGroupText.split('\n').filter((l) => l.trim()).length}
                </Tag>
                · 按行位置匹配：前 min(原, 现) 行更新，多出删除，新增追加
              </Text>
            </div>
          </>
        ) : (
          <>
            {/* ====== 新建模式：原预设 + 自定义队伍 + 预设分组 ====== */}
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

            <Divider orientation="left" plain>
              🏷️ 分组预设
            </Divider>

            <Form.Item
              label="分组名（每行一个，空行忽略）"
              help="可选。创建赛事时一并建立分组，便于「分组同题」抽取模式使用"
            >
              <Input.TextArea
                value={groupText}
                onChange={(e) => setGroupText(e.target.value)}
                rows={4}
                placeholder={'A 组\nB 组\nC 组'}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
