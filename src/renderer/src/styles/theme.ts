// ============================================================
// theme.ts — antd ConfigProvider 主题配置
//
// 集中管理 antd 主题 token，支持亮色 / 暗色双主题切换。
// 通过 getThemeConfig(mode) 按 settings.themeMode 返回对应配置。
// ============================================================

import { theme as antdTheme, type ThemeConfig } from 'antd'
import {
  fontFamily,
  colorPrimary,
  colorGold
} from './tokens'

/**
 * 三色映射共享 token：
 * - colorPrimary：主色（蓝）#1466e0（饱和度较 antd 默认降 10%，见 tokens.ts）
 * - colorInfo：赛事工作区强调色（金）
 * - colorSuccess：语义成功色（Phase 4 B1 解除品牌紫挪用，回归 antd 默认绿，
 *   亮/暗主题由算法自动派生）；比赛工具区品牌紫改由 tokens.colorPurple 直引
 */
const sharedColorTokens = {
  colorPrimary,
  colorInfo: colorGold,
  colorWarning: '#faad14',
  colorError: '#ff4d4f'
} as const

/** 亮色主题（默认） */
export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...sharedColorTokens,

    // 字体
    fontFamily: fontFamily.sans,
    fontSize: 14,

    // 圆角
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    // 线宽
    wireframe: false,

    // 控件尺寸
    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24
  },
  components: {
    Layout: {
      headerBg: 'rgba(255, 255, 255, 0.85)',
      headerHeight: 56,
      bodyBg: 'transparent',
      // 透出让 AppSidebar siderStyle 的深色玻璃态生效
      siderBg: 'transparent'
    },
    Menu: {
      itemSelectedBg: colorPrimary,
      itemSelectedColor: '#fff',
      itemHoverBg: `${colorPrimary}14`,
      itemBorderRadius: 6,
      itemMarginInline: 8
    },
    Card: {
      borderRadiusLG: 8,
      boxShadowTertiary: '0 1px 2px rgba(0, 0, 0, 0.04)'
    },
    Button: {
      controlHeight: 32,
      controlHeightLG: 40,
      // primary 按钮文字稍粗，配合渐变背景增强视觉层级
      fontWeight: 500,
      // primary 按钮蓝色投影（与 CSS 中 .ant-btn-primary 的 box-shadow 保持一致风格，派生自 colorPrimary）
      primaryShadow: `0 2px 6px ${colorPrimary}4D`,
    },
    Table: {
      headerBg: '#fafafa',
      headerColor: '#262626',
      rowHoverBg: '#f5f5f5'
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 24
    },
    Tabs: {
      itemActiveColor: colorPrimary,
      itemSelectedColor: colorPrimary,
      inkBarColor: colorPrimary
    },
    Modal: {
      borderRadiusLG: 12
    }
  },
  // 全局控件尺寸
  cssVar: true,
  hashed: false
}

/** 暗色主题（深蓝黑底，配合 darkAlgorithm） */
export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...sharedColorTokens,

    // 暗色背景层：base → container → elevated 逐级抬高
    colorBgBase: '#0a0f1a',
    colorBgContainer: '#141a28',
    colorBgElevated: '#1a2236',
    colorBorder: '#2a3447',
    colorTextSecondary: 'rgba(255, 255, 255, 0.65)',

    // 字体
    fontFamily: fontFamily.sans,
    fontSize: 14,

    // 圆角
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    // 线宽
    wireframe: false,

    // 控件尺寸
    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24
  },
  components: {
    Layout: {
      // 暗色下 header 半透明深底，sider 透出让 siderStyle 玻璃态生效
      headerBg: 'rgba(20, 26, 40, 0.85)',
      headerHeight: 56,
      bodyBg: 'transparent',
      siderBg: 'transparent'
    },
    Menu: {
      itemSelectedBg: colorPrimary,
      itemSelectedColor: '#fff',
      itemHoverBg: `${colorPrimary}29`,
      itemBorderRadius: 6,
      itemMarginInline: 8
    },
    Card: {
      borderRadiusLG: 8,
      boxShadowTertiary: '0 1px 2px rgba(0, 0, 0, 0.3)'
    },
    Button: {
      controlHeight: 32,
      controlHeightLG: 40,
      // primary 按钮文字稍粗，与亮色保持一致
      fontWeight: 500,
      // 暗色下投影稍强（透明度 0.4），保证深底可见性
      primaryShadow: `0 2px 6px ${colorPrimary}66`,
    },
    Table: {
      headerBg: '#1a2236',
      headerColor: 'rgba(255, 255, 255, 0.85)',
      rowHoverBg: '#1a2236'
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 24
    },
    Tabs: {
      // 暗色下用品牌蓝亮调（#4096ff 为 colorPrimary 的暗底 companion，Phase 4 B1 决策保留）
      itemActiveColor: '#4096ff',
      itemSelectedColor: '#4096ff',
      inkBarColor: '#4096ff'
    },
    Modal: {
      borderRadiusLG: 12
    }
  },
  cssVar: true,
  hashed: false
}

/** 当前激活主题（向后兼容：默认指向亮色） */
export const activeTheme = lightTheme

/**
 * 根据模式返回对应的主题配置。
 * @param mode 实际生效的模式（'light' | 'dark'）
 */
export function getThemeConfig(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? darkTheme : lightTheme
}
