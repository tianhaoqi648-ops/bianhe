# 修复 XLSX.readFile is not a function 错误

## 背景与根因

### 错误现象
在 Electron 主进程的 `src/main/services/import-engine.ts` 中调用 `XLSX.readFile(filePath, ...)` 时抛出 `TypeError: XLSX.readFile is not a function`，导致题库 xlsx 文件导入功能不可用。

### 根本原因
1. 项目 [package.json](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/package.json) 设置 `"type": "module"`，主进程编译产物为 ESM。
2. [electron.vite.config.ts](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/electron.vite.config.ts) 中 `externalizeDepsPlugin()` 把 `xlsx` 标记为外部依赖，运行时由 Node.js 解析加载。
3. xlsx 包 [package.json](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/node_modules/xlsx/package.json) 的 `"main": "xlsx.js"` 是 CommonJS 入口。Node.js 在 ESM 模式下 `import * as XLSX from 'xlsx'` 加载该 CommonJS 模块时，使用 cjs-module-lexer 静态分析 `module.exports` 提取命名导出。
4. xlsx.js 第 24463 行通过动态赋值 `XLSX.readFile = readFileSync` 设置 `readFile` 属性（[xlsx.js#L24463](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/node_modules/xlsx/xlsx.js#L24463)），cjs-module-lexer 无法静态识别这种动态赋值，导致命名导出 `readFile` 丢失，`XLSX.readFile` 为 undefined。

### 验证
- 渲染进程 [downloadImportTemplate.ts](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/utils/downloadImportTemplate.ts) 使用 `XLSX.read(buf, { type: 'array' })` 和 `XLSX.write` 工作正常，证明 `XLSX.read` 接受内存数据，无需 fs 模块。
- vitest 测试环境（[vitest.config.ts](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/vitest.config.ts) `environment: 'node'`）下 `XLSX.readFile` 可用，因为 vitest 不走 Electron 主进程的 ESM 加载路径，所以现有测试通过但运行时失败。

## 修复方案

**采用方案 A：`XLSX.read + buffer`**（用户已确认）

在主进程中用 `fs.readFileSync` 读取文件为 Buffer，再传给 `XLSX.read(buffer, { type: 'buffer' })` 解析。完全绕过 ESM/CJS 命名导出丢失问题，与渲染进程代码风格一致，不依赖 `set_fs`，跨 ESM/CJS 环境兼容。

## 改动清单

### 1. `src/main/services/import-engine.ts`

**位置**：`parseExcelOrCsv` 函数（约 336-347 行）

**修改前**：
```typescript
function parseExcelOrCsv(filePath: string, fileType: FileType): ParsedResult {
  let workbook: XLSX.WorkBook
  if (fileType === 'csv') {
    const buffer = fs.readFileSync(filePath)
    const encoding = detectEncoding(buffer)
    const text = iconv.decode(buffer, encoding)
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    // XLSX：二进制 ZIP，保持原 readFile 调用
    workbook = XLSX.readFile(filePath, { type: 'file', codepage: 65001 })
  }
  // ...
}
```

**修改后**：
```typescript
function parseExcelOrCsv(filePath: string, fileType: FileType): ParsedResult {
  let workbook: XLSX.WorkBook
  if (fileType === 'csv') {
    const buffer = fs.readFileSync(filePath)
    const encoding = detectEncoding(buffer)
    const text = iconv.decode(buffer, encoding)
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    // XLSX：用 fs 读取 buffer 后交给 XLSX.read，规避 ESM 模式下
    // import * as XLSX from 'xlsx' 加载 CommonJS 版本时 readFile 命名导出丢失的问题
    const buffer = fs.readFileSync(filePath)
    workbook = XLSX.read(buffer, { type: 'buffer' })
  }
  // ...
}
```

**关键变化**：
- 删除 `XLSX.readFile(filePath, { type: 'file', codepage: 65001 })` 调用
- 替换为 `fs.readFileSync(filePath)` + `XLSX.read(buffer, { type: 'buffer' })`
- 移除不再需要的 `codepage: 65001`（xlsx 文件本身是 ZIP+XML，内部固定 UTF-8，codepage 选项仅对旧版 .xls/.dbf 等格式有用，对 xlsx 无影响）
- 注释更新为说明为何走 buffer 路径

**导入语句保持不变**：`import * as XLSX from 'xlsx'` 仍然有效，因为 `read` 是 xlsx.js 顶层 `exports.read = read` 静态赋值（[xlsx.js#L3074](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/node_modules/xlsx/xlsx.js#L3074)），cjs-module-lexer 能正确识别。

### 2. `src/main/services/__tests__/import-engine.test.ts`（补充测试）

新增一个 describe 块 `parseFile XLSX buffer 读取路径`，专门验证修复后的 buffer 读取路径：

```typescript
import { vi } from 'vitest'

describe('parseFile XLSX buffer 读取路径（修复 readFile 缺失）', () => {
  it('不依赖 XLSX.readFile，使用 XLSX.read(buffer) 解析', async () => {
    // 用 spy 验证 XLSX.readFile 未被调用，XLSX.read 被调用
    const xlsxModule = await import('xlsx')
    const readSpy = vi.spyOn(xlsxModule, 'read')
    const readFileSpy = vi.spyOn(xlsxModule as any, 'readFile')

    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['title', 'type', 'difficulty'],
          ['buffer 路径辩题', '价值辩', '入门级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1)
      expect(result.topics[0].title).toBe('buffer 路径辩题')
      // 核心断言：XLSX.read 被调用，readFile 未被调用
      expect(readSpy).toHaveBeenCalled()
      expect(readFileSpy).not.toHaveBeenCalled()
    } finally {
      fs.unlinkSync(tmpPath)
      readSpy.mockRestore()
      readFileSpy.mockRestore()
    }
  })

  it('大文件 xlsx 仍能正确解析（>1MB）', async () => {
    // 生成 1000 行数据，确保文件体积足够
    const rows: any[][] = [['title', 'type']]
    for (let i = 0; i < 1000; i++) {
      rows.push([`测试辩题${i}-${'测试'.repeat(20)}`, '价值辩'])
    }
    const tmpPath = writeTmpXlsx([{ name: 'Sheet1', rows }])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.topics).toHaveLength(1000)
      expect(result.topics[0].title).toContain('测试辩题0')
      expect(result.topics[999].title).toContain('测试辩题999')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})
```

**测试目的**：
- 第一个测试用 `vi.spyOn` 直接断言 `XLSX.read` 被调用、`XLSX.readFile` 未被调用，回归保护未来不会回退到 readFile
- 第二个测试用 1000 行数据验证 buffer 路径对大文件的正确性

## 假设与决策

| 项目 | 说明 |
|---|---|
| 保留 `import * as XLSX from 'xlsx'` | `read` 命名导出在 ESM 下可用（静态赋值），无需改默认导入 |
| 不调用 `set_fs` | buffer 路径不需要 xlsx 内部 fs 实例 |
| 移除 `codepage: 65001` | 仅对 .xls/.dbf 等老格式生效，对 xlsx 无意义 |
| 不修改渲染进程 xlsx 用法 | 渲染进程使用 `XLSX.read/write` 已正常工作 |
| 测试通过 vitest 验证 | vitest 环境下 readFile 本就可用，但 spy 断言能确保调用路径正确 |

## 验证步骤

按顺序执行：

1. **类型检查**：`npm run typecheck` — 确认无 TS 错误
2. **单元测试**：`npm test` — 确认所有测试通过，新增 2 个测试通过
3. **运行时验证**：`npm run dev` 启动应用，导入一个 xlsx 题库文件（例如之前失败的 `华语辩论经典赛事辩题库_整合版.xlsx`），确认：
   - 不再抛出 `XLSX.readFile is not a function`
   - 题目正常入库
   - 多 sheet / 字段值不匹配等 warnings 正常显示

## 不在范围内

- 不重构 import-engine 的其他解析逻辑（CSV/DOCX）
- 不调整 electron-vite 构建配置
- 不升级 xlsx 版本（0.18.5 维持不变）
- 不修改渲染进程的 xlsx 使用代码
