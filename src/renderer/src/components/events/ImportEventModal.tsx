import { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Button,
  Space,
  Radio,
  Alert,
  Typography,
  Result,
  Descriptions,
  Tag,
  Tooltip
} from 'antd';
import {
  UploadOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ImportOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import BrandSpin from '../common/BrandSpin';
import { spacing } from '../../styles/tokens';
import { primaryButtonStyle } from '../../styles/shared';
import { useToast } from '../../hooks/useToast';
import type {
  ImportEventPackagePreviewResult,
  ImportEventPackageResult,
  ApiResponse
} from '../../../../shared/types';

const { Text } = Typography;

export interface ImportEventModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (eventId: string) => void;
}

type ConflictStrategy = 'skip' | 'overwrite' | 'rename';
type Step = 0 | 1 | 2;

const FILE_FILTERS = [{ name: '赛事包 JSON', extensions: ['json'] }];

const STRATEGY_LABEL: Record<ConflictStrategy, string> = {
  skip: '跳过（同名则不导入）',
  overwrite: '覆盖（先删后建）',
  rename: '重命名（加后缀）'
};

const STRATEGY_DESC: Record<ConflictStrategy, string> = {
  skip: '若已有同名赛事，则跳过本次导入，不修改任何数据。',
  overwrite: '删除原有同名赛事及其所有关联数据（轮次/队伍/分组/抽取记录），再创建新的。',
  rename: '保留原赛事，新赛事名加后缀「(导入)」，若仍重名则继续加「(导入 2)」「(导入 3)」…'
};

export default function ImportEventModal({ open, onClose, onSuccess }: ImportEventModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportEventPackagePreviewResult | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('rename');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportEventPackageResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // mounted 守卫，防止异步操作完成后 setState 已卸载的组件
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = () => {
    setStep(0);
    setFilePath(null);
    setPreviewing(false);
    setPreview(null);
    setStrategy('rename');
    setImporting(false);
    setImportResult(null);
    setImportError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---------- 步骤 0：选择文件并预览 ----------
  const handlePickFile = async () => {
    try {
      const picked = await window.fileAPI.pickFile(FILE_FILTERS);
      if (!mountedRef.current) return;
      if (!picked.success || !picked.data) return;
      const path = picked.data;
      const ext = path.toLowerCase().split('.').pop();
      if (ext !== 'json') {
        toast.error('仅支持 .json 文件');
        return;
      }
      setFilePath(path);
      setPreview(null);
      setStep(1);
      // 自动开始预览
      void previewFile(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '选择文件失败');
    }
  };

  const previewFile = async (path: string) => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await window.eventAPI.previewEventPackage(path);
      if (!mountedRef.current) return;
      if (!res.success || !res.data) {
        throw new Error(res.error || '预览失败');
      }
      setPreview(res.data);
    } catch (e) {
      if (!mountedRef.current) return;
      toast.error(e instanceof Error ? e.message : '预览失败');
      setStep(0);
    } finally {
      if (mountedRef.current) setPreviewing(false);
    }
  };

  // ---------- 步骤 1：执行导入 ----------
  const handleImport = async () => {
    if (!filePath) return;
    setImporting(true);
    setImportError(null);
    try {
      const res: ApiResponse<ImportEventPackageResult> =
        await window.eventAPI.importEventPackage({
          filePath,
          conflictStrategy: strategy
        });
      if (!mountedRef.current) return;
      if (!res.success || !res.data) {
        // skip 策略下冲突会返回 error，展示在结果页而非 toast
        setImportError(res.error || '导入失败');
        setImportResult(null);
        setStep(2);
        return;
      }
      setImportResult(res.data);
      setImportError(null);
      setStep(2);
      toast.success('赛事包导入成功');
    } catch (e) {
      if (!mountedRef.current) return;
      setImportError(e instanceof Error ? e.message : '导入失败');
      setImportResult(null);
      setStep(2);
    } finally {
      if (mountedRef.current) setImporting(false);
    }
  };

  // ---------- 渲染辅助 ----------
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : '';

  const renderPreviewTable = () => {
    if (!preview) return null;
    const items = [
      { label: '赛事名', value: preview.eventName },
      { label: '轮次', value: preview.roundCount },
      { label: '队伍', value: preview.teamCount },
      { label: '分组', value: preview.groupCount },
      { label: '抽取会话', value: preview.drawSessionCount },
      { label: '队伍历史', value: preview.teamHistoryCount }
    ];
    return (
      <Descriptions
        size="small"
        column={2}
        bordered
        style={{ marginTop: spacing.md }}
        items={items.map((it) => ({
          key: it.label,
          label: it.label,
          children: <Text strong>{it.value}</Text>
        }))}
      />
    );
  };

  // ---------- 步骤渲染 ----------
  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ textAlign: 'center', padding: `${spacing.xl} 0` }}>
            <UploadOutlined
              style={{ fontSize: 48, color: '#1677ff', marginBottom: spacing.lg }}
            />
            <div style={{ marginBottom: spacing.sm }}>
              <Text strong>选择要导入的赛事包文件</Text>
            </div>
            <Alert
              message="仅支持 .json 格式的赛事包文件（由「导出赛事」生成）"
              type="info"
              showIcon
              banner
              style={{ marginBottom: spacing.lg, textAlign: 'left' }}
            />
            <Button
              type="primary"
              size="large"
              icon={<ImportOutlined />}
              onClick={handlePickFile}
              style={primaryButtonStyle}
            >
              选择文件
            </Button>
          </div>
        );

      case 1:
        return (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing.sm,
                marginBottom: spacing.md,
                padding: spacing.sm,
                background: 'var(--ant-color-fill-alter, #fafafa)',
                borderRadius: 4
              }}
            >
              <FileTextOutlined style={{ color: '#1677ff' }} />
              <Text strong ellipsis style={{ flex: 1 }}>
                {fileName}
              </Text>
              <Tooltip title="重新选择文件">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setStep(0);
                    setFilePath(null);
                    setPreview(null);
                  }}
                >
                  重选
                </Button>
              </Tooltip>
            </div>

            <BrandSpin spinning={previewing} tip="解析中…">
              {preview && (
                <>
                  {renderPreviewTable()}

                  {preview.hasConflict && (
                    <Alert
                      message="检测到同名赛事"
                      description={`已有赛事「${preview.eventName}」存在，请选择冲突处理策略。`}
                      type="warning"
                      showIcon
                      icon={<WarningOutlined />}
                      banner
                      style={{ marginTop: spacing.md }}
                    />
                  )}

                  <div style={{ marginTop: spacing.lg }}>
                    <Text strong style={{ display: 'block', marginBottom: spacing.sm }}>
                      冲突处理策略：
                    </Text>
                    <Radio.Group
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      disabled={!preview.hasConflict}
                    >
                      <Space direction="vertical">
                        <Radio value="skip">
                          <Text>{STRATEGY_LABEL.skip}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {' '}- {STRATEGY_DESC.skip}
                          </Text>
                        </Radio>
                        <Radio value="overwrite">
                          <Text>{STRATEGY_LABEL.overwrite}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {' '}- {STRATEGY_DESC.overwrite}
                          </Text>
                        </Radio>
                        <Radio value="rename">
                          <Text>{STRATEGY_LABEL.rename}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {' '}- {STRATEGY_DESC.rename}
                          </Text>
                        </Radio>
                      </Space>
                    </Radio.Group>
                    {!preview.hasConflict && (
                      <div style={{ marginTop: spacing.xs }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          （无同名冲突，任意策略都会以原名称导入）
                        </Text>
                      </div>
                    )}
                  </div>
                </>
              )}
            </BrandSpin>
          </div>
        );

      case 2:
        if (importError) {
          return (
            <Result
              status="warning"
              title="导入未完成"
              subTitle={importError}
              extra={[
                <Button key="retry" type="primary" onClick={() => setStep(1)}>
                  返回调整
                </Button>,
                <Button key="close" onClick={handleClose}>
                  关闭
                </Button>
              ]}
            />
          );
        }
        if (!importResult) {
          return (
            <Result
              status="info"
              title="无导入结果"
              extra={<Button onClick={handleClose}>关闭</Button>}
            />
          );
        }
        return (
          <Result
            status="success"
            icon={<CheckCircleOutlined />}
            title="赛事包导入成功"
            subTitle={
              importResult.renamedTo
                ? `原赛事名「${importResult.originalName}」已重命名为「${importResult.renamedTo}」`
                : undefined
            }
            extra={[
              <Button
                key="close"
                type="primary"
                onClick={() => {
                  if (onSuccess) onSuccess(importResult.eventId);
                  handleClose();
                }}
              >
                完成
              </Button>
            ]}
          >
            <Descriptions
              size="small"
              column={2}
              bordered
              items={[
                {
                  key: 'roundCount',
                  label: '轮次数',
                  children: <Text strong>{importResult.roundCount}</Text>
                },
                {
                  key: 'teamCount',
                  label: '队伍数',
                  children: <Text strong>{importResult.teamCount}</Text>
                },
                {
                  key: 'groupCount',
                  label: '分组数',
                  children: <Text strong>{importResult.groupCount}</Text>
                },
                {
                  key: 'strategy',
                  label: '冲突策略',
                  children: <Tag color="blue">{STRATEGY_LABEL[importResult.strategy]}</Tag>
                }
              ]}
            />
          </Result>
        );
    }
  };

  // ---------- 底部按钮 ----------
  const renderFooter = () => {
    if (step === 0) return null;
    if (step === 2) return null;
    // step 1
    return (
      <Space>
        <Button onClick={handleClose}>取消</Button>
        <Button
          type="primary"
          icon={<ImportOutlined />}
          loading={importing || previewing}
          disabled={!preview || previewing}
          onClick={handleImport}
          style={primaryButtonStyle}
        >
          开始导入
        </Button>
      </Space>
    );
  };

  return (
    <Modal
      title="导入赛事"
      open={open}
      onCancel={handleClose}
      footer={renderFooter()}
      width={560}
      destroyOnHidden
      maskClosable={false}
    >
      {renderStepContent()}
    </Modal>
  );
}
