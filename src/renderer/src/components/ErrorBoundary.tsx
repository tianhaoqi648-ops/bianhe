// ============================================================
// ErrorBoundary.tsx — 通用错误边界组件
//
// 捕获子树渲染异常，降级为可重试的错误 UI，避免整页白屏。
// React 18 仍要求 class component 实现 componentDidCatch / getDerivedStateFromError。
//
// P3.4 Task 18 升级：
//   - 错误展示：错误摘要（标题 + message）+ 折叠堆栈（antd Collapse）
//     + 3 个按钮：重启应用 / 复制错误 / 重试
//   - 暗色 token 适配（背景 token.colorBgContainer，文字 token.colorText）
//   - componentDidCatch 通过 IPC 写入主进程 error.log（自动轮转）
// ============================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Result, Collapse, Space, Typography, theme, message } from 'antd'
import { ReloadOutlined, CopyOutlined, RedoOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

interface Props {
  children: ReactNode
  /** 自定义降级 UI，未提供时使用默认 Result */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
    // P3.4 Task 18：异步写入主进程错误日志（自动轮转）
    // 用 void + catch 包装，避免未处理的 Promise 拒绝
    try {
      const writeError = window.electron?.logs?.writeError
      if (writeError) {
        void writeError({
          name: error.name,
          message: error.message,
          stack: error.stack || info.componentStack || '(no stack)',
          timestamp: new Date().toISOString()
        }).catch((e) => {
          console.warn('[ErrorBoundary] writeErrorLog failed:', e)
        })
      }
    } catch (e) {
      console.warn('[ErrorBoundary] writeErrorLog threw:', e)
    }
  }

  reset = (): void => this.setState({ error: null })

  handleCopy = (error: Error): void => {
    const text = [
      `Name: ${error.name}`,
      `Message: ${error.message}`,
      `Stack:`,
      error.stack || '(no stack)'
    ].join('\n')
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success('已复制错误信息')
      })
      .catch(() => {
        message.error('复制失败')
      })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return <DefaultErrorView error={this.state.error} onReset={this.reset} onReload={this.handleReload} onCopy={this.handleCopy} />
    }
    return this.props.children
  }
}

// ============================================================
// 默认错误视图（暗色 token 适配）
// ============================================================

interface DefaultErrorViewProps {
  error: Error
  onReset: () => void
  onReload: () => void
  onCopy: (error: Error) => void
}

function DefaultErrorView({ error, onReset, onReload, onCopy }: DefaultErrorViewProps): ReactNode {
  const { token } = theme.useToken()
  const stack = error.stack || '(no stack available)'

  return (
    <div
      style={{
        // 暗色 / 亮色自适应
        background: token.colorBgContainer,
        color: token.colorText,
        minHeight: '100vh',
        padding: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Result
          status="error"
          title={<span style={{ color: token.colorText }}>{error.name || '页面加载出错'}</span>}
          subTitle={
            <span style={{ color: token.colorTextSecondary }}>
              {error.message || '发生了未知错误'}
            </span>
          }
          extra={
            <Space wrap>
              <Button type="primary" icon={<ReloadOutlined />} onClick={onReload}>
                重启应用
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => onCopy(error)}>
                复制错误
              </Button>
              <Button icon={<RedoOutlined />} onClick={onReset}>
                重试
              </Button>
            </Space>
          }
        />
        <div
          style={{
            marginTop: 16,
            background: token.colorFillQuaternary,
            borderRadius: 8,
            padding: 12
          }}
        >
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            <Text type="secondary" strong>
              错误摘要：
            </Text>
            <br />
            <Text style={{ color: token.colorText }} code>
              {error.name}
            </Text>
            ：{error.message}
          </Paragraph>
          <Collapse
            size="small"
            items={[
              {
                key: 'stack',
                label: '堆栈信息',
                children: (
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      margin: 0,
                      maxHeight: 320,
                      overflow: 'auto'
                    }}
                  >
                    {stack}
                  </pre>
                )
              }
            ]}
          />
        </div>
      </div>
    </div>
  )
}
