// ============================================================
// judge-common.ts — AI 裁判工具公共模块（AI 裁判功能演进 2026-08-18）
//
// 从 judge-debate.tool.ts 提取的共享能力，供 judge_debate / judge_speech /
// simulate_opponent / rewrite_speech 等工具复用：
//   1. buildJudgeSystemPrompt：按评委人设构建 system prompt
//   2. parseJsonResult：容错解析 LLM 返回的 JSON（去 ```json 围栏、取首个 {} 块）
// ============================================================

import type { JudgeProfile } from '@shared/ai-judges'

/**
 * 按评委人设构建 system prompt。
 *
 * @param judge 评委人设（ai-judges.ts）
 * @param taskInstruction 当前任务的指令（如"评审一场辩论"/"设计质询问题"），追加在末尾
 * @returns system prompt 文本
 */
export function buildJudgeSystemPrompt(judge: JudgeProfile, taskInstruction: string): string {
  return [
    `你是${judge.name}（${judge.category}），一位华语辩论领域备受尊敬的辩手与评委。`,
    `【背景】${judge.bio}`,
    `【你的辩风】${judge.styleTraits.map((t) => `- ${t}`).join('\n')}`,
    `【你的评审倾向】最看重：${judge.judgePriorities.top}；次看重：${judge.judgePriorities.secondary}；可能忽略：${judge.judgePriorities.ignored}`,
    `【你的标志性表达】${judge.signaturePhrases.map((p) => `"${p}"`).join(' ')}`,
    `【你的点评风格】${judge.reviewStyle}`,
    '',
    taskInstruction
  ].join('\n')
}

/**
 * 容错解析 LLM 返回的 JSON。
 * - 去除 ```json ... ``` 围栏
 * - 提取首个 {...} 块（LLM 有时附带说明文字）
 * - 解析失败抛错（由调用方 catch 并转失败结果）
 *
 * @param raw LLM 返回的 content
 * @returns 解析后的对象
 * @throws 找不到 JSON 或 JSON.parse 失败时抛错
 */
export function parseJsonResult(raw: string): unknown {
  let text = raw.trim()
  // 去掉可能的 ```json ... ``` 围栏
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }
  // 提取首个 {...} 块（LLM 有时会附带说明文字）
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
    throw new Error('未找到 JSON 对象')
  }
  text = text.slice(braceStart, braceEnd + 1)
  return JSON.parse(text)
}
