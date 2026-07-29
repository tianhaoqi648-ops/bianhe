import { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Steps,
  Button,
  Space,
  Table,
  Alert,
  Typography,
  Result,
  Tag
} from 'antd';
import BrandSpin from './common/BrandSpin';
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
  ValueMapping,
  FieldMapping,
  CustomField,
  CustomFieldType
} from '../../../shared/types';
import type { CandidateField } from '../../../shared/constants';
import { SYSTEM_FIELD_DEFINITIONS } from '../../../shared/field-definitions';
import { spacing } from '../styles/tokens';
import { primaryButtonStyle } from '../styles/shared';
import { useToast } from '../hooks/useToast';
import ImportFormatGuide from './import/ImportFormatGuide';
import ValueMappingPanel from './import/ValueMappingPanel';
import FieldMappingPanel from './import/FieldMappingPanel';
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
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'xlsx' | 'csv' | 'docx' | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);
  // 新值映射状态：用户在 Step 2 预览页配置，handleImport 时应用
  const [valueMapping, setValueMapping] = useState<ValueMapping>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // 合并后的系统候选值（系统候选 + 用户扩展），供 ValueMappingPanel 显示已有候选
  const [mergedCandidates, setMergedCandidates] = useState<
    Record<CandidateField, string[]> | null
  >(null);

  // Bug 3.1: mounted 守卫，防止异步操作完成后 setState 已卸载的组件
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Bug 5.1: 撤销按钮 loading 状态
  const [revoking, setRevoking] = useState(false);

  // 弹窗打开时拉取合并后的候选值（含用户扩展），供 ValueMappingPanel 显示
  useEffect(() => {
    if (!open) return;
    window.settingsAPI
      .getCandidates()
      .then((res) => {
        if (!mountedRef.current) return;
        if (res.success && res.data) {
          setMergedCandidates(res.data as Record<CandidateField, string[]>);
        }
      })
      .catch(() => {
        // 拉取失败不阻断流程，ValueMappingPanel 不显示（mergedCandidates 保持 null）
      });
  }, [open]);

  // 弹窗打开时拉取自定义字段列表，供 FieldMappingPanel 显示已有自定义字段
  useEffect(() => {
    if (!open) return;
    window.customFieldAPI
      .list()
      .then((res) => {
        if (!mountedRef.current) return;
        if (res.success && res.data) {
          setCustomFields(res.data);
        }
      })
      .catch(() => {
        // 拉取失败不阻断流程
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

  const handleCreateCustomField = async (
    label: string,
    type: CustomFieldType
  ): Promise<CustomField> => {
    const res = await window.customFieldAPI.create(label, type);
    if (!mountedRef.current) throw new Error('component unmounted');
    if (!res.success || !res.data) {
      throw new Error(res.error || '创建字段失败');
    }
    const created = res.data;
    setCustomFields((prev) => [...prev, created]);
    return created;
  };

  // 字段映射实时变更触发重新解析
  // 用户在 FieldMappingPanel 修改未识别列绑定或已识别列重新绑定后，
  // 调用 IPC 重新解析 rawTable 得到新 ParsedResult（含新 topics/unknownValues）
  const handleFieldMappingChange = async (m: FieldMapping) => {
    if (!parsed || !parsed.rawTable) return;
    try {
      const res = await window.importAPI.applyFieldMapping(parsed, m);
      if (!mountedRef.current) return;
      if (res.success && res.data) {
        setParsed(res.data);
      }
    } catch (e) {
      // 静默失败，用户继续编辑时再重试
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---------- 步骤 1：选择文件 ----------
  const handlePickFile = async () => {
    try {
      const picked = await window.fileAPI.pickFile(FILE_FILTERS);
      if (!picked.success || !picked.data) return;
      const path = picked.data;
      const ext = path.toLowerCase().split('.').pop();
      if (ext !== 'xlsx' && ext !== 'csv' && ext !== 'docx') {
        toast.error('仅支持 .xlsx / .csv / .docx 文件');
        return;
      }
      setFilePath(path);
      setFileType(ext);
      setStep(1);
      // 自动开始解析
      void parseFile(path, ext);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '选择文件失败');
    }
  };

  // ---------- 步骤 2：解析文件 ----------
  const parseFile = async (path: string, ext: 'xlsx' | 'csv' | 'docx') => {
    setParsing(true);
    try {
      const res = await window.importAPI.parseFile(path, ext);
      if (!mountedRef.current) return;
      if (!res.success || !res.data) {
        throw new Error(res.error || '解析失败');
      }
      setParsed(res.data);
      setStep(2);
    } catch (e) {
      if (!mountedRef.current) return;
      toast.error(e instanceof Error ? e.message : '解析失败');
      setStep(1);
    } finally {
      if (mountedRef.current) setParsing(false);
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
      toast.error(`映射不完整：${desc}`);
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
      if (!mountedRef.current) return;
      if (!res.success || !res.data) {
        throw new Error(res.error || '导入失败');
      }
      setImportResult(res.data);
      setStep(3);
      // 导入成功 Toast 带「撤销」按钮（仅当有 batchId 时）
      if (res.data.batchId) {
        const batchId = res.data.batchId;
        toast.undo(
          `成功导入 ${res.data.imported} 条辩题`,
          async () => {
            // Bug 5.1: 防止重复点击
            if (revoking) return;
            setRevoking(true);
            try {
              const revokeRes = await window.importAPI.revokeBatch(batchId);
              if (!mountedRef.current) return;
              if (!revokeRes.success || !revokeRes.data) {
                throw new Error(revokeRes.error || '撤销失败');
              }
              toast.success(
                `已撤销本次导入（删除 ${revokeRes.data.deletedCount} 条）`
              );
              // Bug 3.2: 撤销成功后调用 reset() 清理状态，避免残留
              reset();
              onSuccess?.();
              onClose();
            } catch (e) {
              if (!mountedRef.current) return;
              toast.error(e instanceof Error ? e.message : '撤销失败');
            } finally {
              if (mountedRef.current) setRevoking(false);
            }
          },
          { duration: 8 }
        );
      } else {
        toast.success(`成功导入 ${res.data.imported} 条辩题`);
      }
      onSuccess?.();
    } catch (e) {
      if (!mountedRef.current) return;
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      if (mountedRef.current) setImporting(false);
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
        // Bug 3.3: 用 try/catch 包裹，catch 中显示错误，不 throw
        if (!importResult.batchId) return;
        try {
          const res = await window.importAPI.revokeBatch(importResult.batchId);
          if (!mountedRef.current) return;
          if (!res.success || !res.data) {
            toast.error(res.error || '撤销失败');
            return;
          }
          toast.success(`已撤销（删除 ${res.data.deletedCount} 条）`);
          reset();
          onSuccess?.();
          onClose();
        } catch (e) {
          if (!mountedRef.current) return;
          toast.error(e instanceof Error ? e.message : '撤销失败');
        }
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

  const SYSTEM_COLUMN_ORDER: Array<{ key: string; label: string; width: number }> = [
    { key: 'title', label: '标题', width: 0 },
    { key: 'type', label: '类型', width: 100 },
    { key: 'domain', label: '领域', width: 100 },
    { key: 'difficulty', label: '难度', width: 90 },
    { key: 'source', label: '来源', width: 130 },
    { key: 'source_type', label: '来源类型', width: 110 },
    { key: 'tags', label: '标签', width: 150 }
  ];

  function buildPreviewColumns(sample: TopicCreateInput): ColumnsType<TopicCreateInput> {
    const cols: ColumnsType<TopicCreateInput> = [];
    for (const { key, label, width } of SYSTEM_COLUMN_ORDER) {
      if (key === 'title') {
        cols.push({ title: label, dataIndex: key, key, ellipsis: true });
      } else if (key === 'tags') {
        cols.push({
          title: label,
          dataIndex: key,
          key,
          width,
          render: (tags: string[] | null) =>
            tags && tags.length > 0 ? (
              <Space size={4} wrap>
                {tags.map((t, i) => (
                  <Tag key={`${t}-${i}`} color="blue">
                    {t}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )
        });
      } else {
        cols.push({
          title: label,
          dataIndex: key,
          key,
          width,
          render: (v: string | null) => v ?? <Text type="secondary">-</Text>
        });
      }
    }
    // 自定义字段列（来自 custom_data）
    const customKeys = Object.keys(sample.custom_data ?? {});
    for (const ck of customKeys) {
      cols.push({
        title: ck,
        key: `custom_${ck}`,
        width: 120,
        render: (_v, record) => {
          const cv = record.custom_data?.[ck];
          if (cv == null) return <Text type="secondary">-</Text>;
          if (Array.isArray(cv)) {
            return (
              <Space size={4} wrap>
                {cv.map((t, i) => (
                  <Tag key={`${t}-${i}`} color="purple">
                    {t}
                  </Tag>
                ))}
              </Space>
            );
          }
          return String(cv);
        }
      });
    }
    return cols;
  }

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
            <Alert
              message="支持 .xlsx / .csv / .docx 格式，可下载模板查看字段说明"
              type="info"
              showIcon
              banner
              style={{ marginBottom: spacing.lg, textAlign: 'left' }}
            />
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
                <BrandSpin tip="正在解析文件..." />
              </div>
            ) : (
              <>
                <Alert
                  message="解析失败"
                  description="请检查文件格式后重试，可参考下方格式要求自查"
                  type="error"
                  showIcon
                  action={
                    <Button size="middle" onClick={() => { setParsing(false); setStep(0); }}>
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
                          <li key={`${i}-${w}`} style={{ marginBottom: 4 }}>
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
                {/* 字段映射区：始终显示，含已识别列只读行 + 未识别列可编辑行 */}
                <FieldMappingPanel
                  unmatchedColumns={parsed.unmatchedColumns ?? []}
                  matchedMappings={parsed.mapping}
                  systemFields={SYSTEM_FIELD_DEFINITIONS}
                  customFields={customFields}
                  onMappingChange={handleFieldMappingChange}
                  onCreateField={handleCreateCustomField}
                />

                {/* 值映射区：仅当有 unknownValues 且合并候选已加载时显示 */}
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
                  columns={buildPreviewColumns(parsed.topics[0])}
                  dataSource={parsed.topics}
                  rowKey={(record, i) => `${i}-${record.title}`}
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
          <Button size="middle" onClick={() => { setParsing(false); setStep(0); }}>
            重新选择
          </Button>
        )}
        {step === 2 &&
          parsed &&
          parsed.topics.length > 0 && (
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
