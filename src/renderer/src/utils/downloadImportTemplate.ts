import * as XLSX from 'xlsx';

/** 模板的表头行（中文别名 + 字段名备注） */
export const TEMPLATE_HEADERS = ['标题', '类型', '领域', '难度', '来源', '标签'];

/** 2 行示例数据 */
export const TEMPLATE_SAMPLE_ROWS: string[][] = [
  ['金钱是/不是万恶之源', '价值辩', '社会热点', '入门级', '新国辩', '伦理,成长'],
  ['社交媒体对青少年利大于弊/弊大于利', '政策辩', '科技伦理', '进阶级', '华语辩论世界杯', '青少年;科技']
];

/**
 * 生成 .xlsx 模板文件的 ArrayBuffer
 */
export function buildTemplateWorkbook(): ArrayBuffer {
  const aoa: string[][] = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 设置列宽
  ws['!cols'] = [
    { wch: 40 }, // 标题
    { wch: 12 }, // 类型
    { wch: 14 }, // 领域
    { wch: 10 }, // 难度
    { wch: 20 }, // 来源
    { wch: 18 } // 标签
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '辩题模板');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * 触发浏览器下载 .xlsx 模板文件
 */
export function downloadImportTemplate(filename = '辩题导入模板.xlsx'): void {
  const buffer = buildTemplateWorkbook();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放，避免下载未完成就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
