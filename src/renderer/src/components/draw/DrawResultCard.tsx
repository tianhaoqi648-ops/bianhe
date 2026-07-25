import { Card, Tag, Space, Typography, theme } from 'antd';
import type { Topic, DrawSessionItem, Team } from '../../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../../utils/tagDisplay';

const DIFFICULTY_COLOR: Record<string, string> = {
  入门级: 'green',
  进阶级: 'orange',
  专业级: 'red'
};

export interface DrawResultCardProps {
  index: number;
  topic: Topic;
  item: DrawSessionItem;
  teams: Team[];
}

export default function DrawResultCard({ index, topic, item, teams }: DrawResultCardProps) {
  const { token } = theme.useToken();
  const settings = useSettingsStore((s) => s.settings);
  const teamA = teams.find((t) => t.id === item.team_a_id);
  const teamB = teams.find((t) => t.id === item.team_b_id);

  return (
    <Card
      size="small"
      style={{
        borderColor: token.colorPrimary,
        borderWidth: 1,
        background: token.colorBgContainer
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 序号 */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: token.colorPrimary,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
            flexShrink: 0
          }}
        >
          {index + 1}
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            {topic.title}
          </Typography.Title>
          <Space size={4} wrap style={{ marginBottom: item.team_a_id ? 12 : 0 }}>
            {(() => {
              const cfg = loadTagDisplayConfig(settings);
              const typeTag = filterTag(cfg, topic.type, 'type', 'drawResult');
              const diffTag = filterTag(cfg, topic.difficulty, 'difficulty', 'drawResult');
              const sourceTag = filterTag(cfg, topic.source_type, 'source_type', 'drawResult');
              const customTags = filterTags(cfg, topic.tags, 'custom', 'drawResult');
              return (
                <>
                  {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
                  {diffTag && (
                    <Tag color={DIFFICULTY_COLOR[diffTag] ?? 'default'}>{diffTag}</Tag>
                  )}
                  {sourceTag && <Tag>{sourceTag}</Tag>}
                  {customTags.map((t) => (
                    <Tag key={t}>#{t}</Tag>
                  ))}
                </>
              );
            })()}
          </Space>

          {/* 持方对阵 */}
          {item.team_a_id && teamA && teamB && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '8px 12px',
                background: token.colorBgLayout,
                borderRadius: 6
              }}
            >
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{item.stance_a}</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{teamA.name}</div>
              </div>
              <Typography.Text strong style={{ color: token.colorError, fontSize: 18 }}>
                VS
              </Typography.Text>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{item.stance_b}</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{teamB.name}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
