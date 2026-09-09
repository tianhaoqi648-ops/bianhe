// ============================================================
// shared/security/pathGuard.ts — 文件路径安全校验（纯函数，无 electron 依赖）
//
// 目的：防止渲染进程经「用户经 fileAPI.pickFile 选择文件 → 路径字符串往返 →
// 第二跳 IPC 读取」的模式，让主进程读取系统敏感目录下的任意文件。
//
// 原则：
//   - 导入/解析类功能允许用户选择任意位置的文件（Desktop / Downloads / 文档等），
//     因此不限制「必须在工作目录内」；
//   - 仅拒绝已知的系统敏感目录（Windows 系统目录 / Program Files / POSIX 系统目录）；
//   - 内容级防线（扩展名白名单、大小上限、JSON/zip 解析校验）由各 service 层保留。
//
// 注意：黑名单刻意不包含 USERPROFILE / APPDATA —— 那会误伤用户把导入文件
// 存放在桌面、下载、文档等正常位置的合法场景。
// ============================================================
import { resolve, sep } from 'path'

/** 收集当前平台的系统敏感目录根（全部 resolve 归一化） */
function sensitiveRoots(): string[] {
  const roots: string[] = []
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)']) {
      const v = process.env[key]
      if (v) roots.push(resolve(v))
    }
  } else {
    roots.push('/etc', '/System', '/private/etc', '/root')
  }
  return roots.filter((r) => r.length > 0)
}

/**
 * 断言路径不属于系统敏感目录；否则抛出带说明的错误。
 * 经 resolve 归一化后再做前缀匹配，`..\\..\\` 等相对注入会被解析为真实位置。
 *
 * @throws Error 当路径命中敏感目录前缀时
 */
export function assertNotSensitivePath(p: string): void {
  if (!p || typeof p !== 'string') {
    throw new Error('文件路径不能为空')
  }
  const abs = resolve(p)
  for (const root of sensitiveRoots()) {
    if (abs === root || abs.startsWith(root + sep)) {
      throw new Error(`禁止访问系统受保护目录：${root}`)
    }
  }
}
