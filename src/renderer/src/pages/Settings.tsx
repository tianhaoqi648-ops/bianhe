import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  Slider,
  Modal,
  Checkbox,
  Radio,
  Divider,
  List,
  Tooltip,
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
  AudioOutlined,
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
  PlayCircleOutlined,
  RobotOutlined,
  ImportOutlined
} from '@ant-design/icons';
import { version } from '../../../../package.json';
import { useSettingsStore, getTimeoutTtsSetting, TIMEOUT_TTS_KEY } from '../stores/settingsStore';
import { BELL_KITS, BELL_KIT_KEY, getBellKitFromSettings } from '../utils/timer-bell-kits';
import { useTopicStore } from '../stores/topicStore';
import { useAgentSessionStore } from '../stores/agentSessionStore';
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
import type {
  ExportFormat,
  SttEngine,
  SttEngineStatus,
  SttFfmpegStatus,
  SttFunAsrStatus,
  SttLocalEngine,
  SttDirDiagnostics
} from '../../../shared/types';

// 本地扩展：FunASR 缺失的推理运行时依赖（如 ["torchaudio"]），由 funasrStatus() 返回
interface SttFunAsrStatusWithDeps extends SttFunAsrStatus {
  missingDeps?: string[]
}
import {
  STT_ENGINE_KEY,
  STT_MODEL_KEY,
  STT_LOCAL_ENGINE_KEY,
  STT_FUNASR_MODEL_KEY,
  WHISPER_MODELS,
  FUNASR_MODELS
} from '../../../shared/types';
import { LLM_PROVIDER_PRESETS } from '../../../shared/agent-types';
import type {
  LLMProvider,
  LLMConfig,
  TestConnectionResult,
  ToolConfirmRule,
  ToolRiskLevel,
  AgentConfigAPI
} from '../../../shared/agent-types';
import {
  CONFIG_RESET_CATEGORIES,
  DATA_RESET_CATEGORIES,
  RESET_CATEGORY_LABELS,
  RESET_CATEGORY_DESCRIPTIONS,
  type ConfigResetCategory,
  type DataResetCategory
} from '../../../shared/settings-defaults';
import {
  RECORDING_DIR_KEY,
  RECORDING_SEGMENT_KEY,
  RECORDING_FORMAT_KEY,
  resolveRecordingFormat
} from '../../../shared/match-recording';
import { STT_DIR_KEY } from '../../../shared/match-recording';

const { Content } = Layout;
const { Text, Paragraph, Title } = Typography;

// 设置页 Tab 类型
type SettingsTab = 'basic' | 'appearance' | 'data' | 'backup' | 'hotkeys' | 'ai' | 'about';

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

// ============================================================
// 工具确认规则相关常量（Task 48）
//
// 在渲染进程维护一份 12 个工具的元数据常量（与 src/main/agent/tools/index.ts
// 的 allTools 对齐），避免新增 IPC 通道。如工具清单变化，同步更新此处。
// ============================================================

/** 工具确认规则元数据（用于设置页按风险等级分组展示） */
interface ToolConfirmMeta {
  toolName: string
  description: string
  riskLevel: ToolRiskLevel
}

/**
 * 12 个工具的元数据常量（8 个 v1.3.0 基础工具 + 4 个 v1.4.0 赛事流程工具）。
 *
 * 风险等级分组（与各 *.tool.ts 中 riskLevel 字段对齐）：
 *   - high：create_event / import_event_batch / optimize_team_groups / generate_schedule
 *   - medium：create_topic / draw_topics
 *   - low：search_topics / get_topic_detail / list_events / get_format /
 *           get_current_timer_state / recommend_format
 */
const TOOL_CONFIRM_METAS: ToolConfirmMeta[] = [
  // 高风险
  {
    toolName: 'create_event',
    description: '创建赛事。仅写入赛事主体，赛制与队伍需后续单独配置。',
    riskLevel: 'high'
  },
  {
    toolName: 'import_event_batch',
    description: '从 Excel/CSV/DOCX 文件批量导入赛事与队伍。',
    riskLevel: 'high'
  },
  {
    toolName: 'optimize_team_groups',
    description: '优化赛事队伍分组（蛇形分配 / 随机分配）。',
    riskLevel: 'high'
  },
  {
    toolName: 'generate_schedule',
    description: '为赛事生成赛程对阵（单淘汰/单循环/双淘汰/瑞士轮）。',
    riskLevel: 'high'
  },
  // 中风险
  {
    toolName: 'create_topic',
    description: '创建新辩题。',
    riskLevel: 'medium'
  },
  {
    toolName: 'draw_topics',
    description: '从题库抽取辩题。支持按维度筛选、控制数量、避免重复。',
    riskLevel: 'medium'
  },
  // 低风险
  {
    toolName: 'search_topics',
    description: '搜索辩题库。支持按关键词、类型、领域、难度、标签筛选。',
    riskLevel: 'low'
  },
  {
    toolName: 'get_topic_detail',
    description: '获取辩题详情（含自定义字段）。',
    riskLevel: 'low'
  },
  {
    toolName: 'list_events',
    description: '列出赛事。可按状态筛选，默认按创建时间倒序返回。',
    riskLevel: 'low'
  },
  {
    toolName: 'get_format',
    description: '查询赛制模板。不传 formatId 时返回默认赛制。',
    riskLevel: 'low'
  },
  {
    toolName: 'get_current_timer_state',
    description: '查询当前计时器状态（当前环节、剩余时间、运行状态等）。',
    riskLevel: 'low'
  },
  {
    toolName: 'recommend_format',
    description: '根据赛事规模与偏好推荐赛制模板。',
    riskLevel: 'low'
  }
]

/** 风险等级标签配置（含展示文案、Tag 颜色、默认是否需确认） */
const RISK_LEVEL_LABELS: Record<
  ToolRiskLevel,
  { label: string; color: string; defaultRequireConfirm: boolean }
> = {
  high: { label: '高风险', color: 'red', defaultRequireConfirm: true },
  medium: { label: '中风险', color: 'orange', defaultRequireConfirm: true },
  low: { label: '低风险', color: 'green', defaultRequireConfirm: false }
}

/** 风险等级展示顺序（high → medium → low） */
const RISK_LEVEL_ORDER: ToolRiskLevel[] = ['high', 'medium', 'low']

/**
 * 构造默认确认规则（按 riskLevel 决定 requireConfirm）。
 * high / medium 默认需确认，low 默认无需确认。
 */
function buildDefaultConfirmRules(): ToolConfirmRule[] {
  return TOOL_CONFIRM_METAS.map((m) => ({
    toolName: m.toolName,
    requireConfirm: RISK_LEVEL_LABELS[m.riskLevel].defaultRequireConfirm
  }))
}

/** 把字节数格式化为可读体积（KB/MB），非法输入返回 '-' */
function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '-'
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`
  return `${mb.toFixed(1)} MB`
}

/**
 * 获取 preload 暴露的 Agent 配置 API。
 *
 * window.agent 通过 contextBridge.exposeInMainWorld('agent', agentAPI) 挂载，
 * 但 Window 接口尚未声明 agent 字段，此处用 cast 获取类型安全引用，
 * 与 agentStore.ts 中 getAgentAPI 的处理方式一致。
 */
function getAgentConfigAPI(): AgentConfigAPI | null {
  const w = window as unknown as { agent?: { config?: AgentConfigAPI } }
  return w.agent?.config ?? null
}

export default function Settings() {
  const { token } = theme.useToken();
  const settingsStore = useSettingsStore();
  const topicStore = useTopicStore();
  const { aiConfig, setAIConfig, aiEnabled: aiAssistantEnabled, setAIEnabled: setAIAssistantEnabled } = settingsStore;
  const { themeMode, setThemeMode } = useThemeMode();
  const toast = useToast();

  // 当前激活的 Tab（持久化到 localStorage）
  const [activeTab, setActiveTab] = useState<SettingsTab>(loadActiveTab);

  // 支持 URL query ?tab=about 直达「关于」页（由全局更新通知「去更新」跳转而来）
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'about') {
      setActiveTab('about');
    }
    // 仅在挂载时读取一次，避免路由变化反复覆盖用户手动切换的 Tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 本地表单状态（与 store 同步）
  const [dedupEnabled, setDedupEnabled] = useState<boolean>(DEFAULTS.dedupEnabled);
  const [levenshtein, setLevenshtein] = useState<number>(DEFAULTS.dedupLevenshtein);
  const [keyword, setKeyword] = useState<number>(DEFAULTS.dedupKeyword);
  const [aiEnabled, setAiEnabled] = useState<boolean>(DEFAULTS.aiDedupEnabled);
  const [aiApiKey, setAiApiKey] = useState<string>(DEFAULTS.aiApiKey);
  const [aiThreshold, setAiThreshold] = useState<number>(DEFAULTS.aiThreshold);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // AI 助手「测试连接」按钮 loading
  const [testing, setTesting] = useState(false);
  // Task 48：工具确认规则状态
  const [confirmRules, setConfirmRules] = useState<ToolConfirmRule[]>([]);
  const [confirmRulesLoading, setConfirmRulesLoading] = useState(false);
  const [confirmRulesSaving, setConfirmRulesSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [tagDisplayOpen, setTagDisplayOpen] = useState(false);
  const [exporting, setExporting] = useState<null | 'topics' | 'sessions'>(null);

  // 录音存放位置
  const [recDirEffective, setRecDirEffective] = useState('');
  const [recDirConfigured, setRecDirConfigured] = useState(false);
  const [recDirPicking, setRecDirPicking] = useState(false);
  // 录音分段模式（whole 整场一轨 / split 按环节分段）
  const [recSegmentMode, setRecSegmentMode] = useState<'whole' | 'split'>('whole');
  // 录音格式（wav 可拖动进度条，体积大 / webm 体积小，进度条不可拖 / m4a AAC 体积小且可拖，需平台支持）
  const [recFormat, setRecFormat] = useState<'wav' | 'webm' | 'm4a'>('wav');
  // M4A（AAC）依赖 MediaRecorder 的 audio/mp4 支持，运行期检测
  const m4aSupported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4');
  // AI 转写（STT）：引擎选择 / 模型 / 本地引擎安装与下载状态
  const [sttEngine, setSttEngine] = useState<SttEngine>('local-first');
  const [sttModel, setSttModel] = useState<string>('base');
  const [sttStatus, setSttStatus] = useState<SttEngineStatus | null>(null);
  const [sttDownloading, setSttDownloading] = useState(false);
  // 本地引擎实现（whisper.cpp / FunASR）与 FunASR 模型/运行环境状态
  const [sttLocalEngine, setSttLocalEngine] = useState<SttLocalEngine>('whisper');
  const [sttFunAsrModel, setSttFunAsrModel] = useState<string>('paraformer-zh');
  const [sttFunAsrStatus, setSttFunAsrStatus] = useState<SttFunAsrStatusWithDeps | null>(null);
  const [funAsrInstalling, setFunAsrInstalling] = useState(false);
  // AI 转写（STT）：ffmpeg 转码器安装/下载状态
  const [sttFfmpegStatus, setSttFfmpegStatus] = useState<SttFfmpegStatus | null>(null);
  const [sttFfmpegDownloading, setSttFfmpegDownloading] = useState(false);
  // AI 转写（STT）：存放目录（配置值；空 = 默认 userData/stt）
  const [sttDirConfigured, setSttDirConfigured] = useState('');
  const [sttDirPicking, setSttDirPicking] = useState(false);
  // T4：stt 目录诊断（有效路径 + whisper/ffmpeg/模型在位状况，用于更新后数据缺失引导找回）
  const [sttDirDiagnostics, setSttDirDiagnostics] = useState<SttDirDiagnostics | null>(null);
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

      setRecSegmentMode(s[RECORDING_SEGMENT_KEY] === 'split' ? 'split' : 'whole');

      const sttEng = s[STT_ENGINE_KEY];
      setSttEngine(sttEng === 'local' || sttEng === 'api' ? sttEng : 'local-first');
      const sttMdl = s[STT_MODEL_KEY];
      setSttModel(typeof sttMdl === 'string' && sttMdl.trim() ? sttMdl.trim() : 'base');
      const localEng = s[STT_LOCAL_ENGINE_KEY];
      setSttLocalEngine(localEng === 'funasr' ? 'funasr' : 'whisper');
      const funAsrMdl = s[STT_FUNASR_MODEL_KEY];
      setSttFunAsrModel(
        typeof funAsrMdl === 'string' &&
          (FUNASR_MODELS as readonly string[]).includes(funAsrMdl.trim())
          ? funAsrMdl.trim()
          : FUNASR_MODELS[0]
      );

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

  // ====== AI 助手：测试连接 ======
  // 通过专用 agent:test-connection IPC 通道验证 LLM 连通性
  // 不进入 agent 循环、不污染会话历史
  const handleTestConnection = async () => {
    // 前端侧前置校验（与主进程 validateConfig 逻辑一致，即时反馈）
    const apiKey = aiConfig.apiKey?.trim() ?? '';
    const baseURL = aiConfig.baseURL?.trim() ?? '';
    const model = aiConfig.model?.trim() ?? '';

    if (!apiKey) {
      toast.error('请先填写 API Key');
      return;
    }
    if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
      toast.error('baseURL 必须以 http:// 或 https:// 开头');
      return;
    }
    if (!model) {
      toast.error('请填写模型名');
      return;
    }

    const w = window as unknown as {
      agent?: {
        testConnection: (config: LLMConfig) => Promise<TestConnectionResult>;
      };
    };
    if (typeof w.agent === 'undefined' || !w.agent?.testConnection) {
      toast.error('Agent 服务尚未就绪');
      return;
    }

    setTesting(true);
    try {
      const result = await w.agent.testConnection(aiConfig);
      if (result.success) {
        toast.success(`连接成功（耗时 ${result.latencyMs ?? '?'}ms）`);
      } else {
        // 按 code 显示对应提示
        switch (result.code) {
          case 'no_api_key':
            toast.error('请先填写 API Key');
            break;
          case 'invalid_baseURL':
            toast.error('baseURL 必须以 http:// 或 https:// 开头');
            break;
          case 'invalid_model':
            toast.error('请填写模型名');
            break;
          case 'invalid_api_key':
            toast.error('API Key 无效或已过期');
            break;
          case 'rate_limit':
            toast.error('请求过于频繁，请稍后重试');
            break;
          case 'network':
            toast.error(result.message ?? '网络连接失败');
            break;
          case 'timeout':
            toast.error(result.message ?? '请求超时（15s），请检查网络或更换 LLM 服务');
            break;
          default:
            toast.error(result.message ?? '测试连接失败');
            break;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  // ====== Task 48：工具确认规则 ======
  // 加载工具确认规则（无配置时主进程返回默认规则）
  const loadConfirmRules = async () => {
    const api = getAgentConfigAPI();
    if (!api) {
      // Agent 服务未就绪：使用本地默认规则占位，避免界面空白
      setConfirmRules(buildDefaultConfirmRules());
      return;
    }
    setConfirmRulesLoading(true);
    try {
      const res = await api.getConfirmRules();
      if (res.success && Array.isArray(res.data)) {
        setConfirmRules(res.data);
      }
    } catch {
      // 静默失败，保留空数组
    } finally {
      setConfirmRulesLoading(false);
    }
  };

  useEffect(() => {
    void loadConfirmRules();
  }, []);

  // 切换单个工具的确认规则（乐观更新 + 实时保存）
  const handleToggleConfirmRule = async (toolName: string, requireConfirm: boolean) => {
    const prev = confirmRules;
    // 计算新规则：若已存在则更新，否则追加
    const exists = prev.some((r) => r.toolName === toolName);
    const next = exists
      ? prev.map((r) => (r.toolName === toolName ? { ...r, requireConfirm } : r))
      : [...prev, { toolName, requireConfirm }];
    setConfirmRules(next); // 乐观更新
    setConfirmRulesSaving(true);
    try {
      const api = getAgentConfigAPI();
      if (!api) {
        toast.error('Agent 服务未就绪，无法保存');
        setConfirmRules(prev); // 回滚
        return;
      }
      const res = await api.setConfirmRules(next);
      if (!res.success) {
        throw new Error(res.error || '保存失败');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
      setConfirmRules(prev); // 回滚
    } finally {
      setConfirmRulesSaving(false);
    }
  };

  // 恢复默认确认规则（按 riskLevel 重置）
  const handleResetConfirmRules = async () => {
    const defaultRules = buildDefaultConfirmRules();
    const prev = confirmRules;
    setConfirmRules(defaultRules); // 乐观更新
    setConfirmRulesSaving(true);
    try {
      const api = getAgentConfigAPI();
      if (!api) {
        toast.error('Agent 服务未就绪，无法保存');
        setConfirmRules(prev); // 回滚
        return;
      }
      const res = await api.setConfirmRules(defaultRules);
      if (!res.success) {
        throw new Error(res.error || '恢复默认失败');
      }
      toast.success('已恢复为默认确认规则');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '恢复默认失败');
      setConfirmRules(prev); // 回滚
    } finally {
      setConfirmRulesSaving(false);
    }
  };

  // ====== 清空所有 Agent 会话 ======
  // Modal.confirm 二次确认后调用 agentSessionStore.clearAllSessions，
  // 由 store 内部调用 API + 重置会话列表/当前会话/消息。
  const handleClearAllAgentSessions = () => {
    Modal.confirm({
      title: '确认清空所有 Agent 会话',
      content: '将删除全部会话及消息，不可恢复。',
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const ok = await useAgentSessionStore.getState().clearAllSessions();
        if (ok) {
          toast.success('已清空所有 Agent 会话');
        } else {
          toast.error('清空失败');
        }
      }
    });
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

  // ====== 录音存放位置 ======
  const refreshRecDir = async () => {
    try {
      const res = await window.recordingAPI.getDir();
      if (res.success && res.data) {
        setRecDirEffective(res.data.effective);
        setRecDirConfigured(!!res.data.configured);
      }
    } catch {
      // ignore
    }
  };

  const handlePickRecDir = async () => {
    setRecDirPicking(true);
    try {
      const res = await window.recordingAPI.pickDir();
      if (res.success && res.data) {
        await window.settingsAPI.set(RECORDING_DIR_KEY, res.data);
        toast.success('录音目录已更新');
      } else if (res.success) {
        toast.info('已取消选择');
      } else {
        toast.error(res.error || '选择目录失败');
      }
      await refreshRecDir();
    } finally {
      setRecDirPicking(false);
    }
  };

  const handleResetRecDir = async () => {
    await window.settingsAPI.set(RECORDING_DIR_KEY, '');
    toast.success('已恢复默认录音目录');
    await refreshRecDir();
  };

  // 录音分段模式：切换后立即持久化
  const handleRecSegmentModeChange = async (v: 'whole' | 'split') => {
    setRecSegmentMode(v);
    await window.settingsAPI.set(RECORDING_SEGMENT_KEY, v);
    toast.success(v === 'split' ? '已切换为按环节分段' : '已切换为整场一轨');
  };

  // 录音格式：切换后立即持久化到 settings 'recording.format'
  const handleRecFormatChange = async (v: 'wav' | 'webm' | 'm4a') => {
    setRecFormat(v);
    await window.settingsAPI.set(RECORDING_FORMAT_KEY, v);
    const label = v === 'wav' ? 'WAV（可拖动进度条）' : v === 'm4a' ? 'M4A（AAC · 体积小且可拖）' : 'WebM（体积小，进度条不可拖）';
    toast.success(`已切换为 ${label}`);
  };

  // 录音格式：本页加载时读取，缺失/未识别默认 'wav'
  useEffect(() => {
    void (async () => {
      try {
        const res = await window.settingsAPI.get(RECORDING_FORMAT_KEY);
        setRecFormat(resolveRecordingFormat(res.data));
      } catch {
        // 静默失败
      }
    })();
  }, []);

  useEffect(() => {
    void refreshRecDir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 转到「通用」Tab 时刷新 STT 存放目录
  useEffect(() => {
    if (activeTab === 'basic') void refreshSttDir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ====== AI 转写（STT）：引擎状态 / 下载 / 取消 / 删除 ======
  const refreshSttStatus = useCallback(async (model: string) => {
    try {
      const res = await window.sttAPI.status(model);
      if (res.success && res.data) setSttStatus(res.data);
    } catch {
      // 静默失败
    }
  }, []);

  // 切到「通用」Tab 或模型变化时刷新本地引擎状态
  useEffect(() => {
    if (activeTab === 'basic') void refreshSttStatus(sttModel);
  }, [activeTab, sttModel, refreshSttStatus]);

  // 下载进行中轮询进度（stt:status 返回模块级实时进度）
  useEffect(() => {
    if (!sttDownloading) return;
    const timer = setInterval(() => void refreshSttStatus(sttModel), 600);
    return () => clearInterval(timer);
  }, [sttDownloading, sttModel, refreshSttStatus]);

  // 引擎选择：切换后立即持久化到 settings（后端缺省也从未通过 req 传）
  const handleSttEngineChange = async (v: SttEngine) => {
    setSttEngine(v);
    try {
      await settingsStore.set(STT_ENGINE_KEY, v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存引擎选择失败');
    }
  };

  // 模型选择：持久化 + 刷新对应模型状态
  const handleSttModelChange = async (v: string) => {
    setSttModel(v);
    try {
      await settingsStore.set(STT_MODEL_KEY, v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存模型选择失败');
    }
    await refreshSttStatus(v);
  };

  // 下载转写引擎（二进制 + 模型）
  const handleSttDownload = async () => {
    setSttDownloading(true);
    try {
      const res = await window.sttAPI.download(sttModel);
      if (!res.success) throw new Error(res.error || '下载失败');
      toast.success(`转写引擎下载完成（模型 ${sttModel}）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载失败');
    } finally {
      setSttDownloading(false);
      await refreshSttStatus(sttModel);
    }
  };

  const handleSttCancelDownload = async () => {
    setSttDownloading(false);
    try {
      await window.sttAPI.cancelDownload();
      toast.info('已取消下载');
    } catch {
      // ignore
    }
    await refreshSttStatus(sttModel);
  };

  const handleSttRemove = async () => {
    try {
      const res = await window.sttAPI.remove();
      if (!res.success) throw new Error(res.error || '删除失败');
      toast.success('已删除本地转写引擎');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
    await refreshSttStatus(sttModel);
  };

  // 导入本地 whisper 模型（ggml-<model>.bin，离线兜底）
  const handleSttImport = async () => {
    try {
      const res = await window.sttAPI.importLocalModel();
      if (res?.ok) {
        toast.success(`已导入本地模型（${res.model ?? '未知模型'}）`);
      } else if (res?.error) {
        toast.error(res.error);
      }
      // 用户取消（ok:false 且无 error）静默
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入本地模型失败');
    } finally {
      await refreshSttStatus(sttModel);
    }
  };

  // 手动选择本机已有的 whisper 转写器（whisper-cli，离线兜底，规避 bench 错选/网络不可达）
  const handleWhisperPick = async () => {
    try {
      const s = await window.sttAPI.pickWhisperCli();
      if (s?.binaryOk) toast.success('已使用本机 whisper 转写器');
      else toast.error(s?.error || '所选 whisper 不可用（可能缺少配套 DLL，或仍是 bench 版）');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '选择失败');
    }
    await refreshSttStatus(sttModel);
  };
  const handleWhisperClear = async () => {
    try {
      await window.sttAPI.clearWhisperCli();
      toast.info('已清除手动 whisper 路径');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清除失败');
    }
    await refreshSttStatus(sttModel);
  };

  // 刷新 FunASR 本地引擎运行环境状态
  const refreshSttFunAsrStatus = useCallback(async () => {
    try {
      const s = await window.sttAPI.funasrStatus();
      if (s) setSttFunAsrStatus(s);
    } catch {
      // 静默失败
    }
  }, []);

  // 切到「通用」Tab 时刷新 FunASR 状态
  useEffect(() => {
    if (activeTab === 'basic') void refreshSttFunAsrStatus();
  }, [activeTab, refreshSttFunAsrStatus]);

  // 本地引擎实现选择：持久化 + 按引擎刷新对应状态（whisper 恢复 whisper 状态，funasr 显示 funasr 状态）
  const handleSttLocalEngineChange = async (v: SttLocalEngine) => {
    setSttLocalEngine(v);
    try {
      await settingsStore.set(STT_LOCAL_ENGINE_KEY, v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存本地引擎选择失败');
    }
    if (v === 'funasr') await refreshSttFunAsrStatus();
    else await refreshSttStatus(sttModel);
  };

  // FunASR 模型选择：持久化 + 刷新对应模型状态
  const handleSttFunAsrModelChange = async (v: string) => {
    setSttFunAsrModel(v);
    try {
      await settingsStore.set(STT_FUNASR_MODEL_KEY, v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存 FunASR 模型选择失败');
    }
    await refreshSttFunAsrStatus();
  };

  // 一键安装 FunASR 依赖（pip install funasr）
  const handleFunAsrInstall = async () => {
    if (funAsrInstalling) return;
    setFunAsrInstalling(true);
    try {
      const res = await window.sttAPI.funasrInstall();
      if (res.ok) {
        toast.success(res.detail ?? '已安装 funasr 运行环境');
      } else {
        toast.error(res.detail ?? '安装失败');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '安装 FunASR 失败');
    } finally {
      setFunAsrInstalling(false);
      await refreshSttFunAsrStatus();
    }
  };

  // ====== AI 转写（STT）：ffmpeg 转码器 状态 / 下载 / 取消 / 删除 ======
  const refreshSttFfmpegStatus = useCallback(async () => {
    try {
      const s = await window.sttAPI.ffmpegStatus();
      if (s) setSttFfmpegStatus(s);
    } catch {
      // 静默失败
    }
  }, []);

  // 切到「通用」Tab 时刷新 ffmpeg 状态
  useEffect(() => {
    if (activeTab === 'basic') void refreshSttFfmpegStatus();
  }, [activeTab, refreshSttFfmpegStatus]);

  // ffmpeg 下载进行中轮询进度（stt:ffmpeg-status 返回实时进度）
  useEffect(() => {
    if (!sttFfmpegDownloading) return;
    const timer = setInterval(() => void refreshSttFfmpegStatus(), 600);
    return () => clearInterval(timer);
  }, [sttFfmpegDownloading, refreshSttFfmpegStatus]);

  const handleFfmpegDownload = async () => {
    setSttFfmpegDownloading(true);
    try {
      const s = await window.sttAPI.downloadFfmpeg();
      if (s?.error) throw new Error(s.error);
      toast.success('转码器（ffmpeg）下载完成');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ffmpeg 下载失败');
    } finally {
      setSttFfmpegDownloading(false);
      await refreshSttFfmpegStatus();
    }
  };

  const handleFfmpegCancelDownload = async () => {
    setSttFfmpegDownloading(false);
    try {
      const s = await window.sttAPI.cancelFfmpeg();
      if (s?.error) throw new Error(s.error);
      toast.info('已取消 ffmpeg 下载');
    } catch {
      // ignore
    }
    await refreshSttFfmpegStatus();
  };

  const handleFfmpegRemove = async () => {
    try {
      const s = await window.sttAPI.removeFfmpeg();
      if (s?.error) throw new Error(s.error);
      toast.success('已删除 ffmpeg 转码器');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
    await refreshSttFfmpegStatus();
  };

  // 手动选择本机已有 ffmpeg（网络不可用时的离线兜底）
  const handleFfmpegPick = async () => {
    try {
      const s = await window.sttAPI.pickFfmpegPath();
      if (s?.error) throw new Error(s.error);
      if (s?.installed) toast.success('已使用本机 ffmpeg');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '选择 ffmpeg 失败');
    }
    await refreshSttFfmpegStatus();
  };
  // 清除手动指定的 ffmpeg 路径
  const handleFfmpegClearPath = async () => {
    try {
      await window.sttAPI.clearFfmpegPath();
      toast.info('已清除手动 ffmpeg 路径');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清除失败');
    }
    await refreshSttFfmpegStatus();
  };

  // ====== AI 转写存放位置（STT 引擎目录） ======
  const refreshSttDir = async () => {
    try {
      const res = await window.settingsAPI.get(STT_DIR_KEY);
      const v = res?.data;
      setSttDirConfigured(typeof v === 'string' && v.trim() ? v.trim() : '');
    } catch {
      // 静默失败
    }
  };

  // T4：刷新 stt 目录诊断（有效路径 + whisper/ffmpeg/模型在位状况）
  const refreshSttDirDiagnostics = useCallback(async () => {
    try {
      const res = await window.sttAPI.sttDirDiagnostics();
      if (res.success && res.data) setSttDirDiagnostics(res.data);
    } catch {
      // 静默失败
    }
  }, []);

  // 转到「通用」Tab 时刷新 stt 目录诊断（展示 whisper/ffmpeg/模型在位状况）
  useEffect(() => {
    if (activeTab === 'basic') void refreshSttDirDiagnostics();
  }, [activeTab, refreshSttDirDiagnostics]);

  const handlePickSttDir = async () => {
    setSttDirPicking(true);
    try {
      const res = await window.recordingAPI.pickDir();
      if (res.success && res.data) {
        await window.settingsAPI.set(STT_DIR_KEY, res.data);
        toast.success('转写引擎目录已更新');
        await refreshSttStatus(sttModel);
      } else if (res.success) {
        toast.info('已取消选择');
      } else {
        toast.error(res.error || '选择目录失败');
      }
      await refreshSttDir();
    } finally {
      setSttDirPicking(false);
    }
  };

  const handleResetSttDir = async () => {
    await window.settingsAPI.set(STT_DIR_KEY, '');
    toast.success('已恢复默认转写引擎目录');
    await refreshSttDir();
    await refreshSttStatus(sttModel);
  };

  // ====== P2-8：铃声库 / 超时语音 ======
  const bellKitCurrent = getBellKitFromSettings(settingsStore.settings);
  const timeoutTts = getTimeoutTtsSetting(settingsStore.settings);

  const handleBellKitChange = async (id: string) => {
    try {
      await window.settingsAPI.set(BELL_KIT_KEY, id);
      toast.success('铃声库已切换，计时到点即刻生效');
    } catch {
      // 静默失败
    }
  };

  const handleTtsEnabledChange = async (checked: boolean) => {
    try {
      await window.settingsAPI.set(TIMEOUT_TTS_KEY, { ...timeoutTts, enabled: checked });
      toast.success(checked ? '已开启超时语音播报' : '已关闭超时语音播报');
    } catch {
      // 静默失败
    }
  };

  const handleTtsVolumeChange = async (volume: number) => {
    try {
      await window.settingsAPI.set(TIMEOUT_TTS_KEY, { ...timeoutTts, volume });
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

      {/* P2-8：铃声库 / 超时语音 */}
      <Card
        size="small"
        title={
          <Space>
            <BellOutlined style={{ color: '#1677ff' }} />
            <span>计时器铃声库与超时语音</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              铃声库：一键切换全应用（小屏/大屏）计时到点与预告铃声，无需改赛制
            </Text>
            <Select
              style={{ width: 360 }}
              value={bellKitCurrent.id}
              onChange={(v) => void handleBellKitChange(v)}
              options={BELL_KITS.map((k) => ({
                value: k.id,
                label: `${k.name} — ${k.description}`
              }))}
            />
          </div>
          <Divider style={{ margin: 0 }} />
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              超时语音警告：到点/某方超时时用本地语音播报（「时间到」「正方时间到」等），不联网
            </Text>
            <Space size="large">
              <span>
                <Switch
                  checked={timeoutTts.enabled}
                  onChange={(checked) => void handleTtsEnabledChange(checked)}
                />
                <Text style={{ marginLeft: 8 }}>开启超时语音播报</Text>
              </span>
              <span>
                <Text type="secondary">音量：</Text>
                <Slider
                  style={{ width: 220, display: 'inline-block', marginLeft: 8 }}
                  min={0}
                  max={100}
                  value={timeoutTts.volume}
                  onChange={(v) => void handleTtsVolumeChange(v)}
                />
              </span>
            </Space>
          </div>
        </Space>
      </Card>

      {/* 录音存放位置 */}
      <Card
        size="small"
        title={
          <Space>
            <AudioOutlined style={{ color: '#1677ff' }} />
            <span>录音存放位置</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">当前目录：</Text>
            <Text code>{recDirEffective || '加载中…'}</Text>
          </div>
          <Space>
            <Button onClick={() => void handlePickRecDir()} loading={recDirPicking}>
              选择目录…
            </Button>
            <Button onClick={() => void handleResetRecDir()} disabled={!recDirConfigured}>
              恢复默认（用户数据目录）
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              比赛/计时录音的存放路径，可在设置中随时更换。
            </Text>
          </Space>
          <div>
            <Text type="secondary">录音分段：</Text>
            <Radio.Group
              value={recSegmentMode}
              onChange={(e) => void handleRecSegmentModeChange(e.target.value as 'whole' | 'split')}
              optionType="button"
              buttonStyle="solid"
              size="small"
            >
              <Radio value="whole">整场一轨</Radio>
              <Radio value="split">按环节分段</Radio>
            </Radio.Group>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              整场一轨为单一录音；按环节分段会在每个环节切换时独立成轨。
            </Text>
          </div>
          <div>
            <Text type="secondary">录音格式：</Text>
            <div style={{ marginTop: 4 }}>
              <Radio.Group
                value={recFormat}
                onChange={(e) => void handleRecFormatChange(e.target.value as 'wav' | 'webm' | 'm4a')}
              >
                <Radio value="wav">WAV（可拖动进度条 · 体积大 · 推荐）</Radio>
                <br />
                <Radio value="webm">WebM（体积小 · 进度条不可拖动）</Radio>
                <br />
                <Radio value="m4a" disabled={!m4aSupported}>M4A（AAC · 体积小且可拖动）{!m4aSupported && ' · 当前系统不支持'}</Radio>
              </Radio.Group>
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              WAV 录音可拖动进度条但体积较大（推荐）；M4A（AAC）体积小且可拖动；WebM 体积更小但进度条不可拖动。
            </Text>
          </div>
        </Space>
      </Card>

      {/* AI 转写（录音转文字） */}
      <Card
        size="small"
        title={
          <Space>
            <AudioOutlined style={{ color: '#1677ff' }} />
            <span>AI 转写（录音转文字）</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text type="secondary">转写引擎：</Text>
            <div style={{ marginTop: 4 }}>
              <Radio.Group
                value={sttEngine}
                onChange={(e) => void handleSttEngineChange(e.target.value as SttEngine)}
              >
                <Radio value="local-first">本地优先（免费离线）</Radio>
                <br />
                <Radio value="local">仅本地</Radio>
                <br />
                <Radio value="api">仅 API</Radio>
              </Radio.Group>
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              本地优先：先用本地 Whisper，本地缺失或转写失败时自动用已配置的 AI API 兜底。
            </Text>
          </div>

          <div>
            <Text type="secondary">本地引擎（本地实现）：</Text>
            <div style={{ marginTop: 4 }}>
              <Select
                style={{ width: 320 }}
                value={sttLocalEngine}
                onChange={(v) => void handleSttLocalEngineChange(v as SttLocalEngine)}
                options={[
                  { value: 'whisper', label: 'whisper.cpp（本地离线）' },
                  { value: 'funasr', label: 'FunASR（阿里 · 需 Python 环境）' }
                ]}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              whisper.cpp 全程本地离线；FunASR 需本机已装 Python + funasr 包，两者不可同时作为本地实现。
            </Text>
          </div>

          <div>
            <Text type="secondary">存放位置：</Text>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">当前目录：</Text>
              <Text code>{sttDirConfigured || '默认 userData/stt'}</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Space>
                <Button onClick={() => void handlePickSttDir()} loading={sttDirPicking}>
                  选择目录…
                </Button>
                <Button onClick={() => void handleResetSttDir()} disabled={!sttDirConfigured}>
                  恢复默认（用户数据目录）
                </Button>
              </Space>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                选择数据根目录后，转写数据（模型/转码器）将存放在该目录下的 stt 子目录；默认 userData/stt。
              </Text>
            </div>
          </div>

          {sttLocalEngine === 'whisper' ? (
            <div>
              <Text type="secondary">转写模型：</Text>
              <div style={{ marginTop: 4 }}>
                <Select
                  style={{ width: 320 }}
                  value={sttModel}
                  onChange={(v) => void handleSttModelChange(v)}
                  options={(WHISPER_MODELS as readonly string[]).map((m) => ({
                    value: m,
                    label:
                      m === 'base'
                        ? 'base（约 142MB · 推荐）'
                        : m === 'small'
                          ? 'small（体积更大 · 更精准）'
                          : 'medium（体积更大 · 中文更准）'
                  }))}
                />
              </div>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                模型文件随引擎一起下载，切换模型后需重新下载对应文件才可使用该模型的本地转写。small 属入门级，medium 更准。
              </Text>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                模型下载需网络。无网络或镜像不可达时，可“导入本地模型”（ggml-*.bin），或改用“仅 API”。
              </Text>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 2, display: 'block' }}>
                本地 whisper 不支持 m4a/webm 解码：本地转写建议用 WAV 录音；若用 m4a 请把引擎设为“仅 API”。
              </Text>
            </div>
          ) : (
            <div>
              <Text type="secondary">FunASR 模型：</Text>
              <div style={{ marginTop: 4 }}>
                <Select
                  style={{ width: 320 }}
                  value={sttFunAsrModel}
                  onChange={(v) => void handleSttFunAsrModelChange(v)}
                  options={(FUNASR_MODELS as readonly string[]).map((m) => ({
                    value: m,
                    label: m === 'paraformer-zh' ? 'paraformer-zh（推荐 · 中文）' : 'sensevoicesmall-zh（体积更小）'
                  }))}
                />
              </div>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                FunASR 模型由本机 funasr 首次运行时自动拉取（需联网），无需在此单独下载；若未装运行环境请先 pip install funasr。
              </Text>
            </div>
          )}

          <div>
            <Text type="secondary">本地引擎状态：</Text>
            <div style={{ marginTop: 6 }}>
              {sttLocalEngine === 'whisper' ? (
                sttStatus ? (
                  sttStatus.downloading || sttDownloading ? (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Progress
                        percent={Math.round(sttStatus.progress ?? 0)}
                        size="small"
                        status="active"
                      />
                      <Space>
                        <Button loading>正在下载（模型 {sttModel}）…</Button>
                        <Button danger onClick={() => void handleSttCancelDownload()}>
                          取消下载
                        </Button>
                      </Space>
                    </Space>
                  ) : sttStatus.installed ? (
                    <Space wrap>
                      <Tag color="green" icon={<CheckCircleOutlined />}>已安装</Tag>
                      <span style={{ fontSize: 12 }}>
                        模型 {sttStatus.model ?? sttModel} · 体积 {formatSize(sttStatus.fileSize)}
                      </span>
                      <Button onClick={() => void refreshSttStatus(sttModel)}>刷新</Button>
                      <Button icon={<ImportOutlined />} onClick={() => void handleSttImport()}>
                        导入本地模型
                      </Button>
                      <Button icon={<FolderOpenOutlined />} onClick={() => void handleWhisperPick()}>
                        选择本机 whisper 转写器
                      </Button>
                      <Button onClick={() => void handleWhisperClear()}>清除手动路径</Button>
                      <Popconfirm
                        title="确认删除本地转写引擎？"
                        description="将删除 whisper 二进制与「当前模型」，不影响其它模型与 ffmpeg 转码器。"
                        onConfirm={() => void handleSttRemove()}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ) : (
                    <Space wrap>
                      <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void handleSttDownload()}>
                        下载转写引擎（模型 {sttModel}）
                      </Button>
                      <Button icon={<ImportOutlined />} onClick={() => void handleSttImport()}>
                        导入本地模型
                      </Button>
                      <Button icon={<FolderOpenOutlined />} onClick={() => void handleWhisperPick()}>
                        选择本机 whisper 转写器
                      </Button>
                    </Space>
                  )
                ) : (
                  <Button onClick={() => void refreshSttStatus(sttModel)}>检查引擎状态</Button>
                )
              ) : (
                <div>
                  {sttFunAsrStatus ? (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Space wrap>
                        {sttFunAsrStatus.envOk ? (
                          <Tag color="green" icon={<CheckCircleOutlined />}>
                            FunASR 运行环境就绪（需 Python + funasr）
                          </Tag>
                        ) : (
                          <Tag color="red">FunASR 运行环境未就绪</Tag>
                        )}
                        <span style={{ fontSize: 12 }}>模型 {sttFunAsrStatus.model ?? sttFunAsrModel}</span>
                        <Button onClick={() => void refreshSttFunAsrStatus()}>刷新</Button>
                      </Space>
                      {!sttFunAsrStatus.envOk &&
                        (sttFunAsrStatus.missingDeps && sttFunAsrStatus.missingDeps.length > 0 ? (
                          <div>
                            <Text type="danger" style={{ fontSize: 12 }}>
                              已检测到 Python 与 funasr，但缺少推理依赖，真转写会因缺模块失败：
                            </Text>
                            <Space wrap style={{ marginTop: 6 }}>
                              {sttFunAsrStatus.missingDeps.map((dep) => (
                                <Tag color="red" key={dep}>{dep}</Tag>
                              ))}
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                              点击下方“一键安装 FunASR 依赖”补全后即可转写。
                            </Text>
                          </div>
                        ) : (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {sttFunAsrStatus.hasPython === false
                              ? '未检测到 Python：请先安装 Python（python.org 勾选 “Add to PATH” 或微软商店），装好后回到本页点击“一键安装 FunASR 依赖”。'
                              : sttFunAsrStatus.hasPython === true
                                ? '已检测到 Python，但缺少 funasr 包 → 点击“一键安装 FunASR 依赖”。'
                                : '需安装 Python 并执行 pip install funasr，首次使用会自动拉取模型；或切回 whisper.cpp 本地引擎。'}
                          </Text>
                        ))}
                      {!sttFunAsrStatus.envOk && (
                        <Button
                          type="primary"
                          loading={funAsrInstalling}
                          disabled={funAsrInstalling}
                          onClick={() => void handleFunAsrInstall()}
                        >
                          {funAsrInstalling ? '正在安装（pip install funasr）…' : '一键安装 FunASR 依赖'}
                        </Button>
                      )}
                    </Space>
                  ) : (
                    <Button onClick={() => void refreshSttFunAsrStatus()}>检查 FunASR 环境</Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <Text type="secondary">转码器（ffmpeg）状态：</Text>
            <div style={{ marginTop: 6 }}>
              {sttFfmpegStatus ? (
                sttFfmpegStatus.downloading || sttFfmpegDownloading ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Progress
                      percent={Math.round(sttFfmpegStatus.progress ?? 0)}
                      size="small"
                      status="active"
                    />
                    {sttFfmpegStatus.error && (
                      <Text type="danger" style={{ fontSize: 12 }}>{sttFfmpegStatus.error}</Text>
                    )}
                    <Space>
                      <Button loading>正在下载转码器…</Button>
                      <Button danger onClick={() => void handleFfmpegCancelDownload()}>
                        取消下载
                      </Button>
                    </Space>
                  </Space>
                ) : sttFfmpegStatus.installed ? (
                  <Space wrap>
                    <Tag color="green" icon={<CheckCircleOutlined />}>已安装</Tag>
                    <span style={{ fontSize: 12 }}>
                      体积 {formatSize(sttFfmpegStatus.fileSize)}
                    </span>
                    <Button onClick={() => void refreshSttFfmpegStatus()}>刷新</Button>
                    <Button onClick={() => void handleFfmpegPick()}>选择本机已有 ffmpeg</Button>
                    <Button onClick={() => void handleFfmpegClearPath()}>清除手动路径</Button>
                    <Popconfirm
                      title="确认删除 ffmpeg 转码器？"
                      description="将删除已下载的 ffmpeg 二进制（不增大安装包）。"
                      onConfirm={() => void handleFfmpegRemove()}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button danger>删除</Button>
                    </Popconfirm>
                  </Space>
                ) : (
                  <Space wrap>
                    <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void handleFfmpegDownload()}>
                      下载转码器
                    </Button>
                    <Button onClick={() => void handleFfmpegPick()}>选择本机已有 ffmpeg</Button>
                    {sttFfmpegStatus.error && (
                      <Text type="danger" style={{ fontSize: 12 }}>下载提示：{sttFfmpegStatus.error}</Text>
                    )}
                  </Space>
                )
              ) : (
                <Button onClick={() => void refreshSttFfmpegStatus()}>检查转码器状态</Button>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              m4a/webm 本地转写需 ffmpeg 转码器（免费，按需下载，不增大安装包）；无 ffmpeg 时自动回退 AI API。
            </Text>
          </div>

          <Alert
            type="info"
            showIcon
            banner
            message="转写引擎（Whisper）不在安装包内，首次使用时按需下载到本地，不会增大应用安装包体积。"
          />
        </Space>
      </Card>

      {/* T4：转写数据目录（stt 目录 + whisper/ffmpeg/模型在位状况 + 缺失时引导找回） */}
      <Card
        size="small"
        title={
          <Space>
            <FolderOpenOutlined style={{ color: '#1677ff' }} />
            <span>转写数据目录</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
      >
        {sttDirDiagnostics ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Text type="secondary">目录路径：</Text>
              <Text code>{sttDirDiagnostics.path || '未知'}</Text>
            </div>
            <div>
              <Text type="secondary">whisper 转写器：</Text>
              {sttDirDiagnostics.hasWhisperCli ? (
                <Tag color="green" icon={<CheckCircleOutlined />}>已就位</Tag>
              ) : (
                <Tag color="red">缺失</Tag>
              )}
            </div>
            <div>
              <Text type="secondary">ffmpeg 转码器：</Text>
              {sttDirDiagnostics.hasFfmpeg ? (
                <Tag color="green" icon={<CheckCircleOutlined />}>已就位</Tag>
              ) : (
                <Tag color="red">缺失</Tag>
              )}
            </div>
            <div>
              <Text type="secondary">已下载模型：</Text>
              <div style={{ marginTop: 4 }}>
                {sttDirDiagnostics.models && sttDirDiagnostics.models.length > 0 ? (
                  <Space wrap>
                    {sttDirDiagnostics.models.map((m) => (
                      <Tag key={m} color="blue">{m}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">无</Text>
                )}
              </div>
            </div>
            {(!sttDirDiagnostics.hasWhisperCli || !sttDirDiagnostics.hasFfmpeg) && (
              <Alert
                type="warning"
                showIcon
                message="转写数据缺失或未就位"
                description="可能因应用更新等操作被清除。可在上方“下载转写引擎 / 下载转码器”重新下载，或用“选择本机 whisper 转写器 / 选择本机已有 ffmpeg”从本地文件找回。"
              />
            )}
          </Space>
        ) : (
          <Button onClick={() => void refreshSttDirDiagnostics()}>检查转写数据目录</Button>
        )}
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

  // ====== 渲染：AI 助手 Tab（LLM 配置） ======
  const renderAITab = () => (
    <div>
      <Alert
        message="AI 助手"
        description="配置内置 AI 助手的 LLM 服务。配置后可在应用内与 AI 对话，辅助辩题分析、赛事筹备等。"
        type="info"
        showIcon
        banner
        style={{ marginBottom: spacing.md }}
      />

      <AccentCard
        size="small"
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>LLM 配置</span>
          </Space>
        }
        style={{ marginBottom: spacing.md, background: token.colorBgContainer, ...cardStyle }}
      >
        <Form layout="vertical">
          <Form.Item label="启用 AI 助手" tooltip="关闭后将隐藏 AI 助手入口，可随时重新开启">
            <Switch
              checked={aiAssistantEnabled}
              onChange={(v) => setAIAssistantEnabled(v)}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            message="隐私提示"
            description="你的对话内容将发送到所配置的 LLM 服务并存储在本地。API Key 仅存储在本地，不会上传到任何服务器。"
            style={{ marginBottom: 16 }}
          />

          <Form.Item label="服务商" tooltip="选择 LLM 服务商，切换后自动预填 baseURL 与模型（自定义不预填）">
            <Select
              value={aiConfig.provider}
              onChange={(provider: LLMProvider) => {
                const preset = LLM_PROVIDER_PRESETS[provider];
                setAIConfig({
                  provider,
                  baseURL: preset.baseURL,
                  model: preset.model
                });
              }}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'qwen', label: '通义千问' },
                { value: 'kimi', label: 'Kimi' },
                { value: 'zhipu', label: '智谱清言' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'custom', label: '自定义' }
              ]}
            />
          </Form.Item>

          <Form.Item label="API Key" tooltip="LLM 服务的 API 密钥（sk-... 开头，依服务商而定）">
            <Input.Password
              value={aiConfig.apiKey}
              onChange={(e) => setAIConfig({ apiKey: e.target.value })}
              placeholder="sk-..."
              visibilityToggle
            />
          </Form.Item>

          <Form.Item label="Base URL" tooltip="OpenAI 兼容 API 的基础地址">
            <Input
              value={aiConfig.baseURL}
              onChange={(e) => setAIConfig({ baseURL: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </Form.Item>

          <Form.Item label="模型" tooltip="具体模型名，如 gpt-4o-mini / deepseek-chat">
            <Input
              value={aiConfig.model}
              onChange={(e) => setAIConfig({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </Form.Item>

          <Space>
            <Button
              loading={testing}
              onClick={handleTestConnection}
              icon={<PlayCircleOutlined />}
            >
              测试连接
            </Button>
          </Space>
        </Form>
      </AccentCard>

      {/* Task 48：工具确认规则 */}
      <AccentCard
        size="small"
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            <span>工具确认规则</span>
            <Tooltip title="配置 Agent 调用工具时是否需要人工确认">
              <InfoCircleOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
            </Tooltip>
          </Space>
        }
        style={{ background: token.colorBgContainer, ...cardStyle }}
      >
        <Paragraph type="secondary" style={{ marginBottom: spacing.md }}>
          配置 Agent 调用工具时是否需要人工确认。高风险工具建议保留确认。
        </Paragraph>

        <BrandSpin spinning={confirmRulesLoading}>
          {RISK_LEVEL_ORDER.map((level) => {
            const tools = TOOL_CONFIRM_METAS.filter((m) => m.riskLevel === level);
            const cfg = RISK_LEVEL_LABELS[level];
            return (
              <div key={level} style={{ marginBottom: spacing.sm }}>
                <Divider orientation="left" style={{ marginTop: 0, marginBottom: spacing.sm }}>
                  <Tag color={cfg.color}>{cfg.label}</Tag>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    默认{cfg.defaultRequireConfirm ? '需确认' : '无需确认'}
                  </Text>
                </Divider>
                <List
                  size="small"
                  dataSource={tools}
                  split={false}
                  renderItem={(tool) => {
                    const rule = confirmRules.find((r) => r.toolName === tool.toolName);
                    const checked = rule?.requireConfirm ?? cfg.defaultRequireConfirm;
                    return (
                      <List.Item
                        actions={[
                          <Tooltip
                            key="switch"
                            title={
                              checked ? '执行前将弹出确认框' : 'Agent 将直接执行，无需确认'
                            }
                          >
                            <Switch
                              size="small"
                              checked={checked}
                              onChange={(v) => handleToggleConfirmRule(tool.toolName, v)}
                              checkedChildren="确认"
                              unCheckedChildren="直通"
                            />
                          </Tooltip>
                        ]}
                      >
                        <List.Item.Meta
                          title={<Text code>{tool.toolName}</Text>}
                          description={tool.description}
                        />
                      </List.Item>
                    );
                  }}
                />
              </div>
            );
          })}

          <Space style={{ marginTop: spacing.sm }}>
            <Button
              icon={<UndoOutlined />}
              onClick={handleResetConfirmRules}
              loading={confirmRulesSaving}
            >
              恢复默认
            </Button>
          </Space>
        </BrandSpin>
      </AccentCard>

      {/* 数据管理：清空所有 Agent 会话 */}
      <AccentCard
        size="small"
        title={
          <Space>
            <DatabaseOutlined style={{ color: token.colorError }} />
            <span>数据管理</span>
          </Space>
        }
        style={{ marginTop: spacing.md, background: token.colorBgContainer, ...cardStyle }}
      >
        <Paragraph type="secondary" style={{ marginBottom: spacing.md }}>
          清空所有 Agent 会话及其消息记录。此操作不可恢复，请谨慎操作。
        </Paragraph>
        <Button
          danger
          icon={<RestOutlined />}
          onClick={handleClearAllAgentSessions}
        >
          清空所有 Agent 会话
        </Button>
      </AccentCard>
    </div>
  );

  // 左侧 Menu 项
  const menuItems = [
    { key: 'basic', icon: <SettingOutlined />, label: '通用' },
    { key: 'appearance', icon: <BulbOutlined />, label: '外观' },
    { key: 'data', icon: <DatabaseOutlined />, label: '数据' },
    { key: 'backup', icon: <CloudSyncOutlined />, label: '备份与迁移' },
    { key: 'hotkeys', icon: <KeyOutlined />, label: '快捷键' },
    { key: 'ai', icon: <RobotOutlined />, label: 'AI 助手' },
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
                  {activeTab === 'ai' && renderAITab()}
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
