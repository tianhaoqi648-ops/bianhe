# Services 层实现 Spec

## Why

数据库层（schema + repository）已完成并通过验证，但应用尚不具备任何业务能力。需要实现 `src/main/services/` 下的核心业务逻辑层，作为连接 repository 与未来 IPC/UI 层的中间层，提供：辩题抽取、题库去重、概率控制、文件导入四大核心能力。

## What Changes

新增 4 个 service 模块（纯函数 + 类型导出，不直接注册 IPC）：

- **`src/main/services/probability.ts`** — 加权随机算法 + 难度梯度比例控制
- **`src/main/services/draw-engine.ts`** — 抽取引擎，编排"筛选→排除→加权抽取→持方分配→落库→审计"全流程
- **`src/main/services/dedup-engine.ts`** — 题库去重引擎，文本匹配层（完全/编辑距离/关键词重合）+ AI 语义层预留接口
- **`src/main/services/import-engine.ts`** — 文件解析引擎，支持 xlsx/csv/docx 三种格式，自动识别表头与结构

不修改 db/repository 层。新增依赖：`xlsx`、`mammoth`、`diff-match-patch`、`nodejieba`（中文分词，用于关键词提取）。

## Impact

- **Affected specs**: `init-debate-drawer-base`（依赖其 repository 接口，不修改其代码）
- **Affected code**:
  - 新增：`src/main/services/probability.ts`、`draw-engine.ts`、`dedup-engine.ts`、`import-engine.ts`
  - 修改：`package.json`（新增 4 个依赖）
  - 不修改任何 db/、ipc/、preload/、renderer/ 代码

## ADDED Requirements

### Requirement: 概率控制模块 (probability.ts)

系统 SHALL 提供加权随机选择与难度梯度控制能力，作为抽取引擎的基础组件。

#### Scenario: 加权随机选择 - 基本场景
- **WHEN** 调用 `weightedRandomSelect(items, count)`，items 中每个元素带 `weight` 字段
- **THEN** 返回 `count` 个不重复元素，每个元素被抽中概率 = `weight / 总权重`
- **AND** 当 `count >= items.length` 时返回全部 items（顺序随机）

#### Scenario: 加权随机选择 - 边界处理
- **WHEN** items 为空数组
- **THEN** 抛出 `Error('候选池为空')`
- **WHEN** count <= 0
- **THEN** 返回空数组 `[]`
- **WHEN** 某个 item.weight <= 0
- **THEN** 该项仍可参与抽取但概率为 0（不参与）

#### Scenario: 难度梯度控制
- **WHEN** 调用 `getDifficultyDistribution(roundName)` 获取难度比例
- **THEN** 按预设规则返回 `{ 入门级: x, 进阶级: y, 专业级: z }` 比例（和为 1）
- **AND** 预设规则：小组赛→{0.6, 0.4, 0}；复赛→{0, 0.6, 0.4}；决赛→{0, 0, 1}；其他/未匹配→{0.34, 0.33, 0.33}
- **WHEN** 调用 `applyDifficultyDistribution(candidates, distribution, count)` 按比例从候选池分层抽样
- **THEN** 返回按分布抽取的 result，分布数量不足时从其他难度池补足

---

### Requirement: 抽取引擎 (draw-engine.ts)

系统 SHALL 提供 `drawTopics(params)` 函数，编排完整抽取流程并落库。

#### Scenario: 完整抽取流程
- **WHEN** 调用 `drawTopics(params)`，params 包含 event_id、round_id、topic_count、include_stance、teams、filters、source_mix_ratio、operator
- **THEN** 按顺序执行：
  1. 根据 filters 从 `topicRepo.listTopics` 获取候选题池（不分页，pageSize 足够大）
  2. 排除 `status = 'blacklisted'` 的辩题
  3. 排除本赛事已抽取过的辩题（`drawRepo.listDrawnTopicIdsByEvent`）
  4. 排除参与队伍的历史辩题（`eventRepo.listTeamHistory` 汇总 topic_id）
  5. 如 `round.difficulty_override` 非空，按 `getDifficultyDistribution` 过滤候选池
  6. 如 `source_mix_ratio` 提供，按比例分层抽样混合官方/自定义题源
  7. 调用 `weightedRandomSelect` 抽取指定数量辩题
  8. 如 `include_stance = true`，对每道题随机分配正反方，并把 teams 中两两配对分配到 A/B
  9. 调用 `drawRepo.createSession` 写入会话与明细（事务）
  10. 调用 `auditRepo.addLog` 记录抽取操作
- **AND** 返回 `DrawResult` 包含 session 详情与抽取明细

#### Scenario: 题池不足
- **WHEN** 候选池经排除后数量 < `topic_count`
- **THEN** 抛出 `InsufficientTopicsError`，message 含候选数与需求数，不写入数据库

#### Scenario: 持方分配 - 队伍数量校验
- **WHEN** `include_stance = true` 但 `teams.length < 2` 或 `teams.length` 为奇数
- **THEN** 抛出 `Error('队伍数量必须为 ≥2 的偶数')`
- **WHEN** `include_stance = false`
- **THEN** 不分配持方，items 中 team_a_id / team_b_id / stance_a / stance_b 均为 null

#### Scenario: 单题抽取参数
- **WHEN** `topic_count = 1`
- **THEN** 仍走完整流程，正常返回 1 条结果

#### Scenario: 题源混合比例
- **WHEN** `source_mix_ratio = { official: 0.7, custom: 0.3 }`，topic_count = 10
- **THEN** 从候选池中按 7:3 比例分别从 `source_type='官方'` 与 `source_type='自定义'` 子池抽取
- **AND** 某子池不足时从另一子池补足，并在审计 detail 中记录实际比例

---

### Requirement: 去重引擎 (dedup-engine.ts)

系统 SHALL 提供题库去重检测能力，支持文本匹配层与可选 AI 语义层。

#### Scenario: 完全相同检测
- **WHEN** 调用 `findDuplicates(topics)`，topics 中存在两条 title 完全一致（去首尾空格后）
- **THEN** 归入同一 DuplicateGroup，相似度分数 = 1.0

#### Scenario: 高相似检测 - 编辑距离
- **WHEN** 两条辩题 title 的 Levenshtein 距离 < 5（默认阈值）
- **THEN** 归入同一组，相似度分数 = `1 - distance / max(len_a, len_b)`
- **AND** 距离阈值为可配置参数 `levenshteinThreshold`，默认 5

#### Scenario: 关键词重合检测
- **WHEN** 两条辩题提取的核心关键词重合度 > 0.8（默认阈值）
- **THEN** 归入同一组，相似度分数 = 重合度
- **AND** 关键词提取规则：用 nodejieba 分词，去除停用词与长度 < 2 的词，保留名词/动词

#### Scenario: AI 语义层预留接口
- **WHEN** 调用 `findDuplicates(topics, { similarityFn: async (a, b) => 0.9 })`
- **THEN** 使用传入的 similarityFn 计算两两相似度，分数 > 0.85 时归入同一组
- **AND** similarityFn 为异步函数，返回 0~1 的相似度
- **WHEN** 不提供 similarityFn
- **THEN** 仅使用文本匹配层

#### Scenario: 返回结构
- **WHEN** 检测完成
- **THEN** 返回 `DuplicateGroup[]`，每个 group 含 `id`、`topics: Topic[]`、`similarity: number`、`reason: 'exact' | 'levenshtein' | 'keyword' | 'ai'`
- **AND** 同一条辩题只能出现在一个 group 中（取最高相似度的归并）

---

### Requirement: 导入引擎 (import-engine.ts)

系统 SHALL 提供文件解析能力，支持 Excel/CSV/Word 三种格式，自动识别结构。

#### Scenario: Excel/CSV 解析 - 表头自动映射
- **WHEN** 调用 `parseFile(filePath, 'xlsx')` 或 `parseFile(filePath, 'csv')`
- **THEN** 用 `xlsx` 库读取第一张工作表
- **AND** 识别表头行，将中文表头映射到 Topic 字段：
  - 标题/题目/辩题 → title
  - 类型 → type
  - 领域 → domain
  - 难度 → difficulty
  - 来源 → source
  - 标签 → tags（按逗号/顿号分隔）
- **AND** 返回 `ParsedResult { topics: TopicCreateInput[]; mapping: Record<string, string>; warnings: string[] }`
- **WHEN** 必填字段 title 缺失
- **THEN** 该行跳过并加入 warnings

#### Scenario: Word 解析 - 表格结构
- **WHEN** 调用 `parseFile(filePath, 'docx')` 且文件含表格
- **THEN** 用 `mammoth` 读取，检测到表格时按列解析，第一行为表头，映射规则同 Excel
- **AND** 返回 ParsedResult

#### Scenario: Word 解析 - 编号列表
- **WHEN** docx 文件不含表格但含编号列表（如 "1. xxx" / "一、xxx"）
- **THEN** 按编号项解析为 title，其他字段为 null
- **AND** 返回 ParsedResult

#### Scenario: Word 解析 - 纯文本段落
- **WHEN** docx 文件不含表格与编号，仅纯文本段落
- **THEN** 按段落（空行分隔）解析为 title，其他字段为 null
- **AND** 返回 ParsedResult

#### Scenario: 不支持的文件类型
- **WHEN** fileType 不是 'xlsx' | 'csv' | 'docx'
- **THEN** 抛出 `Error('不支持的文件类型: <type>')`

#### Scenario: 文件不存在
- **WHEN** filePath 指向的文件不存在
- **THEN** 抛出 `Error('文件不存在: <path>')`

---

### Requirement: 模块导出与依赖关系

#### Scenario: 模块依赖顺序
- **WHEN** 编译/运行时
- **THEN** 依赖关系为：`draw-engine.ts` → `probability.ts` + 4 个 repository；`dedup-engine.ts` → `topic.repo` 类型；`import-engine.ts` → `topic.repo` 类型；`probability.ts` 无内部依赖

#### Scenario: 纯函数风格
- **WHEN** 调用任意 service 函数
- **THEN** 函数不持有模块级可变状态（除预设常量），所有状态通过参数传入，便于测试与 IPC 层无状态包装

## MODIFIED Requirements

无（本次为纯新增）。

## REMOVED Requirements

无。
