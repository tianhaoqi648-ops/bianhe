// ============================================================
// WelcomeTour.tsx — 首次启动 5 步引导 Tour
//
// 基于 antd Tour 组件，覆盖题库 / 队伍 / 赛事 / 抽取 / 计时器 5 个核心页面。
// 每步切换时自动导航到对应路由；跳过或完成后标记 onboardingCompleted=true。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tour } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  BookOutlined,
  TeamOutlined,
  TrophyOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import type { TourProps } from 'antd';
import { useSettingsStore } from '../../stores/settingsStore';

export interface WelcomeTourProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调（无论跳过还是完成都会触发） */
  onClose: () => void;
}

/** 5 步引导配置：每步对应一个路由 + 标题 + 描述 + 图标 */
interface TourStepConfig {
  route: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STEP_CONFIGS: TourStepConfig[] = [
  {
    route: '/topics',
    title: '1. 题库管理',
    description: '先添加辩题，可批量导入 Excel / CSV / Word 文件，或新建单条辩题。题库是抽辩题的数据源。',
    icon: <BookOutlined />
  },
  {
    route: '/teams',
    title: '2. 队伍管理',
    description: '录入参赛队伍，可按赛事分组。支持单挑赛与多队循环赛。',
    icon: <TeamOutlined />
  },
  {
    route: '/events',
    title: '3. 赛事管理',
    description: '创建赛事并配置轮次、分组、赛制。一个赛事可包含多轮抽辩。',
    icon: <TrophyOutlined />
  },
  {
    route: '/draw',
    title: '4. 抽取辩题',
    description: '为轮次抽辩题，支持题量、持方、筛选条件、题源比例等配置。可投屏大屏展示。',
    icon: <ThunderboltOutlined />
  },
  {
    route: '/timer',
    title: '5. 计时器',
    description: '开赛时启动计时，按赛制环节自动切换。支持铃声提醒、自由辩论切换、大屏投影。',
    icon: <ClockCircleOutlined />
  }
];

export default function WelcomeTour({ open, onClose }: WelcomeTourProps) {
  const navigate = useNavigate();
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const [current, setCurrent] = useState(0);
  const initialNavDone = useRef(false);

  // 进入 Tour 时从第 0 步开始
  useEffect(() => {
    if (open) {
      if (!initialNavDone.current) {
        setCurrent(0);
        // 切换到第 1 步对应的路由
        navigate(STEP_CONFIGS[0].route, { replace: true });
        initialNavDone.current = true;
      }
    } else {
      // Tour 关闭时重置 ref，下次打开可重新导航
      initialNavDone.current = false;
    }
  }, [open]);  // 移除 navigate 依赖

  // 步骤切换：导航到对应路由
  const handleChange: TourProps['onChange'] = (next) => {
    setCurrent(next);
    const cfg = STEP_CONFIGS[next];
    if (cfg) {
      navigate(cfg.route, { replace: true });
    }
  };

  // 关闭（跳过 / 完成）：标记 onboarding 完成
  const handleClose = useCallback(() => {
    setOnboardingCompleted(true);
    onClose();
  }, [setOnboardingCompleted, onClose]);

  // 构造 antd Tour 的 steps 配置（无 target，居中模态样式）
  const steps = useMemo<TourProps['steps']>(
    () =>
      STEP_CONFIGS.map((cfg) => ({
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {cfg.icon}
            <span>{cfg.title}</span>
          </span>
        ),
        description: (
          <div>
            <div style={{ marginBottom: 12 }}>{cfg.description}</div>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, color: '#999', fontSize: 12 }}
              onClick={handleClose}
            >
              以后不再提醒
            </Button>
          </div>
        )
      })),
    [handleClose]
  );

  return (
    <Tour
      open={open}
      current={current}
      steps={steps}
      onChange={handleChange}
      onClose={handleClose}
      indicatorsRender={(step, total) => (
        <span style={{ color: '#1677ff', fontSize: 13 }}>
          {step + 1} / {total}
        </span>
      )}
    />
  );
}
