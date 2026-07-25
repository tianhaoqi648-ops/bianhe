import {
  Card,
  Form,
  Select,
  InputNumber,
  Switch,
  Slider,
  Button,
  Divider,
  Typography,
  Space
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { TopicFilter, Team } from '../../../../shared/types';
import FilterPanel from '../FilterPanel';
import TeamPairing, { type TeamPair } from './TeamPairing';

export interface DrawConfigState {
  eventId: string | null;
  roundId: string | null;
  topicCount: number;
  includeStance: boolean;
  teamPairs: TeamPair[];
  filter: TopicFilter;
  includeKeywords: string[];
  excludeKeywords: string[];
  sourceMixEnabled: boolean;
  officialRatio: number; // 0~100
}

export interface DrawConfigPanelProps {
  state: DrawConfigState;
  onChange: (patch: Partial<DrawConfigState>) => void;
  events: Array<{ id: string; name: string }>;
  rounds: Array<{ id: string; name: string | null; difficulty_override: string | null }>;
  teams: Team[];
  tagOptions: string[];
  loading: boolean;
  onDraw: () => void;
}

export default function DrawConfigPanel({
  state,
  onChange,
  events,
  rounds,
  teams,
  tagOptions,
  loading,
  onDraw
}: DrawConfigPanelProps) {
  const canDraw =
    !!state.eventId &&
    state.topicCount > 0 &&
    state.topicCount <= 20 &&
    (!state.includeStance ||
      (state.teamPairs.length > 0 && state.teamPairs.every((p) => p.teamA && p.teamB)));

  const currentRound = rounds.find((r) => r.id === state.roundId);

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          <span>抽取配置</span>
        </Space>
      }
      size="small"
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Form layout="vertical" size="small">
        <Form.Item label="赛事" required>
          <Select
            placeholder="选择赛事"
            value={state.eventId ?? undefined}
            onChange={(v) => onChange({ eventId: v ?? null, roundId: null, teamPairs: [] })}
            options={events.map((e) => ({ label: e.name, value: e.id }))}
            allowClear
          />
        </Form.Item>

        <Form.Item label="轮次">
          <Select
            placeholder="选择轮次（可选，决定难度梯度）"
            value={state.roundId ?? undefined}
            onChange={(v) => onChange({ roundId: v ?? null })}
            options={rounds.map((r) => ({
              label: r.name ?? `轮次 ${r.id.slice(0, 4)}`,
              value: r.id
            }))}
            allowClear
            disabled={!state.eventId}
          />
          {currentRound?.difficulty_override && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              该轮次难度梯度：{currentRound.difficulty_override}
            </Typography.Text>
          )}
        </Form.Item>

        <Form.Item label="辩题数量" required>
          <InputNumber
            min={1}
            max={20}
            value={state.topicCount}
            onChange={(v) => onChange({ topicCount: v ?? 1 })}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="同时抽取持方（正反方）">
          <Switch
            checked={state.includeStance}
            onChange={(v) => onChange({ includeStance: v })}
          />
        </Form.Item>

        {state.includeStance && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <TeamPairing
              teams={teams}
              pairs={state.teamPairs}
              onChange={(pairs) => onChange({ teamPairs: pairs })}
            />
          </>
        )}

        <Divider style={{ margin: '12px 0' }} />

        <Form.Item label="题库混合比例（官方 : 自定义）">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Switch
              size="small"
              checked={state.sourceMixEnabled}
              onChange={(v) => onChange({ sourceMixEnabled: v })}
            />
            {state.sourceMixEnabled && (
              <>
                <Slider
                  min={0}
                  max={100}
                  step={10}
                  value={state.officialRatio}
                  onChange={(v) => onChange({ officialRatio: v })}
                  marks={{ 0: '0:10', 30: '3:7', 50: '5:5', 70: '7:3', 100: '10:0' }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  官方 {state.officialRatio}% : 自定义 {100 - state.officialRatio}%
                </Typography.Text>
              </>
            )}
          </Space>
        </Form.Item>

        <Divider style={{ margin: '12px 0' }}>筛选条件</Divider>

        <FilterPanel
          filter={state.filter}
          onChange={(f) => onChange({ filter: { ...state.filter, ...f } })}
          onReset={() => onChange({ filter: {} })}
          tagOptions={tagOptions}
          includeKeywords={state.includeKeywords}
          excludeKeywords={state.excludeKeywords}
          onIncludeKeywordsChange={(v) => onChange({ includeKeywords: v })}
          onExcludeKeywordsChange={(v) => onChange({ excludeKeywords: v })}
        />

        <Divider style={{ margin: '12px 0' }} />

        <Button
          type="primary"
          size="large"
          block
          icon={<ThunderboltOutlined />}
          onClick={onDraw}
          disabled={!canDraw || loading}
          loading={loading}
          className={canDraw && !loading ? 'pulse-primary' : ''}
        >
          开始抽取
        </Button>
        {!canDraw && (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, marginTop: 4, display: 'block', textAlign: 'center' }}
          >
            请完善赛事/数量/队伍配置
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}
