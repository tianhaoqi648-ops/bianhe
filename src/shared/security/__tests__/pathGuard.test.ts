// ============================================================
// pathGuard.test.ts — assertNotSensitivePath 纯函数校验
//
// 覆盖：
//   - Windows 系统目录（SystemRoot/ProgramFiles 派生）拒绝
//   - POSIX 系统目录（/etc、/System、/root）拒绝
//   - 相对注入（..\..\、../../）经 resolve 归一后被拒
//   - 用户正常位置（Desktop/Downloads/文档、临时目录、项目目录）放行
//   - 空路径拒绝
// 说明：进程在 Windows CI/本机运行时走 win32 分支，POSIX 用例通过
//   模拟断言（直接构造 /etc 等字符串与 win32 resolve 行为差异）——
//   为避免平台耦合，POSIX 路径在 win32 上 resolve 后是「当前盘符下
//   的 \etc\... 相对目录」，不命中黑名单；因此 POSIX 用例仅在
//   process.platform === 'posix' 时断言拒绝，否则断言不抛（跨平台语义各归其位）。
// ============================================================
import { describe, it, expect } from 'vitest'
import { resolve, relative } from 'path'
import { assertNotSensitivePath } from '../pathGuard'

const isWin = process.platform === 'win32'

describe('security: assertNotSensitivePath', () => {
  it('拒绝空路径与非字符串', () => {
    expect(() => assertNotSensitivePath('')).toThrow()
    expect(() => assertNotSensitivePath(undefined as unknown as string)).toThrow()
  })

  // Windows 专属语义用例（SystemRoot/ProgramFiles 与反斜杠注入）：
  // 仅 Windows 执行，Linux 上这些路径语义不成立（CI Run 8 失败教训）
  it.skipIf(!isWin)('Windows：系统目录及其子路径拒绝', () => {
    const winRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    expect(() => assertNotSensitivePath(resolve(winRoot, 'system32', 'config', 'sam'))).toThrow()
    // ProgramFiles：实现与测试同源读取 env——该变量缺失时（如精简 shell），
    // 黑名单同样不含该根，两侧行为一致，断言按环境存在性跳过
    const pf = process.env.ProgramFiles
    if (pf) {
      expect(() => assertNotSensitivePath(resolve(pf, 'SomeApp', 'file.txt'))).toThrow()
    }
  })

  it('Windows：用户正常位置放行（Desktop / Downloads / 临时目录 / 项目目录）', () => {
    expect(() => assertNotSensitivePath('C:\\Users\\me\\Desktop\\import.json')).not.toThrow()
    expect(() => assertNotSensitivePath('D:\\Downloads\\backup.json')).not.toThrow()
    expect(() => assertNotSensitivePath(resolve(process.cwd(), 'data', 'x.json'))).not.toThrow()
    expect(() => assertNotSensitivePath(resolve(__dirname, 'fixture.json'))).not.toThrow()
  })

  it.skipIf(!isWin)('Windows：相对路径注入 ..\\..\\ 经 resolve 归一后按真实位置判定', () => {
    // 从当前 cwd 构造「相对逃逸到系统目录」的路径：resolve 后必然落在黑名单内
    const winRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    const rel = relative(process.cwd(), resolve(winRoot, 'system32', 'drivers'))
    // 同盘 → 形如 ..\..\C:\...；跨盘 → Windows 的 relative 直接返回绝对路径。
    // 两种形态经 assertNotSensitivePath 内部 resolve 归一后都命中黑名单。
    expect(() => assertNotSensitivePath(rel)).toThrow()
    // 从项目目录向上的普通相对逃逸不到系统根 → 放行（合法语义）
    expect(() => assertNotSensitivePath('..\\..\\data\\x.json')).not.toThrow()
  })

  it('POSIX：/etc、/System、/root 拒绝（仅 posix 平台执行拒绝断言）', () => {
    if (isWin) {
      // win32 上 '/etc/passwd' 被 resolve 为当前盘符下 '\etc\passwd'，不在 POSIX 黑名单语义内
      expect(() => assertNotSensitivePath('/etc/passwd')).not.toThrow()
      return
    }
    expect(() => assertNotSensitivePath('/etc/passwd')).toThrow()
    expect(() => assertNotSensitivePath('/System/Library/x')).toThrow()
    expect(() => assertNotSensitivePath('/root/.ssh/id_rsa')).toThrow()
    expect(() => assertNotSensitivePath('/home/me/import.json')).not.toThrow()
  })

  it('黑名单不包含用户目录（USERPROFILE/APPDATA 不在敏感根内）', () => {
    // 用户在 AppData/用户目录下放置的文件不被误伤（设计决策：黑名单仅系统目录）
    const appdata = process.env.APPDATA
    if (appdata) {
      expect(() => assertNotSensitivePath(resolve(appdata, 'some-app', 'file.json'))).not.toThrow()
    }
    const home = process.env.USERPROFILE ?? process.env.HOME
    if (home) {
      expect(() => assertNotSensitivePath(resolve(home, 'Documents', 'a.json'))).not.toThrow()
    }
  })
})
