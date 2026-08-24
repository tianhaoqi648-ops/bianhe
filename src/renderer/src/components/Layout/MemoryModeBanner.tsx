// ============================================================
// MemoryModeBanner.tsx — 内存（临时）模式常驻警告条
//
// gov4.1：进入 memory 模式后，渲染端在布局中常驻显示警告，
// 提示用户数据无法持久保存、关闭程序将丢失。
// 常驻（非 Toast）以保证任何页面下都可感知，直至重启恢复到持久化模式。
// ============================================================

import { Alert } from 'antd'
import { useDbModeStore } from '../../stores/dbModeStore'
import { MEMORY_PERSISTENT_WARNING } from '../../utils/memoryModeGuard'

function MemoryModeBanner() {
  const dbMode = useDbModeStore((s) => s.dbMode)
  if (dbMode !== 'memory') return null

  return (
    <Alert
      banner
      type="warning"
      showIcon
      message={MEMORY_PERSISTENT_WARNING}
      style={{ borderRadius: 0 }}
    />
  )
}

export default MemoryModeBanner