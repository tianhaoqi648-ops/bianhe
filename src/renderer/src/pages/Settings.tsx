import { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Tabs,
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
  message,
  Spin,
  Tag,
  Progress,
  Modal,
  Checkbox,
  theme
} from 'antd';
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
  RestOutlined
} from '@ant-design/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useTopicStore } from '../stores/topicStore';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
import TagDisplaySettingsModal from '../components/TagDisplaySettingsModal';
import {
  statCardStyle,
  pageContainerStyle
} from '../styles/shared';
import { spacing } from '../styles/tokens';
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
  const [messageApi, contextHolder] = message.useMessage();

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

  // 危险操作：恢复初始设置
  const [resetModalOpen, setResetModalOpen] = useState(false);
  // 配置类：默认全选
  const [resetConfigCategories, setResetConfigCategories] = useState<ConfigResetCategory[]>(
    ['dedup', 'tagDisplay', 'candidates']
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
      messageApi.success('去重设置已保存');
      // 保存成功后短暂显示绿色 ✓
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '保存失败');
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
    messageApi.info('已恢复为默认设置，需点击"保存设置"后生效');
  };

  // ====== 数据导出 ======
  const handleExportTopics = async (format: ExportFormat) => {
    setExporting('topics');
    try {
      const res = await window.exportAPI.exportTopics({ format });
      if (!res.success) {
        throw new Error(res.error || '导出失败');
      }
      messageApi.success(`已导出 ${res.data?.count ?? 0} 条辩题到：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        messageApi.info('已取消');
      } else {
        messageApi.error(e instanceof Error ? e.message : '导出失败');
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
      messageApi.success(`已导出 ${res.data?.count ?? 0} 条记录到：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        messageApi.info('已取消');
      } else {
        messageApi.error(e instanceof Error ? e.message : '导出失败');
      }
    } finally {
      setExporting(null);
    }
  };

  // ====== 官方题库"检查更新" ======
  // 当前版本仅展示当前已加载的版本与数量；用户可点击"重新加载"清空标记并触发再次 seed
  const handleCheckOfficialUpdate = () => {
    messageApi.info(
      `当前版本：${officialInfo.version}，已加载 ${officialInfo.count} 道官方辩题。检查更新功能待后续版本支持。`
    );
  };

  const handleReloadOfficial = async () => {
    try {
      // 清空 seeded 标记，下次启动时重新 seed
      await settingsStore.set(KEYS.officialSeeded, false);
      messageApi.success('已重置官方题库标记，请重启应用以重新加载');
      setOfficialInfo((s) => ({ ...s, seeded: false }));
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  // ====== 一键恢复初始设置 ======
  const handleOpenResetModal = () => {
    // 默认配置类全选，数据类全不选
    setResetConfigCategories(['dedup', 'tagDisplay', 'candidates']);
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
      messageApi.warning('请至少选择一个要重置的类别');
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

      messageApi.success(`已恢复初始设置（${parts.join('，') || '无变更'}）`);
      setResetModalOpen(false);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '恢复失败');
    } finally {
      setResetting(false);
    }
  };

  // ====== 渲染各 Tab ======
  const renderDedupTab = () => (
    <Row justify="center">
      <Col xs={24} sm={24} md={20} lg={16} xl={16}>
        <Alert
          message="去重设置"
          description="配置 dedup-engine 在导入与去重检查时使用的阈值。文本匹配层始终可用；AI 语义层为可选项。"
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        <Form layout="vertical">
          <Card
            size="small"
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
      </Col>
    </Row>
  );

  const renderLibraryTab = () => (
    <div>
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

      <Card
        size="small"
        title={
          <Space>
            <UploadOutlined style={{ color: '#1677ff' }} />
            <span>题库导入</span>
          </Space>
        }
        style={{ marginBottom: spacing.md }}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<UploadOutlined />}
            onClick={() => setImportOpen(true)}
          >
            导入辩题
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          支持 Excel (.xlsx)、CSV (.csv)、Word (.docx) 三种格式。
          导入流程：选择文件 → 自动解析 → 预览映射 → 确认导入 → 显示结果报告。
        </Paragraph>
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <DownloadOutlined style={{ color: '#1677ff' }} />
            <span>题库导出</span>
          </Space>
        }
      >
        <Space wrap>
          <Button
            icon={<FileExcelOutlined />}
            loading={exporting === 'topics'}
            onClick={() => handleExportTopics('xlsx')}
          >
            导出为 Excel
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => handleExportTopics('csv')}
          >
            导出为 CSV
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => handleExportTopics('json')}
          >
            导出为 JSON
          </Button>
        </Space>
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <TagsOutlined style={{ color: '#1677ff' }} />
            <span>标签显示配置</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
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
          隐藏仅影响 UI 展示，不影响数据与抽题范围；编辑弹窗、导入预览不受影响。
        </Paragraph>
      </Card>
    </div>
  );

  const renderDataTab = () => (
    <div>
      <Alert
        message="数据导出与导入"
        description="可导出题库、抽取记录或赛事数据包；可从 Excel/CSV/Word 导入辩题。"
        type="info"
        showIcon
        banner
        style={{ marginBottom: spacing.md }}
      />

      <Row gutter={[spacing.lg, spacing.lg]}>
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

        {/* 右侧：数据导入 + 去重检查 */}
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
        </Col>
      </Row>
    </div>
  );

  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ ...pageContainerStyle, overflow: 'auto' }}>
          {/* 顶部工具栏 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              padding: 12,
              background: token.colorBgContainer,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            <Space>
              <SettingOutlined style={{ color: '#1677ff' }} />
              <Text strong>系统设置</Text>
            </Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void settingsStore.fetchAll();
                void loadTopicStats();
              }}
            >
              刷新
            </Button>
          </div>

          <Spin spinning={settingsStore.loading}>
            <Card size="small" style={{ background: token.colorBgContainer }}>
              <Tabs
                items={[
                  {
                    key: 'dedup',
                    label: (
                      <Space>
                        <SafetyCertificateOutlined />
                        <span>去重设置</span>
                      </Space>
                    ),
                    children: renderDedupTab()
                  },
                  {
                    key: 'library',
                    label: (
                      <Space>
                        <DatabaseOutlined />
                        <span>题库管理</span>
                      </Space>
                    ),
                    children: renderLibraryTab()
                  },
                  {
                    key: 'data',
                    label: (
                      <Space>
                        <DownloadOutlined />
                        <span>数据导入导出</span>
                      </Space>
                    ),
                    children: renderDataTab()
                  }
                ]}
              />
            </Card>
          </Spin>

          {/* 危险操作分区 */}
          <Card
            size="small"
            style={{
              marginTop: 16,
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
        </Content>
      </Layout>

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
    </>
  );
}

// ============================================================
// 赛事数据包导出子组件
// ============================================================
function EventPackageExport() {
  const [messageApi, contextHolder] = message.useMessage();
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
      messageApi.warning('请先选择赛事');
      return;
    }
    setExporting(true);
    try {
      const res = await window.exportAPI.exportEventPackage({ eventId: selectedId });
      if (!res.success) {
        throw new Error(res.error || '导出失败');
      }
      messageApi.success(`已导出赛事数据包：${res.data?.filePath ?? ''}`);
    } catch (e) {
      if (e instanceof Error && e.message === '用户取消保存') {
        messageApi.info('已取消');
      } else {
        messageApi.error(e instanceof Error ? e.message : '导出失败');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {contextHolder}
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
