import { Collapse, Table, Typography, Tag, Space, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { spacing } from '../../styles/tokens';

const { Text, Paragraph } = Typography;

interface FieldRow {
  field: string;
  aliases: string[];
  required: boolean;
  example: string;
  note: string;
}

const FIELD_ROWS: FieldRow[] = [
  {
    field: 'title',
    aliases: ['标题', '题目', '辩题', '辩题标题', '名称', 'title', 'topic'],
    required: true,
    example: '金钱是/不是万恶之源',
    note: '必填，缺失则该行跳过'
  },
  {
    field: 'type',
    aliases: ['类型', '辩题类型', 'type', 'category'],
    required: false,
    example: '价值辩',
    note: '可选'
  },
  {
    field: 'domain',
    aliases: ['领域', '主题领域', '分类', 'domain'],
    required: false,
    example: '社会热点',
    note: '可选'
  },
  {
    field: 'difficulty',
    aliases: ['难度', '难度等级', 'difficulty', 'level'],
    required: false,
    example: '入门级',
    note: '可选'
  },
  {
    field: 'source',
    aliases: ['来源', '出处', 'source'],
    required: false,
    example: '新国辩',
    note: '可选'
  },
  {
    field: 'tags',
    aliases: ['标签', '标记', 'tags', 'tag'],
    required: false,
    example: '成长,伦理',
    note: '可选，按 , ， 、 ; ； 分隔'
  }
];

export interface ImportFormatGuideProps {
  /** 默认是否折叠 */
  defaultCollapsed?: boolean;
}

export default function ImportFormatGuide({
  defaultCollapsed = false
}: ImportFormatGuideProps) {
  const columns: ColumnsType<FieldRow> = [
    {
      title: '字段',
      dataIndex: 'field',
      key: 'field',
      width: 100,
      render: (v) => <code>{v}</code>
    },
    {
      title: '表头别名（中英文）',
      dataIndex: 'aliases',
      key: 'aliases',
      render: (v: string[]) => (
        <Space size={4} wrap>
          {v.map((a) => (
            <Tag key={a}>{a}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '必填',
      dataIndex: 'required',
      key: 'required',
      width: 60,
      render: (v: boolean) =>
        v ? <Tag color="red">必填</Tag> : <Tag>可选</Tag>
    },
    {
      title: '示例',
      dataIndex: 'example',
      key: 'example',
      render: (v: string) => <Text type="secondary">{v}</Text>
    },
    {
      title: '说明',
      dataIndex: 'note',
      key: 'note',
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v}
        </Text>
      )
    }
  ];

  return (
    <Collapse
      defaultActiveKey={defaultCollapsed ? [] : ['guide']}
      size="small"
      items={[
        {
          key: 'guide',
          label: <Text strong>格式要求（点击展开/折叠）</Text>,
          children: (
            <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                banner
                message="支持文件类型：.xlsx / .csv / .docx"
              />
              <div>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  Excel / CSV 列名映射（中英文均可，大小写不敏感）
                </Text>
                <Table
                  columns={columns}
                  dataSource={FIELD_ROWS}
                  rowKey="field"
                  size="small"
                  pagination={false}
                  scroll={{ x: 500 }}
                />
              </div>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Word（.docx）三种结构自动识别
                </Text>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                  <li>
                    <Text strong>表格</Text>：第一行为表头，规则同 Excel
                  </li>
                  <li>
                    <Text strong>编号列表</Text>：支持 <code>1.</code> / <code>1、</code> /{' '}
                    <code>1)</code> / <code>一、</code> / <code>壹、</code>，每项作为一条
                    title
                  </li>
                  <li>
                    <Text strong>纯文本</Text>：每个非空行作为一条 title
                  </li>
                </ul>
              </div>
              <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                <Text strong>其他规则：</Text>
                标签按 <code>, ， 、 ; ；</code> 任一分隔符拆分；CSV 自动识别 UTF-8 /
                UTF-16 / GBK 编码；导入辩题的「来源类型」自动标记为「自定义」。
                <br />
                <Text strong>字段值提示：</Text>
                若字段值不在系统候选值内（如难度写 <code>1-入门</code>{' '}
                而非 <code>入门级</code>），会原样入库但后续筛选可能选不到，建议导入后批量编辑。
              </Paragraph>
            </Space>
          )
        }
      ]}
    />
  );
}
