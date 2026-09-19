// ============================================================
// RecordingMaintenancePanel.tsx — 录音维护（Phase 1.3-fix Me1）
//
// Read-only Orphan Report：扫描录音目录（双根）× DB 引用 → 分类报告。
// 发现异常 ≠ 删除异常——本面板【无任何删除/清理/修复操作】，
// 仅展示状态、引用数与建议，供用户人工判断。
// ============================================================
import { useState } from 'react';
import { Button, Card, List, Space, Statistic, Tag, Typography, Alert } from 'antd';
import {
  ScanOutlined,
  FileSearchOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import type { RecordingScanReport, RecordingScanClassification } from '../../../../shared/types';

const { Text } = Typography;

/** 分类 → Tag 颜色与文案 */
const CLASSIFICATION_META: Record<
  RecordingScanClassification,
  { color: string; label: string; description: string }
> = {
  REFERENCED: {
    color: 'green',
    label: '已引用',
    description: '文件存在且被至少一场比赛引用。'
  },
  SHARED: {
    color: 'blue',
    label: '共享',
    description: '文件被多场比赛共同引用（同一录音绑定到多个比赛）。'
  },
  UNREFERENCED: {
    color: 'default',
    label: '未引用',
    description: '当前没有比赛引用该文件，但不能安全判定为孤儿——可能是自由练习录音或待重新绑定的文件。'
  },
  ORPHAN: {
    color: 'orange',
    label: '孤儿',
    description: '文件存在，但当前没有发现任何有效业务引用（可能是历史遗留、手动放入或换根前产物）。请人工确认后再决定处理方式。'
  },
  MISSING: {
    color: 'red',
    label: '缺失',
    description: '数据库存在引用，但当前录音目录中不存在该文件（可能是换机/换根后音频未迁移，即 Ghost Reference）。'
  },
  UNKNOWN: {
    color: 'purple',
    label: '未知',
    description: '无法安全判断（文件类型异常/状态读取失败/结构无法识别）。请人工确认。'
  }
};

export function RecordingMaintenancePanel(): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<RecordingScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async (): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      const res = await window.recordingAPI.scan();
      if (!res.success || !res.data) {
        setError(res.error || '扫描失败');
        return;
      }
      setReport(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const iconFor = (c: RecordingScanClassification): JSX.Element => {
    if (c === 'ORPHAN' || c === 'MISSING') return <WarningOutlined style={{ color: '#fa8c16' }} />;
    if (c === 'UNKNOWN') return <QuestionCircleOutlined style={{ color: '#722ed1' }} />;
    return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <FileSearchOutlined style={{ color: '#1677ff' }} />
          <span>录音维护（只读扫描）</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="此扫描为只读维护报告：仅统计录音文件与数据库引用的对应关系，不会删除、移动或修改任何文件。"
        />
        <Space>
          <Button
            type="primary"
            icon={<ScanOutlined />}
            loading={scanning}
            onClick={() => void handleScan()}
          >
            扫描录音目录
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            扫描当前录音目录与历史默认目录，比对数据库引用后给出分类报告。
          </Text>
        </Space>

        {error && <Alert type="error" showIcon message={error} />}

        {report &&
          report.roots.map((root) => {
            const summary = {
              REFERENCED: 0,
              SHARED: 0,
              UNREFERENCED: 0,
              ORPHAN: 0,
              MISSING: 0,
              UNKNOWN: 0
            } as Record<RecordingScanClassification, number>;
            for (const item of root.items) summary[item.classification]++;
            return (
              <Card
                key={`${root.rootType}-${root.rootPath}`}
                type="inner"
                size="small"
                title={`${root.rootType === 'CURRENT' ? '当前录音目录' : '历史默认目录'}：${root.rootPath}`}
              >
                {root.error && <Alert type="warning" message={`目录读取失败：${root.error}`} />}
                <Space size="large" wrap style={{ marginBottom: 8 }}>
                  {(
                    [
                      ['REFERENCED', '已引用'],
                      ['SHARED', '共享'],
                      ['UNREFERENCED', '未引用'],
                      ['ORPHAN', '孤儿'],
                      ['MISSING', '缺失'],
                      ['UNKNOWN', '未知']
                    ] as Array<[RecordingScanClassification, string]>
                  ).map(([cls, label]) => (
                    <Statistic
                      key={cls}
                      title={label}
                      value={root.items.filter((i) => i.classification === cls).length + (summary[cls] === -1 ? 0 : 0)}
                      valueStyle={{
                        fontSize: 18,
                        color: cls === 'ORPHAN' || cls === 'MISSING' ? '#fa8c16' : undefined
                      }}
                    />
                  ))}
                </Space>
                {root.items.length > 0 && (
                  <List
                    size="small"
                    dataSource={root.items}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          <Space size={8}>
                            {iconFor(item.classification)}
                            <Tag color={CLASSIFICATION_META[item.classification].color}>
                              {CLASSIFICATION_META[item.classification].label}
                            </Tag>
                            <Text code>{item.basename}</Text>
                            {item.sizeBytes != null && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {item.sizeBytes} B
                              </Text>
                            )}
                            {item.modifiedAt && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {item.modifiedAt.slice(0, 10)}
                              </Text>
                            )}
                            {item.referencedBy.length > 0 && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                引用：{item.referencedBy.length} 场比赛
                              </Text>
                            )}
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {item.reasonText}
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
                {root.items.length === 0 && !root.error && (
                  <Text type="secondary">该目录下没有录音文件。</Text>
                )}
              </Card>
            );
          })}

        {report && (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              状态说明：
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              · 孤儿：文件存在，但当前没有发现有效业务引用（含 ExclamationCircleOutlined 标记的条目需人工确认）。
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              · 缺失：数据库存在引用，但录音文件不存在（换机/换根后音频未迁移）。
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              · 未引用：当前没有比赛引用，但不能安全判定为孤儿（可能是自由练习或待重绑文件）。
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <ExclamationCircleOutlined /> 本报告为只读维护信息，应用不会自动删除任何录音文件。
            </Text>
          </Space>
        )}
      </Space>
    </Card>
  );
}
