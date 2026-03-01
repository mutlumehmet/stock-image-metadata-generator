/**
 * Stock Metadata Generator — single-file web app.
 * Tailwind styles are in index.css (@import "tailwindcss" + @theme).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { apiEverypixels, everypixelToKeywordStrings } from './api/everypixels';
import { enqueueThumbnail } from './lib/thumbnailQueue';

// ─── Types & constants ─────────────────────────────────────────────────────
interface FileEntry {
  id: string;
  file: File;
  name: string;
}

interface MetadataRecord {
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

interface Settings {
  groq_api_key: string;
  everypixels_id: string;
  everypixels_secret: string;
}

type IStockMap = Record<string, string>;

const CSV_HEADERS = [
  'file_path', 'file_name', 'created_at', 'title_en', 'title_tr',
  'description_en', 'description_tr', 'adobe_keywords_en', 'adobe_keywords_tr',
  'shutter_keywords_en', 'shutter_keywords_tr', 'istock_keywords_en', 'istock_keywords_tr',
] as const;

const ADOBE_MAX = 49;
const SHUTTER_MAX = 50;
const ISTOCK_MAX = 50;
const DEFAULT_SETTINGS: Settings = { groq_api_key: '', everypixels_id: '', everypixels_secret: '' };
const THUMB_W = 244;
const THUMB_H = 152;
const SETTINGS_KEY = 'stock_metadata_settings';
const ISTOCK_KEY = 'stock_metadata_istock';
const METADATA_KEY = 'stock_metadata_by_file_id';

// ─── Helpers: localStorage ──────────────────────────────────────────────────
function safeParseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    const start = s.indexOf('{');
    if (start === -1) return fallback;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1)) as T;
          } catch {
            return fallback;
          }
        }
      }
    }
  }
  return fallback;
}

function loadSettings(): Settings {
  const s = localStorage.getItem(SETTINGS_KEY);
  if (!s) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...safeParseJson<Partial<Settings>>(s, {}) };
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadIStockMap(): IStockMap {
  const s = localStorage.getItem(ISTOCK_KEY);
  return s ? safeParseJson<IStockMap>(s, {}) : {};
}

function saveIStockMap(map: IStockMap): void {
  localStorage.setItem(ISTOCK_KEY, JSON.stringify(map));
}

function loadMetadataByFileId(): Record<string, MetadataRecord> {
  const s = localStorage.getItem(METADATA_KEY);
  return s ? safeParseJson<Record<string, MetadataRecord>>(s, {}) : {};
}

function saveMetadataByFileId(map: Record<string, MetadataRecord>): void {
  localStorage.setItem(METADATA_KEY, JSON.stringify(map));
}

function emptyRecord(fileName: string): MetadataRecord {
  return {
    file_name: fileName,
    created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    title_en: '', title_tr: '', description_en: '', description_tr: '',
    adobe_keywords_en: [], adobe_keywords_tr: [],
    shutter_keywords_en: [], shutter_keywords_tr: [],
    istock_keywords_en: [], istock_keywords_tr: [],
  };
}

// ─── Helpers: thumbnails & file ─────────────────────────────────────────────
function getFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function isImage(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/');
}

function isVideo(file: File): boolean {
  return file.type.toLowerCase().startsWith('video/');
}

const ALLOWED_EXTENSIONS = ['jpeg', 'jpg', 'mov', 'mp4'];

function isAllowedMedia(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.includes(ext);
}

/** Short side max for image sent to APIs (Everypixel uses ~300px; smaller = faster). */
const API_IMAGE_SHORT_SIDE_PX = 300;
const API_JPEG_QUALITY = 0.78;

/** Resize so the short side is API_IMAGE_SHORT_SIDE_PX, return base64 JPEG for API. */
function resizeToShortSide(w: number, h: number): { w: number; h: number } {
  const short = Math.min(w, h);
  if (short <= API_IMAGE_SHORT_SIDE_PX) return { w, h };
  const scale = API_IMAGE_SHORT_SIDE_PX / short;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Resize image or video frame (short side 300px), return base64 JPEG for API. */
function fileToBase64Jpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (dataUrl: string) => {
      const base64 = dataUrl.split(',')[1];
      if (!base64) reject(new Error('Invalid data URL'));
      else resolve(base64);
    };

    if (isImage(file)) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const { w, h } = resizeToShortSide(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          finish(canvas.toDataURL('image/jpeg', API_JPEG_QUALITY));
        } else reject(new Error('Canvas failed'));
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    } else if (isVideo(file)) {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => { video.currentTime = 0.1; };
      video.onseeked = () => {
        const { w, h } = resizeToShortSide(video.videoWidth, video.videoHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          finish(canvas.toDataURL('image/jpeg', API_JPEG_QUALITY));
        } else reject(new Error('Canvas failed'));
        URL.revokeObjectURL(url);
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video failed')); };
    } else reject(new Error('Unsupported file type'));
  });
}

/** Build a File from base64 JPEG (e.g. for Everypixel when input is video). */
function base64JpegToFile(b64: string, name = 'frame.jpg'): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  return new File([blob], name, { type: 'image/jpeg' });
}

function getThumbnailUrl(file: File): Promise<string> {
  if (isImage(file)) return Promise.resolve(URL.createObjectURL(file));
  if (isVideo(file)) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => { video.currentTime = 0.1; };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, THUMB_W);
        canvas.height = Math.min(video.videoHeight, THUMB_H);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas failed'));
        }
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video failed')); };
    });
  }
  return Promise.reject(new Error('Unsupported file type'));
}

// ─── Helpers: CSV ───────────────────────────────────────────────────────────
function escapeCsvField(val: string): string {
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsvRow(record: MetadataRecord, filePath: string): string {
  const joinKw = (arr: string[]) => arr.filter(Boolean).join(', ');
  const row: Record<string, string> = {
    file_path: filePath, file_name: record.file_name, created_at: record.created_at,
    title_en: record.title_en, title_tr: record.title_tr,
    description_en: record.description_en, description_tr: record.description_tr,
    adobe_keywords_en: joinKw(record.adobe_keywords_en), adobe_keywords_tr: joinKw(record.adobe_keywords_tr),
    shutter_keywords_en: joinKw(record.shutter_keywords_en), shutter_keywords_tr: joinKw(record.shutter_keywords_tr),
    istock_keywords_en: joinKw(record.istock_keywords_en), istock_keywords_tr: joinKw(record.istock_keywords_tr),
  };
  return CSV_HEADERS.map((h) => escapeCsvField(row[h] ?? '')).join(',');
}

function buildCsv(records: { filePath: string; record: MetadataRecord }[]): string {
  return [CSV_HEADERS.join(','), ...records.map(({ filePath, record }) => buildCsvRow(record, filePath))].join('\r\n');
}

function downloadCsv(content: string, filename = '_metadata.csv'): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── API: Groq ─────────────────────────────────────────────────────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_REQUEST_MS = 90000; // 90s timeout so referans/hint doesn't cause infinite hang

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function groqVision(b64: string, prompt: string, key: string, maxTokens = 700): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      GROQ_URL,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }, { type: 'text', text: prompt }] }],
          max_tokens: maxTokens,
        }),
      },
      GROQ_REQUEST_MS,
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Groq vision: İstek zaman aşımına uğradı (90s). Referans metnini kısaltıp tekrar deneyin.');
    throw e;
  }
  if (!res.ok) throw new Error(`Groq vision: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

async function groqText(prompt: string, key: string, maxTokens = 500): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      GROQ_URL,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
      },
      GROQ_REQUEST_MS,
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Groq text: İstek zaman aşımına uğradı (90s).');
    throw e;
  }
  if (!res.ok) throw new Error(`Groq text: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

function extractFirstJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return '';
}

const METADATA_PROMPT = `You are a professional stock photo metadata expert. Analyze this image and generate optimized metadata for microstock platforms (Adobe Stock, Shutterstock, iStock). Consider: buyer search behavior, commercial appeal, SEO.

Return ONLY valid JSON, nothing else: {"title_en":"...","title_tr":"...","description_en":"...","description_tr":"..."}

Title (title_en / title_tr):
- Use the "Who, What, Where, When" formula: one clear sentence (e.g. who is doing what, where, and when if relevant).
- Ideal length: 5–10 words. No unnecessary embellishments.
- Natural language: write a meaningful sentence, do NOT stack keywords. Algorithms rank human-like titles higher. Example: "Woman working on laptop in bright modern office" — NOT "Woman laptop office business".
- Both EN and TR must read naturally.

Description (description_en / description_tr):
- Longer and more detailed than the title. Include mood, setting, lighting, use-cases, and context.
- 150–200 characters. Must be DIFFERENT from the title; never copy or repeat the title verbatim.`;

async function apiMetadata(
  b64: string,
  groqKey: string,
  hint: string,
): Promise<{ title_en: string; title_tr: string; description_en: string; description_tr: string }> {
  const hintTxt = hint.trim() ? `\n\nEk referans bilgi: ${hint}` : '';
  const raw = await groqVision(b64, METADATA_PROMPT + hintTxt, groqKey, 600);
  const jsonStr = extractFirstJsonObject(raw);
  if (!jsonStr) throw new Error('Invalid response: no JSON');
  return JSON.parse(jsonStr);
}

const KEYWORDS_BY_PLATFORM: Record<string, string> = {
  adobe: 'Adobe Stock (max 49 keywords)',
  shutterstock: 'Shutterstock (max 50 keywords)',
  istock: 'iStock/Getty (max 50 keywords)',
};

const KEYWORDS_PROMPT = `You are a microstock SEO expert. Generate optimized English keywords for {platform}.{hint}

First, interpret the image as a story in your mind only (who, what, why, when, where, concept). Do NOT output this story or any explanation—use it only internally to choose keywords.

Then generate keywords that reflect this story: who/what first (specific subject), then category, then place/time, then concepts (why, inspiration). Put the 10 most story-critical terms first.

Keyword rules (follow strictly):
- Hierarchical order: Put the 10 most important keywords FIRST. Adobe Stock and Getty rank early positions higher; order by importance.
- Specific to general order: (1) Specific subject (e.g. Golden Retriever), (2) Category (e.g. Dog, Pet), (3) Concepts (e.g. Loyalty, Friendship).
- Use singular form only; do not add plural variants (e.g. "dog" not "dogs") to save the keyword limit.
- Include conceptual tags that reflect the mood or message (e.g. Loneliness, Success, Sustainability); these are highly searched by agencies.
- Only tag what is clearly visible and central to the image; do not add small background objects or elements that are not the main subject.

Also consider: buyer trends (2024-2025), commercial use (advertising, editorial, web, print), emotions, technical aspects, location/demographics if visible.

Output format (critical): Your response must be exactly one line of comma-separated keywords. No introductory phrase (e.g. no "Here are the keywords:"), no sentences, no bullet points, no story text. Example: wind turbine, power line, renewable energy, sustainability, outdoor, sunset. Generate exactly 50 keywords.`;

async function apiKeywords(b64: string, key: string, hint: string, platform: 'adobe' | 'shutterstock' | 'istock'): Promise<string[]> {
  const hintTxt = hint.trim() ? `\nExtra context: ${hint}` : '';
  const prompt = KEYWORDS_PROMPT.replace('{platform}', KEYWORDS_BY_PLATFORM[platform] ?? 'microstock').replace('{hint}', hintTxt);
  const raw = await groqVision(b64, prompt, key, 450);
  const kws = raw.replace(/["'*\-\n\d.]/g, '').split(',').map((k) => k.trim()).filter(Boolean);
  return kws.slice(0, 50);
}

/** Appends from candidates (no duplicates, case-insensitive) until list length reaches max. */
function fillKeywordsToMax(existing: string[], max: number, candidates: string[]): string[] {
  const set = new Set(existing.map((k) => k.toLowerCase().trim()));
  const out = [...existing];
  for (const k of candidates) {
    if (out.length >= max) break;
    const t = k.trim();
    if (!t || set.has(t.toLowerCase())) continue;
    set.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

const TR_KW_BATCH_SIZE = 25;
const TR_KW_NUMBERED_PROMPT =
  'Translate each numbered line to Turkish. Keep the same numbers. Return ONLY the numbered Turkish translations, one per line. No other text.\n\n';

function parseNumberedLines(raw: string, fallback: string[]): string[] {
  const out = [...fallback];
  const re = /^\s*(\d+)\.\s*(.*)$/;
  for (const line of raw.split('\n')) {
    const m = line.trim().match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      const text = m[2].trim();
      if (num >= 1 && num <= fallback.length) out[num - 1] = text || fallback[num - 1];
    }
  }
  return out;
}

async function apiTranslateKwNumbered(kws: string[], key: string): Promise<string[]> {
  if (kws.length === 0) return [];
  const list = kws.slice(0, 50);
  const out: string[] = [];
  for (let i = 0; i < list.length; i += TR_KW_BATCH_SIZE) {
    const chunk = list.slice(i, i + TR_KW_BATCH_SIZE);
    try {
      const input = chunk.map((w, j) => `${j + 1}. ${w}`).join('\n');
      const raw = await groqText(TR_KW_NUMBERED_PROMPT + input, key, 400);
      out.push(...parseNumberedLines(raw, chunk));
    } catch {
      out.push(...chunk);
    }
  }
  return out;
}

// ─── Context ───────────────────────────────────────────────────────────────
interface AppState {
  files: FileEntry[];
  currentFileId: string | null;
  /** IDs of files selected for batch metadata generation (e.g. checkboxes). */
  selectedIds: Set<string>;
  metadataByFileId: Record<string, MetadataRecord>;
  settings: Settings;
  istockMap: IStockMap;
  hint: string;
}

interface AppActions {
  setFiles: (f: FileEntry[]) => void;
  addFiles: (f: File[]) => void;
  setCurrentFileId: (id: string | null) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setMetadata: (id: string, r: MetadataRecord) => void;
  updateMetadata: (id: string, patch: Partial<MetadataRecord>) => void;
  setSettings: (s: Settings) => void;
  saveSettings: (s: Settings) => void;
  setIstockMap: (m: IStockMap) => void;
  saveIstockMap: (m: IStockMap) => void;
  setHint: (h: string) => void;
  downloadCsvExport: () => void;
  refreshTurkish: (fileId: string, keys: { en: KeywordKey; tr: KeywordKey }, enFull: string[]) => Promise<void>;
}

type KeywordKey = 'adobe_keywords_en' | 'adobe_keywords_tr' | 'shutter_keywords_en' | 'shutter_keywords_tr' | 'istock_keywords_en' | 'istock_keywords_tr';

const AppContext = createContext<AppState & AppActions | null>(null);

function AppProvider({ children }: { children: ReactNode }) {
  const [files, setFilesState] = useState<FileEntry[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [metadataByFileId, setMetadataByFileId] = useState<Record<string, MetadataRecord>>(
    () => (typeof window !== 'undefined' ? loadMetadataByFileId() : {}),
  );
  const [settings, setSettingsState] = useState<Settings>(loadSettings());
  const [istockMap, setIstockMapState] = useState<IStockMap>(loadIStockMap());
  const [hint, setHint] = useState('');

  const setFiles = useCallback((f: FileEntry[]) => setFilesState(f), []);
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => {
    setFilesState((currentFiles) => {
      setSelectedIds(new Set(currentFiles.map((f) => f.id)));
      return currentFiles;
    });
  }, []);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const addFiles = useCallback((newFiles: File[]) => {
    setFilesState((prev) => {
      const existing = new Set(prev.map((x) => x.id));
      const added: FileEntry[] = [];
      for (const file of newFiles) {
        const id = getFileId(file);
        if (!existing.has(id)) {
          existing.add(id);
          added.push({ id, file, name: file.name });
        }
      }
      return [...prev, ...added];
    });
  }, []);

  const setMetadata = useCallback((id: string, record: MetadataRecord) => {
    setMetadataByFileId((prev) => {
      const next = { ...prev, [id]: record };
      if (typeof window !== 'undefined') saveMetadataByFileId(next);
      return next;
    });
  }, []);

  const updateMetadata = useCallback((id: string, patch: Partial<MetadataRecord>) => {
    setMetadataByFileId((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const next = { ...prev, [id]: { ...current, ...patch } };
      if (typeof window !== 'undefined') saveMetadataByFileId(next);
      return next;
    });
  }, []);

  const saveSettingsAction = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  const saveIstockMapAction = useCallback((m: IStockMap) => {
    setIstockMapState(m);
    saveIStockMap(m);
  }, []);

  const downloadCsvExport = useCallback(() => {
    const records = files
      .map((f) => ({ filePath: f.name, record: metadataByFileId[f.id] ?? emptyRecord(f.name) }))
      .filter((r) => r.record.title_en || r.record.title_tr || (r.record.adobe_keywords_en?.length ?? 0) > 0);
    if (records.length === 0) return;
    downloadCsv(buildCsv(records));
  }, [files, metadataByFileId]);

  const refreshTurkish = useCallback(
    async (fileId: string, keys: { en: KeywordKey; tr: KeywordKey }, enFull: string[]) => {
      const record = metadataByFileId[fileId];
      if (!record) return;
      const key = settings.groq_api_key?.trim();
      if (!key) return;
      const enFiltered = enFull.map((s) => (s ?? '').trim()).filter(Boolean);
      if (enFiltered.length === 0) return;
      const trFiltered = await apiTranslateKwNumbered(enFiltered, key);
      const trFull: string[] = [];
      let j = 0;
      for (let i = 0; i < enFull.length; i++) {
        if ((enFull[i] ?? '').trim()) {
          trFull.push(trFiltered[j] ?? enFiltered[j] ?? '');
          j++;
        } else {
          trFull.push('');
        }
      }
      setMetadata(fileId, { ...record, [keys.tr]: trFull });
    },
    [metadataByFileId, setMetadata, settings.groq_api_key],
  );

  const value = useMemo(
    () => ({
      files, currentFileId, selectedIds, metadataByFileId, settings, istockMap, hint,
      setFiles, addFiles, setCurrentFileId, toggleSelection, selectAll, deselectAll,
      setMetadata, updateMetadata,
      setSettings: (s: Settings) => setSettingsState(s), saveSettings: saveSettingsAction,
      setIstockMap: (m: IStockMap) => setIstockMapState(m), saveIstockMap: saveIstockMapAction,
      setHint, downloadCsvExport, refreshTurkish,
    }),
    [files, currentFileId, selectedIds, metadataByFileId, settings, istockMap, hint, saveSettingsAction, saveIstockMapAction, downloadCsvExport, refreshTurkish]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useApp(): AppState & AppActions {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// ─── Components ─────────────────────────────────────────────────────────────
function Toolbar({
  onGenerate,
  generating,
  generatingProgress,
  onOpenIStock,
  onOpenSettings,
}: {
  onGenerate: () => void;
  generating: boolean;
  generatingProgress: { current: number; total: number } | null;
  onOpenIStock: () => void;
  onOpenSettings: () => void;
}) {
  const { hint, setHint } = useApp();
  const progressLabel = generating && generatingProgress ? ` ${generatingProgress.current}/${generatingProgress.total}` : '';
  return (
    <header className="bg-[#090c14] border-b border-border shrink-0 flex items-center p-2 gap-2">
      <div className="w-[290px] shrink-0 flex items-center gap-3">
        <img src="/logo.png" alt="BBS STUDIO" className="h-8 w-auto object-contain invert brightness-110" />
        <span className="text-text font-semibold text-sm truncate">Stock Metadata Generator</span>
      </div>
      <div className="flex items-center rounded-lg border border-border bg-card2 px-3 py-1.5 min-w-0 flex-1 max-w-2xl">
        <span className="text-text3 text-xs mr-2 shrink-0">Referans</span>
        <input type="text" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="AI'ya ek ipucu..." className="flex-1 min-w-0 w-0 bg-transparent border-0 text-text text-sm placeholder-text3 outline-none" />
      </div>
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap shrink-0">
        <button type="button" onClick={onGenerate} disabled={generating} className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white font-semibold text-sm disabled:opacity-50">
          {generating ? `⏳ Üretiliyor…${progressLabel}` : '⚡ Metadata Üret'}
        </button>
        <div className="w-px h-7 bg-border" />
        <button type="button" onClick={onOpenIStock} className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm">📚 iStock</button>
        <div className="w-px h-7 bg-border" />
        <button type="button" onClick={onOpenSettings} className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm">⚙ Ayarlar</button>
      </div>
    </header>
  );
}

function Thumbnail({
  entry,
  selected,
  selectedForBatch,
  hasMetadata,
  onClick,
  onToggleBatch,
}: {
  entry: FileEntry;
  selected: boolean;
  selectedForBatch: boolean;
  hasMetadata: boolean;
  onClick: () => void;
  onToggleBatch: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isInView, setIsInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setIsInView(true);
      },
      { rootMargin: '100px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!isInView) return;
    let revoked = false;
    enqueueThumbnail(() => getThumbnailUrl(entry.file))
      .then((u) => {
        objectUrlRef.current = u;
        if (!revoked) setUrl(u);
      })
      .catch(() => {
        if (!revoked) setUrl(null);
      });
    return () => {
      revoked = true;
      const u = objectUrlRef.current;
      if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
      objectUrlRef.current = null;
    };
  }, [entry.id, entry.file, isInView]);

  const showVideoPlaceholder = isVideo(entry.file) && !url;
  const showImagePlaceholder = !isVideo(entry.file) && !url;

  return (
    <div ref={rootRef} className="w-full">
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left rounded-lg p-1.5 border-2 transition-colors ${selected ? 'bg-sel border-accent' : 'border-transparent bg-card hover:bg-hover'}`}
      >
        <div className="relative rounded overflow-hidden bg-bg flex items-center justify-center" style={{ width: THUMB_W, height: THUMB_H }}>
          <button
            type="button"
            aria-label={selectedForBatch ? 'Seçimi kaldır' : 'Toplu işleme için seç'}
            onClick={(e) => { e.stopPropagation(); onToggleBatch(); }}
            className="absolute left-1 top-1 z-10 rounded border border-border bg-card/90 hover:bg-hover w-5 h-5 flex items-center justify-center text-text2 shadow"
          >
            {selectedForBatch ? <span className="text-green text-sm">✓</span> : null}
          </button>
          {url ? (
            <img src={url} alt="" className="max-w-full max-h-full object-contain" style={{ maxWidth: THUMB_W, maxHeight: THUMB_H }} />
          ) : showVideoPlaceholder ? (
            <div className="flex flex-col items-center justify-center gap-1 px-2 py-3 text-center">
              <span className="text-text3 text-3xl" aria-hidden>🎬</span>
              <span className="text-text3 text-xs">Önizleme yok</span>
            </div>
          ) : showImagePlaceholder ? (
            <span className="text-text3 text-2xl">🖼</span>
          ) : null}
        </div>
        <p className="text-text text-xs mt-1 truncate px-1" style={{ maxWidth: THUMB_W + 8 }}>{entry.name.length > 28 ? entry.name.slice(0, 25) + '...' : entry.name}</p>
        {hasMetadata && <div className="h-0.5 bg-green rounded-full mx-1" />}
      </button>
    </div>
  );
}

function FileList() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState('');
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }
  }, []);
  const { files, setFiles, currentFileId, setCurrentFileId, selectedIds, toggleSelection, selectAll, deselectAll, metadataByFileId, downloadCsvExport } = useApp();

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected?.length) return;
    const list: File[] = [];
    let name = '';
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      if (i === 0 && path) name = path.split('/')[0] || f.name;
      if (isAllowedMedia(f)) list.push(f);
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    setFiles(list.map((file) => ({ id: getFileId(file), file, name: file.name })));
    setFolderName(name || (list[0]?.name ? 'Folder' : ''));
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const items = e.dataTransfer?.files;
    if (!items?.length) return;
    const list: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (isAllowedMedia(f)) list.push(f);
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    setFiles(list.map((file) => ({ id: getFileId(file), file, name: file.name })));
    setFolderName('');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <button type="button" onClick={() => folderInputRef.current?.click()} className="h-10 rounded-lg bg-card2 hover:bg-sel text-text font-semibold text-sm border border-border mb-1">📁 Select folder</button>
      <input ref={folderInputRef} type="file" multiple accept=".jpg,.jpeg,.mov,.mp4" onChange={handleFolderChange} className="hidden" />
      <div className="text-text3 text-xs mb-0.5 flex items-center gap-2 min-w-0" title={folderName || undefined}>
        <span className="truncate min-w-0">{files.length ? (folderName ? `📁 ${folderName}` : `📁 ${files.length} files`) : 'No folder selected'}</span>
        <span className="shrink-0 text-text3">·</span>
        <span className="font-semibold shrink-0">FILES {files.length}</span>
      </div>
      {files.length > 0 && (
        <div className="flex items-center gap-2 mb-1">
          <button type="button" onClick={selectAll} className="text-text3 hover:text-text text-xs">Tümünü seç</button>
          <span className="text-text3 text-xs">|</span>
          <button type="button" onClick={deselectAll} className="text-text3 hover:text-text text-xs">Seçimi kaldır</button>
          {selectedIds.size > 0 && <span className="text-green text-xs ml-1">({selectedIds.size} seçili)</span>}
        </div>
      )}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        {files.length === 0 && <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-text3 text-sm" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>Drop images/videos here or use the button above</div>}
        {files.map((entry) => {
          const meta = metadataByFileId[entry.id];
          const hasMeta = !!(meta && (meta.title_en || meta.title_tr || (meta.adobe_keywords_en?.length ?? 0) > 0));
          return (
            <Thumbnail
              key={entry.id}
              entry={entry}
              selected={currentFileId === entry.id}
              selectedForBatch={selectedIds.has(entry.id)}
              hasMetadata={hasMeta}
              onClick={() => setCurrentFileId(entry.id)}
              onToggleBatch={() => toggleSelection(entry.id)}
            />
          );
        })}
      </div>
      <div className="border-t border-border mt-2 pt-2">
        <button type="button" onClick={downloadCsvExport} className="w-full h-9 rounded-lg bg-greenBg hover:bg-[#143020] text-green font-semibold text-sm">💾 Download CSV</button>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="w-[290px] shrink-0 rounded-xl bg-card border border-border p-3 flex flex-col min-h-0">
      <FileList />
    </aside>
  );
}

function Field({ label, lang, value, onChange, multiline }: { label: string; lang: 'EN' | 'TR'; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  const badgeBg = lang === 'EN' ? '#162a52' : '#0f2c1a';
  const badgeFg = lang === 'EN' ? '#5b9af8' : '#4ade80';
  const isEn = lang === 'EN';
  return (
    <div className="rounded-lg border border-[#20263a] bg-card2 p-2">
      {multiline ? (
        <div className="flex items-start gap-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 h-20 rounded-lg bg-input border border-border text-text text-sm p-2 resize-none outline-none focus:ring-1 focus:ring-accent"
            placeholder={label}
          />
          <div className="flex flex-col gap-1 items-end shrink-0">
            {isEn ? (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(value)}
                className="text-xs font-bold px-1.5 py-0.5 rounded flex items-center gap-1 hover:brightness-110"
                style={{ backgroundColor: badgeBg, color: badgeFg }}
              >
                <span>EN</span>
                <span className="text-[10px]">⎘</span>
              </button>
            ) : (
              <span
                className="text-xs font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: badgeBg, color: badgeFg }}
              >
                {lang}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            placeholder={label}
          />
          {isEn ? (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(value)}
              className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 hover:brightness-110"
              style={{ backgroundColor: badgeBg, color: badgeFg }}
            >
              <span>EN</span>
              <span className="text-[10px]">⎘</span>
            </button>
          ) : (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{ backgroundColor: badgeBg, color: badgeFg }}
            >
              {lang}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TitleDescriptionForm() {
  const { files, currentFileId, metadataByFileId, updateMetadata } = useApp();
  if (!currentFileId) return null;
  const entry = files.find((f) => f.id === currentFileId);
  const record = metadataByFileId[currentFileId];
  if (!entry || !record) return null;
  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      <Field label="Başlık" lang="EN" value={record.title_en ?? ''} onChange={(v) => updateMetadata(currentFileId, { title_en: v })} />
      <Field label="Başlık" lang="TR" value={record.title_tr ?? ''} onChange={(v) => updateMetadata(currentFileId, { title_tr: v })} />
      <Field label="Açıklama" lang="EN" value={record.description_en ?? ''} onChange={(v) => updateMetadata(currentFileId, { description_en: v })} multiline />
      <Field label="Açıklama" lang="TR" value={record.description_tr ?? ''} onChange={(v) => updateMetadata(currentFileId, { description_tr: v })} multiline />
    </div>
  );
}

function KeywordListSynced({ keys, maxKw, record, onUpdateEn, onUpdateTr, filter = '' }: {
  keys: { en: KeywordKey; tr: KeywordKey };
  maxKw: number;
  record: MetadataRecord;
  onUpdateEn: (kw: string[]) => void;
  onUpdateTr: (kw: string[]) => void;
  filter?: string;
}) {
  const enScrollRef = useRef<HTMLDivElement>(null);
  const trScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const syncScroll = useCallback((source: 'en' | 'tr') => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const enEl = enScrollRef.current;
    const trEl = trScrollRef.current;
    if (enEl && trEl) {
      if (source === 'en') trEl.scrollTop = enEl.scrollTop;
      else enEl.scrollTop = trEl.scrollTop;
    }
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const enArr = (record[keys.en] as string[]) ?? [];
  const trArr = (record[keys.tr] as string[]) ?? [];
  const enList = [...enArr];
  const trList = [...trArr];
  while (enList.length < maxKw) enList.push('');
  while (trList.length < maxKw) trList.push('');
  const setOneEn = (index: number, value: string) => { const next = [...enList]; next[index] = value; onUpdateEn(next); };
  const setOneTr = (index: number, value: string) => { const next = [...trList]; next[index] = value; onUpdateTr(next); };
  const filterLower = filter.trim().toLowerCase();
  const visibleIndices = filterLower
    ? Array.from({ length: maxKw }, (_, i) => i).filter(
        (i) =>
          (enList[i] ?? '').toLowerCase().includes(filterLower) ||
          (trList[i] ?? '').toLowerCase().includes(filterLower),
      )
    : Array.from({ length: maxKw }, (_, i) => i);
  const inputClass = 'flex-1 min-w-0 bg-transparent border border-transparent hover:border-border rounded px-2 py-1 text-text text-sm outline-none focus:border-accent';
  const scrollClass = 'flex-1 overflow-y-auto p-2 space-y-0.5 min-h-[120px]';
  return (
    <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
      <div className="flex flex-col min-h-0 rounded-lg bg-input border border-border overflow-hidden">
        <div ref={enScrollRef} className={scrollClass} onScroll={() => syncScroll('en')}>
          {visibleIndices.map((i) => (
            <div key={i} className={`flex items-center gap-1 ${i < 10 ? 'bg-accent/5 rounded px-1 -mx-1' : ''}`}>
              <span className={`text-xs w-6 shrink-0 ${i < 10 ? 'text-accent font-medium' : 'text-text3'}`}>{String(i + 1).padStart(2, '0')}</span>
              <input type="text" value={enList[i]} onChange={(e) => setOneEn(i, e.target.value)} className={inputClass} placeholder="EN" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col min-h-0 rounded-lg bg-input border border-border overflow-hidden">
        <div ref={trScrollRef} className={scrollClass} onScroll={() => syncScroll('tr')}>
          {visibleIndices.map((i) => (
            <div key={i} className={`flex items-center gap-1 ${i < 10 ? 'bg-accent/5 rounded px-1 -mx-1' : ''}`}>
              <span className={`text-xs w-6 shrink-0 ${i < 10 ? 'text-accent font-medium' : 'text-text3'}`}>{String(i + 1).padStart(2, '0')}</span>
              <input type="text" value={trList[i]} onChange={(e) => setOneTr(i, e.target.value)} className={inputClass} placeholder="TR" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TabId = 'adobe' | 'shutterstock' | 'istock';
const TABS: { id: TabId; label: string; maxKw: number }[] = [
  { id: 'adobe', label: 'Adobe Stock', maxKw: ADOBE_MAX },
  { id: 'shutterstock', label: 'Shutterstock', maxKw: SHUTTER_MAX },
  { id: 'istock', label: 'iStock', maxKw: ISTOCK_MAX },
];
const KEY_MAP: Record<TabId, { en: KeywordKey; tr: KeywordKey }> = {
  adobe: { en: 'adobe_keywords_en', tr: 'adobe_keywords_tr' },
  shutterstock: { en: 'shutter_keywords_en', tr: 'shutter_keywords_tr' },
  istock: { en: 'istock_keywords_en', tr: 'istock_keywords_tr' },
};

function KeywordTabs({ onError }: { onError?: (msg: string) => void }) {
  const [activeTab, setActiveTab] = useState<TabId>('adobe');
  const [refreshingTr, setRefreshingTr] = useState(false);
  const [keywordFilter, setKeywordFilter] = useState('');
  const { currentFileId, metadataByFileId, updateMetadata, istockMap, saveIstockMap, refreshTurkish } = useApp();
  const originalIstockEnRef = useRef<{ fileId: string; en: string[] }>({ fileId: '', en: [] });
  useEffect(() => {
    if (!currentFileId) return;
    const record = metadataByFileId[currentFileId];
    const en = (record?.istock_keywords_en ?? []) as string[];
    if (originalIstockEnRef.current.fileId !== currentFileId) {
      originalIstockEnRef.current = { fileId: currentFileId, en: [...en] };
    }
  }, [currentFileId, metadataByFileId]);
  if (!currentFileId) return null;
  const record = metadataByFileId[currentFileId];
  if (!record) return null;
  const tab = TABS.find((t) => t.id === activeTab)!;
  const keys = KEY_MAP[activeTab];
  const enKeywords = ((record[keys.en] as string[]) ?? []).filter(Boolean);
  const handleCopyEn = () => {
    if (!enKeywords.length) return;
    navigator.clipboard.writeText(enKeywords.join(', '));
  };
  const handleAddToLibrary = () => {
    if (activeTab !== 'istock') return;
    const next = { ...istockMap };
    const original = originalIstockEnRef.current.fileId === currentFileId ? originalIstockEnRef.current.en : [];
    const currentFull = (record[keys.en] as string[]) ?? [];
    for (let i = 0; i < Math.max(original.length, currentFull.length); i++) {
      const orig = (original[i] ?? '').trim();
      const curr = (currentFull[i] ?? '').trim();
      if (orig && curr && orig.toLowerCase() !== curr.toLowerCase()) {
        next[orig.toLowerCase()] = curr;
      }
    }
    saveIstockMap(next);
  };
  const handleRefreshTurkish = async () => {
    if (!currentFileId || !enKeywords.length) return;
    const enFull = (record[keys.en] as string[]) ?? [];
    setRefreshingTr(true);
    onError?.('');
    try {
      await refreshTurkish(currentFileId, keys, enFull);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Türkçe güncellenemedi');
    } finally {
      setRefreshingTr(false);
    }
  };
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center mb-1">
        <div className="flex gap-1 rounded-lg bg-card2 border border-border px-1 py-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium ${
                activeTab === t.id ? 'bg-accent text-white' : 'bg-transparent text-text2 hover:bg-hover'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={handleCopyEn} className="ml-2 px-3 py-1 rounded-md bg-card2 border border-border text-xs text-text2 hover:text-text">EN ⎘</button>
        {activeTab === 'istock' && (
          <>
            <button type="button" onClick={handleAddToLibrary} disabled={!enKeywords.length} className="ml-2 px-3 py-1 rounded-md bg-[#2a1060] hover:bg-[#3a1880] disabled:opacity-50 text-[#c4b5fd] text-xs" title="Mevcut iStock EN anahtar kelimelerini kütüphaneye ekle">Kütüphaneye Ekle</button>
            <button type="button" onClick={() => { const mapped = (record.istock_keywords_en ?? []).map((k) => istockMap[k.toLowerCase().trim()] ?? k); const en = [...new Set(mapped)]; updateMetadata(currentFileId, { istock_keywords_en: en }); }} className="ml-2 px-3 py-1 rounded-md bg-[#2a1060] hover:bg-[#3a1880] text-[#c4b5fd] text-xs" title="Kütüphane eşleşmelerini uygula">iStock Eşleştir</button>
          </>
        )}
        <button type="button" onClick={handleRefreshTurkish} disabled={!enKeywords.length || refreshingTr} className="ml-2 px-3 py-1 rounded-md bg-card2 border border-border text-text2 hover:text-text text-xs disabled:opacity-50" title="Mevcut İngilizce kelimelere göre Türkçe karşılıkları yeniden çevir">{refreshingTr ? '⏳' : ''} Türkçeyi güncelle</button>
        <span className="ml-auto text-xs text-text3">max {tab.maxKw}</span>
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <input type="text" value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)} placeholder="Anahtar kelime ara (EN/TR)..." className="flex-1 h-8 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent placeholder-text3" />
        {keywordFilter.trim() && <button type="button" onClick={() => setKeywordFilter('')} className="h-8 px-2 rounded-lg text-text3 hover:text-text text-sm" title="Filtreyi temizle">✕</button>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <KeywordListSynced keys={keys} maxKw={tab.maxKw} record={record} onUpdateEn={(kw) => updateMetadata(currentFileId, { [keys.en]: kw })} onUpdateTr={(kw) => updateMetadata(currentFileId, { [keys.tr]: kw })} filter={keywordFilter} />
      </div>
    </div>
  );
}

function MainForm({ onError }: { onError?: (msg: string) => void }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-transparent">
      <TitleDescriptionForm />
      <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-card border border-border p-3">
        <KeywordTabs onError={onError} />
      </div>
    </div>
  );
}

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSettings } = useApp();
  const [groq, setGroq] = useState('');
  const [epId, setEpId] = useState('');
  const [epSecret, setEpSecret] = useState('');
  useEffect(() => { if (open) { setGroq(settings.groq_api_key); setEpId(settings.everypixels_id); setEpSecret(settings.everypixels_secret); } }, [open, settings]);
  const handleSave = () => { saveSettings({ groq_api_key: groq.trim(), everypixels_id: epId.trim(), everypixels_secret: epSecret.trim() }); onClose(); };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border p-6 w-[500px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-text font-bold text-lg mb-4">API Ayarları</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3"><label className="text-text2 w-48 text-sm">Groq API Key</label><input type="password" value={groq} onChange={(e) => setGroq(e.target.value)} placeholder="••••••••" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" /></div>
          <div className="flex items-center gap-3"><label className="text-text2 w-48 text-sm">Everypixels Client ID</label><input type="text" value={epId} onChange={(e) => setEpId(e.target.value)} className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" /></div>
          <div className="flex items-center gap-3"><label className="text-text2 w-48 text-sm">Everypixels Client Secret</label><input type="password" value={epSecret} onChange={(e) => setEpSecret(e.target.value)} placeholder="••••••••" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" /></div>
        </div>
        <button type="button" onClick={handleSave} className="mt-4 w-full h-9 rounded-lg bg-accent hover:bg-accentH text-white font-semibold">💾 Kaydet</button>
      </div>
    </div>
  );
}

function IStockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { istockMap, setIstockMap, saveIstockMap } = useApp();
  const [generic, setGeneric] = useState('');
  const [istock, setIstock] = useState('');
  const [entries, setEntries] = useState<[string, string][]>([]);
  useEffect(() => { if (open) setEntries(Object.entries(istockMap).sort((a, b) => a[0].localeCompare(b[0]))); }, [open, istockMap]);
  const genericKey = generic.trim().toLowerCase();
  const existingIstock = genericKey ? istockMap[genericKey] : undefined;
  const handleAdd = () => {
    const g = generic.trim().toLowerCase();
    const i = istock.trim();
    if (g && i) {
      const next = { ...istockMap, [g]: i };
      setIstockMap(next);
      saveIstockMap(next);
      setGeneric('');
      setIstock('');
      setEntries(Object.entries(next).sort((a, b) => a[0].localeCompare(b[0])));
    }
  };
  const handleRemove = (key: string) => {
    const next = { ...istockMap }; delete next[key]; setIstockMap(next); saveIstockMap(next);
    setEntries(Object.entries(next).sort((a, b) => a[0].localeCompare(b[0])));
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border p-6 w-[640px] max-w-[90vw] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-text font-bold text-lg mb-2">iStock Keyword Eşleştirmesi</h2>
        <div className="flex flex-col gap-2 mb-4 p-3 rounded-lg bg-card2 border border-border">
          <div className="flex gap-2 items-center">
            <input type="text" value={generic} onChange={(e) => setGeneric(e.target.value)} placeholder="Generic word" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none" />
            <span className="text-text2 self-center">→</span>
            <input type="text" value={istock} onChange={(e) => setIstock(e.target.value)} placeholder="iStock equivalent" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none" />
            <button type="button" onClick={handleAdd} className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white text-sm font-medium">+ Add</button>
          </div>
          {existingIstock !== undefined && (
            <p className="text-xs text-text3">
              &quot;{genericKey}&quot; zaten kütüphanede{existingIstock ? ` → ${existingIstock}. Add ile güncellersiniz.` : '. Add ile güncellersiniz.'}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {entries.map(([gen, ist]) => (
            <div key={gen} className="flex items-center justify-between rounded-lg bg-card2 border border-border px-3 py-2">
              <span className="text-text2 truncate flex-1">{gen}</span>
              <span className="text-[#5b9af8] truncate flex-1 text-center">→</span>
              <span className="text-[#5b9af8] truncate flex-1">{ist}</span>
              <button type="button" onClick={() => handleRemove(gen)} className="text-red-400 hover:text-red-300 ml-2 px-2 py-1 rounded text-sm">✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────
function AppContent() {
  const { files, currentFileId, setCurrentFileId, selectedIds, metadataByFileId, setMetadata, settings, hint, istockMap } = useApp();
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState<{ current: number; total: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [iStockOpen, setIStockOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentEntry = files.find((f) => f.id === currentFileId);

  useEffect(() => {
    if (currentFileId && currentEntry && !metadataByFileId[currentFileId]) setMetadata(currentFileId, emptyRecord(currentEntry.name));
  }, [currentFileId, currentEntry, metadataByFileId, setMetadata]);

  const mapIstock = useCallback((kws: string[]) => kws.map((k) => istockMap[k.toLowerCase().trim()] ?? k), [istockMap]);

  const handleGenerate = useCallback(async () => {
    const key = settings.groq_api_key?.trim();
    if (!key) { setError('Enter Groq API key in Settings.'); return; }
    const orderedEntries = files.filter((f) => selectedIds.has(f.id));
    const toProcess = orderedEntries.length > 0 ? orderedEntries : (currentEntry ? [currentEntry] : []);
    if (toProcess.length === 0) { setError('En az bir dosya seçin veya listeden bir dosyaya tıklayın.'); return; }
    setError(null);
    setGenerating(true);
    setGeneratingProgress(toProcess.length > 1 ? { current: 0, total: toProcess.length } : null);
    try {
      const hintText = hint.trim();
      for (let i = 0; i < toProcess.length; i++) {
        const entry = toProcess[i];
        if (toProcess.length > 1) setGeneratingProgress({ current: i + 1, total: toProcess.length });
        setCurrentFileId(entry.id);
        const b64 = await fileToBase64Jpeg(entry.file);
        const epId = settings.everypixels_id?.trim();
        const epSecret = settings.everypixels_secret?.trim();

        const getEnKeywords = async (): Promise<{ adobeEn: string[]; shutterEn: string[]; istockEn: string[] }> => {
          if (epId && epSecret) {
            try {
              const fileForEp = isVideo(entry.file) ? base64JpegToFile(b64, 'frame.jpg') : entry.file;
              const epResult = await apiEverypixels(fileForEp, epId, epSecret);
              const allKw = everypixelToKeywordStrings(epResult);
              let adobeEn = allKw.slice(0, ADOBE_MAX);
              let shutterEn = allKw.slice(0, SHUTTER_MAX);
              let istockEn = mapIstock(allKw.slice(0, ISTOCK_MAX));
              const [groqAdobe, groqShutter, groqIstock] = await Promise.all([
                adobeEn.length < ADOBE_MAX ? apiKeywords(b64, key, hintText, 'adobe') : Promise.resolve([]),
                shutterEn.length < SHUTTER_MAX ? apiKeywords(b64, key, hintText, 'shutterstock') : Promise.resolve([]),
                istockEn.length < ISTOCK_MAX ? apiKeywords(b64, key, hintText, 'istock') : Promise.resolve([]),
              ]);
              adobeEn = fillKeywordsToMax(adobeEn, ADOBE_MAX, groqAdobe);
              shutterEn = fillKeywordsToMax(shutterEn, SHUTTER_MAX, groqShutter);
              istockEn = fillKeywordsToMax(istockEn, ISTOCK_MAX, mapIstock(groqIstock));
              return { adobeEn, shutterEn, istockEn };
            } catch {
              const [adobeEn, shutterEn, istockEn] = await Promise.all([
                apiKeywords(b64, key, hintText, 'adobe').then((k) => k.slice(0, ADOBE_MAX)),
                apiKeywords(b64, key, hintText, 'shutterstock').then((k) => k.slice(0, SHUTTER_MAX)),
                apiKeywords(b64, key, hintText, 'istock').then((k) => mapIstock(k.slice(0, ISTOCK_MAX))),
              ]);
              return { adobeEn, shutterEn, istockEn };
            }
          }
          const [adobeEn, shutterEn, istockEn] = await Promise.all([
            apiKeywords(b64, key, hintText, 'adobe').then((k) => k.slice(0, ADOBE_MAX)),
            apiKeywords(b64, key, hintText, 'shutterstock').then((k) => k.slice(0, SHUTTER_MAX)),
            apiKeywords(b64, key, hintText, 'istock').then((k) => mapIstock(k.slice(0, ISTOCK_MAX))),
          ]);
          return { adobeEn, shutterEn, istockEn };
        };

        const [enResult, meta] = await Promise.all([getEnKeywords(), apiMetadata(b64, key, hintText)]);
        const { adobeEn, shutterEn, istockEn } = enResult;
        const [adobeTr, shutterTr, istockTr] = await Promise.all([
          apiTranslateKwNumbered(adobeEn, key),
          apiTranslateKwNumbered(shutterEn, key),
          apiTranslateKwNumbered(istockEn, key),
        ]);
        const record: MetadataRecord = {
          file_name: entry.name,
          created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
          title_en: meta.title_en ?? '', title_tr: meta.title_tr ?? '',
          description_en: meta.description_en ?? '', description_tr: meta.description_tr ?? '',
          adobe_keywords_en: adobeEn, adobe_keywords_tr: adobeTr,
          shutter_keywords_en: shutterEn, shutter_keywords_tr: shutterTr,
          istock_keywords_en: istockEn, istock_keywords_tr: istockTr,
        };
        setMetadata(entry.id, record);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
      setGeneratingProgress(null);
    }
  }, [files, selectedIds, currentEntry, settings, hint, mapIstock, setMetadata, setCurrentFileId]);

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Toolbar onGenerate={handleGenerate} generating={generating} generatingProgress={generatingProgress} onOpenIStock={() => setIStockOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
      {error && <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm">{error}</div>}
      <div className="flex-1 flex min-h-0 p-2 gap-2">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <MainForm onError={setError} />
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <IStockModal open={iStockOpen} onClose={() => setIStockOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
