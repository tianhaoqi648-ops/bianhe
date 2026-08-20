import { ConfigProvider, Layout, Modal, Checkbox, Space, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';

import DrawPage from './pages/DrawPage';
import TopicLibrary from './pages/TopicLibrary';
import TeamManage from './pages/TeamManage';
import EventManage from './pages/EventManage';
import History from './pages/History';
import TimerPage from './pages/TimerPage';
import FormatEditor from './pages/FormatEditor';
import JudgeArena from './pages/JudgeArena';
import Settings from './pages/Settings';
import { getThemeConfig } from './styles/theme';
import { contentBgStyle } from './styles/shared';
import { useSettingsStore } from './stores/settingsStore';
import { useUndoStore } from './stores/undoStore';
import { hotkeyManager } from './utils/hotkey-manager';
import { useHotkeys } from './hooks/useHotkeys';
import { useThemeMode } from './hooks/useThemeMode';
import { useMediaQuery } from './hooks/useMediaQuery';
import { ToastProvider, useToast } from './hooks/useToast';
import AppSidebar, { MENU_GROUPS } from './components/Layout/AppSidebar';
import AppHeader from './components/Layout/AppHeader';
import UpdaterNotifier from './components/settings/UpdaterNotifier';
import MobileTabBar from './components/Layout/MobileTabBar';
import HotkeyHelpModal from './components/HotkeyHelpModal';
import UndoToast from './components/UndoToast';
import ErrorBoundary from './components/ErrorBoundary';
import CommandPalette from './components/CommandPalette';
import WelcomeTour from './components/onboarding/WelcomeTour';
import { AgentChatPanel } from './components/agent/AgentChatPanel';
import { SAMPLE_TOPICS, SAMPLE_FORMAT } from './data/sample-data';
import { useUIStore } from './stores/uiStore';

const { Content } = Layout;

/**
 * 根据 pathname 从 MENU_GROUPS 解析当前选中的路由 key。
 * 精确匹配优先，否则前缀匹配（支持子路由如 /topics/123）。
 */
function resolveSelectedKey(pathname: string): string {
  const allKeys = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  if (allKeys.includes(pathname)) return pathname;
  return allKeys.find((k) => pathname.startsWith(k)) ?? '/draw';
}

/**
 * 应用主体布局（位于 HashRouter 内部，可使用 useLocation / useNavigate）。
 * 负责响应式断点与 侧栏 / Header / TabBar 的组合渲染。
 */
function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resolvedMode } = useThemeMode();
  const toast = useToast();

  // 响应式断点
  const isMobile = useMediaQuery('(max-width: 767px)'); // <768px
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)'); // 768–1023px
  const collapsed = isTablet; // 平板自动折叠侧栏

  // AI 助手面板折叠状态（默认收起，Ctrl+J 切换）
  const [agentCollapsed, setAgentCollapsed] = useState(true);

  // AI 助手开关（设置页可关闭，关闭后不渲染 AgentChatPanel，但 agentCollapsed 状态保留）
  const aiEnabled = useSettingsStore((s) => s.aiEnabled);

  // ====== 首次启动 Tour 触发（Task 8.3） ======
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const sampleDataPrompted = useSettingsStore((s) => s.sampleDataPrompted);
  const setSampleDataPrompted = useSettingsStore((s) => s.setSampleDataPrompted);
  const [tourOpen, setTourOpen] = useState(false);
  // 标记 Tour 是否刚完成（用于触发示例数据询问）
  const [tourJustFinished, setTourJustFinished] = useState(false);

  // 首次启动且未完成引导 → 自动弹出 Tour（仅在首页 / 或 /draw 时）
  useEffect(() => {
    if (!onboardingCompleted && (location.pathname === '/' || location.pathname === '/draw')) {
      // 延迟 300ms 弹出，避免与首屏渲染竞争
      const timer = setTimeout(() => setTourOpen(true), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [onboardingCompleted, location.pathname]);

  // Tour 关闭回调：标记 onboarding 完成，并触发示例数据询问
  const handleTourClose = useCallback(() => {
    setTourOpen(false);
    setOnboardingCompleted(true);
    setTourJustFinished(true);
  }, [setOnboardingCompleted]);

  // ====== 首次启动示例数据填充询问（Task 10.3） ======
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [fillTopics, setFillTopics] = useState(true);
  const [fillFormat, setFillFormat] = useState(true);
  const [sampleLoading, setSampleLoading] = useState(false);

  // Tour 刚完成且未询问过示例数据 → 检查数据库是否为空
  useEffect(() => {
    if (!tourJustFinished || sampleDataPrompted) return;
    void (async () => {
      try {
        const topicCountRes = await window.topicAPI.count({});
        const topicCount = topicCountRes.success ? Number(topicCountRes.data ?? 0) : 0;
        const formatRes = await window.formatAPI.list();
        const formatCount = formatRes.success && formatRes.data ? formatRes.data.length : 0;
        // 数据库为空（无辩题且无赛制）时弹出询问
        if (topicCount === 0 && formatCount === 0) {
          setSampleModalOpen(true);
        } else {
          // 已有数据，无需询问，直接标记
          setSampleDataPrompted(true);
        }
      } catch {
        // 查询失败时不打扰用户
        setSampleDataPrompted(true);
      } finally {
        setTourJustFinished(false);
      }
    })();
  }, [tourJustFinished, sampleDataPrompted, setSampleDataPrompted]);

  // 确认填充示例数据
  const handleConfirmSampleData = async () => {
    setSampleLoading(true);
    try {
      if (fillTopics) {
        for (const t of SAMPLE_TOPICS) {
          try {
            await window.topicAPI.create(t);
          } catch {
            // 单条失败不阻塞后续
          }
        }
        toast.success(`已填充 ${SAMPLE_TOPICS.length} 条示例辩题`);
      }
      if (fillFormat) {
        try {
          await window.formatAPI.create({
            name: SAMPLE_FORMAT.name,
            description: SAMPLE_FORMAT.description,
            formatData: SAMPLE_FORMAT.formatData
          });
          toast.success('已填充示例赛制（国赛制）');
        } catch {
          // 失败不阻塞
        }
      }
    } finally {
      setSampleDataPrompted(true);
      setSampleModalOpen(false);
      setSampleLoading(false);
      setTourJustFinished(false);
    }
  };

  // 跳过示例数据
  const handleSkipSampleData = () => {
    setSampleDataPrompted(true);
    setSampleModalOpen(false);
    setTourJustFinished(false);
  };

  // 根路由默认跳转 /draw
  useEffect(() => {
    if (location.pathname === '/') navigate('/draw', { replace: true });
  }, [location.pathname, navigate]);

  // 当前选中菜单 key（前缀匹配）
  const selectedKey = useMemo(
    () => resolveSelectedKey(location.pathname),
    [location.pathname]
  );

  // 导航回调
  const handleNavigate = useCallback(
    (key: string) => {
      navigate(key);
    },
    [navigate]
  );

  // 内容区样式：动态背景色（亮/暗）+ 移动端底部留白（为 MobileTabBar 56px + 安全区让位）
  const contentStyle: React.CSSProperties = {
    ...contentBgStyle,
    background: resolvedMode === 'dark' ? '#0a0f1a' : '#f5f7fa',
    paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0))' : undefined
  };

  return (
    <Layout style={{ minHeight: '100vh', display: 'flex', flexDirection: 'row' }}>
      {/* 桌面 / 平板：显示侧栏（240px 或折叠 80px） */}
      {!isMobile && (
        <AppSidebar
          selectedKey={selectedKey}
          collapsed={collapsed}
          onNavigate={handleNavigate}
        />
      )}
      {/* AI 助手面板（Task 23）：左侧可折叠，Ctrl+J 切换，移动端不显示。
          aiEnabled=false 时不渲染（设置页可关闭），agentCollapsed 状态保留以便重新开启时恢复。 */}
      {!isMobile && aiEnabled && (
        <AgentChatPanel
          collapsed={agentCollapsed}
          onToggle={() => setAgentCollapsed((v) => !v)}
          onNavigateToSettings={() => navigate('/settings')}
        />
      )}
      <Layout style={{ flex: 1, minWidth: 0 }}>
        {/* 全局更新通知（启动自检可见反馈，不渲染 DOM，任何页面常驻） */}
        <UpdaterNotifier />
        <AppHeader selectedKey={selectedKey} />
        <Content style={contentStyle}>
          <ErrorBoundary>
            <div key={location.pathname} className="page-transition">
              <Routes>
                <Route path="/" element={<DrawPage />} />
                <Route path="/draw" element={<DrawPage />} />
                <Route path="/topics" element={<TopicLibrary />} />
                <Route path="/teams" element={<TeamManage />} />
                <Route path="/events" element={<EventManage />} />
                <Route path="/history" element={<History />} />
                <Route path="/timer" element={<TimerPage />} />
                <Route path="/format-editor" element={<FormatEditor />} />
                <Route path="/judge" element={<JudgeArena />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </ErrorBoundary>
        </Content>
      </Layout>
      {/* 移动端：底部 TabBar */}
      {isMobile && (
        <MobileTabBar selectedKey={selectedKey} onNavigate={handleNavigate} />
      )}

      {/* 首次启动引导 Tour（Task 8.3） */}
      <WelcomeTour open={tourOpen} onClose={handleTourClose} />

      {/* 首次启动示例数据填充询问（Task 10.3） */}
      <Modal
        title="欢迎使用辩盒"
        open={sampleModalOpen}
        onCancel={handleSkipSampleData}
        onOk={handleConfirmSampleData}
        okText="填充示例数据"
        cancelText="跳过"
        confirmLoading={sampleLoading}
        maskClosable={false}
        closable={false}
        keyboard={false}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            检测到数据库为空，是否填充示例数据以快速体验功能？
          </Typography.Paragraph>
          <Checkbox
            checked={fillTopics}
            onChange={(e) => setFillTopics(e.target.checked)}
          >
            填充示例辩题（{SAMPLE_TOPICS.length} 条，覆盖不同类型/难度/领域）
          </Checkbox>
          <Checkbox
            checked={fillFormat}
            onChange={(e) => setFillFormat(e.target.checked)}
          >
            填充示例赛制（国赛制 4 环节）
          </Checkbox>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            跳过后可在「题库管理」与「赛制编辑器」中手动添加。
          </Typography.Text>
        </Space>
      </Modal>
    </Layout>
  );
}

function App() {
  // 应用启动时加载 settings（确保标签显示配置等 UI 设置在任何页面渲染前就绪）
  const fetchSettings = useSettingsStore((s) => s.fetchAll);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const [helpOpen, setHelpOpen] = useState(false);
  // 主题模式：resolvedMode 已合并用户设置与系统偏好，可直接传入 antd
  const { resolvedMode } = useThemeMode();

  useEffect(() => {
    void fetchSettings();
    // 初始化全局快捷键监听
    hotkeyManager.init();
    return () => hotkeyManager.destroy();
  }, [fetchSettings]);

  // 同步 <html data-theme> 便于自定义 CSS 区分明暗
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedMode);
  }, [resolvedMode]);

  // 全局快捷键：Cmd/Ctrl+K 打开命令面板，Esc 关闭
  // 使用 useUIStore.getState() 避免订阅状态导致不必要的 re-render
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd (macOS) / Ctrl (Windows/Linux) + K → 打开命令面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useUIStore.getState().setCommandPaletteOpen(true);
        return;
      }
      // Esc → 关闭命令面板（仅当已打开时）
      if (e.key === 'Escape' && useUIStore.getState().commandPaletteOpen) {
        useUIStore.getState().setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 全局快捷键：? 打开帮助弹窗
  useHotkeys({
    combo: '?',
    description: '显示快捷键帮助',
    handler: () => setHelpOpen((v) => !v),
    scope: 'global'
  });

  // 全局快捷键：Ctrl+Z 撤销
  useHotkeys({
    combo: 'ctrl+z',
    description: '撤销最近一步操作',
    handler: () => {
      void undo();
    },
    scope: 'global'
  });

  // 全局快捷键：Ctrl+Shift+Z 重做（暂未实现）
  useHotkeys({
    combo: 'ctrl+shift+z',
    description: '重做（暂未实现）',
    handler: () => {
      void redo();
    },
    scope: 'global'
  });

  return (
    <ConfigProvider locale={zhCN} theme={getThemeConfig(resolvedMode)}>
      <ToastProvider>
        <CommandPalette />
        <HashRouter>
          <AppLayout />
        </HashRouter>
        <HotkeyHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        <UndoToast />
      </ToastProvider>
    </ConfigProvider>
  );
}

export default App;
