// ============================================================
// TeamAvatar.tsx — 队徽头像公共组件
//
// logo 优先 + 首字圆形头像 fallback
// 供 TimerDisplay（主屏 size=64）和 BigScreenTimer（大屏 size=96）复用
// ============================================================

interface TeamAvatarProps {
  name: string
  color: string
  logo?: string | null
  /** 头像尺寸（像素），默认 64 */
  size?: number
}

export default function TeamAvatar({ name, color, logo, size = 64 }: TeamAvatarProps) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: `2px solid ${color}`
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        fontWeight: 700,
        flexShrink: 0
      }}
    >
      {name?.[0] ?? '?'}
    </div>
  )
}
