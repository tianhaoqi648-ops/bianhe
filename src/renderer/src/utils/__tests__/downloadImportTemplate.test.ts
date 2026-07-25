import { describe, it, expect } from 'vitest';
import {
  buildTemplateWorkbook,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS
} from '../downloadImportTemplate';
import * as XLSX from 'xlsx';

describe('downloadImportTemplate', () => {
  describe('TEMPLATE_HEADERS', () => {
    it('包含 6 个字段，顺序与 HEADER_MAPPING 一致', () => {
      expect(TEMPLATE_HEADERS).toEqual([
        '标题',
        '类型',
        '领域',
        '难度',
        '来源',
        '标签'
      ]);
    });
  });

  describe('TEMPLATE_SAMPLE_ROWS', () => {
    it('每行字段数与表头一致', () => {
      TEMPLATE_SAMPLE_ROWS.forEach((row) => {
        expect(row.length).toBe(TEMPLATE_HEADERS.length);
      });
    });

    it('第一列 title 非空', () => {
      TEMPLATE_SAMPLE_ROWS.forEach((row) => {
        expect(row[0].length).toBeGreaterThan(0);
      });
    });
  });

  describe('buildTemplateWorkbook', () => {
    it('生成可被 XLSX 重新读取的 ArrayBuffer，含表头 + 示例行', () => {
      const buf = buildTemplateWorkbook();
      expect(buf).toBeInstanceOf(ArrayBuffer);
      expect(buf.byteLength).toBeGreaterThan(0);

      const wb = XLSX.read(buf, { type: 'array' });
      expect(wb.SheetNames).toContain('辩题模板');
      const ws = wb.Sheets['辩题模板'];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      expect(rows[0]).toEqual(TEMPLATE_HEADERS);
      expect(rows.length).toBe(1 + TEMPLATE_SAMPLE_ROWS.length);
      // 验证示例行内容
      expect(rows[1]).toEqual(TEMPLATE_SAMPLE_ROWS[0]);
      expect(rows[2]).toEqual(TEMPLATE_SAMPLE_ROWS[1]);
    });
  });
});
