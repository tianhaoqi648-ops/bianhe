// ============================================================
// theme.ts — antd ConfigProvider 主题配置
//
// 集中管理 antd 主题 token，便于后续支持暗色模式 / 多主题切换。
// 当前为亮色主题，色板与设计 Token 一致。
// ============================================================

import type { ThemeConfig } from 'antd'
import { fontFamily } from './tokens'

/** 亮色主题（默认） */
export const lightTheme: ThemeConfig = {
  token: {
    // 主色板
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',

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
      siderBg: '#001529'
    },
    Menu: {
      itemSelectedBg: '#1677ff',
      itemSelectedColor: '#fff',
      itemHoverBg: 'rgba(22, 119, 255, 0.08)',
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
      fontWeight: 500,
      primaryShadow: '0 4px 12px rgba(22, 119, 255, 0.4)'
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
      itemActiveColor: '#1677ff',
      itemSelectedColor: '#1677ff',
      inkBarColor: '#1677ff'
    },
    Modal: {
      borderRadiusLG: 12
    }
  },
  // 全局控件尺寸
  cssVar: true,
  hashed: false
}

/** 暗色主题占位（后续可启用） */
export const darkTheme: ThemeConfig = {
  ...lightTheme,
  algorithm: undefined // 待引入 theme.darkAlgorithm
}

/** 当前激活主题 */
export const activeTheme = lightTheme
