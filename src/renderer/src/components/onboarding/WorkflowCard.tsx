// ============================================================
// WorkflowCard.tsx — 工作流引导卡（3 步上手）
//
// 新用户引导卡，展示 3 步上手进度：
// 1. 题库有 X 条辩题
// 2. 已建 X 个赛事
// 3. 完成首次抽辩
//
// 完成所有步骤后自动隐藏（settings.showWorkflowCard = false）。
// 默认放置在 EventManage 顶部。
// ============================================================

import { useEffect, useState } from 'react';
import { Card, Button, Space, Typography, Tag, theme } from 'antd';
import {
  CheckCircleFilled,
  BookOutlined,
  TrophyOutlined,
  ThunderboltOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../../stores/settingsStore';
import { spacing } from '../../styles/tokens';

const { Text, Title } = Typography;

/** 工作流步骤状态 */
interface WorkflowStep {
  /** 步骤序号（1-based） */
  step: number;
  /** 图标 */
  icon: React.ReactNode;
  /** 步骤标题 */
  title: string;
  /** 当前数量描述（如 "已有 5 条辩题"） */
  description: string;
  /** 是否完成 */
  done: boolean;
  /** 未完成时的 CTA 文字 */
  ctaText: string;
  /** CTA 跳转路由 */
  route: string;
}

export interface WorkflowCardProps {
  /** 自定义样式 */
  style?: React.CSSProperties;
}

export default function WorkflowCard({ style }: WorkflowCardProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const showWorkflowCard = useSettingsStore((s) => s.showWorkflowCard);
  const setShowWorkflowCard = useSettingsStore((s) => s.setShowWorkflowCard);

  // 数据计数
  const [topicCount, setTopicCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // 拉取计数数据
  useEffect(() => {
    if (!showWorkflowCard) return;
    let cancelled = false;
    void (async () => {
      try {
        const [topicRes, eventRes, sessionRes] = await Promise.all([
          window.topicAPI.count({}),
          window.eventAPI.listEvents({ page: 1, pageSize: 1 }),
          window.drawAPI.listSessions({ page: 1, pageSize: 1 })
        ]);
        if (cancelled) return;
        setTopicCount(topicRes.success ? Number(topicRes.data ?? 0) : 0);
        setEventCount(eventRes.success && eventRes.data ? Number(eventRes.data.total ?? 0) : 0);
        setSessionCount(sessionRes.success && sessionRes.data ? Number(sessionRes.data.total ?? 0) : 0);
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showWorkflowCard]);

  // 3 步状态
  const steps: WorkflowStep[] = [
    {
      step: 1,
      icon: <BookOutlined />,
      title: '添加辩题',
      description: loading ? '加载中…' : `题库有 ${topicCount} 条辩题`,
      done: topicCount > 0,
      ctaText: '去添加',
      route: '/topics'
    },
    {
      step: 2,
      icon: <TrophyOutlined />,
      title: '创建赛事',
      description: loading ? '加载中…' : `已建 ${eventCount} 个赛事`,
      done: eventCount > 0,
      ctaText: '去创建',
      route: '/events'
    },
    {
      step: 3,
      icon: <ThunderboltOutlined />,
      title: '完成首次抽辩',
      description: loading ? '加载中…' : `已完成 ${sessionCount} 次抽取`,
      done: sessionCount > 0,
      ctaText: '去抽取',
      route: '/draw'
    }
  ];

  // 全部完成时自动隐藏（仅在数据加载完成后判断）
  useEffect(() => {
    if (!loading && showWorkflowCard && steps.every((s) => s.done)) {
      setShowWorkflowCard(false);
    }
  }, [loading, showWorkflowCard, steps, setShowWorkflowCard]);

  // 用户手动关闭
  const handleClose = () => {
    setShowWorkflowCard(false);
  };

  if (!showWorkflowCard) return null;

  // 完成步骤数
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card
      size="small"
      style={{
        marginBottom: spacing.md,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        ...style
      }}
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            3 步上手
          </Title>
          <Tag color={doneCount === 3 ? 'success' : 'processing'}>
            {doneCount} / 3
          </Tag>
        </Space>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={handleClose}
          aria-label="关闭引导卡"
        />
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {steps.map((s) => (
          <div
            key={s.step}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.md
            }}
          >
            <Space>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: s.done ? token.colorSuccessBg : token.colorFillSecondary,
                  color: s.done ? token.colorSuccess : token.colorTextSecondary,
                  fontSize: 14
                }}
              >
                {s.done ? <CheckCircleFilled /> : s.icon}
              </span>
              <Space direction="vertical" size={0}>
                <Text strong>{s.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {s.description}
                </Text>
              </Space>
            </Space>
            {!s.done && (
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => navigate(s.route)}
              >
                {s.ctaText}
              </Button>
            )}
          </div>
        ))}
      </Space>
    </Card>
  );
}
