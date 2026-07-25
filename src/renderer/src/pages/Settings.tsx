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
  Divider,
  Select,
  Popconfirm,
  message,
  Spin,
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
  FileTextOutlined
} from '@ant-design/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useTopicStore } from '../stores/topicStore';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
import type { ExportFormat } from '../../../shared/types';

const { Content } = Layout;
const { Text, Paragraph } = Typography;

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
  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [exporting, setExporting] = useState<null | 'topics' | 'sessions'>(null);

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
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
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

  // ====== 渲染各 Tab ======
  const renderDedupTab = () => (
    <div style={{ maxWidth: 720 }}>
      <Alert
        message="去重设置"
        description="配置 dedup-engine 在导入与去重检查时使用的阈值。文本匹配层始终可用；AI 语义层为可选项。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form layout="vertical">
        <Card size="small" title={<><SafetyCertificateOutlined /> 文本匹配层</>} style={{ marginBottom: 12 }}>
          <Form.Item label="启用文本匹配去重" tooltip="关闭后将跳过 Levenshtein 与关键词重合检测">
            <Switch
              checked={dedupEnabled}
              onChange={(v) => setDedupEnabled(v)}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>
          <Row gutter={16}>
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
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card size="small" title={<><ExperimentOutlined /> AI 语义层（可选）</>} style={{ marginBottom: 12 }}>
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
          </Form.Item>
          <Alert
            message="AI 语义层为可选功能"
            description="当前版本仅保存配置，AI 相似度函数尚未接入实际服务。后续版本将对接具体 API。"
            type="warning"
            showIcon
          />
        </Card>

        <Space>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={saving}
            onClick={handleSaveDedup}
          >
            保存设置
          </Button>
          <Button
            icon={<SafetyCertificateOutlined />}
            onClick={() => setDedupOpen(true)}
          >
            立即执行去重检查
          </Button>
        </Space>
      </Form>
    </div>
  );

  const renderLibraryTab = () => (
    <div style={{ maxWidth: 720 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="题库总数"
              value={topicStats.total}
              prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="官方题库"
              value={topicStats.official}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="内置版本"
              value={officialInfo.version}
              prefix={<SafetyCertificateOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已加载"
              value={officialInfo.seeded ? '是' : '否'}
              prefix={
                officialInfo.seeded ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <ReloadOutlined style={{ color: '#faad14' }} />
                )
              }
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="官方题库"
        style={{ marginBottom: 12 }}
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
        title="题库导入"
        style={{ marginBottom: 12 }}
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
        title="题库导出"
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
    </div>
  );

  const renderDataTab = () => (
    <div style={{ maxWidth: 720 }}>
      <Alert
        message="数据导出与导入"
        description="可导出题库、抽取记录或赛事数据包；可从 Excel/CSV/Word 导入辩题。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card
        size="small"
        title={<><DownloadOutlined /> 数据导出</>}
        style={{ marginBottom: 12 }}
      >
        <Divider orientation="left" plain style={{ marginTop: 0 }}>
          题库
        </Divider>
        <Space wrap style={{ marginBottom: 12 }}>
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

        <Divider orientation="left" plain>
          抽取记录
        </Divider>
        <Space wrap style={{ marginBottom: 12 }}>
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

        <Divider orientation="left" plain>
          赛事数据包（JSON）
        </Divider>
        <EventPackageExport />
      </Card>

      <Card
        size="small"
        title={<><UploadOutlined /> 数据导入</>}
        style={{ marginBottom: 12 }}
      >
        <Paragraph type="secondary">
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
        title={<><SafetyCertificateOutlined /> 去重检查</>}
      >
        <Paragraph type="secondary">
          对当前题库执行去重检查，发现并清理相似/重复辩题。
        </Paragraph>
        <Button
          type="primary"
          icon={<SafetyCertificateOutlined />}
          onClick={() => setDedupOpen(true)}
        >
          执行去重检查
        </Button>
      </Card>
    </div>
  );

  return (
    <>
      {contextHolder}
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Content style={{ padding: '0 16px 16px', overflow: 'auto' }}>
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
        </Content>
      </Layout>

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
