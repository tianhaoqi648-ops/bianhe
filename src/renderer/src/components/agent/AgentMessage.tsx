// ============================================================
// AgentMessage.tsx — Agent 对话消息渲染组件（AI Agent v1.3.0 Week 4 Task 20）
//
// 职责：
// 1. 区分 user / assistant / tool_call 三种角色并分别渲染对齐方向与气泡样式
//    - user：右对齐，primary 淡色背景气泡
//    - assistant（含 tool_call 兼容角色）：左对齐，colorBgContainer 背景气泡
// 2. assistant 消息正文以 Markdown 渲染（react-markdown + remark-gfm），
//    支持标题/列表/代码块/表格/链接等 GFM 元素；user 消息保持纯文本
// 3. 流式 delta（isStreaming=true）时在正文末尾显示 1px×14px 闪烁光标
// 4. assistant 消息的 toolCalls 用 ToolCallCard 渲染
//
// 依赖：
// - antd theme.useToken() 获取主题 token（colorPrimaryBg / colorBgContainer / colorBorderSecondary 等）
// - react-markdown + remark-gfm 渲染 assistant 正文
// - AgentUIMessage / AgentUIToolCall 类型来自 stores/agentStore
// - ToolCallCard 来自 ./ToolCallCard（Task 21 实现）
// ============================================================

import React, { useMemo } from 'react'
import { theme, Typography } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentUIMessage, AgentUIToolCall } from '../../stores/agentStore'
import { ToolCallCard } from './ToolCallCard'

/** 气泡最大宽度（避免占满整个面板） */
const MAX_WIDTH = '85%'

/** 流式光标样式：1px 宽 / 14px 高 / 当前文本色 / 1s 闪烁 */
const cursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '1px',
  height: '14px',
  marginLeft: '2px',
  backgroundColor: 'currentColor',
  verticalAlign: 'text-bottom',
  animation: 'agent-cursor-blink 1s infinite'
}

/**
 * 流式光标：渲染 <style> 注入 keyframes + 一个闪烁的竖条 span。
 * 多条流式消息同时存在时会产生重复 <style>，内容一致无副作用。
 */
function StreamingCursor(): JSX.Element {
  return (
    <>
      <style>{`
        @keyframes agent-cursor-blink {
          0%, 49% { opacity: 1 }
          50%, 100% { opacity: 0 }
        }
      `}</style>
      <span style={cursorStyle} aria-hidden />
    </>
  )
}

/**
 * 渲染 assistant 消息附带的工具调用列表。
 */
function renderToolCalls(toolCalls: AgentUIToolCall[]): React.ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {toolCalls.map((tool) => (
        <ToolCallCard key={tool.toolCallId} toolCall={tool} />
      ))}
    </div>
  )
}

/**
 * AssistantMessageBody — 助手消息正文 Markdown 渲染组件。
 *
 * 使用 react-markdown + remark-gfm 解析 GFM 语法，并通过 components 自定义渲染：
 * - 链接在新窗口打开（target=_blank + rel=noreferrer）
 * - 代码块使用 antd Typography.Text + pre 包装，等宽字体 + 浅色背景
 * - 表格使用原生 table + borderCollapse，避免 GFM 表格塌陷
 * - 标题/列表/段落使用 antd Typography 默认间距与字号
 *
 * 流式时正文末尾追加 StreamingCursor（在 Markdown 容器外，确保光标不受 Markdown 解析影响）。
 */
function AssistantMessageBody({
  content,
  streaming,
  token
}: {
  content: string
  streaming: boolean
  token: ReturnType<typeof theme.useToken>['token']
}): JSX.Element {
  // markdown components 配置：仅在内容变化时重建，避免每帧重渲染
  const markdownComponents = useMemo<React.ComponentProps<typeof ReactMarkdown>['components']>(
    () => ({
      a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      pre: ({ node, ...props }) => (
        <pre
          {...props}
          style={{
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 6,
            padding: '8px 10px',
            overflowX: 'auto',
            margin: '8px 0',
            fontSize: 13,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }}
        />
      ),
      code: ({ node, className, ...props }) => {
        // react-markdown v10 移除了 inline prop；通过 className 区分：
        // - 代码块（fenced code）会带 language-* className
        // - 行内 code 无 className
        // 同时通过 node.parent 是否为 pre 进一步判断
        const isBlock = node?.position?.start.line !== node?.position?.end.line || !!className
        if (isBlock) {
          return <code className={className} {...props} />
        }
        return (
          <code
            {...props}
            style={{
              background: token.colorFillQuaternary,
              padding: '1px 4px',
              borderRadius: 3,
              fontSize: '0.9em',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            }}
          />
        )
      },
      table: ({ node, ...props }) => (
        <table
          {...props}
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            margin: '8px 0',
            fontSize: 13
          }}
        />
      ),
      th: ({ node, ...props }) => (
        <th
          {...props}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            padding: '4px 8px',
            background: token.colorFillQuaternary,
            textAlign: 'left'
          }}
        />
      ),
      td: ({ node, ...props }) => (
        <td
          {...props}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            padding: '4px 8px',
            textAlign: 'left'
          }}
        />
      ),
      p: ({ node, ...props }) => <p {...props} style={{ margin: '4px 0' }} />,
      ul: ({ node, ...props }) => <ul {...props} style={{ margin: '4px 0', paddingLeft: 20 }} />,
      ol: ({ node, ...props }) => <ol {...props} style={{ margin: '4px 0', paddingLeft: 20 }} />,
      h1: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={5} style={{ margin: '8px 0 4px' }} />
      ),
      h2: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={5} style={{ margin: '8px 0 4px' }} />
      ),
      h3: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={6} style={{ margin: '6px 0 2px' }} />
      ),
      h4: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={6} style={{ margin: '6px 0 2px' }} />
      ),
      h5: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={6} style={{ margin: '6px 0 2px' }} />
      ),
      h6: ({ node, ...props }) => (
        <Typography.Title {...(props as any)} level={6} style={{ margin: '6px 0 2px' }} />
      )
    }),
    [token]
  )

  return (
    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
      {streaming && <StreamingCursor />}
    </div>
  )
}

/** AgentMessage Props */
export interface AgentMessageProps {
  message: AgentUIMessage
}

/**
 * AgentMessage — Agent 对话消息气泡组件
 *
 * user 消息右对齐 + primary 淡色气泡（纯文本）；assistant 消息左对齐 + 容器底色气泡（Markdown）。
 * 最大宽度 85%。assistant 流式时正文末尾显示闪烁光标；toolCalls 渲染为卡片。
 * 空内容（assistant 仅发工具调用时 content=''）不渲染正文区，但仍渲染工具调用卡片。
 */
export function AgentMessage({ message }: AgentMessageProps): JSX.Element {
  const { token } = theme.useToken()

  // tool_call 角色按助手消息处理（保留兼容）
  const isUser = message.role === 'user'
  const isAssistant = !isUser

  const hasContent = message.content.length > 0
  const showCursor = isAssistant && message.isStreaming === true
  const showContentArea = hasContent || showCursor
  const toolCalls = message.toolCalls
  const hasToolCalls = !!toolCalls && toolCalls.length > 0

  // 防御：助手消息既无正文、又非流式、也无工具调用 → 不渲染任何内容
  if (isAssistant && !showContentArea && !hasToolCalls) {
    return <></>
  }

  // 用户气泡：右对齐，primary 淡色背景
  const userBubbleStyle: React.CSSProperties = {
    maxWidth: MAX_WIDTH,
    backgroundColor: token.colorPrimaryBg,
    color: token.colorText,
    borderRadius: 12,
    padding: '8px 12px',
    wordBreak: 'break-word'
  }

  // 助手气泡：左对齐，容器底色 + 次级边框
  const assistantBubbleStyle: React.CSSProperties = {
    maxWidth: MAX_WIDTH,
    backgroundColor: token.colorBgContainer,
    color: token.colorText,
    borderRadius: 12,
    padding: '8px 12px',
    border: `1px solid ${token.colorBorderSecondary}`,
    wordBreak: 'break-word'
  }

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <div style={isUser ? userBubbleStyle : assistantBubbleStyle}>
        {showContentArea && (
          isUser ? (
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {message.content}
            </div>
          ) : (
            <AssistantMessageBody
              content={message.content}
              streaming={showCursor}
              token={token}
            />
          )
        )}
        {isAssistant && toolCalls && toolCalls.length > 0 && renderToolCalls(toolCalls)}
      </div>
    </div>
  )
}
