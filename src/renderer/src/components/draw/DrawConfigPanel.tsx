import {
  Form,
  Select,
  InputNumber,
  Switch,
  Slider,
  Divider,
  Alert,
  Typography,
  Space,
  Collapse,
  Segmented,
  Button,
  Tag,
  Checkbox,
  Tooltip
} from 'antd';
import type { CollapseProps } from 'antd';
import { ThunderboltOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { TopicFilter, Team, TeamGroup } from '../../../../shared/types';
import FilterPanel from '../FilterPanel';
import TeamPairing, { type TeamPair } from './TeamPairing';
import type { RevealMode } from './RevealAnimation';
import { spacing } from '../../styles/tokens';

/** 持方模式：对战模式（两两配对） / 单人模式（仅一支队伍，引擎随机分配正反方） */
export type StanceMode = 'versus' | 'solo';

/** 抽取模式：一对一对阵 / 按分组同题 / 多队同题 */
export type DrawMode = 'versus' | 'group' | 'multi_team';

export interface DrawConfigState {
  eventId: string | null;
  roundId: string | null;
  topicCount: number;
  includeStance: boolean;
  /** 持方模式：仅在 includeStance=true 时生效 */
  stanceMode: StanceMode;
  /** 对战模式下的对阵配对 */
  teamPairs: TeamPair[];
  /** 单人模式下的队伍 id */
  soloTeamId: string | null;
  filter: TopicFilter;
  includeKeywords: string[];
  excludeKeywords: string[];
  sourceMixEnabled: boolean;
  officialRatio: number; // 0~100
  /** 抽取模式：versus 对战（默认） / group 按分组同题 / multi_team 多队同题 */
  drawMode: DrawMode;
  /** group 模式下选中的分组 id 列表 */
  groupIds: string[];
  /** multi_team 模式下每题队伍数（>=2，默认 2） */
  teamsPerTopic: number;
  /** 抽题选库：选中的题组 id（null 表示全库抽取） */
  groupId: string | null;
  /** P3.1 Task 1：揭晓动画模式，默认 'flip' 翻牌 */
  revealMode: RevealMode;
}

export interface DrawConfigPanelProps {
  state: DrawConfigState;
  onChange: (patch: Partial<DrawConfigState>) => void;
  events: Array<{ id: string; name: string }>;
  rounds: Array<{ id: string; name: string | null; difficulty_override: string | null; is_round_robin?: boolean }>;
  teams: Team[];
  /** 赛事下的分组列表（group 模式使用） */
  groups: TeamGroup[];
  /** 当前赛事绑定的题库（题组）列表，用于「抽题选库」 */
  topicGroups: Array<{ id: string; name: string; isDefault: boolean }>;
  tagOptions: string[];
  loading?: boolean;
  onDraw?: () => void;
  /** 测试模式开关（状态提升到 DrawPage） */
  testMode: boolean;
  onTestModeChange: (v: boolean) => void;
  /** 允许辩题重复（状态提升到 DrawPage，默认值由父组件根据 event.allow_repeat 决定） */
  allowRepeat: boolean;
  onAllowRepeatChange: (v: boolean) => void;
  /** 赛事级 allow_repeat 配置（0/1），仅作初始值参考，实际值由父组件控制 */
  eventAllowRepeat?: number;
}

export default function DrawConfigPanel({
  state,
  onChange,
  events,
  rounds,
  teams,
  groups,
  topicGroups,
  tagOptions,
  loading,
  onDraw,
  testMode,
  onTestModeChange,
  allowRepeat,
  onAllowRepeatChange
}: DrawConfigPanelProps) {
  // 校验：
  // - versus 不开持方：只校验赛事/数量
  // - versus 对战模式：每对 teamA + teamB 都必须选齐
  // - versus 单人模式：必须选一支队伍（soloTeamId 非空）
  // - group 模式：必须选至少一个分组
  // - multi_team 模式：必须设置 teamsPerTopic >= 2 且队伍数能整除
  const teamsForMultiMode = teams;
  const multiTeamCountOk =
    teamsForMultiMode.length > 0 && teamsForMultiMode.length % state.teamsPerTopic === 0;

  const canDraw =
    !!state.eventId &&
    (state.drawMode === 'group'
      ? state.groupIds.length > 0
      : state.drawMode === 'multi_team'
        ? state.teamsPerTopic >= 2 && multiTeamCountOk
        : // versus
          state.topicCount > 0 &&
          state.topicCount <= 20 &&
          (!state.includeStance ||
            (state.stanceMode === 'versus'
              ? state.teamPairs.length > 0 && state.teamPairs.every((p) => p.teamA && p.teamB)
              : !!state.soloTeamId)));

  // group 模式下：topicCount 由分组数决定，不强制 1-20 区间
  // multi_team 模式下：topicCount 由 队伍数/teamsPerTopic 决定
  // 这里仅在 versus 模式下保持原 1-20 约束

  const currentRound = rounds.find((r) => r.id === state.roundId);

  // 切换抽取模式时清空不相关字段
  const handleDrawModeChange = (next: DrawMode) => {
    if (next === state.drawMode) return;
    const patch: Partial<DrawConfigState> = { drawMode: next };
    // 切换到非 versus 模式时清空 versus 模式特有字段（保留 teamPairs，便于切回）
    // 切换到非 group 模式时清空 groupIds
    if (next !== 'group') patch.groupIds = [];
    // 切换到非 multi_team 模式时清空 teamsPerTopic 为默认值
    if (next !== 'multi_team') patch.teamsPerTopic = 2;
    onChange(patch);
  };

  // 仅输出 Form 内容，外层 Card 由 DrawPage 负责包裹（避免 Card 嵌套）
  // SubTask 18.1：内部改用 Collapse 折叠面板，分为基础配置 / 高级配置 / 题源比例 三组
  return (
    <Form layout="vertical" size="middle" style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <Collapse
        defaultActiveKey={['basic']}
        ghost
        size="small"
        style={{ marginLeft: -8, marginRight: -8 }}
        items={[
          {
            key: 'basic',
            label: '基础配置',
            children: (
              <>
                <Form.Item label="赛事" required>
                  <Select
                    placeholder="选择赛事"
                    value={state.eventId ?? undefined}
                    onChange={(v) => onChange({ eventId: v ?? null, roundId: null, teamPairs: [], groupIds: [], groupId: null })}
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

                <Form.Item label="题库">
                  <Select
                    placeholder="选择题库（默认默认题库）"
                    value={state.groupId ?? undefined}
                    onChange={(v) => onChange({ groupId: v ?? null })}
                    options={topicGroups.map((g) => ({
                      label: g.isDefault ? `${g.name}（默认）` : g.name,
                      value: g.id
                    }))}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    disabled={!state.eventId || topicGroups.length === 0}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {topicGroups.length > 0
                      ? state.groupId
                        ? '只从所选题库的辩题中抽取'
                        : '未选择题库：从全体辩题中抽取'
                      : '该赛事未绑定题库，将按全体辩题抽取'}
                  </Typography.Text>
                </Form.Item>

                <Form.Item label="辩题数量" required>
                  <InputNumber
                    min={1}
                    max={20}
                    value={state.topicCount}
                    onChange={(v) => onChange({ topicCount: v ?? 1 })}
                    style={{ width: '100%' }}
                    disabled={state.drawMode !== 'versus'}
                  />
                  {state.drawMode === 'group' && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      分组模式下题数 = 选中分组数（自动覆盖）
                    </Typography.Text>
                  )}
                  {state.drawMode === 'multi_team' && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      多队同题模式下题数 = 队伍数 ÷ 每题队伍数（自动覆盖）
                    </Typography.Text>
                  )}
                </Form.Item>

                <Form.Item label="抽取模式">
                  <Segmented<DrawMode>
                    block
                    value={state.drawMode}
                    onChange={(v) => handleDrawModeChange(v)}
                    options={[
                      { label: '一对一对阵', value: 'versus' },
                      { label: '按分组同题', value: 'group' },
                      { label: '多队同题', value: 'multi_team' }
                    ]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {state.drawMode === 'versus'
                      ? '两两配对，引擎为每对随机分配正反方'
                      : state.drawMode === 'group'
                        ? '每分组打同一道题，同组所有队伍同题'
                        : '将队伍随机分组，每组打同一道题'}
                  </Typography.Text>
                </Form.Item>

                {/* ---------- group 模式：分组多选 ---------- */}
                {state.drawMode === 'group' && (
                  <>
                    <div style={{ marginTop: 8 }}>
                      <Space>
                        <span>当前轮次赛制：</span>
                        {!currentRound ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            请先选择轮次
                          </Typography.Text>
                        ) : currentRound.is_round_robin ? (
                          <Tag color="gold">循环赛（不分正反方）</Tag>
                        ) : (
                          <Tag color="silver">淘汰赛（分正反方）</Tag>
                        )}
                        {currentRound && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            请在轮次编辑中修改
                          </Typography.Text>
                        )}
                      </Space>
                    </div>
                    <Divider plain orientation="left" style={{ margin: '12px 0' }}>
                      分组配置
                    </Divider>
                    <Form.Item label="选择分组" required>
                      <Select
                        mode="multiple"
                        placeholder="选择参与抽取的分组"
                        value={state.groupIds}
                        onChange={(v) => onChange({ groupIds: v })}
                        options={groups.map((g) => ({ label: g.name, value: g.id }))}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        disabled={!state.eventId}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        共 {state.groupIds.length} 个分组 · 题数将自动设置为 {state.groupIds.length}
                      </Typography.Text>
                    </Form.Item>
                  </>
                )}

                {/* ---------- multi_team 模式：每题队伍数 ---------- */}
                {state.drawMode === 'multi_team' && (
                  <>
                    <Divider plain orientation="left" style={{ margin: '12px 0' }}>
                      多队同题配置
                    </Divider>
                    <Form.Item label="每题队伍数" required>
                      <InputNumber
                        min={2}
                        max={20}
                        value={state.teamsPerTopic}
                        onChange={(v) => onChange({ teamsPerTopic: v ?? 2 })}
                        style={{ width: '100%' }}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        赛事下共 {teams.length} 队 · 题数将自动设置为{' '}
                        {teams.length > 0 && state.teamsPerTopic > 0 && teams.length % state.teamsPerTopic === 0
                          ? `${teams.length / state.teamsPerTopic}`
                          : '（队伍数需为每题队伍数的整数倍）'}
                      </Typography.Text>
                      {teams.length > 0 && state.teamsPerTopic > 0 && teams.length % state.teamsPerTopic !== 0 && (
                        <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                          当前队伍数 {teams.length} 不能被 {state.teamsPerTopic} 整除
                        </Typography.Text>
                      )}
                    </Form.Item>
                  </>
                )}

                {/* ---------- versus 模式：原有持方配置 ---------- */}
                {state.drawMode === 'versus' && (
                  <>
                    <Form.Item label="同时抽取持方（正反方）">
                      <Switch
                        checked={state.includeStance}
                        onChange={(v) => onChange({ includeStance: v })}
                      />
                    </Form.Item>

                    {state.includeStance && (
                      <>
                        <Divider plain orientation="left" style={{ margin: '12px 0' }}>
                          持方配置
                        </Divider>
                        <Form.Item label="持方模式">
                          <Segmented
                            block
                            value={state.stanceMode}
                            onChange={(v) => onChange({ stanceMode: v as StanceMode })}
                            options={[
                              { label: '对战模式', value: 'versus' },
                              { label: '单人模式', value: 'solo' }
                            ]}
                          />
                          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                            {state.stanceMode === 'versus'
                              ? '两两配对，引擎为每对随机分配正反方'
                              : '仅一支队伍，引擎为每道题随机分配正方或反方'}
                          </Typography.Text>
                        </Form.Item>

                        {state.stanceMode === 'versus' ? (
                          <TeamPairing
                            teams={teams}
                            pairs={state.teamPairs}
                            onChange={(pairs) => onChange({ teamPairs: pairs })}
                          />
                        ) : (
                          <Form.Item label="选择队伍" required>
                            <Select
                              placeholder="选择一支队伍"
                              value={state.soloTeamId ?? undefined}
                              onChange={(v) => onChange({ soloTeamId: v ?? null })}
                              options={teams.map((t) => ({ label: t.name, value: t.id }))}
                              allowClear
                              showSearch
                              optionFilterProp="label"
                            />
                            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                              持方（正方/反方）在抽取时由引擎随机分配。
                            </Typography.Text>
                          </Form.Item>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )
          },
          {
            key: 'sourceRatio',
            label: '题源比例',
            children: (
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
            )
          },
          {
            key: 'advanced',
            label: '高级配置',
            children: (
              <>
                <Divider style={{ margin: '8px 0 12px' }} orientation="left" plain>
                  揭晓动画
                </Divider>
                <Form.Item label="揭晓模式">
                  <Select<RevealMode>
                    value={state.revealMode}
                    onChange={(v) => onChange({ revealMode: v })}
                    options={[
                      { value: 'tear', label: '撕开（金色封面左右分离）' },
                      { value: 'spotlight', label: '聚光灯（左到右扫描）' },
                      { value: 'fade', label: '渐显（最简洁，默认）' }
                    ]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    大屏揭晓与全屏展示模式生效；小屏动画不受影响
                  </Typography.Text>
                </Form.Item>

                <Divider style={{ margin: '8px 0 12px' }} orientation="left" plain>
                  筛选条件
                </Divider>
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
              </>
            )
          }
        ] as CollapseProps['items']}
      />

      <Divider style={{ margin: '12px 0' }} />

      {/* 测试模式 + 允许辩题重复：状态提升到 DrawPage，buildParams 时使用 */}
      <Form.Item
        label={
          <span>
            测试模式&nbsp;
            <Tooltip title="开启后：不写队伍历史、不排除已抽辩题、默认允许重复抽取">
              <QuestionCircleOutlined />
            </Tooltip>
          </span>
        }
      >
        <Switch
          checked={testMode}
          onChange={onTestModeChange}
          checkedChildren="测试"
          unCheckedChildren="正式"
        />
      </Form.Item>

      <Form.Item
        label={
          <span>
            允许辩题重复&nbsp;
            <Tooltip title="开启后允许同一辩题被多次抽出（有放回抽样）">
              <QuestionCircleOutlined />
            </Tooltip>
          </span>
        }
      >
        <Checkbox
          checked={allowRepeat}
          onChange={(e) => onAllowRepeatChange(e.target.checked)}
          disabled={testMode}
        >
          {testMode ? '测试模式已强制开启' : '本次抽取允许重复辩题'}
        </Checkbox>
      </Form.Item>

      <Button
        type="primary"
        block
        className="pulse-primary"
        icon={<ThunderboltOutlined />}
        disabled={!canDraw}
        loading={loading}
        onClick={onDraw}
      >
        开始抽取
      </Button>

      {!canDraw && (
        <Alert
          type="warning"
          showIcon
          banner
          message={
            !state.eventId
              ? '请选择赛事'
              : state.drawMode === 'group'
                ? '请选择至少一个分组'
                : state.drawMode === 'multi_team'
                  ? !multiTeamCountOk && state.teamsPerTopic > 0
                    ? `队伍数 ${teams.length} 需为每题队伍数 ${state.teamsPerTopic} 的整数倍`
                    : '请设置每题队伍数 ≥2'
                    : state.includeStance
                      ? state.stanceMode === 'solo'
                        ? '请完善赛事/数量并选择一支队伍'
                        : '请完善赛事/数量/队伍配置（每对需选齐 A、B 两方）'
                      : '请完善赛事/数量配置'
          }
          style={{ marginTop: 8 }}
        />
      )}
    </Form>
  );
}
