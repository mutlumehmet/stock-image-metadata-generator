import type { MetadataRecord } from '../types';
import { CSV_HEADERS } from '../types';

function escapeCsvField(val: string): string {
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildCsvRow(record: MetadataRecord, filePath: string): string {
  const joinKw = (arr: string[]) => arr.filter(Boolean).join(', ');
  const row: Record<string, string> = {
    file_path: filePath,
    file_name: record.file_name,
    created_at: record.created_at,
    title_en: record.title_en,
    title_tr: record.title_tr,
    description_en: record.description_en,
    description_tr: record.description_tr,
    adobe_keywords_en: joinKw(record.adobe_keywords_en),
    adobe_keywords_tr: joinKw(record.adobe_keywords_tr),
    shutter_keywords_en: joinKw(record.shutter_keywords_en),
    shutter_keywords_tr: joinKw(record.shutter_keywords_tr),
    istock_keywords_en: joinKw(record.istock_keywords_en),
    istock_keywords_tr: joinKw(record.istock_keywords_tr),
  };
  return CSV_HEADERS.map((h) => escapeCsvField(row[h] ?? '')).join(',');
}

export function buildCsv(records: { filePath: string; record: MetadataRecord }[]): string {
  const header = CSV_HEADERS.join(',');
  const rows = records.map(({ filePath, record }) => buildCsvRow(record, filePath));
  return [header, ...rows].join('\r\n');
}

export function downloadCsv(content: string, filename = '_metadata.csv'): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
