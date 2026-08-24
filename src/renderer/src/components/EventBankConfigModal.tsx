import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  Alert,
  Empty,
  Button,
  Divider,
  Spin
} from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  SlidersOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { useEventStore } from '../stores/eventStore';
import { useToast } from '../hooks/useToast';
import { undoManager } from '../utils/undo-manager';
import {
  buildEventBankConfig,
  planRoundBankSync,
  bankModeLabel
} from '../utils/eventTopicBank';
import type { Event, TopicGroup, EventBankConfig, DrawBankMode } from '../../../shared/types';

const { Text } = Typography;

const MODE_OPTIONS: Array<{ value: DrawBankMode; label: string; desc: string }> = [
  { value: 'single', label: '单选库', desc: '从绑定题库中选一个，抽题仅取自该库（缺省）' },
  { value: 'union', label: '绑定并集', desc: '把全部绑定题库合并为一个候选池抽取' },
  { value: 'priority', label: '顺序后备', desc: '按优先级顺序取库，前库不足自动用下一库补足' },
  { value: 'by_round', label: '按轮次指定', desc: '为每个轮次分别指定用哪些题库' }
];

/**
 * 赛事选题模式配置 Modal（T3）。
 *
 * 从「赛事题库」进来的配置入口：选择 mode，并按模式配置
 *   - single：从绑定题库选单一库
 *   - priority：对绑定题库排优先级顺序（priorityOrder）
 *   - by_round：为每个轮次选择用哪几个题库（roundBanks → 同步 round_topic_groups）
 * 保存统一写 events.bank_config（setEventBankConfig）。
 */
export default function EventBankConfigModal({
  open,
  onClose,
  event,
  boundGroups,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  event: Event;
  /** 该赛事已绑定的题库（作为各模式的可选库） */
  boundGroups: TopicGroup[];
  /** 保存成功后回调（父级可据需刷新） */
  onSaved: () => void;
}) {
  const toast = useToast();
  const eventStore = useEventStore();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rounds, setRounds] = useState<Array<{ id: string; name: string | null }>>([]);
  // 草稿态
  const [mode, setMode] = useState<DrawBankMode>('single');
  const [priorityGroupIds, setPriorityGroupIds] = useState<string[]>([]);
  const [roundBanks, setRoundBanks] = useState<Record<string, string[]>>({});

  const boundIds = useMemo(() => boundGroups.map((g) => g.id), [boundGroups]);

  const reload = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    try {
      const [cfgRes, roundRes] = await Promise.all([
        window.groupAPI.getEventBankConfig(event.id),
        window.eventAPI.listRoundsByEvent(event.id)
      ]);
      const cfg: EventBankConfig = cfgRes.success && cfgRes.data
        ? cfgRes.data
        : { mode: 'single' };
      const roundsList =
        roundRes.success && roundRes.data
          ? roundRes.data
          : eventStore.rounds.filter((r) => r.event_id === event.id);
      setRounds(roundsList);

      // 初始化草稿：priorityOrder 视为已选库顺序；roundBanks 逐轮
      setMode(cfg.mode);
      setPriorityGroupIds(cfg.priorityOrder ? [...cfg.priorityOrder] : []);
      const rb: Record<string, string[]> = {};
      for (const r of roundsList) {
        rb[r.id] = cfg.roundBanks?.[r.id] ? [...cfg.roundBanks[r.id]] : [];
      }
      setRoundBanks(rb);
    } catch {
      setMode('single');
      setPriorityGroupIds([]);
      setRoundBanks({});
    } finally {
      setLoading(false);
    }
  }, [event, eventStore.rounds]);

  useEffect(() => {
    if (open && event) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  // 只保留还在绑定库中的已选（绑定库里被解绑的自动剔除，避免写入失效 id）
  const sanitizedPriorityIds = useMemo(
    () => priorityGroupIds.filter((id) => boundIds.includes(id)),
    [priorityGroupIds, boundIds]
  );
  const sanitizedRoundBanks: Record<string, string[]> = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [rid, ids] of Object.entries(roundBanks)) {
      out[rid] = ids.filter((id) => boundIds.includes(id));
    }
    return out;
  }, [roundBanks, boundIds]);

  const canSave = useMemo(() => {
    if (boundGroups.length === 0) return false;
    if (mode === 'single') return sanitizedPriorityIds.length === 1;
    if (mode === 'priority') return true;
    if (mode === 'by_round') return true;
    // union：无需额外配置
    return true;
  }, [mode, sanitizedPriorityIds, boundGroups]);

  const handleModeChange = (next: DrawBankMode) => {
    setMode(next);
    if (next === 'single' && sanitizedPriorityIds.length > 0) {
      // single 仅保留首个
      setPriorityGroupIds([sanitizedPriorityIds[0]]);
    }
  };

  const move = (index: number, delta: number) => {
    const next = [...sanitizedPriorityIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPriorityGroupIds(next);
  };

  const setRoundBanksFor = (roundId: string, ids: string[]) => {
    setRoundBanks((prev) => ({ ...prev, [roundId]: ids }));
  };

  const handleSave = async () => {
    if (!event) return;
    setSaving(true);
    try {
      const config = buildEventBankConfig({
        mode,
        priorityGroupIds: sanitizedPriorityIds,
        roundBanks: sanitizedRoundBanks
      });
      const res = await window.groupAPI.setEventBankConfig({
        eventId: event.id,
        config
      });
      if (!res.success) throw new Error(res.error || '保存选题模式失败');
      // Governance-8.3：bank 配置接入 undo
      undoManager.pushEntry({
        storeName: 'topicGroup',
        action: 'setBankConfig',
        targetType: 'event',
        targetId: event.id,
        label: '更新选题模式',
        logId: res._undoLogId ?? undefined
      });

      // by_round：同步 round_topic_groups 表（engine 的 by_round 按它解析），保证增删生效
      if (mode === 'by_round') {
        const currentByRound: Record<string, string[]> = {};
        for (const r of rounds) {
          const cur = await window.groupAPI.listGroupsByRound(r.id);
          currentByRound[r.id] = cur.success && cur.data ? cur.data.map((g) => g.id) : [];
        }
        const ops = planRoundBankSync(sanitizedRoundBanks, currentByRound);
        for (const op of ops) {
          for (const gid of op.unbind) {
            const unbindRes = await window.groupAPI.unbindRoundGroup({ roundId: op.roundId, groupId: gid });
            // Governance-8.3：轮次题库解绑接入 undo
            if (unbindRes.success) {
              undoManager.pushEntry({
                storeName: 'topicGroup',
                action: 'bindRound',
                targetType: 'round',
                targetId: op.roundId,
                label: `解绑轮次题库`,
                logId: unbindRes._undoLogId ?? undefined
              });
            }
          }
          if (op.bind.length > 0) {
            const bindRes = await window.groupAPI.bindRoundGroups({ roundId: op.roundId, groupIds: op.bind });
            // Governance-8.3：轮次题库绑定接入 undo
            if (bindRes.success) {
              undoManager.pushEntry({
                storeName: 'topicGroup',
                action: 'bindRound',
                targetType: 'round',
                targetId: op.roundId,
                label: '绑定轮次题库',
                logId: bindRes._undoLogId ?? undefined
              });
            }
          }
        }
      }

      toast.success(`已保存选题模式：${bankModeLabel[mode]}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <SlidersOutlined />
          <span>选题模式配置</span>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {event.name}
          </Text>
        </Space>
      }
      width={600}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !canSave }}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {boundGroups.length === 0 ? (
          <Empty description="该赛事尚未绑定题库，请先在「赛事题库」页添加至少一个题库后再配置选题模式" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 4 }}>
            <Alert
              type="info"
              showIcon
              message="选题模式决定本赛事抽题时的候选题库如何确定；DrawPage 抽题将按此模式解析。"
            />

            {/* 模式选择 */}
            <div>
              <Text strong>抽题方式</Text>
              <Segmented<DrawBankMode>
                block
                value={mode}
                onChange={handleModeChange}
                options={MODE_OPTIONS.map((m) => ({ label: m.label, value: m.value }))}
                style={{ marginTop: 8 }}
              />
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
                {MODE_OPTIONS.find((m) => m.value === mode)?.desc}
              </Text>
            </div>

            <Divider style={{ margin: '4px 0' }} />

            {mode === 'single' && (
              <div>
                <Text strong>选择题库</Text>
                <Select
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="从绑定题库中选择一个"
                  value={
                    sanitizedPriorityIds.length === 1 ? sanitizedPriorityIds[0] : undefined
                  }
                  onChange={(v) => setPriorityGroupIds(v ? [v] : [])}
                  options={boundGroups.map((g) => ({
                    label: g.isDefault ? `${g.name}（默认）` : g.name,
                    value: g.id
                  }))}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                />
              </div>
            )}

            {mode === 'priority' && (
              <div>
                <Text strong>
                  排列顺序（优先级由高到低，前库不足自动用下一库补足）
                </Text>
                {sanitizedPriorityIds.length === 0 ? (
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
                    请从下方未选库中添加到顺序列表。若不配置则退化为「绑定并集」。
                  </Text>
                ) : (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sanitizedPriorityIds.map((gid, idx) => {
                      const g = boundGroups.find((x) => x.id === gid);
                      return (
                        <Space
                          key={gid}
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: 'rgba(128,128,128,0.06)'
                          }}
                        >
                          <Space size={6}>
                            <Text strong>{idx + 1}.</Text>
                            <Text>{g?.name ?? '(已解绑)'}</Text>
                          </Space>
                          <Space size={2}>
                            <Button
                              size="small"
                              type="text"
                              icon={<ArrowUpOutlined />}
                              disabled={idx === 0}
                              onClick={() => move(idx, -1)}
                            />
                            <Button
                              size="small"
                              type="text"
                              icon={<ArrowDownOutlined />}
                              disabled={idx === sanitizedPriorityIds.length - 1}
                              onClick={() => move(idx, 1)}
                            />
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                setPriorityGroupIds(
                                  sanitizedPriorityIds.filter((_, i) => i !== idx)
                                )
                              }
                            />
                          </Space>
                        </Space>
                      );
                    })}
                  </div>
                )}
                <Select
                  mode="multiple"
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="添加题库到顺序列表"
                  value={[]}
                  onChange={(vals) =>
                    setPriorityGroupIds((prev) => [
                      ...prev,
                      ...(vals as string[]).filter((v) => !prev.includes(v))
                    ])
                  }
                  options={boundGroups
                    .filter((g) => !sanitizedPriorityIds.includes(g.id))
                    .map((g) => ({ label: g.name, value: g.id }))}
                  showSearch
                  optionFilterProp="label"
                />
              </div>
            )}

            {mode === 'by_round' && (
              <div>
                <Text strong>为每个轮次指定题库</Text>
                {rounds.length === 0 ? (
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
                    该赛事暂无轮次，无法配置按轮次选题。
                  </Text>
                ) : (
                  <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 8 }}>
                    {rounds.map((r) => {
                      const selected = sanitizedRoundBanks[r.id] ?? [];
                      return (
                        <div key={r.id}>
                          <Text strong style={{ fontSize: 13 }}>
                            {r.name ?? `轮次 ${r.id.slice(0, 4)}`}
                          </Text>
                          <Select
                            mode="multiple"
                            style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择该轮次的题库（可多选）"
                            value={selected}
                            onChange={(vals) => setRoundBanksFor(r.id, vals as string[])}
                            options={boundGroups.map((g) => ({
                              label: g.name,
                              value: g.id
                            }))}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                          />
                        </div>
                      );
                    })}
                  </Space>
                )}
              </div>
            )}

            {mode === 'union' && (
              <Alert
                type="success"
                showIcon
                message="绑定并集：本赛事绑定的全部题库合并为候选池，无需额外配置。"
              />
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {boundGroups.map((g) => (
                <Tag key={g.id} color={g.isDefault ? 'gold' : 'blue'}>
                  {g.name}
                </Tag>
              ))}
            </div>
          </Space>
        )}
      </Spin>
    </Modal>
  );
}