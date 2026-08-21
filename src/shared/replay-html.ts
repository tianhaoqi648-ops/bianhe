// ============================================================
// replay-html.ts — 复盘 HTML 可视化导出（P2-9）
//
// 把 AI 裁判复盘渲染为【单文件、自包含】的 HTML：内联 SVG 雷达图 + 内联
// CSS/JS，无任何外部 CDN/依赖，保存后双击即可打开查看、可离线分享。
//
// 复用 shared/radar-svg.ts 的 buildRadarSvgString 生成雷达图内联 SVG。
//
// 提供两级接口：
//   1. buildJudgeReplayHtml(timeline, result, opts)：从 judge_match 结果 +
//      转写时间线组装结构化复盘（与 JudgeArena 的 buildJudgeReportMarkdown 对齐）。
//   2. buildReplayHtml(data)：纯模板渲染，直接接收结构化 ReplayData，便于单测。
// ============================================================

import { buildRadarSvgString } from './radar-svg'
import { STAGE_DEFINITIONS } from './debate-stages'

/** 胜方约定（与 judge_match 结果一致） */
export type ReplaySide = 'aff' | 'neg'

/** 逐环节判定（对应 stageVerdicts） */
export interface ReplayStageVerdict {
  stage?: string
  winner?: ReplaySide | null
  confidence?: number
  comment?: string
}

/** 结构化复盘数据（buildReplayHtml 的输入） */
export interface ReplayData {
  /** 辩题 */
  topic: string
  /** 正方名称（缺省 '正方'） */
  affName?: string
  /** 反方名称（缺省 '反方'） */
  negName?: string
  /** 评委名（展示风格类别，不展示真人信息时留空） */
  judgeName?: string
  /** 胜负/置信度/判定理由；verdict 为 null 表示素材不足未判定 */
  verdict?: { winner?: ReplaySide | null; confidence?: number; reason?: string } | null
  /** 五维评分（正反双方） */
  dimensions: Array<{ key: string; name: string; affScore: number; negScore: number; comment: string }>
  /** 逐环节点评 */
  stageVerdicts?: ReplayStageVerdict[]
  /** 全场最佳辩手 */
  bestSpeaker?: string | null
  /** AI 总结建议 */
  summary?: string
  /** 素材不足时的说明 */
  insufficientReason?: string
  /** 全辩转写时间线（可选展示） */
  timeline?: Array<{ stage?: string; stageName?: string; side?: string | null; speaker?: string | null; tsMs?: number; content: string }>
  /** 评审/导出时间（缺省用当下） */
  exportedAt?: string
}

/** 雷达图配色（复核 UI：正方蓝、反方橙） */
export const AFF_COLOR = '#1677ff'
export const NEG_COLOR = '#fa8c16'

/** 环节类型 → 展示名（与 judge-result-cards STAGE_NAMES 同源） */
const STAGE_NAMES: Record<string, string> = Object.fromEntries(
  STAGE_DEFINITIONS.map((s) => [s.type, s.name])
)

/** 转写时间线段 */
export interface ReplayTimelineSeg {
  stage?: string
  stageName?: string
  side?: string | null
  speaker?: string | null
  tsMs?: number
  content: string
}

/** HTML 文本转义（仅用于用户内容，防注入/破坏结构） */
function esc(v: unknown): string {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )
}

/** 胜方短标签 */
function winnerLabel(w: ReplaySide | null | undefined, aff: string, neg: string): string {
  if (w === 'aff') return `正方（${aff}）`
  if (w === 'neg') return `反方（${neg}）`
  return '平局'
}

function sideName(side: string | null | undefined): string {
  if (side === 'aff') return '正方'
  if (side === 'neg') return '反方'
  return ''
}

/**
 * 生成自包含 HTML 复盘文档。
 * 覆盖区块：五维雷达图、五维评分表、逐环节点评、胜负判定、最佳辩手、AI 建议。
 */
export function buildReplayHtml(data: ReplayData): string {
  const aff = data.affName?.trim() || '正方'
  const neg = data.negName?.trim() || '反方'
  const verdict = data.verdict && typeof data.verdict === 'object' ? data.verdict : null
  const winner = verdict?.winner ? winnerLabel(verdict.winner, aff, neg) : '素材不足，未判定'
  const confidence =
    verdict?.confidence != null ? Math.round(verdict.confidence * 100) + '%' : ''
  const exportedAt = data.exportedAt || new Date().toLocaleString()

  // 五维雷达图（正反叠加，复用 shared radar-svg 纯函数）
  const radarSvg =
    data.dimensions.length > 0
      ? buildRadarSvgString({
          labels: data.dimensions.map((d) => d.name),
          series: [
            { name: aff, scores: data.dimensions.map((d) => d.affScore), color: AFF_COLOR },
            { name: neg, scores: data.dimensions.map((d) => d.negScore), color: NEG_COLOR }
          ],
          size: 320
        })
      : ''

  const filledSegs = (data.timeline ?? []).filter((t) => t.content.trim() !== '')

  const dimsRows = data.dimensions
    .map((d) => {
      const name = esc(d.name || d.key || '维度')
      const affScore = d.affScore
      const negScore = d.negScore
      const comment = esc(d.comment)
      return `<div class="dim">
        <div class="dim-head"><span class="dim-name">${name}</span><span class="dim-score">正方 ${affScore} / 反方 ${negScore}</span></div>
        <div class="dim-bar"><div class="bar aff" style="width:${affScore * 10}%"></div><div class="bar neg" style="width:${negScore * 10}%"></div></div>
        ${comment ? `<div class="dim-comment">${comment.replace(/\n/g, '<br>')}</div>` : ''}
      </div>`
    })
    .join('\n')

  const stageRows = (data.stageVerdicts ?? [])
    .filter((sv) => sv && typeof sv === 'object')
    .map((sv) => {
      const stageName = STAGE_NAMES[sv.stage ?? ''] || sv.stage || '环节'
      const win = winnerLabel(sv.winner ?? null, aff, neg)
      const conf =
        sv.confidence != null ? `${Math.round(sv.confidence * 100)}%` : ''
      const comment = esc(sv.comment)
      return `<div class="stage">
        <div class="stage-head"><span class="stage-name">${esc(stageName)}</span><span class="stage-win">${win}</span>${conf ? `<span class="stage-conf">置信度 ${conf}</span>` : ''}</div>
        ${comment ? `<div class="stage-comment">${comment}</div>` : ''}
      </div>`
    })
    .join('\n')

  const timelineRows = filledSegs
    .map((seg, i) => {
      const stageLabel =
        STAGE_NAMES[seg.stage ?? ''] || seg.stageName || seg.stage || `第 ${i + 1} 段`
      const who = [sideName(seg.side), seg.speaker].filter(Boolean).map(esc).join(' · ')
      const ts = seg.tsMs != null ? `<div class="ts">时间：${Math.round(seg.tsMs / 1000)}s</div>` : ''
      return `<div class="seg">
        <div class="seg-head">${esc(stageLabel)}${who ? `<span class="seg-who">— ${who}</span>` : ''}</div>
        ${ts}
        <div class="seg-content">${esc(seg.content).replace(/\n/g, '<br>')}</div>
      </div>`
    })
    .join('\n')

  const verdictReason = verdict?.reason?.trim()
  const insufficient = data.insufficientReason?.trim()
  const summary = data.summary?.trim()

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>辩论复盘报告</title>
<style>
  :root { --aff:#1677ff; --neg:#fa8c16; --ink:#1f2329; --sub:#646a73; --line:#e8e8e8; --bg:#f5f6f8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color:var(--ink); background:var(--bg); line-height:1.6; }
  .wrap { max-width:720px; margin:0 auto; padding:24px 16px 56px; background:#fff; }
  h1 { font-size:24px; margin:0 0 6px; }
  .meta { color:var(--sub); font-size:13px; margin-bottom:16px; }
  .meta div { margin:2px 0; }
  .verdict-banner { display:flex; flex-wrap:wrap; gap:12px; align-items:center; background:#f0f5ff; border:1px solid #adc6ff; border-radius:8px; padding:12px 16px; margin-bottom:20px; }
  .verdict-banner .v-win { font-size:18px; font-weight:600; }
  .verdict-banner .v-conf { color:var(--sub); font-size:13px; }
  .badge { display:inline-block; background:#fff; border:1px solid var(--line); border-radius:20px; padding:2px 12px; font-size:13px; }
  section { margin-bottom:24px; }
  section h2 { font-size:16px; border-left:4px solid var(--aff); padding-left:8px; margin:0 0 12px; }
  .chart { text-align:center; }
  .chart svg { max-width:100%; }
  .legend { display:flex; gap:16px; justify-content:center; font-size:13px; color:var(--sub); margin-top:4px; }
  .legend .dot { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; }
  .dim { margin-bottom:14px; }
  .dim-head { display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; }
  .dim-name { font-weight:500; }
  .dim-score { color:var(--sub); }
  .dim-bar { display:flex; gap:2px; height:10px; border-radius:4px; overflow:hidden; background:#f0f0f0; }
  .bar { transition: width .3s; }
  .bar.aff { background:var(--aff); }
  .bar.neg { background:var(--neg); }
  .dim-comment { font-size:12px; color:var(--sub); margin-top:4px; white-space:pre-wrap; }
  .stage { border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px; background:#fafafa; }
  .stage-head { display:flex; flex-wrap:wrap; gap:10px; align-items:center; font-size:14px; margin-bottom:4px; }
  .stage-name { font-weight:600; }
  .stage-win { color:var(--aff); }
  .stage-conf { color:var(--sub); font-size:12px; }
  .stage-comment { font-size:13px; }
  .seg { border-bottom:1px dashed var(--line); padding:10px 0; }
  .seg-head { font-size:13px; font-weight:600; margin-bottom:2px; }
  .seg-who { color:var(--sub); font-weight:400; font-size:12px; margin-left:6px; }
  .ts { color:var(--sub); font-size:11px; }
  .seg-content { font-size:13px; margin-top:2px; white-space:pre-wrap; }
  .suggest { background:#fafafa; border:1px solid var(--line); border-radius:8px; padding:12px 16px; font-size:13px; white-space:pre-wrap; }
  .footer { margin-top:28px; text-align:center; color:var(--sub); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>辩论复盘报告</h1>
  <div class="meta">
    <div><strong>辩题</strong>：${esc(data.topic || '(未填写辩题)')}</div>
    <div><strong>对阵</strong>：${esc(aff)}（正方） vs ${esc(neg)}（反方）</div>
    ${data.judgeName ? `<div><strong>评委</strong>：「${esc(data.judgeName)}」</div>` : ''}
    <div><strong>评审时间</strong>：${esc(exportedAt)}</div>
  </div>

  <div class="verdict-banner">
    <span class="v-win">判定：${esc(winner)}</span>
    ${confidence ? `<span class="v-conf">置信度 ${esc(confidence)}</span>` : ''}
    ${data.bestSpeaker ? `<span class="badge">🏆 最佳辩手：${esc(data.bestSpeaker)}</span>` : ''}
  </div>

  ${radarSvg ? `
    <section>
      <h2>五维能力雷达图</h2>
      <div class="chart">${radarSvg}</div>
      <div class="legend"><span><span class="dot" style="background:${AFF_COLOR}"></span>${esc(aff)}</span><span><span class="dot" style="background:${NEG_COLOR}"></span>${esc(neg)}</span></div>
    </section>
  ` : ''}

  ${data.dimensions.length ? `
    <section>
      <h2>五维评分</h2>
      ${dimsRows}
    </section>
  ` : ''}

  ${stageRows ? `
    <section>
      <h2>逐环节点评</h2>
      ${stageRows}
    </section>
  ` : ''}

  ${timelineRows ? `
    <section>
      <h2>全场转写（${filledSegs.length} 段）</h2>
      ${timelineRows}
    </section>
  ` : ''}

  <section>
    <h2>AI 建议与总结</h2>
    <div class="suggest">
      ${verdictReason ? `<p><strong>判定理由</strong>：${esc(verdictReason)}</p>` : ''}
      ${insufficient ? `<p><em>${esc(insufficient)}</em></p>` : ''}
      ${summary ? `<p>${esc(summary).replace(/\n/g, '<br>')}</p>` : ''}
      ${!verdictReason && !insufficient && !summary ? '<p>暂无总结内容。</p>' : ''}
    </div>
  </section>

  <div class="footer">由 AI 裁判自动生成 · 自包含 HTML，无需联网即可查看</div>
</div>
</body>
</html>`

  return html
}

/**
 * 从 judge_match 结果 + 转写时间线组装结构化复盘并渲染 HTML。
 * 对缺失数据做空态兜底（不抛错），保证任何情况下都能导出一份结构完整的报告。
 * 与 JudgeArena buildJudgeReportMarkdown 的字段口径一致（五维/逐环节/胜负/最佳辩手/建议）。
 */
export function buildJudgeReplayHtml(
  timeline: ReplayTimelineSeg[],
  result: unknown,
  affName?: string | null,
  negName?: string | null,
  topicTitle?: string | null
): { content: string; defaultName: string } {
  const data =
    result && typeof result === 'object'
      ? (result as {
          judgeName?: string
          topic?: string
          verdict?: { winner?: ReplaySide | null; confidence?: number; reason?: string } | null
          dimensions?: ReplayData['dimensions']
          stageVerdicts?: ReplayStageVerdict[]
          bestSpeaker?: string | null
          summary?: string
          insufficientReason?: string
        })
      : null

  const topic = topicTitle?.trim() || data?.topic?.trim() || '(未填写辩题)'
  const aff = affName?.trim() || '正方'
  const neg = negName?.trim() || '反方'

  const replay: ReplayData = {
    topic,
    affName: aff,
    negName: neg,
    judgeName: data?.judgeName,
    verdict: data?.verdict ?? null,
    dimensions: data?.dimensions ?? [],
    stageVerdicts: data?.stageVerdicts ?? [],
    bestSpeaker: data?.bestSpeaker || null,
    summary: data?.summary,
    insufficientReason: data?.insufficientReason,
    timeline,
    exportedAt: new Date().toLocaleString()
  }

  const content = buildReplayHtml(replay)

  const safeAff = aff.replace(/[\\/:*?"<>|]/g, '')
  const safeNeg = neg.replace(/[\\/:*?"<>|]/g, '')
  const defaultName = `辩论复盘_${safeAff}_vs_${safeNeg}_${new Date().toISOString().slice(0, 10)}`
  return { content, defaultName }
}