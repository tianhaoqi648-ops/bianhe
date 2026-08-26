# KNOWN_DIVERGENCES — 跨端已知行为差异登记（Phase 7.7-3）

> 本文件随 golden 测试同步到两端仓库。规则：**发现真实差异 → 先在此登记 + golden 固化（it.skip + TODO），不擅自修改产品规则**。
> TODO 注释格式：`TODO(7.7-3-known-divergence): 见 KNOWN_DIVERGENCES.md #N`。
> 差异项裁决后：更新本表状态（resolved/decided）并启用对应 golden 断言。

---

## #1 循环赛主客互换（round robin home/away）

- **现象**：Mini `generateRoundRobin`（cloud/functions/event/index.js 原 L182）奇数轮执行主客互换（`r % 2 === 1` 时交换 home/away）；Desktop `generateSingleRoundRobin`（src/main/agent/schedule-engine.ts）不互换。
- **证据**：Mini event/index.js L181-182；Desktop schedule-engine.ts（单循环圆圈法直接输出）。
- **影响面**：赛程对阵的 team_a/team_b（正反方）归属在两端不一致；无序对阵集合一致。
- **待裁决**：哪端为主客规范？是否统一为「奇数轮互换」？
- **启用条件**：裁决后修改一端，两端 golden 主客断言取消 skip 并精确比对。

## #2 Swiss 配对结构（Swiss pairing）

- **现象**：Desktop `generateSwiss` 第 1 轮 Fisher-Yates 随机配对 + 后续空框架（TBD）；Mini `generateSwiss` 同样随机但实现独立（shuffle），且后续轮次由 `swissPairNext` 动态生成（Desktop 无等价实现）。
- **证据**：Desktop schedule-engine.ts L313+；Mini event/index.js L264-301 + L1661-1753。
- **影响面**：Swiss 精确配对序列两端不可比（随机源与算法独立）；结构不变量（覆盖性/轮空/积分）可比。
- **待裁决**：是否需要统一 Swiss 配对算法进 Core（本阶段明确不抽 Schedule Engine）？
- **启用条件**：Schedule 进入 Core 并统一算法后，golden 启用精确配对断言。

## #3 draw 洗牌顺序（draw shuffle order）

- **状态**：**已解决（种子注入）**。两端运行同一 golden 测试文件、同一 mulberry32 种子 → 同一 Math.random 序列 → draw 输出可直接精确断言。不 skip。
- **证据**：golden/rng.ts `withSeed` + draw.json fixture `seed: 20260115`。

## #4 difficulty 大师级边界 / difficulty_override 语义

- **现象**：桌面历史难度档 4 档（含「大师级」），Core 规范 3 档（入门/进阶/专业）；`normalizeDifficulty('大师级') === '专业'` 是 **Core 确定性行为**（golden 直接断言，不 skip）。
- **已知（7.2 登记）**：Desktop 内部 `difficulty_override` 语义不一致——端侧 override 行为不在 Core，**不做跨端断言**。
- **待裁决**：端侧 difficulty_override 语义是否统一（后续阶段，本阶段不修）。

## #5 backup restore order 12 vs 8

- **现象**：桌面备份 12 类别（BACKUP_CATEGORIES，src/shared/constants.ts），Mini 8 类别（cloud/functions/common/pure/backup-protocol.js shim）。Core `backup-protocol.ts` 不含类别→表映射（端侧维护）。
- **处理**：golden 不做跨端相等断言；每端各自断言「自身 BACKUP_RESTORE_ORDER 是其类别集的合法拓扑序」（结构性不变量）。
- **待裁决**：类别清单是否统一（跨端互导语义，后续阶段）。

## #6 schedule-engine 类型依赖 @shared/agent-types（不在 Core）

- **现象**：Desktop schedule-engine.ts 仅 `import type { ScheduleRound, ScheduleMatch } from '@shared/agent-types'`，该类型不在 Core。
- **处理**：桌面 schedule golden 测试文件**不随 sync 同步**（各自维护，共享 schedule.json fixture）；Mini 用端侧 common/pure/schedule.js。
- **待裁决**：Schedule 进入 Core 时，ScheduleRound/ScheduleMatch 类型需随迁（Schedule 本阶段不抽）。
