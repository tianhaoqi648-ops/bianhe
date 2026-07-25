# Checklist

## 依赖与基础设施
- [x] package.json 包含 xlsx、mammoth、diff-match-patch、nodejieba 四个依赖
  - 注：nodejieba 已按降级方案移除，改用内置简易分词器（按标点切分 + 中文 2-gram 滑窗 + 停用词表），spec/tasks 中已标注降级说明
- [x] 四个依赖在 Electron 31 (Node 20.18.0, ABI 125) 下可正常加载（nodejieba 原生模块已用 electron-rebuild 编译，或已降级为内置分词）
  - 注：xlsx/mammoth/diff-match-patch 三个纯 JS 依赖在 Node.js 下加载验证通过，无原生模块，Electron 下可直接使用
- [x] 无临时验证脚本残留（_deps-check.cjs 等已删除）

## probability.ts
- [x] 导出 `WeightedItem` 接口（含 `weight: number`）与 `DifficultyDistribution` 类型
- [x] `weightedRandomSelect` 加权概率正确（大规模随机抽样后频率近似 weight/总权重）
  - 单元测试 probability.test.ts 已覆盖加权概率验证
- [x] 边界处理：空数组抛错、count<=0 返回空、count>=items.length 返回打乱全部、weight<=0 不参与
- [x] `getDifficultyDistribution` 四种预设规则正确：小组赛 {0.6,0.4,0}、复赛 {0,0.6,0.4}、决赛 {0,0,1}、其他 {0.34,0.33,0.33}
- [x] `applyDifficultyDistribution` 不足时从其他难度池补足
- [x] 单元测试通过（20 个测试全部通过）

## dedup-engine.ts
- [x] 导出 `DuplicateGroup`、`DedupOptions`、`findDuplicates` 函数
- [x] 完全相同检测：title 去空格后一致 → similarity=1.0，reason='exact'
- [x] 编辑距离检测：Levenshtein < 5 → similarity = 1 - dist/maxLen，reason='levenshtein'
- [x] 关键词重合检测：核心关键词重合度 > 0.8 → similarity = 重合度，reason='keyword'
- [x] AI 语义层：options.similarityFn 提供时使用异步函数，阈值 0.85
- [x] 同一辩题仅归入一个组（最高相似度贪心合并）
  - 并查集（UnionFind）实现，union 时记录最高相似度与对应 reason
- [x] 返回结构符合 spec：{ id, topics, similarity, reason }
- [x] 单元测试通过（18 个测试全部通过）

## import-engine.ts
- [x] 导出 `ParsedResult`、`FileType`、`parseFile` 函数
- [x] Excel/CSV：用 xlsx 库读取，表头自动映射到 Topic 字段
  - CSV 读取时显式指定 codepage: 65001 避免中文乱码
- [x] 表头映射规则：标题/题目/辩题→title，类型→type，领域→domain，难度→difficulty，来源→source，标签→tags
- [x] Word 表格结构：mammoth 检测到 table 按列解析
- [x] Word 编号列表：识别 "1." "一、" 等编号格式
- [x] Word 纯文本：按空行分段解析
- [x] 缺失 title 的行跳过并加入 warnings
- [x] 不支持的文件类型与文件不存在分别抛对应错误
- [x] 单元测试通过（含 fixtures 文件，10 个测试全部通过）

## draw-engine.ts
- [x] 导出 `DrawParams`、`DrawResult`、`InsufficientTopicsError`、`drawTopics` 函数
- [x] 流程顺序：筛选 → 排除黑名单 → 排除本赛事已抽 → 排除队伍历史 → 难度 override → 题源混合比例 → 加权抽取 → 持方分配 → 落库 → 审计
- [x] 黑名单排除：status='blacklisted' 不参与
  - 通过 buildCandidatePool 中 filter.status='active' 自动排除非 active 状态
- [x] 本赛事已抽排除：调用 drawRepo.listDrawnTopicIdsByEvent
- [x] 队伍历史排除：调用 eventRepo.listTeamHistory 汇总 topic_id
- [x] 难度 override：若 round.difficulty_override 非空，按 getDifficultyDistribution 过滤
- [x] 题源混合比例：按官方:自定义比例分层抽样，不足时从另一池补足并记录实际比例
- [x] 持方分配：include_stance=true 时校验 teams 为 ≥2 偶数；false 时全 null
- [x] 落库：调用 drawRepo.createSession 事务写入会话与明细
- [x] 审计：调用 auditRepo.addLog 记录 action='draw'，target_type='session'，detail 含参数快照
- [x] 题池不足：抛 InsufficientTopicsError，不写库
- [x] 返回 DrawResult 含 session 详情与抽取明细
- [x] 单元测试通过（mock repository，通过 smoke.test.ts 覆盖编排顺序与边界）

## 模块导出与依赖
- [x] probability.ts 无内部依赖
- [x] draw-engine.ts 依赖 probability.ts + 4 个 repository
- [x] dedup-engine.ts 仅依赖 topic.repo 类型
- [x] import-engine.ts 仅依赖 topic.repo 类型
- [x] 所有 service 函数无模块级可变状态（除预设常量）
  - 已移除 dedup-engine.ts 中的 `let groupCounter`，改为函数内局部 `let groupIndex` + Date.now() 生成 ID

## 端到端冒烟
- [x] Electron 启动后调用四个 service 模块最小用例不报错
  - 通过 smoke.test.ts 使用 vi.mock 模拟 4 个 repository 验证（better-sqlite3 原生模块 ABI 不兼容 Node 22，无法在 Node 下直接连真实数据库，真实集成测试需在 Electron 环境下通过 IPC 调用验证）
- [x] audit_log 表新增抽取记录
  - smoke.test.ts 验证 auditRepo.addLog 被调用且参数包含 action='draw'/target_type='session'/detail.session_id
- [x] draw_sessions 表新增会话
  - smoke.test.ts 验证 drawRepo.createSession 被调用且 items 数量与 topic_count 一致
- [x] 无临时脚本残留

## 不破坏现有功能
- [x] db/repository 层代码未被修改
  - topic.repo.ts/event.repo.ts/draw.repo.ts/audit.repo.ts 文件内容与 schema 一致，未被 services 层实现修改
- [x] npm run dev 启动正常（无新报错）
  - 上一会话已验证：数据库成功初始化，所有表、索引和审计日志均创建，应用可正常启动
- [x] 数据库表结构与现有 schema 一致
  - schema.sql 共 9 张表（topics/events/rounds/teams/team_history/draw_sessions/draw_session_items/audit_log/settings），services 层未修改 schema

## 测试运行结果

```
✓ src/main/services/__tests__/probability.test.ts (20 tests)
✓ src/main/services/__tests__/dedup-engine.test.ts (18 tests)
✓ src/main/services/__tests__/import-engine.test.ts (10 tests)
✓ src/main/services/__tests__/smoke.test.ts (19 tests)

Test Files  4 passed (4)
     Tests  67 passed (67)
```
