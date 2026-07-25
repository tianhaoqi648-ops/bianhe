import { useState } from 'react';
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
  Tag
} from 'antd';
import {
  UploadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type {
  ParsedResult,
  TopicCreateInput,
  ImportExecuteResult
} from '../../../shared/types';
import { spacing } from '../styles/tokens';

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

export default function ImportTopicsModal({ open, onClose, onSuccess }: ImportTopicsModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [step, setStep] = useState<Step>(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'xlsx' | 'csv' | 'docx' | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);

  const reset = () => {
    setStep(0);
    setFilePath(null);
    setFileType(null);
    setParsed(null);
    setImportResult(null);
    setParsing(false);
    setImporting(false);
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
    setImporting(true);
    try {
      const res = await window.importAPI.execute({
        topics: parsed.topics,
        checkDuplicates: true
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || '导入失败');
      }
      setImportResult(res.data);
      setStep(3);
      messageApi.success(`成功导入 ${res.data.imported} 条辩题`);
      onSuccess?.();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
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
            <Button
              size="middle"
              type="primary"
              icon={<UploadOutlined />}
              onClick={handlePickFile}
            >
              选择文件
            </Button>
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
              <Alert
                message="解析失败"
                description="请检查文件格式后重试"
                type="error"
                showIcon
                action={
                  <Button size="middle" onClick={() => setStep(0)}>
                    重新选择
                  </Button>
                }
              />
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
                message="解析警告"
                type="warning"
                showIcon
                style={{ marginBottom: spacing.md }}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 120, overflow: 'auto' }}>
                    {parsed.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {w}
                        </Text>
                      </li>
                    ))}
                    {parsed.warnings.length > 20 && (
                      <li>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          ... 还有 {parsed.warnings.length - 20} 条警告
                        </Text>
                      </li>
                    )}
                  </ul>
                }
              />
            )}

            {parsed.topics.length === 0 ? (
              <Alert
                message="未解析到任何辩题"
                description="请检查文件内容是否包含 title 列"
                type="error"
                showIcon
              />
            ) : (
              <Table
                columns={previewColumns}
                dataSource={parsed.topics}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                scroll={{ x: 700 }}
              />
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
              <Button key="close" size="middle" type="primary" onClick={handleClose}>
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
