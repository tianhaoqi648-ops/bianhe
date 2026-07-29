import { Button, List, Select, Space, Tag, Typography } from 'antd';
import { SwapOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { Team } from '../../../../shared/types';
import EmptyState from '../common/EmptyState';
import { spacing, fontSize } from '../../styles/tokens';

export interface TeamPair {
  teamA: Team | null;
  teamB: Team | null;
}

export interface TeamPairingProps {
  teams: Team[];
  pairs: TeamPair[];
  onChange: (pairs: TeamPair[]) => void;
}

export default function TeamPairing({ teams, pairs, onChange }: TeamPairingProps) {
  // 自动随机配对（Fisher-Yates 洗牌）
  const autoPair = () => {
    if (teams.length < 2 || teams.length % 2 !== 0) return;
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const newPairs: TeamPair[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      newPairs.push({ teamA: shuffled[i], teamB: shuffled[i + 1] });
    }
    onChange(newPairs);
  };

  const updatePair = (index: number, side: 'A' | 'B', team: Team | null) => {
    const next = [...pairs];
    next[index] = { ...next[index], [side === 'A' ? 'teamA' : 'teamB']: team };
    onChange(next);
  };

  if (teams.length === 0) {
    return <EmptyState type="default" description="该赛事暂无队伍，请先在赛事管理中添加队伍" />;
  }

  if (teams.length % 2 !== 0) {
    return (
      <div style={{ padding: spacing.md, color: '#ff4d4f' }}>
        队伍数量为奇数（{teams.length}），需为偶数才能配对。
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8
        }}
      >
        <Typography.Text strong>对阵配对（{pairs.length} 组）</Typography.Text>
        <Button size="small" icon={<ThunderboltOutlined />} onClick={autoPair}>
          随机配对
        </Button>
      </div>
      <List
        size="small"
        dataSource={pairs}
        renderItem={(pair, idx) => (
          <List.Item>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Select
                size="small"
                style={{ width: 140 }}
                placeholder="队伍 A"
                value={pair.teamA?.id}
                onChange={(v) => updatePair(idx, 'A', teams.find((t) => t.id === v) ?? null)}
                options={teams.map((t) => ({ label: t.name, value: t.id }))}
              />
              <Tag color="red">正/反</Tag>
              <SwapOutlined />
              <Tag color="blue">反/正</Tag>
              <Select
                size="small"
                style={{ width: 140 }}
                placeholder="队伍 B"
                value={pair.teamB?.id}
                onChange={(v) => updatePair(idx, 'B', teams.find((t) => t.id === v) ?? null)}
                options={teams.map((t) => ({ label: t.name, value: t.id }))}
              />
            </Space>
          </List.Item>
        )}
      />
      <Typography.Text type="secondary" style={{ fontSize: fontSize.caption, marginTop: 4, display: 'block' }}>
        持方（正方/反方）在抽取时由引擎随机分配，此处仅配置对阵双方。
      </Typography.Text>
    </div>
  );
}
