// ============================================================
// simulate-opponent.tool.ts — Agent 工具：模拟对方攻击（AI 裁判演进 批2 2026-08-18）
//
// 备赛刚需场景：辩手只有己方稿子，需要 AI 以评委的思维站在对方立场，
// 设计攻击（质询问题 / 驳论论点 / 自由辩突袭），检验己方立论漏洞并给出防守建议。
//
// 人设复用：以 {judge.name} 的思维模拟对方攻击——
//   攻防流 → 拆逻辑链、价值流 → 追问价值前提、学理流 → 追问概念前提，
// 天然覆盖 fact（事实）/ theory（理论）/ value（价值）三层。
//
// 三种攻击方式（attackMode）：
//   - cross_exam（默认）：逼问式质询/盘问问题串
//   - rebuttal：结构化反驳论点（拆立论）
//   - free_debate：自由辩短促突袭问题串（一句一题）
//
// 风险等级 low：只读，不修改数据库。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeById } from '@shared/ai-judges'
import { chat, LLMError } from '../llm-client'
import { buildJudgeSystemPrompt, parseJsonResult } from './judge-common'

/** 攻击方式 */
export type AttackMode = 'cross_exam' | 'rebuttal' | 'free_debate'

/** 攻击点层次 */
export type AttackLayer = 'fact' | 'theory' | 'value'

/** simulate_opponent 工具入参 */
export interface SimulateOpponentArgs {
  /** 辩题（必填） */
  topic: string
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 己方稿子（必填，手动粘贴） */
  speech: string
  /** 评委人设 id（可选，默认 hu-jianbiao）——以其思维模拟对方攻击 */
  judgeId?: string
  /** 攻击方式（可选，默认 cross_exam 质询盘问） */
  attackMode?: AttackMode
  /** 赛制提示（可选） */
  formatHint?: string
}

/** 单个攻击点 */
export interface AttackPoint {
  /** 层次：事实 / 理论 / 价值 */
  layer: AttackLayer
  /** 攻击内容（质询问句 / 反驳论点 / 突袭问题） */
  point: string
  /** 针对己方稿中哪部分（如"第一论点""判准"） */
  target: string
  /** 建议如何防守 */
  defenseHint: string
}

/** simulate_opponent 工具返回值（成功态） */
export interface SimulateOpponentResult {
  success: true
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  attackMode: AttackMode
  /** 总体弱点总结 */
  weaknessSummary: string
  /** 攻击点列表（按层次分组） */
  attackPoints: AttackPoint[]
}

/** simulate_opponent 工具返回值（失败态） */
export interface SimulateOpponentFailure {
  success: false
  error: string
}

/** 攻击方式白名单 */
const ATTACK_MODES: AttackMode[] = ['cross_exam', 'rebuttal', 'free_debate']

/** 攻击方式说明（注入 prompt） */
const ATTACK_MODE_HINTS: Record<AttackMode, string> = {
  cross_exam:
    '质询/盘问方式：设计逼问式质询问题串（连环追问、可答性陷阱），每一问都要让对方难以回避；问题要击中己方稿子的具体漏洞。',
  rebuttal:
    '驳论方式：设计结构化的反驳论点（拆立论），每个攻击点是"论点 + 理由 + 落脚"的完整反驳，直接针对己方立论框架的薄弱处。',
  free_debate:
    '自由辩突袭方式：设计短促的突袭问题串，一句一题、快速连发，专挑己方稿子里来不及展开的概念与口径。'
}

/** 期望 LLM 输出的 JSON 结构样例 */
const JSON_SAMPLE = `{
  "weaknessSummary": "这份立论最大的弱点是判准未经论证，第二论点缺乏事实支撑。",
  "attackPoints": [
    {
      "layer": "theory",
      "point": "请问对方辩友，您的判准'……'为什么成立？如果按这个判准，对方的立场是否也能推出同样的结论？",
      "target": "第一段判准",
      "defenseHint": "提前补充判准成立的论证：判准须能区分正反两方，且与辩题核心冲突对应。"
    },
    {
      "layer": "fact",
      "point": "第二论点引用的数据来源是什么？样本是否具有代表性？",
      "target": "第二论点论据",
      "defenseHint": "补充数据出处与适用边界，预留'数据为佐证而非唯一依据'的口径。"
    }
  ]
}`

/**
 * 解析并校验 LLM 返回的攻击设计 JSON。
 * 非法 layer 或空字段条目跳过；attackPoints 缺失/空抛错（由调用方转失败）。
 */
function parseSimulateResult(
  raw: string
): Omit<SimulateOpponentResult, 'success' | 'judgeId' | 'judgeName' | 'topic' | 'side' | 'attackMode'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { weaknessSummary?: unknown; attackPoints?: unknown }

  if (!Array.isArray(obj.attackPoints) || obj.attackPoints.length === 0) {
    throw new Error('attackPoints 缺失或为空')
  }
  const attackPoints: AttackPoint[] = []
  for (const item of obj.attackPoints) {
    if (!item || typeof item !== 'object') continue
    const p = item as { layer?: unknown; point?: unknown; target?: unknown; defenseHint?: unknown }
    if (p.layer !== 'fact' && p.layer !== 'theory' && p.layer !== 'value') continue
    if (typeof p.point !== 'string' || p.point.trim() === '') continue
    attackPoints.push({
      layer: p.layer,
      point: p.point.trim(),
      target: typeof p.target === 'string' && p.target.trim() !== '' ? p.target.trim() : '',
      defenseHint:
        typeof p.defenseHint === 'string' && p.defenseHint.trim() !== ''
          ? p.defenseHint.trim()
          : ''
    })
  }
  if (attackPoints.length === 0) {
    throw new Error('attackPoints 无有效条目')
  }

  const weaknessSummary =
    typeof obj.weaknessSummary === 'string' && obj.weaknessSummary.trim() !== ''
      ? obj.weaknessSummary.trim()
      : ''

  return { weaknessSummary, attackPoints }
}

/**
 * simulate_opponent 工具定义。
 *
 * 执行流程（与 judge_speech 同构）：
 *   1. 校验必填参数（topic / side / speech）与 attackMode 枚举
 *   2. 取评委人设（未知 id 回落默认）
 *   3. 构造 prompt：system=评委人设 + "以评委思维站在对方立场" 指令；user=辩题+立场+攻击方式+己方稿+JSON 样例
 *   4. 调 llm-client.chat → 解析攻击点
 *   5. 任一失败 → { success:false, error }
 */
export const simulateOpponentTool: ToolDefinition<
  SimulateOpponentArgs,
  SimulateOpponentResult | SimulateOpponentFailure
> = {
  name: 'simulate_opponent',
  description:
    '模拟对方攻击：以评委的思维站在对方立场，针对己方稿子设计攻击（质询问题/驳论论点/自由辩突袭），指出立论漏洞并给出防守建议。备赛防守演练用。',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '辩题（必填）'
      },
      side: {
        type: 'string',
        enum: ['aff', 'neg'],
        description: '己方立场（必填）：aff 正方 / neg 反方'
      },
      speech: {
        type: 'string',
        description: '己方稿子全文（必填，手动粘贴）'
      },
      judgeId: {
        type: 'string',
        enum: JUDGE_IDS,
        description: '评委人设 id（可选，默认 hu-jianbiao 胡渐彪）——以其思维模拟对方攻击'
      },
      attackMode: {
        type: 'string',
        enum: ATTACK_MODES,
        description: '攻击方式（可选，默认 cross_exam）：cross_exam 质询盘问 / rebuttal 驳论攻击 / free_debate 自由辩突袭'
      },
      formatHint: {
        type: 'string',
        description: '赛制提示（可选）'
      }
    },
    required: ['topic', 'side', 'speech']
  },
  riskLevel: 'low',
  async execute(
    args: SimulateOpponentArgs,
    ctx?: { config?: LLMConfig; signal?: AbortSignal }
  ): Promise<SimulateOpponentResult | SimulateOpponentFailure> {
    // 1. 校验必填参数
    const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
    const speech = typeof args.speech === 'string' ? args.speech.trim() : ''
    const side = args.side === 'neg' ? 'neg' : 'aff'
    const attackMode = ATTACK_MODES.includes(args.attackMode as AttackMode)
      ? (args.attackMode as AttackMode)
      : 'cross_exam'
    if (topic === '' || speech === '') {
      return { success: false, error: '参数缺失：topic / speech 必填' }
    }
    if (args.attackMode !== undefined && !ATTACK_MODES.includes(args.attackMode as AttackMode)) {
      return { success: false, error: '参数非法：attackMode 必须为 cross_exam / rebuttal / free_debate 之一' }
    }

    // 2. 取评委人设
    const judge = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
    if (!judge) {
      return { success: false, error: '评委人设数据缺失' }
    }

    // 3. 构造 prompt
    const sideLabel = side === 'aff' ? '正方' : '反方'
    const systemPrompt = buildJudgeSystemPrompt(
      judge,
      [
        `现在请以${judge.name}的思维，站在对方立场，攻击${sideLabel}的这份稿子。`,
        '你不仅是设计攻击，还要像这位评委一样判断：什么才是这份立论真正的软肋，对方会从哪里下刀。',
        '攻击方式说明：',
        ATTACK_MODE_HINTS[attackMode],
        '最后请给出一句话的总体弱点总结，以及每个攻击点对应的防守建议。'
      ].join('\n')
    )

    const formatLine =
      typeof args.formatHint === 'string' && args.formatHint.trim() !== ''
        ? `\n赛制参考：${args.formatHint.trim()}`
        : ''
    const userPrompt = [
      `【辩题】${topic}${formatLine}`,
      `【${sideLabel}（己方）稿子】`,
      speech,
      '',
      '【输出要求】',
      '请给出：1) weaknessSummary：总体弱点总结（30-60 字）；',
      '2) attackPoints：攻击点列表（3-6 条），每条含 layer（fact 事实 / theory 理论 / value 价值）、',
      'point（攻击内容，按上述攻击方式组织）、target（针对稿中哪部分）、defenseHint（建议如何防守）。',
      '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
      JSON_SAMPLE
    ].join('\n')

    // 4. 调 LLM
    const config = ctx?.config
    if (!config) {
      return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
    }
    let content: string | null
    try {
      const assistantMessage = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        config,
        undefined,
        ctx?.signal
      )
      content = assistantMessage.content
    } catch (err) {
      const msg =
        err instanceof LLMError
          ? `LLM 调用失败（${err.code}）：${err.message}`
          : err instanceof Error
            ? err.message
            : String(err)
      return { success: false, error: msg }
    }
    if (!content || content.trim() === '') {
      return { success: false, error: '模拟结果为空' }
    }

    // 5. 解析
    try {
      const parsed = parseSimulateResult(content)
      return {
        success: true,
        judgeId: judge.id,
        judgeName: judge.name,
        topic,
        side,
        attackMode,
        ...parsed
      }
    } catch (e) {
      return {
        success: false,
        error: `模拟输出格式异常：${e instanceof Error ? e.message : String(e)}`
      }
    }
  }
}
