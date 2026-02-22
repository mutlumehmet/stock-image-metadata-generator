export interface FileEntry {
  id: string;
  file: File;
  name: string;
}

export interface MetadataRecord {
  file_name: string;
  created_at: string;
  title_en: string;
  title_tr: string;
  description_en: string;
  description_tr: string;
  adobe_keywords_en: string[];
  adobe_keywords_tr: string[];
  shutter_keywords_en: string[];
  shutter_keywords_tr: string[];
  istock_keywords_en: string[];
  istock_keywords_tr: string[];
}

export const CSV_HEADERS = [
  'file_path',
  'file_name',
  'created_at',
  'title_en',
  'title_tr',
  'description_en',
  'description_tr',
  'adobe_keywords_en',
  'adobe_keywords_tr',
  'shutter_keywords_en',
  'shutter_keywords_tr',
  'istock_keywords_en',
  'istock_keywords_tr',
] as const;

export const ADOBE_MAX = 49;
export const SHUTTER_MAX = 50;
export const ISTOCK_MAX = 50;

export interface Settings {
  groq_api_key: string;
  everypixels_id: string;
  everypixels_secret: string;
}

export const DEFAULT_SETTINGS: Settings = {
  groq_api_key: '',
  everypixels_id: '',
  everypixels_secret: '',
};

export type IStockMap = Record<string, string>;
