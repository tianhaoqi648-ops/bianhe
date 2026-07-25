import { Button, Space, Typography, Empty, Tag, theme } from 'antd';
import { DesktopOutlined, ReloadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { DrawResult, Team } from '../../../../shared/types';
import DrawResultCard from './DrawResultCard';

export interface DrawResultListProps {
  result: DrawResult;
  teams: Team[];
  onBigScreen: () => void;
  onRedo: () => void;
}

export default function DrawResultList({
  result,
  teams,
  onBigScreen,
  onRedo
}: DrawResultListProps) {
  const { token } = theme.useToken();
  const { session, topics, actual_ratio } = result;

  if (topics.length === 0) {
    return <Empty description="暂无抽取结果" />;
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          background: token.colorBgContainer,
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
          marginBottom: 12
        }}
      >
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
          <Typography.Text strong>抽取完成</Typography.Text>
          <Typography.Text type="secondary">
            共 {topics.length} 题 · {session.draw_time ?? ''}
          </Typography.Text>
          {actual_ratio && (
            <Tag>
              题源 官方 {Math.round(actual_ratio.official * 100)}% : 自定义{' '}
              {Math.round(actual_ratio.custom * 100)}%
            </Tag>
          )}
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRedo}>
            重新抽取
          </Button>
          <Button type="primary" icon={<DesktopOutlined />} onClick={onBigScreen}>
            投屏模式
          </Button>
        </Space>
      </div>

      {/* 结果卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {topics.map((topic, idx) => {
          const item = session.items.find((it) => it.topic_id === topic.id);
          if (!item) return null;
          return (
            <div key={topic.id} className={`fade-up fade-up-delay-${Math.min(idx + 1, 6)}`}>
              <DrawResultCard index={idx} topic={topic} item={item} teams={teams} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
