# 导入撤销与分类优化 — 剩余迭代执行清单

> **配套详细设计**：[import-undo-and-category-optimization-revised-plan.md](./import-undo-and-category-optimization-revised-plan.md)
> **执行模式**：每迭代独立 commit，每迭代完成后跑 `npm run typecheck && npm test`
> **生成日期**：2026-07-26
> **状态**：迭代1 已完成约 50%（1.1/1.2/1.6/1.7-类型修复 已做）；剩余按本清单顺序执行

---

## 执行原则

1. **严格按迭代顺序**：迭代1 → 迭代2 → 迭代3，不跳步
2. **每完成一个步骤立即标记**：在本文档勾选 `- [ ]` → `- [x]`
3. **每个迭代结束必跑验证**：`npm run typecheck && npm test`
4. **每个迭代结束必 commit**：使用清单中给定的 commit message
5. **遇到设计冲突**：停下来与用户确认，不擅自调整
6. **代码片段参考**：本清单只列任务骨架，具体代码片段见配套设计文档对应章节

---

## 迭代 1 — 端到端闭环（剩余 7 个任务）

### Task 1.3: ImportTopicsModal 传 fileName + 撤销按钮

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

参考设计文档 §1.3.1 / §1.3.2 / §1.3.3

- [ ] **Step 1: 提取 fileName 到 handleImport 调用前**

  当前 L183 的 `filePath?.split(/[\\/]/).pop()` basename 提取逻辑需前移到 `handleImport` 函数内或调用 `execute` 之前。修改 `handleImport`（L160-180），在调用 `window.importAPI.execute` 时传入 `fileName`。

- [ ] **Step 2: 导入成功 notification 带「撤销导入」按钮**

  替换 L173 的 `messageApi.success(...)` 为 `messageApi.open({...})`，含 `btn: <Button onClick={revoke}>撤销导入</Button>`，duration=8 秒。撤销逻辑：调 `window.importAPI.revokeBatch(batchId)` → 成功后 `messageApi.destroy(key)` + `messageApi.success(...)` + `onSuccess?.()` + `onClose()`。

- [ ] **Step 3: Step 3 完成页加「撤销本次导入」次级按钮**

  在 `Result` 的 `extra` 数组中追加 `<Button danger icon={<UndoOutlined />} onClick={handleRevokeFromResult}>撤销本次导入</Button>`。`handleRevokeFromResult` 用 `Modal.confirm` 二次确认 → 调 revokeBatch → 成功后 reset + onClose。

- [ ] **Step 4: import 新增 `UndoOutlined` from `@ant-design/icons`**

- [ ] **Step 5: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS（无 TS 错误）

### Task 1.4: 新建 ImportHistoryModal.tsx

**Files:**
- Create: `src/renderer/src/components/ImportHistoryModal.tsx`

参考设计文档 §1.4

- [ ] **Step 1: 创建文件骨架**

  Props: `{ open, onClose, onSuccess, onViewBatch }`。导入 antd 组件：Modal/Table/Button/Popconfirm/Empty/Badge/Space/Tooltip/Typography/Spin/message。import `dayjs` 用于时间格式化。import `ImportBatch` 类型 from `../../../shared/types`。

- [ ] **Step 2: 实现 fetchBatches + useEffect**

  `useEffect(() => { if (open) fetchBatches() }, [open])`。`fetchBatches` 调 `window.importAPI.listBatches()` 设置 `batches` state。

- [ ] **Step 3: 定义表格列**

  5 列：文件名（Text ellipsis + tooltip）、导入时间（dayjs 格式化 `YYYY-MM-DD HH:mm`）、导入/重复/失败（文本拼接）、当前剩余（Badge，0 灰色）、操作（「查看此批次」+「撤销整批」Popconfirm）。

- [ ] **Step 4: 实现 handleRevoke**

  `setRevoking(batchId)` → `window.importAPI.revokeBatch(batchId)` → 成功后 `messageApi.success` + `onSuccess()` + `fetchBatches()`。失败 messageApi.error。finally `setRevoking(null)`。

- [ ] **Step 5: 实现 handleView**

  `onViewBatch(batchId)` + `onClose()`。

- [ ] **Step 6: 空状态渲染**

  `batches.length === 0` 显示 `<Empty description="暂无导入记录" />`。

- [ ] **Step 7: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 1.5: TopicLibrary 工具栏加「导入历史」按钮

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §1.5

- [ ] **Step 1: import ImportHistoryModal 与 HistoryOutlined**

  顶部 import `ImportHistoryModal from '../components/ImportHistoryModal'`，从 `@ant-design/icons` import `HistoryOutlined`。

- [ ] **Step 2: 新增 state**

  `const [importHistoryOpen, setImportHistoryOpen] = useState(false)`

- [ ] **Step 3: 工具栏 Space 内新增按钮**

  在「导入辩题」按钮旁追加 `<Button icon={<HistoryOutlined />} onClick={() => setImportHistoryOpen(true)}>导入历史</Button>`

- [ ] **Step 4: 顶部挂载 ImportHistoryModal**

  ```tsx
  <ImportHistoryModal
    open={importHistoryOpen}
    onClose={() => setImportHistoryOpen(false)}
    onSuccess={() => store.fetchList()}
    onViewBatch={(batchId) => {
      store.setFilter({ batch_id: batchId, page: 1 })
    }}
  />
  ```

- [ ] **Step 5: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 1.8: 删除 importedPlaceholderToReal 死代码

**Files:**
- Modify: `src/main/ipc/import.ipc.ts`

参考设计文档 §1.8

- [ ] **Step 1: 删除 L117 占位 Map 定义**

  删除 `const importedPlaceholderToReal = new Map<string, string>()`

- [ ] **Step 2: 删除 L162-166 createMany 后的映射写入循环**

  保留 `const created = topicRepo.createMany(topicsToImport)` 与 `imported = created.length`。

- [ ] **Step 3: 简化 createMany try-catch**

  ```typescript
  try {
    const created = topicRepo.createMany(topicsToImport)
    imported = created.length
  } catch (e) {
    failed = topicsToImport.length
    console.error('[import.ipc] createMany failed:', e)
  }
  ```

- [ ] **Step 4: 检查 L130 唯一引用点是否仍能编译**

  L130 `importedPlaceholderToReal.get(mid)` 在删除前需先确认：删除后该分支 `if (realId) conflictIds.push(realId)` 永远不会推入 realId（因为 `realId` 永远是 undefined），但不会编译错误。此为可接受的"新题之间重复检测弱化"——`findDuplicates` 仍能在 `allTopics` 集合上检测新题之间重复并标记 groupMembers，第一次出现的题会被插入，后续同组题在 L124-144 检测到 `memberIds` 中含其他 `__new_X__` 占位 id 时会进入 duplicates 分支。

  **关键确认**：删除 `importedPlaceholderToReal` 后，新题之间的去重逻辑变为：仅依靠 `findDuplicates` 输出的 groupMembers 关系，第一题入库（占位 id 无 realId 不阻断），同组后续题在循环到时检测到 `mid.startsWith('__new_')` 但 `realId` 为 undefined → 不会推入 conflictIds → **不会判为重复**。这会导致新题之间的重复全部入库。

  **修复方案**：删除映射的同时，调整 L128-135 逻辑：凡是 `mid.startsWith('__new_')` 且 `mid !== placeholderId`（即同组其他新题），直接判为冲突（不需查 realId）。

  ```typescript
  for (const mid of memberIds) {
    if (mid.startsWith('__new_')) {
      // 同组其他新题视为冲突（避免新题之间重复入库）
      if (mid !== placeholderId) conflictIds.push(mid)
    } else {
      // 库内已存在题
      conflictIds.push(mid)
    }
  }
  ```

- [ ] **Step 5: typecheck + test 验证**

  Run: `npm run typecheck && npm test`
  Expected: PASS（如有 import-engine 测试涉及去重逻辑，应全部通过）

### Task 1.9: listBatches limit 100 → 500

**Files:**
- Modify: `src/main/db/repository/import-batch.repo.ts`

参考设计文档 §1.9

- [ ] **Step 1: 修改 listBatches 默认参数**

  L100 `function listBatches(limit = 100): ImportBatch[]` → `function listBatches(limit = 500): ImportBatch[]`

- [ ] **Step 2: 更新 JSDoc 注释**

  L98 `默认上限 100 条` → `默认上限 500 条`

- [ ] **Step 3: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 1.10: 迭代 1 验证清单

- [ ] **Step 1: typecheck**

  Run: `npm run typecheck`
  Expected: PASS

- [ ] **Step 2: 单元测试**

  Run: `npm test`
  Expected: 所有测试通过

- [ ] **Step 3: 启动 dev 验证**

  Run: `npm run dev`
  Expected: 应用正常启动，DB 初始化、IPC 注册、官方题库加载均成功

- [ ] **Step 4: 端到端手动验证（5 个场景）**

  1. 导入 100 条 → notification 出现「撤销导入」按钮 → 点击 → 题库回到导入前
  2. Step 3 完成页点击「撤销本次导入」→ Modal.confirm → 确认 → 撤销成功
  3. 题库工具栏点「导入历史」→ 弹窗列出批次 → 点「查看此批次」→ 列表筛到该批次
  4. 导入历史弹窗点「撤销整批」→ Popconfirm → 确认 → 列表刷新 + 题库刷新
  5. DevTools 调用 `window.topicAPI.countByDimension('type')` 返回全库分布

### Task 1.11: 迭代 1 Commit

- [ ] **Step 1: git add + commit**

  ```bash
  git add src/preload/ src/main/ipc/ src/main/db/repository/import-batch.repo.ts src/main/db/repository/topic.repo.ts src/renderer/src/components/ImportTopicsModal.tsx src/renderer/src/components/ImportHistoryModal.tsx src/renderer/src/pages/TopicLibrary.tsx src/shared/types.ts
  git commit -m "feat(import): complete batch undo end-to-end with history modal

- preload: expose revokeBatch/listBatches in importAPI
- ImportTopicsModal: pass fileName, add undo notification + Step 3 revoke button
- ImportHistoryModal: new component with batch list, view, revoke
- TopicLibrary: add import history toolbar button
- topic.ipc: register TOPIC_COUNT_BY_DIMENSION handler
- import-batch.repo: unify ImportBatch type with shared/types
- import.ipc: remove dead importedPlaceholderToReal code, fix new-topic dedup
- listBatches: raise default limit 100 → 500"
  ```

---

## 迭代 2 — 新值映射（9 个任务）

### Task 2.1: 类型定义扩展

**Files:**
- Modify: `src/shared/types.ts`

参考设计文档 §2.1

- [ ] **Step 1: 新增 ValueMapping 相关类型**

  在 `ImportBatch` 后追加：`ValueMappingAction` / `ValueMappingRule` / `ValueMapping` / `UnknownValueItem` 类型定义（见设计文档 §2.1 代码块）。

- [ ] **Step 2: ParsedResult 加 unknownValues? 字段**

  L278-282 改为加 `unknownValues?: UnknownValueItem[]`

- [ ] **Step 3: ImportExecuteRequest 加 valueMapping? 字段**

  L414-420 加 `valueMapping?: ValueMapping`

- [ ] **Step 4: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 2.2: import-engine.ts 改造

**Files:**
- Modify: `src/main/services/import-engine.ts`

参考设计文档 §2.2

- [ ] **Step 1: SYSTEM_CANDIDATES 扩为 5 字段**

  从 `../../shared/constants` import `SYSTEM_CANDIDATES as SYSTEM_CANDIDATES_SRC` 与 `CandidateField` 类型。重写 `SYSTEM_CANDIDATES` 为 `Record<CandidateField, string[]>`，含 type/domain/difficulty/source/source_type 5 字段。

- [ ] **Step 2: FIELD_LABEL 加 source_type**

  追加 `source_type: '来源类型'`

- [ ] **Step 3: 实现 collectUnknownValues 函数**

  按设计文档 §2.2.3 实现：遍历 topics × 5 字段，过滤系统候选值，按字段分组返回 `UnknownValueItem[]`，按 count 降序。

- [ ] **Step 4: parseExcelOrCsv / parseDocx 末尾调用**

  两个 parse 函数返回前追加 `const unknownValues = collectUnknownValues(topics)`，返回对象加 `unknownValues` 字段。

- [ ] **Step 5: ParsedResult 接口同步**

  import-engine 内部 ParsedResult 类型从 `../../shared/types` import（或同步加 unknownValues 字段）。

- [ ] **Step 6: 单元测试覆盖 collectUnknownValues**

  在 `src/main/services/__tests__/import-engine.test.ts` 追加测试：构造含新值的 topics，验证返回结构正确。

- [ ] **Step 7: typecheck + test 验证**

  Run: `npm run typecheck && npm test`
  Expected: PASS

### Task 2.3: SYSTEM_GET_CANDIDATES IPC

**Files:**
- Modify: `src/shared/types.ts`（IPC_CHANNELS 加 `SYSTEM_GET_CANDIDATES: 'system:getCandidates'`）
- Create: `src/main/ipc/system.ipc.ts`
- Modify: `src/main/index.ts`（注册 registerSystemIpc）
- Modify: `src/preload/index.ts`（settingsAPI 加 getCandidates）
- Modify: `src/preload/index.d.ts`（SettingsAPI 接口同步）

参考设计文档 §2.3

- [ ] **Step 1: shared/types.ts IPC_CHANNELS 加 SYSTEM_GET_CANDIDATES**

- [ ] **Step 2: 新建 src/main/ipc/system.ipc.ts**

  实现 `registerSystemIpc()`，注册 `SYSTEM_GET_CANDIDATES` handler 调用 `getMergedCandidates()` 返回 `Record<CandidateField, string[]>`。

- [ ] **Step 3: main/index.ts 注册 registerSystemIpc**

  在 `registerAllIpc()` 中调用 `registerSystemIpc()`。

- [ ] **Step 4: preload/index.ts settingsAPI 加 getCandidates**

  `getCandidates: () => invoke(IPC_CHANNELS.SYSTEM_GET_CANDIDATES)`

- [ ] **Step 5: preload/index.d.ts SettingsAPI 接口同步**

  `getCandidates: () => Promise<ApiResponse<Record<string, string[]>>>`

- [ ] **Step 6: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 2.4: 新建 ValueMappingPanel.tsx

**Files:**
- Create: `src/renderer/src/components/import/ValueMappingPanel.tsx`

参考设计文档 §2.4

- [ ] **Step 1: 创建文件骨架 + Props 接口**

  Props: `{ unknownValues, candidateOptions, onMappingChange }`

- [ ] **Step 2: 实现 state 与默认值**

  `mapping` / `actionState` / `mapTarget` 三个 state，默认 `{}`。

- [ ] **Step 3: 顶部总览**

  动态计算「N 个新值，分布在 M 个字段」并展示。

- [ ] **Step 4: 字段分区渲染**

  按 unknownValues 遍历，每个 field 一个 Section，标题 `${FIELD_LABEL[field]} (${item.values.length} 个新值)`。

- [ ] **Step 5: 单行渲染**

  Tag 显示 `value ×count` + Select action（保留/映射到.../加入候选）+ 当 action='map' 时显示候选值下拉。

- [ ] **Step 6: handleActionChange / handleMapTargetChange**

  更新 state 并通过 onMappingChange 回传父组件。

- [ ] **Step 7: 底部批量按钮**

  「全部保留」清空 mapping；「全部加入候选」全部设为 add。

- [ ] **Step 8: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 2.5: 新建 utils/valueMapping.ts

**Files:**
- Create: `src/renderer/src/utils/valueMapping.ts`

参考设计文档 §2.5

- [ ] **Step 1: 实现 applyMapping 函数**

  遍历 mapping 的 field → rule，action='map' 时改写 topic 字段值为 target。

- [ ] **Step 2: 实现 applyMappingToTopics 函数**

  批量调用 applyMapping，空 mapping 直接返回原数组。

- [ ] **Step 3: 实现 isMappingValid 函数**

  所有 action='map' 必须有 target，否则返回 false。

- [ ] **Step 4: 单元测试**

  新建 `src/renderer/src/utils/__tests__/valueMapping.test.ts`，覆盖 keep/map/add 三种动作 + isMappingValid 边界。

- [ ] **Step 5: typecheck + test 验证**

  Run: `npm run typecheck && npm test`
  Expected: PASS

### Task 2.6: ImportTopicsModal 集成 ValueMappingPanel

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

参考设计文档 §2.6

- [ ] **Step 1: 新增 state + import**

  `valueMapping` / `mergedCandidates` state。import `ValueMappingPanel` / `applyMappingToTopics` / `isMappingValid` / `ValueMapping` / `CandidateField`。

- [ ] **Step 2: open 时拉取候选**

  `useEffect(() => { if (open) window.settingsAPI.getCandidates().then(...) }, [open])`

- [ ] **Step 3: Step 2 预览页条件渲染 ValueMappingPanel**

  当 `parsed?.unknownValues?.length > 0 && mergedCandidates` 时在预览表格上方渲染 Alert + ValueMappingPanel。

- [ ] **Step 4: handleImport 应用映射 + 传 valueMapping**

  调 execute 前先 `isMappingValid(valueMapping)` 校验，不通过提示错误。通过则 `applyMappingToTopics(parsed.topics, valueMapping)` 得 finalTopics，传 `{ topics: finalTopics, checkDuplicates: true, fileName, valueMapping }`。

- [ ] **Step 5: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 2.7: import.ipc.ts 处理 add 动作

**Files:**
- Modify: `src/main/ipc/import.ipc.ts`

参考设计文档 §2.7

- [ ] **Step 1: import addCandidateValue + CandidateField**

- [ ] **Step 2: 在 createBatch 之后、createMany 之前处理 valueMapping.add**

  遍历 `req.valueMapping` 的 field → valueMap → entries，action='add' 时调 `addCandidateValue(field, originValue)`。try-catch 单独捕获，不影响主流程。

- [ ] **Step 3: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 2.8: 迭代 2 验证清单

- [ ] **Step 1: typecheck + test**

  Run: `npm run typecheck && npm test`
  Expected: PASS

- [ ] **Step 2: 启动 dev 验证**

  Run: `npm run dev`
  Expected: 应用正常启动

- [ ] **Step 3: 端到端手动验证（8 个场景）**

  见设计文档 §2.8：构造含新值的 xlsx → 预览页显示 ValueMappingPanel → 测试 keep/map/add 三种动作 → 验证入库结果 → 重启验证 add 持久化 → 验证 isMappingValid 拦截。

### Task 2.9: 迭代 2 Commit

- [ ] **Step 1: git add + commit**

  ```bash
  git add src/shared/ src/main/ src/preload/ src/renderer/src/components/import/ src/renderer/src/components/ImportTopicsModal.tsx src/renderer/src/utils/
  git commit -m "feat(import): add value mapping for unknown candidates on import

- types: add ValueMapping/ValueMappingRule/UnknownValueItem types
- import-engine: extend SYSTEM_CANDIDATES to 5 fields, add collectUnknownValues
- system.ipc: new IPC SYSTEM_GET_CANDIDATES with settingsAPI.getCandidates
- ValueMappingPanel: new component with keep/map/add actions + batch ops
- valueMapping utils: applyMapping/applyMappingToTopics/isMappingValid
- ImportTopicsModal: render ValueMappingPanel, apply mapping before execute
- import.ipc: persist 'add' actions to candidate-service before createMany"
  ```

---

## 迭代 3 — 分类与列表优化（11 个任务）

### Task 3.1: topic.repo.ts 改造

**Files:**
- Modify: `src/main/db/repository/topic.repo.ts`

参考设计文档 §3.1

- [ ] **Step 1: 新增 listAllTags 函数**

  按设计文档 §3.1.1 实现：SQL 拉取所有 status='active' 且 tags IS NOT NULL 的行，JS 层 JSON.parse 聚合，返回 `Array<{ value, count }>` 按 count 降序。try-catch 跳过损坏 JSON。

- [ ] **Step 2: export 加入 listAllTags**

  在 `topicRepo` 对象中加入 `listAllTags`。

- [ ] **Step 3: buildWhereClause 支持 `'__unset__'`**

  L137-147 scalarFields 循环内：`if (value === '__unset__') conditions.push(\`${column} IS NULL\`)` 否则保持原 `= ?` 逻辑。

- [ ] **Step 4: 单元测试**

  在 `src/main/db/repository/__tests__/topic.repo.test.ts` 追加：
  - listAllTags 返回正确聚合
  - buildWhereClause with `__unset__` 生成 IS NULL
  - buildWhereClause with 正常值生成 `= ?`

- [ ] **Step 5: typecheck + test 验证**

  Run: `npm run typecheck && npm test`
  Expected: PASS

### Task 3.2: TOPIC_LIST_ALL_TAGS IPC

**Files:**
- Modify: `src/shared/types.ts`（IPC_CHANNELS 加 `TOPIC_LIST_ALL_TAGS: 'topic:listAllTags'`）
- Modify: `src/main/ipc/topic.ipc.ts`（注册 handler）
- Modify: `src/preload/index.ts`（topicAPI 加 listAllTags）
- Modify: `src/preload/index.d.ts`（TopicAPI 接口同步）

参考设计文档 §3.2

- [ ] **Step 1: shared/types.ts IPC_CHANNELS 加 TOPIC_LIST_ALL_TAGS**

- [ ] **Step 2: topic.ipc.ts 注册 handler**

  调用 `topicRepo.listAllTags()` 返回 `Array<{ value, count }>`。

- [ ] **Step 3: preload/index.ts topicAPI 加 listAllTags**

- [ ] **Step 4: preload/index.d.ts TopicAPI 接口同步**

- [ ] **Step 5: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.3: TopicLibrary 8 维分类树

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §3.3

- [ ] **Step 1: 类型与常量定义**

  `DimensionKey` 扩为 8 维。`DimensionMeta` 接口含 `source: 'system' | 'ipc_count' | 'ipc_tags' | 'ipc_batches' | 'static'`。`DIMENSIONS` 数组按 §3.3.1 重新定义。

- [ ] **Step 2: dimensionData state**

  `useState<DimensionItem[]>([])` + `useState<boolean>(false)` for loading。

- [ ] **Step 3: useEffect 维度数据加载**

  按 `meta.source` 分支：system/static 调 `countByDimension`；ipc_tags 调 `listAllTags`；ipc_batches 调 `listBatches`（处理同名加后缀）。`'(未设置)'` 翻译为 `'__unset__'`。

- [ ] **Step 4: treeData 渲染改造**

  使用 `dimensionData` 而非原 `meta.options`，加入 `__all__` 节点。

- [ ] **Step 5: renderTreeNode 改造**

  按设计文档 §3.3.4 实现：`__all__` 节点显示「全部」+ 总数 Badge；其他节点显示 icon + label + count Badge（0 灰色，>0 主色）。

- [ ] **Step 6: 节点点击 setFilter**

  `__all__` → 清除该维度筛选；`__unset__` → `setFilter({ [dimension]: '__unset__' })`；其他 → `setFilter({ [dimension]: k })`。tags 维度特殊：`setFilter({ tags: [value] })`。

- [ ] **Step 7: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.4: 面包屑导航

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §3.4

- [ ] **Step 1: import Breadcrumb**

- [ ] **Step 2: breadcrumbItems useMemo**

  全部 → 当前维度 / 当前选中分类。点击「全部」调 `handleResetToAll`。

- [ ] **Step 3: handleResetToAll 实现**

  `setSelectedCategory('__all__')` + `store.setFilter({ [dimension]: undefined })`

- [ ] **Step 4: 在分类树上方渲染 Breadcrumb**

- [ ] **Step 5: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.5: 重置筛选按钮

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §3.5

- [ ] **Step 1: hasFilterPanelActive useMemo**

  遍历 `store.filter`，排除 page/pageSize/dimension/空值/空数组，返回 boolean。

- [ ] **Step 2: 条件渲染重置按钮**

  `hasFilterPanelActive` 为 true 时显示 `<Button icon={<CloseCircleOutlined />} onClick={() => store.resetFilter()}>重置筛选</Button>`

- [ ] **Step 3: 确认 store.resetFilter 行为**

  现有 `resetFilter` 重置为 DEFAULT_FILTER（清空所有筛选字段）。如需保留 dimension + selectedCategory，需在调用后手动恢复：`store.resetFilter(); store.setFilter({ [dimension]: selectedCategory === '__all__' ? undefined : selectedCategory === '__unset__' ? '__unset__' : selectedCategory })`。

  **决策**：保持 resetFilter 仅清 FilterPanel 字段不动 dimension，需扩展 store：新增 `resetFilterPanel(exceptKeys: string[])` 方法，或调用方手动恢复。本期采用「调用方手动恢复」方案，最小改动。

- [ ] **Step 4: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.6: topicStore 跨页全选

**Files:**
- Modify: `src/renderer/src/stores/topicStore.ts`

参考设计文档 §3.6

- [ ] **Step 1: state 扩展**

  `allSelectedInFilter: boolean`（默认 false）+ `exceptIds: Set<string>`（默认空 Set）。

- [ ] **Step 2: 实现 selectPage 方法**

  如果 `allSelectedInFilter` 为 true，先退出全选模式（清空 exceptIds）。然后切换当前页选中状态。

- [ ] **Step 3: 实现 selectAllInFilter 方法**

  `set({ allSelectedInFilter: true, exceptIds: new Set(), selectedIds: [] })`

- [ ] **Step 4: 实现 unselectInAllMode / removeFromExcept**

  全选模式下取消单条 → 加入 exceptIds；从 exceptIds 移除 → 重新选中。

- [ ] **Step 5: 实现 isSelected 方法**

  `allSelectedInFilter` 时返回 `!exceptIds.has(id)`，否则返回 `selectedIds.includes(id)`。

- [ ] **Step 6: 改造 clearSelection**

  同时重置 `allSelectedInFilter` / `exceptIds` / `selectedIds`。

- [ ] **Step 7: 接口类型同步更新**

  TopicState 接口加新方法签名。

- [ ] **Step 8: 单元测试**

  新建 `src/renderer/src/stores/__tests__/topicStore.test.ts`，覆盖：
  - selectPage 在普通模式下切换选中
  - selectAllInFilter + isSelected 行为
  - unselectInAllMode + removeFromExcept
  - clearSelection 重置所有

- [ ] **Step 9: typecheck + test 验证**

  Run: `npm run typecheck && npm test`
  Expected: PASS

### Task 3.7: TopicCard 选中状态

**Files:**
- Modify: `src/renderer/src/components/TopicCard.tsx`

参考设计文档 §3.7

- [ ] **Step 1: 使用 store.isSelected 替代 selectedIds.includes**

  `const isSelected = useTopicStore(s => s.isSelected(topic.id))`

- [ ] **Step 2: 获取 allSelectedInFilter + unselectInAllMode + removeFromExcept**

- [ ] **Step 3: 改造 handleToggle**

  全选模式下：isSelected → unselectInAllMode；!isSelected → removeFromExcept。
  普通模式：toggleSelect。

- [ ] **Step 4: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.8: 跨页全选 Alert

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §3.8

- [ ] **Step 1: 计算 currentPageAllSelected**

  `pageIds.every(id => store.isSelected(id))` 且 `store.items.length > 0`

- [ ] **Step 2: 渲染「选中全部 N 条」Alert**

  条件：`currentPageAllSelected && store.total > store.items.length && !store.allSelectedInFilter`。显示「已选当前页 X 条。还有 Y 条未选中」+ 按钮「选中全部 N 条」调 `store.selectAllInFilter()`。

- [ ] **Step 3: 渲染「已选中全部」Alert**

  条件：`store.allSelectedInFilter`。显示「已选中全部 N 条（已取消 X 条）」+ 按钮「清除选择」调 `store.clearSelection()`。

- [ ] **Step 4: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.9: 批量操作改造

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

参考设计文档 §3.9

- [ ] **Step 1: 实现 getSelectedIdsForBatchOp 辅助函数**

  全选模式下：list 拉取全量 id（pageSize=100000），过滤 exceptIds。
  普通模式：返回 `store.selectedIds`。

- [ ] **Step 2: 改造 handleBatchDelete**

  调用 `getSelectedIdsForBatchOp`，Modal.confirm 文案区分全选模式（显示「跨页全选模式，将删除除 X 条外的全部 Y 条」）。

- [ ] **Step 3: 改造 handleBatchAddTag / handleBatchChangeType / handleBatchChangeDifficulty**

  统一用 `getSelectedIdsForBatchOp`。

- [ ] **Step 4: typecheck 验证**

  Run: `npm run typecheck`
  Expected: PASS

### Task 3.10: 迭代 3 验证清单

- [ ] **Step 1: typecheck + test**

  Run: `npm run typecheck && npm test`
  Expected: PASS

- [ ] **Step 2: 启动 dev 验证**

  Run: `npm run dev`
  Expected: 应用正常启动

- [ ] **Step 3: 端到端手动验证（9 个场景）**

  见设计文档 §3.10：8 维分类计数 / 导入批次维度 / 面包屑 / 重置筛选 / 跨页全选 / 取消选择 / 状态维度 / (未设置) 节点 / 跨页批量删除。

### Task 3.11: 迭代 3 Commit

- [ ] **Step 1: git add + commit**

  ```bash
  git add src/main/db/repository/ src/main/ipc/ src/preload/ src/renderer/src/pages/TopicLibrary.tsx src/renderer/src/stores/ src/renderer/src/components/TopicCard.tsx src/shared/types.ts
  git commit -m "feat(library): 8-dimension category tree with breadcrumb and bulk select

- topic.repo: add listAllTags, support '__unset__' → IS NULL in buildWhereClause
- topic.ipc: register TOPIC_LIST_ALL_TAGS handler
- TopicLibrary: extend DIMENSIONS to 8 (add source_type/status/tags/batch_id)
- TopicLibrary: use dimensionData state for full-db counts
- TopicLibrary: add breadcrumb navigation + reset filter button
- topicStore: add allSelectedInFilter flag + exceptIds blacklist + isSelected helper
- TopicCard: use store.isSelected for selection state
- TopicLibrary: cross-page select Alert + batch ops use getSelectedIdsForBatchOp"
  ```

---

## 总体验证

- [ ] **最终 typecheck + test 全量通过**
- [ ] **三个迭代 commit 均已生成**
- [ ] **现有功能无回归**（题库 CRUD / 抽取 / 赛事管理 / 标签显示配置 等）

---

## 风险提示

1. **Task 1.8 是关键修复**：删除 `importedPlaceholderToReal` 时必须同步调整 L128-135 的 `mid.startsWith('__new_')` 分支，否则新题之间重复会全部入库。已在 Step 4 标注修复方案。

2. **Task 3.5 resetFilter 行为**：现有 `store.resetFilter` 会清空所有筛选字段（含 dimension）。需调用方手动恢复 dimension 筛选，或扩展 store。本期采用「调用方手动恢复」最小改动方案。

3. **Task 3.6 Set 序列化**：Zustand 默认不序列化 Set，如需 persist 中间件需额外处理。当前 store 未使用 persist，无影响；如未来加 persist 需将 `exceptIds` 改用 `string[]` 并在 getter 中转换。

4. **跨页全选批量操作性能**：1000+ 条批量删除时 list pageSize=100000 拉取全量 id 约 < 200ms，batchDelete 事务约 < 500ms，UI 不阻塞。
