import { ConfigProvider, Layout, Menu, Breadcrumb, Space, Tooltip, Button } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  ThunderboltOutlined,
  FileTextOutlined,
  TeamOutlined,
  TrophyOutlined,
  HistoryOutlined,
  SettingOutlined,
  FullscreenOutlined,
  InfoCircleOutlined,
  GithubOutlined
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useEffect } from 'react';

import DrawPage from './pages/DrawPage';
import TopicLibrary from './pages/TopicLibrary';
import TeamManage from './pages/TeamManage';
import EventManage from './pages/EventManage';
import History from './pages/History';
import Settings from './pages/Settings';
import { lightTheme } from './styles/theme';
import { spacing } from './styles/tokens';
import { headerStyle, siderStyle, logoContainerStyle, contentBgStyle } from './styles/shared';
import { useSettingsStore } from './stores/settingsStore';

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  { key: '/draw', icon: <ThunderboltOutlined />, label: '抽取' },
  { key: '/topics', icon: <FileTextOutlined />, label: '题库管理' },
  { key: '/teams', icon: <TeamOutlined />, label: '队伍管理' },
  { key: '/events', icon: <TrophyOutlined />, label: '赛事管理' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' }
];

/** 路由 → 面包屑映射 */
const routeBreadcrumb: Record<string, { parent: string; current: string }> = {
  '/draw': { parent: '抽取', current: '准备就绪' },
  '/topics': { parent: '题库管理', current: '辩题列表' },
  '/teams': { parent: '队伍管理', current: '队伍总览' },
  '/events': { parent: '赛事管理', current: '赛事列表' },
  '/history': { parent: '历史记录', current: '抽取记录' },
  '/settings': { parent: '设置', current: '系统配置' }
};

function SiderMenu() {
  const location = useLocation();
  const navigate = useNavigate();

  // 默认跳转到 /draw
  useEffect(() => {
    if (location.pathname === '/') navigate('/draw', { replace: true });
  }, [location.pathname, navigate]);

  const selectedKey =
    menuItems?.find((it) => it && 'key' in it && location.pathname.startsWith(it.key as string))
      ?.key ?? '/draw';

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[String(selectedKey)]}
      items={menuItems}
      onClick={({ key }) => navigate(key)}
    />
  );
}

function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const matched = Object.entries(routeBreadcrumb).find(([k]) =>
    location.pathname.startsWith(k)
  );
  const crumb = matched?.[1] ?? { parent: '辩题抽取工具', current: '' };

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  return (
    <Header style={headerStyle}>
      <Breadcrumb
        items={[
          { title: <span style={{ color: '#8c8c8c' }}>辩题抽取工具</span> },
          { title: crumb.parent },
          crumb.current ? { title: <span style={{ color: '#1677ff', fontWeight: 500 }}>{crumb.current}</span> } : null
        ].filter(Boolean) as any}
      />
      <Space size={spacing.sm}>
        <Tooltip title="全屏切换">
          <Button
            type="text"
            size="small"
            icon={<FullscreenOutlined />}
            onClick={handleFullscreen}
          />
        </Tooltip>
        <Tooltip title="关于">
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => navigate('/settings')}
          />
        </Tooltip>
        <Tooltip title="源码仓库">
          <Button
            type="text"
            size="small"
            icon={<GithubOutlined />}
            href="https://github.com"
            target="_blank"
          />
        </Tooltip>
      </Space>
    </Header>
  );
}

function App() {
  // 应用启动时加载 settings（确保标签显示配置等 UI 设置在任何页面渲染前就绪）
  const fetchSettings = useSettingsStore((s) => s.fetchAll);
  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return (
    <ConfigProvider locale={zhCN} theme={lightTheme}>
      <HashRouter>
        <Layout style={{ minHeight: '100vh' }}>
          <Sider
            collapsible
            width={208}
            style={{ position: 'sticky', top: 0, height: '100vh', ...siderStyle }}
          >
            <div
              style={{
                height: 56,
                display: 'flex',
                alignItems: 'center',
                gap: spacing.sm,
                padding: `0 ${spacing.lg}`,
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={logoContainerStyle}>
                <ThunderboltOutlined />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>辩题抽取工具</span>
                <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 11 }}>v1.0 · Production</span>
              </div>
            </div>
            <SiderMenu />
          </Sider>
          <Layout>
            <AppHeader />
            <Content style={{ margin: 0, padding: spacing.xl, ...contentBgStyle }}>
              <Routes>
                <Route path="/" element={<DrawPage />} />
                <Route path="/draw" element={<DrawPage />} />
                <Route path="/topics" element={<TopicLibrary />} />
                <Route path="/teams" element={<TeamManage />} />
                <Route path="/events" element={<EventManage />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Content>
          </Layout>
        </Layout>
      </HashRouter>
    </ConfigProvider>
  );
}

export default App;
