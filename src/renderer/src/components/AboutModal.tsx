// ============================================================
// AboutModal.tsx — 关于辩盒弹窗
//
// 显示应用版本号、简介、反馈邮箱、GitHub 仓库链接占位。
// 替代 AppHeader 内联的临时 Modal，统一品牌化外观：
// - 顶部 Logo 区：渐变圆形 + 「辩」字
// - 中部介绍：应用描述
// - 底部链接：反馈邮箱 / GitHub 仓库
// ============================================================

import { Modal, Typography, Divider, Space } from 'antd'
import {
  MailOutlined,
  GithubOutlined,
  HeartOutlined
} from '@ant-design/icons'
import type { ModalProps } from 'antd'

const { Text, Link, Paragraph } = Typography

/** 应用元信息（统一管理，便于后续从 package.json 注入） */
export const APP_META = {
  name: '辩盒',
  englishName: 'Debate Box',
  version: '1.2.1',
  description: '辩盒是一款辩论赛题抽取与计时工具，提供题库管理、队伍/赛事管理、辩题抽取、计时器、赛制编辑等全流程能力。',
  feedbackEmail: 'muyun648@qq.com',
  githubUrl: 'https://github.com/tianhaoqi648-ops/bianhe'
} as const

export interface AboutModalProps extends Omit<ModalProps, 'children'> {
  /** 是否显示 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
}

/**
 * AboutModal — 关于辩盒弹窗
 *
 * 用法：
 * ```tsx
 * <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
 * ```
 */
export default function AboutModal({ open, onClose, ...rest }: AboutModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={440}
      {...rest}
    >
      {/* 顶部 Logo 区：渐变圆形 + 「辩」字 + 应用名 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0 16px'
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 36,
            fontWeight: 700,
            fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
            boxShadow: '0 8px 20px rgba(22, 119, 255, 0.3)'
          }}
        >
          辩
        </div>
        <div style={{ marginTop: 12, fontSize: 20, fontWeight: 600 }}>
          {APP_META.name}
          <Text
            type="secondary"
            style={{ marginLeft: 8, fontSize: 14, fontWeight: 400 }}
          >
            {APP_META.englishName}
          </Text>
        </div>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
          v{APP_META.version}
        </Text>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* 中部：应用描述 */}
      <Paragraph
        style={{
          color: '#595959',
          lineHeight: 1.7,
          margin: '0 0 16px',
          fontSize: 14
        }}
      >
        {APP_META.description}
      </Paragraph>

      {/* 底部：反馈与仓库链接 */}
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <MailOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          <Text type="secondary" style={{ marginRight: 4 }}>反馈建议：</Text>
          <Link href={`mailto:${APP_META.feedbackEmail}`}>
            {APP_META.feedbackEmail}
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <GithubOutlined style={{ marginRight: 8, color: '#722ed1' }} />
          <Text type="secondary" style={{ marginRight: 4 }}>源码仓库：</Text>
          <Link href={APP_META.githubUrl} target="_blank" rel="noreferrer">
            {APP_META.githubUrl.replace('https://', '')}
          </Link>
        </div>
      </Space>

      {/* 底部署名 */}
      <Divider style={{ margin: '16px 0 8px' }} />
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: '#8c8c8c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4
        }}
      >
        <span>Made with</span>
        <HeartOutlined style={{ color: '#ff4d4f' }} />
        <span>for debaters</span>
      </div>
    </Modal>
  )
}
