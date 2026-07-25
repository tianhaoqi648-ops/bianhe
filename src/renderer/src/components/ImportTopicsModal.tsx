import { useState, useEffect } from 'react';
import {
  Modal,
  Steps,
  Button,
  Space,
  Table,
  Alert,
  Typography,
  Result,
  Spin,
  message,
  notification,
  Tag
} from 'antd';
import {
  UploadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  DownloadOutlined,
  UndoOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type {
  ParsedResult,
  TopicCreateInput,
  ImportExecuteResult,
  ValueMapping
} from '../../../shared/types';
import type { CandidateField } from '../../../shared/constants';
import { spacing } from '../styles/tokens';
import { primaryButtonStyle } from '../styles/shared';
import ImportFormatGuide from './import/ImportFormatGuide';
import ValueMappingPanel from './import/ValueMappingPanel';
import { downloadImportTemplate } from '../utils/downloadImportTemplate';
import { applyMappingToTopics, isMappingValid } from '../utils/valueMapping';

const { Text } = Typography;

export interface ImportTopicsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 0 | 1 | 2 | 3;

const FILE_FILTERS = [
  { name: 'Excel / CSV / Word', extensions: ['xlsx', 'csv', 'docx'] }
];

// ============================================================
// warnings 分类：按内容前缀判断严重级别，便于在 UI 上区分展示
// ============================================================

type WarningLevel = 'error' | 'warning' | 'info';

/**
 * 根据单条 warning 文本判断严重级别：
 *   - error：阻断性错误（如「未识别到 title 列」「无法解析」「工作表为空」）
 *   - info：信息性提示（如「当前导入的是第 N 张工作表」「不在系统候选值内」）
 *   - warning：其他一般警告（如「第 N 行 title 为空」「表格无标准表头」）
 */
function classifyWarning(w: string): WarningLevel {
  if (
    w.includes('未识别到') ||
    w.includes('无法解析') ||
    w.includes('工作表为空') ||
    w.includes('工作簿无任何工作表')
  ) {
    return 'error';
  }
  if (w.includes('不在系统候选值内') || w.includes('当前导入的是第')) {
    return 'info';
  }
  return 'warning';
}

/** 取一组 warnings 的最严重级别（error > warning > info） */
function getOverallLevel(warnings: string[]): WarningLevel {
  if (warnings.some((w) => classifyWarning(w) === 'error')) return 'error';
  if (warnings.some((w) => classifyWarning(w) === 'warning')) return 'warning';
  return 'info';
}

/** WarningLevel → Antd Tag color 映射 */
const LEVEL_COLOR: Record<WarningLevel, string> = {
  error: 'red',
  warning: 'orange',
  info: 'blue'
};

/** WarningLevel → 中文标签 */
const LEVEL_LABEL: Record<WarningLevel, string> = {
  error: '错误',
  warning: '警告',
  info: '提示'
};

export default function ImportTopicsModal({ open, onClose, onSuccess }: ImportTopicsModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [notificationApi, notificationHolder] = notification.useNotification();
  const [step, setStep] = useState<Step>(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'xlsx' | 'csv' | 'docx' | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);
  // 新值映射状态：用户在 Step 2 预览页配置，handleImport 时应用
  const [valueMapping, setValueMapping] = useState<ValueMapping>({});
  // 合并后的系统候选值（系统候选 + 用户扩展），供 ValueMappingPanel 显示已有候选
  const [mergedCandidates, setMergedCandidates] = useState<
    Record<CandidateField, string[]> | null
  >(null);

  // 弹窗打开时拉取合并后的候选值（含用户扩展），供 ValueMappingPanel 显示
  useEffect(() => {
    if (!open) return;
    window.settingsAPI
      .getCandidates()
      .then((res) => {
        if (res.success && res.data) {
          setMergedCandidates(res.data as Record<CandidateField, string[]>);
        }
      })
      .catch(() => {
        // 拉取失败不阻断流程，ValueMappingPanel 不显示（mergedCandidates 保持 null）
      });
  }, [open]);

  const reset = () => {
    setStep(0);
    setFilePath(null);
    setFileType(null);
    setParsed(null);
    setImportResult(null);
    setParsing(false);
    setImporting(false);
    setValueMapping({});
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---------- 步骤 1：选择文件 ----------
  const handlePickFile = async () => {
    try {
      const picked = await window.fileAPI.pickFile(FILE_FILTERS);
      if (!picked) return;
      const ext = picked.toLowerCase().split('.').pop();
      if (ext !== 'xlsx' && ext !== 'csv' && ext !== 'docx') {
        messageApi.error('仅支持 .xlsx / .csv / .docx 文件');
        return;
      }
      setFilePath(picked);
      setFileType(ext);
      setStep(1);
      // 自动开始解析
      void parseFile(picked, ext);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '选择文件失败');
    }
  };

  // ---------- 步骤 2：解析文件 ----------
  const parseFile = async (path: string, ext: 'xlsx' | 'csv' | 'docx') => {
    setParsing(true);
    try {
      const res = await window.importAPI.parseFile(path, ext);
      if (!res.success || !res.data) {
        throw new Error(res.error || '解析失败');
      }
      setParsed(res.data);
      setStep(2);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '解析失败');
      setStep(1);
    } finally {
      setParsing(false);
    }
  };

  // ---------- 步骤 3：执行导入 ----------
  const handleImport = async () => {
    if (!parsed || parsed.topics.length === 0) return;
    // 校验新值映射完整性：所有 action='map' 必须有非空 target
    const { valid, invalidFields } = isMappingValid(valueMapping);
    if (!valid) {
      const desc = invalidFields
        .map((f) => `${f.field}: "${f.value}" 未选择目标值`)
        .join('；');
      messageApi.error(`映射不完整：${desc}`);
      return;
    }
    setImporting(true);
    try {
      const currentFileName = filePath ? filePath.split(/[\\/]/).pop() : '';
      // 应用映射：action='map' 改写 field 值；keep/add 不改写
      // add 动作由主进程在 createMany 前持久化到 settings 表
      const finalTopics = applyMappingToTopics(parsed.topics, valueMapping);
      const res = await window.importAPI.execute({
        topics: finalTopics,
        checkDuplicates: true,
        fileName: currentFileName,
        valueMapping
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || '导入失败');
      }
      setImportResult(res.data);
      setStep(3);
      // 导入成功 notification 带「撤销导入」按钮（仅当有 batchId 时）
      if (res.data.batchId) {
        const batchId = res.data.batchId;
        const notifKey = `import-undo-${Date.now()}`;
        notificationApi.open({
          key: notifKey,
          type: 'success',
          message: `成功导入 ${res.data.imported} 条辩题`,
          duration: 8,
          btn: (
            <Button
              size="small"
              danger
              onClick={async () => {
                try {
                  const revokeRes = await window.importAPI.revokeBatch(batchId);
                  if (!revokeRes.success || !revokeRes.data) {
                    throw new Error(revokeRes.error || '撤销失败');
                  }
                  notificationApi.destroy(notifKey);
                  messageApi.success(
                    `已撤销本次导入（删除 ${revokeRes.data.deletedCount} 条）`
                  );
                  onSuccess?.();
                  onClose();
                } catch (e) {
                  messageApi.error(e instanceof Error ? e.message : '撤销失败');
                }
              }}
            >
              撤销导入
            </Button>
          )
        });
      } else {
        messageApi.success(`成功导入 ${res.data.imported} 条辩题`);
      }
      onSuccess?.();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  // ---------- Step 3 完成页撤销本次导入 ----------
  const handleRevokeFromResult = () => {
    if (!importResult?.batchId) return;
    Modal.confirm({
      title: '确认撤销本次导入？',
      content: `将删除本次导入的 ${importResult.imported} 条辩题，不可恢复`,
      okText: '撤销导入',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (!importResult.batchId) return;
        const res = await window.importAPI.revokeBatch(importResult.batchId);
        if (!res.success || !res.data) {
          throw new Error(res.error || '撤销失败');
        }
        messageApi.success(`已撤销（删除 ${res.data!.deletedCount} 条）`);
        onSuccess?.();
        onClose();
        reset();
      }
    });
  };

  // ---------- 渲染辅助 ----------
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : '';
  const fileIcon =
    fileType === 'docx' ? (
      <FileTextOutlined style={{ color: '#1677ff' }} />
    ) : (
      <FileExcelOutlined style={{ color: '#52c41a' }} />
    );

  const previewColumns: ColumnsType<TopicCreateInput> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '领域',
      dataIndex: 'domain',
      key: 'domain',
      width: 100,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '难度',
      dataIndex: 'difficulty',
      key: 'difficulty',
      width: 90,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 130,
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 150,
      render: (tags: string[] | null) =>
        tags && tags.length > 0 ? (
          <Space size={4} wrap>
            {tags.map((t) => (
              <Tag key={t} color="blue">
                {t}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        )
    }
  ];

  // ---------- 步骤渲染 ----------
  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ textAlign: 'center', padding: `${spacing.xxxl} 0` }}>
            <UploadOutlined
              style={{ fontSize: 48, color: '#1677ff', marginBottom: spacing.lg }}
            />
            <div style={{ marginBottom: spacing.sm }}>
              <Text strong>选择要导入的文件</Text>
            </div>
            <Text type="secondary" style={{ display: 'block', marginBottom: spacing.lg }}>
              支持 .xlsx / .csv / .docx 格式
            </Text>
            <Space direction="vertical" size={spacing.sm} style={{ marginBottom: spacing.lg }}>
              <Button
                size="middle"
                type="primary"
                icon={<UploadOutlined />}
                onClick={handlePickFile}
                style={primaryButtonStyle}
              >
                选择文件
              </Button>
              <Button
                size="small"
                type="link"
                icon={<DownloadOutlined />}
                onClick={() => downloadImportTemplate()}
              >
                下载 Excel 模板
              </Button>
            </Space>
            <ImportFormatGuide defaultCollapsed={false} />
          </div>
        );

      case 1:
        return (
          <div style={{ padding: `${spacing.xxl} 0` }}>
            <Space style={{ marginBottom: spacing.lg }}>
              {fileIcon}
              <Text strong>{fileName}</Text>
            </Space>
            {parsing ? (
              <div style={{ textAlign: 'center', padding: spacing.xxl }}>
                <Spin tip="正在解析文件..." />
              </div>
            ) : (
              <>
                <Alert
                  message="解析失败"
                  description="请检查文件格式后重试，可参考下方格式要求自查"
                  type="error"
                  showIcon
                  action={
                    <Button size="middle" onClick={() => setStep(0)}>
                      重新选择
                    </Button>
                  }
                  style={{ marginBottom: spacing.md }}
                />
                <ImportFormatGuide defaultCollapsed={false} />
              </>
            )}
          </div>
        );

      case 2:
        if (!parsed) return null;
        return (
          <div>
            <Space style={{ marginBottom: spacing.md }}>
              {fileIcon}
              <Text strong>{fileName}</Text>
              <Tag color="green">已解析 {parsed.topics.length} 条</Tag>
            </Space>

            {parsed.warnings.length > 0 && (
              <Alert
                message={`解析提示（共 ${parsed.warnings.length} 条）`}
                type={getOverallLevel(parsed.warnings)}
                showIcon
                style={{ marginBottom: spacing.md }}
                description={
                  <div>
                    <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 150, overflow: 'auto' }}>
                      {parsed.warnings.slice(0, 20).map((w, i) => {
                        const level = classifyWarning(w);
                        return (
                          <li key={i} style={{ marginBottom: 4 }}>
                            <Tag color={LEVEL_COLOR[level]} style={{ marginRight: 6, fontSize: 11 }}>
                              {LEVEL_LABEL[level]}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {w}
                            </Text>
                          </li>
                        );
                      })}
                      {parsed.warnings.length > 20 && (
                        <li>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            ... 还有 {parsed.warnings.length - 20} 条提示
                          </Text>
                        </li>
                      )}
                    </ul>
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                      常见原因：表头别名不在映射表内（中英文均可，大小写不敏感，支持
                      标题/title/题目/topic 等）、title 列缺失、标签分隔符不正确（应用 , ， 、
                      ; ；）
                    </Text>
                  </div>
                }
              />
            )}

            {parsed.topics.length === 0 ? (
              <>
                <Alert
                  message="未解析到任何辩题"
                  description="请检查文件内容是否包含 title 列，参考下方格式要求自查"
                  type="error"
                  showIcon
                  style={{ marginBottom: spacing.md }}
                />
                <ImportFormatGuide defaultCollapsed={false} />
              </>
            ) : (
              <>
                {parsed.unknownValues &&
                  parsed.unknownValues.length > 0 &&
                  mergedCandidates && (
                    <ValueMappingPanel
                      unknownValues={parsed.unknownValues}
                      candidateOptions={mergedCandidates}
                      onMappingChange={(m) => setValueMapping(m)}
                    />
                  )}
                <Table
                  columns={previewColumns}
                  dataSource={parsed.topics}
                  rowKey={(_, i) => String(i)}
                  size="small"
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  scroll={{ x: 700 }}
                />
                <div style={{ marginTop: spacing.md }}>
                  <ImportFormatGuide defaultCollapsed />
                </div>
              </>
            )}
          </div>
        );

      case 3:
        if (!importResult) return null;
        return (
          <Result
            status={importResult.imported > 0 ? 'success' : 'warning'}
            icon={importResult.imported > 0 ? <CheckCircleOutlined /> : <WarningOutlined />}
            title={
              importResult.imported > 0
                ? `成功导入 ${importResult.imported} 条辩题`
                : '没有新辩题被导入'
            }
            subTitle={
              <Space split={<Text type="secondary">·</Text>}>
                <Text>新增 {importResult.imported}</Text>
                <Text>重复 {importResult.duplicates}</Text>
                {importResult.failed > 0 && <Text type="danger">失败 {importResult.failed}</Text>}
              </Space>
            }
            extra={[
              ...(importResult.batchId
                ? [
                    <Button
                      key="revoke"
                      size="middle"
                      danger
                      icon={<UndoOutlined />}
                      onClick={handleRevokeFromResult}
                    >
                      撤销本次导入
                    </Button>
                  ]
                : []),
              <Button
                key="close"
                size="middle"
                type="primary"
                onClick={handleClose}
                style={primaryButtonStyle}
              >
                完成
              </Button>
            ]}
          />
        );
    }
  };

  // ---------- 底部按钮 ----------
  const footerButtons = () => {
    if (step === 3) return null;
    return (
      <Space>
        <Button size="middle" onClick={handleClose}>
          取消
        </Button>
        {step === 1 && !parsing && (
          <Button size="middle" onClick={() => setStep(0)}>
            重新选择
          </Button>
        )}
        {step === 2 && parsed && parsed.topics.length > 0 && (
          <Button
            size="middle"
            type="primary"
            loading={importing}
            onClick={handleImport}
            style={primaryButtonStyle}
          >
            确认导入 {parsed.topics.length} 条
          </Button>
        )}
      </Space>
    );
  };

  return (
    <>
      {contextHolder}
      {notificationHolder}
      <Modal
        title="导入辩题"
        open={open}
        onCancel={handleClose}
        width={820}
        footer={footerButtons()}
        destroyOnClose
        maskClosable={false}
      >
        <Steps
          current={step}
          size="small"
          style={{ marginBottom: spacing.xxl }}
          items={[
            { title: '选择文件' },
            { title: '解析预览' },
            { title: '确认导入' },
            { title: '完成' }
          ]}
        />
        {renderStepContent()}
      </Modal>
    </>
  );
}
