// ============================================================
// InsufficientTopicsModal.tsx — 题池不足处理弹窗
//
// 当抽取辩题时候选题数 < 所需题数，DrawPage 捕获
// InsufficientTopicsError 后渲染本组件，让用户选择处理方式
// 而非直接 Toast 报错阻断流程。
//
// 三个选项：
//   1. 降级抽取 {candidateCount} 道     → onSelect('downgrade')
//   2. 允许重复抽取 {requiredCount} 道  → onSelect('repeat')
//   3. 取消并去添加辩题                → onSelect('cancel')
//
// 测试场景示例（SubTask 4.4）：
//   - candidateCount=2, requiredCount=4 时三个按钮文案分别为：
//       「降级抽取 2 道」「允许重复抽取 4 道」「取消并去添加辩题」
//   - 点击对应按钮 onSelect 回调分别为：
//       'downgrade' / 'repeat' / 'cancel'
//   - 点击 Modal 右上角 X 或 footer 取消按钮均触发 onSelect('cancel')
// ============================================================

import { Modal, Typography, Space, Button, theme } from 'antd';
import {
  DownCircleOutlined,
  RetweetOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { spacing } from '../../styles/tokens';

/** 题池不足时用户选择的处理动作 */
export type InsufficientAction = 'downgrade' | 'repeat' | 'cancel';

export interface InsufficientTopicsModalProps {
  /** Modal 是否打开（受控） */
  open: boolean;
  /** 当前候选辩题数 */
  candidateCount: number;
  /** 原本需要的辩题数 */
  requiredCount: number;
  /** 用户选择某个处理方式后回调 */
  onSelect: (action: InsufficientAction) => void;
}

/**
 * 题池不足处理弹窗
 *
 * 用法：
 * ```tsx
 * <InsufficientTopicsModal
 *   open={!!insufficientInfo}
 *   candidateCount={insufficientInfo?.candidateCount ?? 0}
 *   requiredCount={insufficientInfo?.requiredCount ?? 0}
 *   onSelect={handleInsufficientSelect}
 * />
 * ```
 */
export function InsufficientTopicsModal({
  open,
  candidateCount,
  requiredCount,
  onSelect
}: InsufficientTopicsModalProps) {
  const { token } = theme.useToken();

  // 选项按钮通用样式：宽度 100%、左对齐、高度 56px、hover 明显反馈
  const buttonStyle: React.CSSProperties = {
    width: '100%',
    height: 56,
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingInline: token.paddingMD,
    borderRadius: token.borderRadius,
    transition: 'all 0.2s ease'
  };

  return (
    <Modal
      open={open}
      title="题池不足"
      onCancel={() => onSelect('cancel')}
      footer={null}
      centered
      destroyOnClose
      maskClosable={false}
    >
      {/* 顶部说明文字 */}
      <Typography.Paragraph
        style={{
          marginBottom: spacing.lg,
          color: token.colorText,
          fontSize: token.fontSize
        }}
      >
        候选 <strong>{candidateCount}</strong> 道，原需 <strong>{requiredCount}</strong> 道，请选择处理方式
      </Typography.Paragraph>

      {/* 三个选项按钮（垂直排列） */}
      <Space direction="vertical" size={spacing.md} style={{ width: '100%' }}>
        <Button
          type="default"
          icon={<DownCircleOutlined style={{ fontSize: 18 }} />}
          style={buttonStyle}
          onClick={() => onSelect('downgrade')}
        >
          降级抽取 {candidateCount} 道
        </Button>

        <Button
          type="default"
          icon={<RetweetOutlined style={{ fontSize: 18 }} />}
          style={buttonStyle}
          onClick={() => onSelect('repeat')}
        >
          允许重复抽取 {requiredCount} 道
        </Button>

        <Button
          type="default"
          icon={<CloseCircleOutlined style={{ fontSize: 18 }} />}
          style={buttonStyle}
          onClick={() => onSelect('cancel')}
        >
          取消并去添加辩题
        </Button>
      </Space>
    </Modal>
  );
}

export default InsufficientTopicsModal;
