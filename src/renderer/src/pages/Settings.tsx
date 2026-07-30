import { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Menu,
  Form,
  InputNumber,
  Switch,
  Input,
  Button,
  Space,
  Typography,
  Alert,
  Statistic,
  Row,
  Col,
  Select,
  Popconfirm,
  Tag,
  Progress,
  Modal,
  Checkbox,
  Radio,
  theme
} from 'antd';
import BrandSpin from '../components/common/BrandSpin';
import AccentCard from '../components/common/AccentCard';
import PageHeader from '../components/common/PageHeader';
import {
  SettingOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  DownloadOutlined,
  UploadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  UndoOutlined,
  TagsOutlined,
  WarningOutlined,
  RestOutlined,
  KeyOutlined,
  BellOutlined,
  BulbOutlined,
  InfoCircleOutlined,
  MailOutlined,
  GithubOutlined,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
  CloudSyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  FolderOpenOutlined,
  RocketOutlined,
  PlayCircleOutlined
} from '@ant-design/icons';
import { version } from '../../../../package.json';
import { useSettingsStore } from '../stores/settingsStore';
import { useTopicStore } from '../stores/topicStore';
import { useThemeMode } from '../hooks/useThemeMode';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
import TagDisplaySettingsModal from '../components/TagDisplaySettingsModal';
import HotkeySettingsTab from '../components/HotkeySettingsTab';
import BellManager from '../components/BellManager';
import BackupManageModal from '../components/BackupManageModal';
import BackupExportModal from '../components/settings/BackupExportModal';
import BackupImportModal from '../components/settings/BackupImportModal';
import UpdateCard from '../components/settings/UpdateCard';
import { statCardStyle, cardStyle } from '../styles/shared';
import { spacing, fontSize, radius } from '../styles/tokens';
import { useToast } from '../hooks/useToast';
import type { ExportFormat } from '../../../shared/types';
import {
  CONFIG_RESET_CATEGORIES,
  DATA_RESET_CATEGORIES,
  RESET_CATEGORY_LABELS,
  RESET_CATEGORY_DESCRIPTIONS,
  type ConfigResetCategory,
  type DataResetCategory
} from '../../../shared/settings-defaults';

const { Content } = Layout;
const { Text, Paragraph, Title } = Typography;

// 设置页 Tab 类型
type SettingsTab = 'basic' | 'appearance' | 'data' | 'backup' | 'hotkeys' | 'about';

// 当前激活 Tab 持久化 key
const ACTIVE_TAB_LS_KEY = 'bianhe-settings-active-tab';

// 应用版本号（从 package.json 读取）
const APP_VERSION = `v${version}`;
// 反馈邮箱
const FEEDBACK_EMAIL = 'muyun648@qq.com';
// GitHub 仓库链接
const GITHUB_URL = 'https://github.com/tianhaoqi648-ops/bianhe';

/** 从 localStorage 读取上次激活的 Tab，失败回退到 'basic' */
function loadActiveTab(): SettingsTab {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'basic';
    const v = window.localStorage.getItem(ACTIVE_TAB_LS_KEY);
    if (v === 'basic' || v === 'appearance' || v === 'data' || v === 'backup' || v === 'hotkeys' || v === 'about') {
      return v;
    }
  } catch {
    // 静默失败
  }
  return 'basic';
}

// 设置项 key 常量
const KEYS = {
  dedupEnabled: 'dedup.enabled',
  dedupLevenshtein: 'dedup.levenshteinThreshold',
  dedupKeyword: 'dedup.keywordThreshold',
  aiDedupEnabled: 'dedup.aiEnabled',
  aiApiKey: 'dedup.aiApiKey',
  aiThreshold: 'dedup.aiThreshold',
  officialSeeded: 'official_topics_seeded',
  officialVersion: 'official_topics_version',
  officialCount: 'official_topics_count'
} as const;

// 默认值
const DEFAULTS = {
  dedupEnabled: true,
  dedupLevenshtein: 5,
  dedupKeyword: 0.8,
  aiDedupEnabled: false,
  aiApiKey: '',
  aiThreshold: 0.85
};

export default function Settings() {
  const { token } = theme.useToken();
  const settingsStore = useSettingsStore();
  const topicStore = useTopicStore();
  const { themeMode, setThemeMode } = useThemeMode();
  const toast = useToast();

  // 当前激活的 Tab（持久化到 localStorage）
  const [activeTab, setActiveTab] = useState<SettingsTab>(loadActiveTab);

  // 本地表单状态（与 store 同步）
  const [dedupEnabled, setDedupEnabled] = useState<boolean>(DEFAULTS.dedupEnabled);
  const [levenshtein, setLevenshtein] = useState<number>(DEFAULTS.dedupLevenshtein);
  const [keyword, setKeyword] = useState<number>(DEFAULTS.dedupKeyword);
  const [aiEnabled, setAiEnabled] = useState<boolean>(DEFAULTS.aiDedupEnabled);
  const [aiApiKey, setAiApiKey] = useState<string>(DEFAULTS.aiApiKey);
  const [aiThreshold, setAiThreshold] = useState<number>(DEFAULTS.aiThreshold);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [tagDisplayOpen, setTagDisplayOpen] = useState(false);
  const [exporting, setExporting] = useState<null | 'topics' | 'sessions'>(null);
  // P3.4 Task 20：备份管理弹窗 + 备份中 loading
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  // 全量数据一键备份/还原弹窗
  const [backupExportOpen, setBackupExportOpen] = useState(false);
  const [backupImportOpen, setBackupImportOpen] = useState(false);

  // 危险操作：恢复初始设置
  const [resetModalOpen, setResetModalOpen] = useState(false);
  // 配置类：默认全选
  const [resetConfigCategories, setResetConfigCategories] = useState<ConfigResetCategory[]>(
    ['dedup', 'tagDisplay', 'candidates', 'hotkeys']
  );
  // 数据类：默认不勾选
  const [resetDataCategories, setResetDataCategories] = useState<DataResetCategory[]>([]);
  // 题库子选项：保留官方题库（默认勾选）
  const [keepOfficial, setKeepOfficial] = useState(true);
  // 二次确认弹窗（仅勾选数据类时弹出）
  const [secondaryConfirmOpen, setSecondaryConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 官方题库信息
  const [officialInfo, setOfficialInfo] = useState<{
    seeded: boolean;
    version: string;
    count: number;
  }>({ seeded: false, version: '-', count: 0 });

  // 题库统计
  const [topicStats, setTopicStats] = useState<{ total: number; official: number }>({
    total: 0,
    official: 0
  });

  // ====== 初始化加载 settings ======
  useEffect(() => {
    void settingsStore.fetchAll();
  }, []);

  // settings 加载完成后初始化表单
  useEffect(() => {
    if (!settingsStore.loading) {
      const s = settingsStore.settings;
      setDedupEnabled(s[KEYS.dedupEnabled] ?? DEFAULTS.dedupEnabled);
      setLevenshtein(Number(s[KEYS.dedupLevenshtein] ?? DEFAULTS.dedupLevenshtein));
      setKeyword(Number(s[KEYS.dedupKeyword] ?? DEFAULTS.dedupKeyword));
      setAiEnabled(s[KEYS.aiDedupEnabled] ?? DEFAULTS.aiDedupEnabled);
      setAiApiKey(s[KEYS.aiApiKey] ?? DEFAULTS.aiApiKey);
      setAiThreshold(Number(s[KEYS.aiThreshold] ?? DEFAULTS.aiThreshold));

      setOfficialInfo({
        seeded: s[KEYS.officialSeeded] === true,
        version: String(s[KEYS.officialVersion] ?? '-'),
        count: Number(s[KEYS.officialCount] ?? 0)
      });
    }
  }, [settingsStore.settings, settingsStore.loading]);

  // 加载题库统计
  const loadTopicStats = async () => {
    try {
      const totalRes = await window.topicAPI.count({});
      if (totalRes.success && totalRes.data !== undefined) {
        const total = Number(totalRes.data);
        const officialRes = await window.topicAPI.count({ source_type: '官方' });
        const official = officialRes.success ? Number(officialRes.data ?? 0) : 0;
        setTopicStats({ total, official });
      }
    } catch (e) {
      // 静默失败
    }
  };

  useEffect(() => {
    void loadTopicStats();
  }, []);

  // ====== 保存去重设置 ======
  const handleSaveDedup = async () => {
    setSaving(true);
    try {
      await settingsStore.set(KEYS.dedupEnabled, dedupEnabled);
      await settingsStore.set(KEYS.dedupLevenshtein, levenshtein);
      await settingsStore.set(KEYS.dedupKeyword, keyword);
      await settingsStore.set(KEYS.aiDedupEnabled, aiEnabled);
      await settingsStore.set(KEYS.aiApiKey, aiApiKey);
      await settingsStore.set(KEYS.aiThreshold, aiThreshold);
      toast.success('去重设置已保存');
      // 保存成功后短暂显示绿色 ✓
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ====== 恢复默认设置（仅重置本地表单，需点击保存生效） ======
  const handleResetDedupDefaults = () => {
    setDedupEnabled(DEFAULTS.dedupEnabled);
    setLevenshtein(DEFAULTS.dedupLevenshtein);
    setKeyword(DEFAULTS.dedupKeyword);
    setAiEnabled(DEFAULTS.aiDedupEnabled);
    setAiApiKey(DEFAULTS.aiApiKey);
    setAiThreshold(DEFAULTS.aiThreshold);
    toast.info('已恢复为默认设置，需点击"保存设置"后生效');
  };

  // ====== 数据导出 ======
  const handleExportTopics = async (format: ExportFormat) => {
    setExporting('topics');
    try {
      const res = await window.exportAPI.exportTopics({ format });
      if (!res.success) {
        throw new Error(res.error || '导出失败');
      }
      toast.success(`已导出 ${res.data?.count ?? 0} 条辩题到：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        toast.info('已取消');
      } else {
        toast.error(e instanceof Error ? e.message : '导出失败');
      }
    } finally {
      setExporting(null);
    }
  };

  const handleExportSessions = async (format: ExportFormat) => {
    setExporting('sessions');
    try {
      const res = await window.exportAPI.exportDrawSessions({ format });
      if (!res.success) {
        throw new Error(res.error || '导出失败');
      }
      toast.success(`已导出 ${res.data?.count ?? 0} 条记录到：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        toast.info('已取消');
      } else {
        toast.error(e instanceof Error ? e.message : '导出失败');
      }
    } finally {
      setExporting(null);
    }
  };

  // ====== P3.4 Task 20：立即备份 ======
  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const backup = window.electron?.backup;
      if (!backup) {
        toast.error('备份 API 不可用');
        return;
      }
      const res = await backup.run();
      if (res.success) {
        toast.success('已备份');
      } else {
        toast.error(res.error || '备份失败');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  // ====== 官方题库"检查更新" ======
  // 当前版本仅展示当前已加载的版本与数量；用户可点击"重新加载"清空标记并触发再次 seed
  const handleCheckOfficialUpdate = () => {
    toast.info(
      `当前版本：${officialInfo.version}，已加载 ${officialInfo.count} 道官方辩题。检查更新功能待后续版本支持。`
    );
  };

  const handleReloadOfficial = async () => {
    try {
      // 清空 seeded 标记，下次启动时重新 seed
      await settingsStore.set(KEYS.officialSeeded, false);
      toast.success('已重置官方题库标记，请重启应用以重新加载');
      setOfficialInfo((s) => ({ ...s, seeded: false }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  // ====== 一键恢复初始设置 ======
  const handleOpenResetModal = () => {
    // 默认配置类全选，数据类全不选
    setResetConfigCategories(['dedup', 'tagDisplay', 'candidates', 'hotkeys']);
    setResetDataCategories([]);
    setKeepOfficial(true);
    setResetModalOpen(true);
  };

  // 构造数据类重置选项
  const buildDataOptions = () => {
    const opts: {
      topics?: { keepOfficial: boolean };
      events?: boolean;
      drawSessions?: boolean;
      importBatches?: boolean;
      auditLogs?: boolean;
    } = {};
    if (resetDataCategories.includes('topics')) {
      opts.topics = { keepOfficial };
    }
    if (resetDataCategories.includes('events')) opts.events = true;
    if (resetDataCategories.includes('drawSessions')) opts.drawSessions = true;
    if (resetDataCategories.includes('importBatches')) opts.importBatches = true;
    if (resetDataCategories.includes('auditLogs')) opts.auditLogs = true;
    return opts;
  };

  // 主弹窗点击"确认恢复"
  const handleConfirmReset = () => {
    if (resetConfigCategories.length === 0 && resetDataCategories.length === 0) {
      toast.warning('请至少选择一个要重置的类别');
      return;
    }
    // 仅勾选了配置类：直接执行
    if (resetDataCategories.length === 0) {
      void doReset();
      return;
    }
    // 勾选了数据类：弹出二次确认
    setSecondaryConfirmOpen(true);
  };

  // 二次确认弹窗点击"我已知晓，确认清除"
  const handleSecondaryConfirm = () => {
    setSecondaryConfirmOpen(false);
    void doReset();
  };

  // 实际执行重置
  const doReset = async () => {
    setResetting(true);
    try {
      const dataOptions = buildDataOptions();
      const res = await settingsStore.resetAll(resetConfigCategories, dataOptions);

      // 关闭标签显示弹窗（若开着）避免显示陈旧配置
      if (resetConfigCategories.includes('tagDisplay') && tagDisplayOpen) {
        setTagDisplayOpen(false);
      }

      // 拼接结果消息
      const parts: string[] = [];
      if (res.configDeleted > 0) parts.push(`配置 ${res.configDeleted} 项`);
      if (res.topicsDeleted > 0) parts.push(`辩题 ${res.topicsDeleted} 条`);
      if (res.eventsDeleted > 0) parts.push(`赛事 ${res.eventsDeleted} 条`);
      if (res.drawSessionsDeleted > 0) parts.push(`抽取 ${res.drawSessionsDeleted} 条`);
      if (res.importBatchesDeleted > 0) parts.push(`导入批次 ${res.importBatchesDeleted} 条`);
      if (res.auditLogsDeleted > 0) parts.push(`审计日志 ${res.auditLogsDeleted} 条`);

      // 刷新题库统计与官方信息
      await loadTopicStats();
      const s = settingsStore.settings;
      setOfficialInfo({
        seeded: s[KEYS.officialSeeded] === true,
        version: String(s[KEYS.officialVersion] ?? '-'),
        count: Number(s[KEYS.officialCount] ?? 0)
      });

      // 刷新题库列表（题库可能被清空）
      if (resetDataCategories.includes('topics')) {
        await topicStore.fetchList();
      }

      toast.success(`已恢复初始设置（${parts.join('，') || '无变更'}）`);
      setResetModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '恢复失败');
    } finally {
      setResetting(false);
    }
  };

  // 切换 Tab 并持久化
  const handleTabChange = (key: string) => {
    const tab = key as SettingsTab;
    setActiveTab(tab);
    try {
      window.localStorage.setItem(ACTIVE_TAB_LS_KEY, key);
    } catch {
      // 静默失败
    }
  };

  // ====== 渲染：通用 Tab（去重设置 + 铃声管理） ======
  const renderBasicTab = () => (
    <div>
      <Alert
        message="通用设置"
        description="应用基础配置：去重规则、铃声管理等。"
        type="info"
        showIcon
        banner
        style={{ marginBottom: spacing.md }}
      />

      {/* 去重设置 */}
      <AccentCard
        size="small"
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            <span>去重设置</span>
          </Space>
        }
        style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}
      >
        <Form layout="vertical">
          <Card
            size="small"
            type="inner"
            title={
              <Space>
                <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
                <span>文本匹配层</span>
                <Tag color="blue">必选</Tag>
              </Space>
            }
            style={{ marginBottom: spacing.md }}
          >
            <Form.Item label="启用文本匹配去重" tooltip="关闭后将跳过 Levenshtein 与关键词重合检测">
              <Switch
                checked={dedupEnabled}
                onChange={(v) => setDedupEnabled(v)}
                checkedChildren="开启"
                unCheckedChildren="关闭"
              />
            </Form.Item>
            <Row gutter={spacing.lg}>
              <Col span={12}>
                <Form.Item
                  label="Levenshtein 距离阈值"
                  tooltip="标题编辑距离小于该值视为相似，建议 3-8"
                >
                  <InputNumber
                    min={1}
                    max={20}
                    value={levenshtein}
                    onChange={(v) => setLevenshtein(Number(v ?? DEFAULTS.dedupLevenshtein))}
                    style={{ width: '100%' }}
                    disabled={!dedupEnabled}
                  />
                  <Progress
                    percent={Math.round((levenshtein / 20) * 100)}
                    size="small"
                    status="active"
                    style={{ marginTop: 4 }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="关键词重合度阈值"
                  tooltip="0~1，越高要求越严格，建议 0.6-0.9"
                >
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.05}
                    value={keyword}
                    onChange={(v) => setKeyword(Number(v ?? DEFAULTS.dedupKeyword))}
                    style={{ width: '100%' }}
                    disabled={!dedupEnabled}
                  />
                  <Progress
                    percent={Math.round(keyword * 100)}
                    size="small"
                    status="active"
                    style={{ marginTop: 4 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            size="small"
            type="inner"
            title={
              <Space>
                <ExperimentOutlined style={{ color: '#722ed1' }} />
                <span>AI 语义层</span>
                <Tag color="orange">可选</Tag>
              </Space>
            }
            style={{ marginBottom: spacing.md }}
          >
            <Form.Item label="启用 AI 语义去重" tooltip="开启后将调用语义相似度接口（需配置 API Key）">
              <Switch
                checked={aiEnabled}
                onChange={(v) => setAiEnabled(v)}
                checkedChildren="开启"
                unCheckedChildren="关闭"
              />
            </Form.Item>
            <Form.Item label="API Key" tooltip="用于调用语义相似度服务的密钥">
              <Input.Password
                placeholder="请输入 API Key"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                disabled={!aiEnabled}
              />
            </Form.Item>
            <Form.Item label="AI 相似度阈值" tooltip="0~1，AI 返回的相似度 ≥ 该值视为重复">
              <InputNumber
                min={0}
                max={1}
                step={0.05}
                value={aiThreshold}
                onChange={(v) => setAiThreshold(Number(v ?? DEFAULTS.aiThreshold))}
                style={{ width: '100%' }}
                disabled={!aiEnabled}
              />
              <Progress
                percent={Math.round(aiThreshold * 100)}
                size="small"
                status="active"
                style={{ marginTop: 4 }}
              />
            </Form.Item>
            <Alert
              message="AI 语义层为可选功能"
              description="当前版本仅保存配置，AI 相似度函数尚未接入实际服务。后续版本将对接具体 API。"
              type="warning"
              showIcon
              banner
            />
          </Card>

          <Space wrap>
            <Button
              type="primary"
              size="large"
              icon={<CheckCircleOutlined />}
              loading={saving}
              onClick={handleSaveDedup}
              style={
                saveSuccess
                  ? { background: '#52c41a', borderColor: '#52c41a' }
                  : undefined
              }
            >
              {saveSuccess ? '已保存' : '保存设置'}
            </Button>
            <Button
              size="large"
              icon={<SafetyCertificateOutlined />}
              onClick={() => setDedupOpen(true)}
            >
              立即执行去重检查
            </Button>
            <Button
              icon={<UndoOutlined />}
              onClick={handleResetDedupDefaults}
            >
              恢复默认设置
            </Button>
          </Space>
        </Form>
      </AccentCard>

      {/* 铃声管理 */}
      <Card
        size="small"
        title={
          <Space>
            <BellOutlined style={{ color: '#1677ff' }} />
            <span>铃声管理</span>
          </Space>
        }
      >
        <BellManager />
      </Card>
    </div>
  );

  // ====== 渲染：外观 Tab（主题模式） ======
  const renderAppearanceTab = () => (
    <div>
      <Alert
        message="外观设置"
        description="自定义应用的视觉风格，包括主题模式等。"
        type="info"
        showIcon
        banner
        style={{ marginBottom: spacing.md }}
      />

      <AccentCard
        size="small"
        title={
          <Space>
            <BulbOutlined style={{ color: '#1677ff' }} />
            <span>主题</span>
          </Space>
        }
        style={{ background: token.colorBgContainer, ...cardStyle }}
      >
        <Form layout="vertical">
          <Form.Item
            label="主题模式"
            tooltip="选择亮色 / 暗色 / 跟随系统。跟随系统时会监听 OS prefers-color-scheme 实时切换"
          >
            <Radio.Group
              value={themeMode}
              onChange={(e) => setThemeMode(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio value="light"><SunOutlined /> 亮色</Radio>
              <Radio value="dark"><MoonOutlined /> 暗色</Radio>
              <Radio value="system"><DesktopOutlined /> 跟随系统</Radio>
            </Radio.Group>
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message={`当前生效模式：${themeMode === 'system' ? '跟随系统' : themeMode === 'dark' ? '暗色' : '亮色'}`}
            description="主题设置会自动持久化到本地，重启应用后仍然生效。"
          />
        </Form>
      </AccentCard>
    </div>
  );

  // ====== 渲染：数据 Tab（题库管理 + 导入导出 + 危险操作） ======
  const renderDataTab = () => (
    <div>
      <Alert
        message="数据管理"
        description="题库统计、数据导入导出与危险操作。"
        type="info"
        showIcon
        banner
        style={{ marginBottom: spacing.md }}
      />

      {/* 题库统计 */}
      <Row gutter={[spacing.lg, spacing.lg]} style={{ marginBottom: spacing.md }}>
        <Col xs={12} sm={12} md={6}>
          <Card size="small" style={statCardStyle('#1677ff')}>
            <Statistic
              title="题库总数"
              value={topicStats.total}
              prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small" style={statCardStyle('#52c41a')}>
            <Statistic
              title="官方题库"
              value={topicStats.official}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small" style={statCardStyle('#722ed1')}>
            <Statistic
              title="内置版本"
              value={officialInfo.version}
              prefix={<SafetyCertificateOutlined style={{ color: '#722ed1' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small" style={statCardStyle('#faad14')}>
            <Statistic
              title="已加载"
              value={officialInfo.seeded ? 1 : 0}
              formatter={() =>
                officialInfo.seeded ? (
                  <Tag color="green" icon={<CheckCircleOutlined />}>已加载</Tag>
                ) : (
                  <Tag color="orange" icon={<ReloadOutlined />}>未加载</Tag>
                )
              }
            />
          </Card>
        </Col>
      </Row>

      {/* 官方题库 */}
      <Card
        size="small"
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            <span>官方题库</span>
          </Space>
        }
        style={{ marginBottom: spacing.md }}
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleCheckOfficialUpdate}>
              检查更新
            </Button>
            <Popconfirm
              title="确认重置官方题库标记？"
              description="下次启动应用时将重新加载官方题库"
              onConfirm={handleReloadOfficial}
              okText="确认"
              cancelText="取消"
            >
              <Button size="small" icon={<ReloadOutlined />}>
                重新加载
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          内置官方题库 v{officialInfo.version}，包含 {officialInfo.count} 道经典辩题。
          首次启动时自动加载到数据库；如需重新加载，请点击"重新加载"并重启应用。
        </Paragraph>
      </Card>

      {/* 数据导出与导入 */}
      <Row gutter={[spacing.lg, spacing.lg]} style={{ marginBottom: spacing.md }}>
        {/* 左侧：数据导出 */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                <DownloadOutlined style={{ color: '#1677ff' }} />
                <span>数据导出</span>
              </Space>
            }
            style={{ height: '100%' }}
          >
            <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>题库</Title>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              将全部辩题导出为 Excel / CSV / JSON 文件。
            </Paragraph>
            <Space wrap style={{ marginBottom: 16 }}>
              <Button
                icon={<FileExcelOutlined />}
                loading={exporting === 'topics'}
                onClick={() => handleExportTopics('xlsx')}
              >
                Excel
              </Button>
              <Button icon={<FileTextOutlined />} onClick={() => handleExportTopics('csv')}>
                CSV
              </Button>
              <Button icon={<FileTextOutlined />} onClick={() => handleExportTopics('json')}>
                JSON
              </Button>
            </Space>

            <Title level={5} style={{ marginBottom: 4 }}>抽取记录</Title>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              将历史抽取记录导出为 Excel / CSV / JSON 文件。
            </Paragraph>
            <Space wrap style={{ marginBottom: 16 }}>
              <Button
                icon={<FileExcelOutlined />}
                loading={exporting === 'sessions'}
                onClick={() => handleExportSessions('xlsx')}
              >
                Excel
              </Button>
              <Button icon={<FileTextOutlined />} onClick={() => handleExportSessions('csv')}>
                CSV
              </Button>
              <Button icon={<FileTextOutlined />} onClick={() => handleExportSessions('json')}>
                JSON
              </Button>
            </Space>

            <Title level={5} style={{ marginBottom: 4 }}>赛事数据包（JSON）</Title>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              将指定赛事的全部相关数据（辩题、轮次、队伍）打包导出。
            </Paragraph>
            <EventPackageExport />
          </Card>
        </Col>

        {/* 右侧：数据导入 + 去重检查 + 标签配置 */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                <UploadOutlined style={{ color: '#1677ff' }} />
                <span>数据导入</span>
              </Space>
            }
            style={{ marginBottom: spacing.md }}
          >
            <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>辩题导入</Title>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              从 Excel / CSV / Word 文件导入辩题到题库。
            </Paragraph>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setImportOpen(true)}
            >
              导入辩题
            </Button>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <SafetyCertificateOutlined style={{ color: '#722ed1' }} />
                <span>去重检查</span>
              </Space>
            }
            style={{ marginBottom: spacing.md }}
          >
            <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>题库去重</Title>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              对当前题库执行去重检查，发现并清理相似 / 重复辩题。
            </Paragraph>
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined />}
              onClick={() => setDedupOpen(true)}
            >
              执行去重检查
            </Button>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <TagsOutlined style={{ color: '#1677ff' }} />
                <span>标签显示配置</span>
              </Space>
            }
            extra={
              <Button
                type="primary"
                size="small"
                icon={<TagsOutlined />}
                onClick={() => setTagDisplayOpen(true)}
              >
                配置标签显示
              </Button>
            }
          >
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              按 5 个场景（题库浏览 / 抽取结果 / 大屏投影 / 筛选面板 / 去重检查）独立配置
              4 个类别（题型 / 难度 / 来源类型 / 自定义标签）的开关与白名单。
            </Paragraph>
          </Card>
        </Col>
      </Row>

      {/* 危险操作分区 */}
      <Card
        size="small"
        style={{
          borderColor: token.colorError,
          borderWidth: 1
        }}
        title={
          <Space>
            <WarningOutlined style={{ color: token.colorError }} />
            <Text type="danger" strong>
              危险操作
            </Text>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          可重置用户偏好配置（去重设置、标签显示、自定义候选值）与业务数据（题库、赛事、抽取记录、导入批次、审计日志）。数据类默认不勾选且需二次确认。
        </Paragraph>
        <Space>
          <Button danger icon={<RestOutlined />} onClick={handleOpenResetModal}>
            恢复初始设置
          </Button>
        </Space>
      </Card>
    </div>
  );

  // ====== 渲染：备份与迁移 Tab（一键备份/还原 + 自动备份管理） ======
  const renderBackupTab = () => (
    <div>
      <PageHeader
        title="备份与迁移"
        subtitle="一键备份所有数据，或从备份文件恢复"
      />

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card
            hoverable
            onClick={() => setBackupExportOpen(true)}
            style={{ height: '100%' }}
          >
            <Space direction="vertical" size="small">
              <CloudUploadOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
              <Text strong style={{ fontSize: fontSize.h4 }}>一键备份</Text>
              <Text type="secondary">将所选类别的数据打包为 JSON 文件，可用于迁移或存档</Text>
            </Space>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            hoverable
            onClick={() => setBackupImportOpen(true)}
            style={{ height: '100%' }}
          >
            <Space direction="vertical" size="small">
              <CloudDownloadOutlined style={{ fontSize: 32, color: token.colorSuccess }} />
              <Text strong style={{ fontSize: fontSize.h4 }}>一键还原</Text>
              <Text type="secondary">从 JSON 备份文件恢复数据，支持三种冲突处理策略</Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Alert
        message="备份文件包含完整数据，建议在做重大操作前先备份"
        type="info"
        style={{ marginTop: spacing.md }}
      />

      {/* 自动备份管理（原 data Tab 的 .db 文件级备份） */}
      <Card
        size="small"
        title={
          <Space>
            <DatabaseOutlined />
            自动备份管理
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        <Space>
          <Button icon={<ReloadOutlined />} loading={backingUp} onClick={handleBackup}>
            立即备份
          </Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => setBackupModalOpen(true)}>
            管理备份
          </Button>
        </Space>
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          自动备份为数据库文件级别（.db），每 24 小时自动触发一次，保留最近 7 份。与上方「一键备份」相互独立。
        </Text>
      </Card>
    </div>
  );

  // ====== 渲染：关于 Tab ======
  const renderAboutTab = () => (
    <div>
      <Card
        size="small"
        style={{ marginBottom: spacing.md, textAlign: 'center' }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Title level={3} style={{ marginBottom: 0 }}>
            辩盒
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            辩论赛题抽取与计时工具
          </Paragraph>
          <Space>
            <Text type="secondary">版本：</Text>
            <Tag color="blue" style={{ fontSize: fontSize.body, padding: '2px 12px' }}>
              {APP_VERSION}
            </Tag>
          </Space>
        </Space>
      </Card>

      {/* 应用更新检查 */}
      <UpdateCard />

      <Card
        size="small"
        title={
          <Space>
            <MailOutlined style={{ color: '#1677ff' }} />
            <span>反馈与支持</span>
          </Space>
        }
        style={{ marginBottom: spacing.md }}
      >
        <Paragraph style={{ marginBottom: 8 }}>
          <Text type="secondary">反馈邮箱：</Text>
          <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
        </Paragraph>
        <Paragraph style={{ marginBottom: 0 }}>
          <GithubOutlined style={{ marginRight: 6 }} />
          <Text type="secondary">GitHub：</Text>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            {GITHUB_URL}
          </a>
        </Paragraph>
      </Card>

      {/* 引导区（Task 10.4）：重新观看引导 + 重置工作流卡 */}
      <Card
        size="small"
        title={
          <Space>
            <RocketOutlined style={{ color: '#1677ff' }} />
            <span>新手引导</span>
          </Space>
        }
        style={{ marginBottom: spacing.md }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          重新观看首次启动引导 Tour，或重置「3 步上手」工作流卡（在赛事管理页顶部显示）。
        </Paragraph>
        <Space>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={() => {
              settingsStore.setOnboardingCompleted(false);
              // 导航到 /draw 触发 Tour（App.tsx useEffect 检测 !onboardingCompleted && route === '/draw'）
              window.location.hash = '#/draw';
            }}
          >
            重新观看引导
          </Button>
          <Button
            icon={<BulbOutlined />}
            onClick={() => {
              settingsStore.setShowWorkflowCard(true);
              toast.success('工作流引导卡已重置，可在赛事管理页查看');
            }}
          >
            重置工作流卡
          </Button>
        </Space>
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <InfoCircleOutlined style={{ color: '#1677ff' }} />
            <span>关于应用</span>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          辩盒是一款专为辩论赛场景设计的题库管理与抽取工具，支持辩题导入导出、智能去重、
          赛事管理、抽取计时、大屏投影等核心能力，适用于辩论赛组织者与参赛队伍。
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          技术栈：Electron + React + TypeScript + Ant Design + SQLite。
        </Paragraph>
      </Card>
    </div>
  );

  // 左侧 Menu 项
  const menuItems = [
    { key: 'basic', icon: <SettingOutlined />, label: '通用' },
    { key: 'appearance', icon: <BulbOutlined />, label: '外观' },
    { key: 'data', icon: <DatabaseOutlined />, label: '数据' },
    { key: 'backup', icon: <CloudSyncOutlined />, label: '备份与迁移' },
    { key: 'hotkeys', icon: <KeyOutlined />, label: '快捷键' },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于' }
  ];

  return (
    <>
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ padding: spacing.xl, overflow: 'auto' }}>
          {/* 顶部页头 */}
          <PageHeader
            title="应用设置"
            subtitle="主题、数据源、快捷键等"
            extra={
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  void settingsStore.fetchAll();
                  void loadTopicStats();
                }}
              >
                刷新
              </Button>
            }
          />

          {/* 左右分栏：左侧 Menu + 右侧内容区 */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              background: token.colorBgContainer,
              borderRadius: radius.lg,
              border: `1px solid ${token.colorBorderSecondary}`,
              overflow: 'hidden',
              minHeight: 'calc(100vh - 64px - 32px - 60px)'
            }}
          >
            {/* 左侧分类 Menu */}
            <Menu
              mode="inline"
              selectedKeys={[activeTab]}
              items={menuItems}
              onClick={({ key }) => handleTabChange(key)}
              style={{
                width: 200,
                height: '100%',
                overflowY: 'auto',
                borderRight: `1px solid ${token.colorBorderSecondary}`,
                flexShrink: 0
              }}
            />

            {/* 右侧内容区 */}
            <BrandSpin spinning={settingsStore.loading} style={{ width: '100%' }}>
              <div
                style={{
                  flex: 1,
                  padding: spacing.xxl,
                  overflowY: 'auto',
                  minWidth: 0
                }}
              >
                <div style={{ maxWidth: 720, margin: '0 auto' }}>
                  {activeTab === 'basic' && renderBasicTab()}
                  {activeTab === 'appearance' && renderAppearanceTab()}
                  {activeTab === 'data' && renderDataTab()}
                  {activeTab === 'backup' && renderBackupTab()}
                  {activeTab === 'hotkeys' && <HotkeySettingsTab />}
                  {activeTab === 'about' && renderAboutTab()}
                </div>
              </div>
            </BrandSpin>
          </div>

          {/* 恢复初始设置确认弹窗（主） */}
          <Modal
            title={
              <Space>
                <WarningOutlined style={{ color: token.colorError }} />
                <span>确认恢复初始设置</span>
              </Space>
            }
            open={resetModalOpen}
            onCancel={() => setResetModalOpen(false)}
            confirmLoading={resetting}
            okText="确认恢复"
            okButtonProps={{
              danger: true,
              disabled: resetConfigCategories.length === 0 && resetDataCategories.length === 0
            }}
            cancelText="取消"
            onOk={handleConfirmReset}
            width={560}
          >
            <Alert
              type="warning"
              showIcon
              message="此操作会立即清除所选类别的内容并恢复默认值，不可撤销。"
              style={{ marginBottom: 12 }}
            />

            {/* 配置类分组 */}
            <Paragraph strong style={{ marginBottom: 8, color: token.colorPrimary }}>
              <SettingOutlined style={{ marginRight: 6 }} />
              配置类（用户偏好，默认勾选）
            </Paragraph>
            <Checkbox.Group
              value={resetConfigCategories}
              onChange={(vals) => setResetConfigCategories(vals as ConfigResetCategory[])}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, paddingLeft: 8 }}
            >
              {CONFIG_RESET_CATEGORIES.map((cat) => (
                <Checkbox key={cat} value={cat}>
                  <Text strong>{RESET_CATEGORY_LABELS[cat]}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {RESET_CATEGORY_DESCRIPTIONS[cat]}
                  </Text>
                </Checkbox>
              ))}
            </Checkbox.Group>

            {/* 数据类分组 */}
            <Paragraph strong style={{ marginBottom: 8, color: token.colorError }}>
              <DatabaseOutlined style={{ marginRight: 6 }} />
              数据类（业务数据，默认不勾选，需二次确认）
            </Paragraph>
            <Checkbox.Group
              value={resetDataCategories}
              onChange={(vals) => setResetDataCategories(vals as DataResetCategory[])}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}
            >
              {DATA_RESET_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <Checkbox value={cat}>
                    <Text strong>{RESET_CATEGORY_LABELS[cat]}</Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {RESET_CATEGORY_DESCRIPTIONS[cat]}
                    </Text>
                  </Checkbox>
                  {/* 题库子选项：仅当题库被勾选时显示 */}
                  {cat === 'topics' && resetDataCategories.includes('topics') && (
                    <div style={{ marginLeft: 24, marginTop: 4 }}>
                      <Checkbox
                        checked={keepOfficial}
                        onChange={(e) => setKeepOfficial(e.target.checked)}
                      >
                        <Text type="secondary">保留官方题库（仅清空自定义辩题）</Text>
                      </Checkbox>
                    </div>
                  )}
                </div>
              ))}
            </Checkbox.Group>

            <Alert
              type="info"
              showIcon
              message="未勾选的类别不受影响；勾选数据类后点击确认将再次询问。"
              style={{ marginTop: 12 }}
            />
          </Modal>

          {/* 二次确认弹窗（仅勾选数据类时弹出） */}
          <Modal
            title={
              <Space>
                <WarningOutlined style={{ color: token.colorError }} />
                <Text type="danger" strong>二次确认 — 数据将被永久删除</Text>
              </Space>
            }
            open={secondaryConfirmOpen}
            onCancel={() => setSecondaryConfirmOpen(false)}
            confirmLoading={resetting}
            okText="我已知晓，确认清除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onOk={handleSecondaryConfirm}
            width={520}
          >
            <Alert
              type="error"
              showIcon
              message="即将清除以下业务数据，此操作不可恢复！"
              style={{ marginBottom: 12 }}
            />
            <ul style={{ margin: 0, paddingLeft: 20, marginBottom: 12 }}>
              {resetDataCategories.includes('topics') && (
                <li>
                  <Text strong>题库数据</Text>
                  {keepOfficial ? '（保留官方题库，仅清空自定义辩题）' : '（清空全部，含官方题库；重启后重新加载）'}
                </li>
              )}
              {resetDataCategories.includes('events') && (
                <li><Text strong>赛事数据</Text>（赛事、轮次、队伍、队伍历史，级联删除）</li>
              )}
              {resetDataCategories.includes('drawSessions') && (
                <li><Text strong>抽取记录</Text>（抽取会话与抽取明细，级联删除）</li>
              )}
              {resetDataCategories.includes('importBatches') && (
                <li><Text strong>导入批次记录</Text>（不含辩题数据本身）</li>
              )}
              {resetDataCategories.includes('auditLogs') && (
                <li><Text strong>审计日志</Text>（系统操作审计日志，本次重置记录将保留）</li>
              )}
            </ul>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              如需备份，请先使用「数据导出」功能导出相关数据。点击下方按钮将立即执行清除。
            </Paragraph>
          </Modal>

          {/* 导入弹窗 */}
          <ImportTopicsModal
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onSuccess={() => {
              void loadTopicStats();
              void topicStore.fetchList();
            }}
          />

          {/* 去重检查弹窗 */}
          <DedupResultModal open={dedupOpen} onClose={() => setDedupOpen(false)} />

          {/* 标签显示配置弹窗 */}
          <TagDisplaySettingsModal
            open={tagDisplayOpen}
            onClose={() => setTagDisplayOpen(false)}
          />

          {/* P3.4 Task 20：备份管理弹窗 */}
          <BackupManageModal
            open={backupModalOpen}
            onClose={() => setBackupModalOpen(false)}
          />

          {/* 全量数据一键备份/还原弹窗 */}
          <BackupExportModal
            open={backupExportOpen}
            onClose={() => setBackupExportOpen(false)}
          />
          <BackupImportModal
            open={backupImportOpen}
            onClose={() => setBackupImportOpen(false)}
          />
        </Content>
      </Layout>
    </>
  );
}

// ============================================================
// 赛事数据包导出子组件
// ============================================================
function EventPackageExport() {
  const toast = useToast();
  const [events, setEvents] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await window.eventAPI.listEvents({ page: 1, pageSize: 1000 });
        if (res.success && res.data) {
          const list = res.data.items ?? [];
          setEvents(list.map((e) => ({ id: e.id, name: e.name })));
        }
      } catch (e) {
        // 静默
      }
    })();
  }, []);

  const handleExport = async () => {
    if (!selectedId) {
      toast.warning('请先选择赛事');
      return;
    }
    setExporting(true);
    try {
      const res = await window.exportAPI.exportEventPackage({ eventId: selectedId });
      if (!res.success) {
        throw new Error(res.error || '导出失败');
      }
      toast.success(`已导出赛事数据包：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        toast.info('已取消');
      } else {
        toast.error(e instanceof Error ? e.message : '导出失败');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Space wrap>
        <Select
          placeholder="选择赛事"
          style={{ width: 280 }}
          value={selectedId}
          onChange={(v) => setSelectedId(v)}
          options={events.map((e) => ({ value: e.id, label: e.name }))}
          showSearch
          optionFilterProp="label"
        />
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={exporting}
          onClick={handleExport}
          disabled={!selectedId}
        >
          导出赛事数据包
        </Button>
      </Space>
    </>
  );
}
