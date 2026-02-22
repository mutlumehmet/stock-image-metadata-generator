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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (isImage(file)) {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    } else if (isVideo(file)) {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => { video.currentTime = 0.1; };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas failed'));
        }
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video failed')); };
    } else reject(new Error('Unsupported file type'));
  });
}

function fileToBase64Jpeg(file: File): Promise<string> {
  return fileToDataUrl(file).then((dataUrl) => {
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('Invalid data URL');
    return base64;
  });
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

async function groqVision(b64: string, prompt: string, key: string, maxTokens = 700): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }, { type: 'text', text: prompt }] }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Groq vision: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

async function groqText(prompt: string, key: string, maxTokens = 500): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
  });
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

const METADATA_PROMPT = `You are a professional stock photo metadata expert. Analyze this image and generate optimized metadata for microstock platforms. Consider: current market trends, buyer search behavior, commercial appeal, SEO. Return ONLY valid JSON: {"title_en":"...","title_tr":"...","description_en":"...","description_tr":"..."} Rules: title max 70 chars, description 150-200 chars, natural EN/TR.`;

async function apiMetadata(b64: string, key: string, hint = ''): Promise<{ title_en: string; title_tr: string; description_en: string; description_tr: string }> {
  const hintTxt = hint.trim() ? `\n\nEk referans bilgi: ${hint}` : '';
  const raw = await groqVision(b64, METADATA_PROMPT + hintTxt, key, 600);
  const jsonStr = extractFirstJsonObject(raw);
  if (!jsonStr) throw new Error('Invalid response: no JSON');
  return JSON.parse(jsonStr);
}

const KEYWORDS_BY_PLATFORM: Record<string, string> = {
  adobe: 'Adobe Stock (max 49 keywords)',
  shutterstock: 'Shutterstock (max 50 keywords)',
  istock: 'iStock/Getty (max 50 keywords)',
};

const KEYWORDS_PROMPT = `You are a microstock SEO expert. Generate optimized English keywords for {platform}.{hint} Analyze image: buyer trends, commercial use, emotions, concepts. Return ONLY comma-separated keywords, exactly 50.`;

async function apiKeywords(b64: string, key: string, hint: string, platform: 'adobe' | 'shutterstock' | 'istock'): Promise<string[]> {
  const hintTxt = hint.trim() ? `\nExtra context: ${hint}` : '';
  const prompt = KEYWORDS_PROMPT.replace('{platform}', KEYWORDS_BY_PLATFORM[platform] ?? 'microstock').replace('{hint}', hintTxt);
  const raw = await groqVision(b64, prompt, key, 450);
  const kws = raw.replace(/["'*\-\n\d.]/g, '').split(',').map((k) => k.trim()).filter(Boolean);
  return kws.slice(0, 50);
}

async function apiTranslate(text: string, toLang: 'tr' | 'en', key: string): Promise<string> {
  const lang = toLang === 'tr' ? 'Türkçe' : 'English';
  return groqText(`Translate to ${lang}. Natural and professional. Return ONLY the translation:\n\n${text}`, key, 350);
}

async function apiTranslateKw(kws: string[], key: string): Promise<string[]> {
  try {
    const raw = await apiTranslate(kws.slice(0, 50).join(', '), 'tr', key);
    const parts = raw.split(',').map((p) => p.trim());
    return [...parts, ...kws].slice(0, kws.length);
  } catch {
    return kws;
  }
}

async function apiEverypixels(file: File, clientId: string, clientSecret: string): Promise<string[]> {
  const form = new FormData();
  form.append('data', file, file.name);
  const res = await fetch('https://api.everypixel.com/v1/keywords', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`) },
    body: form,
  });
  if (!res.ok) throw new Error(`Everypixels: ${res.status}`);
  const data = await res.json();
  return (data?.keywords ?? []).map((k: { keyword?: string }) => k.keyword ?? '').filter(Boolean);
}

// ─── Context ───────────────────────────────────────────────────────────────
interface AppState {
  files: FileEntry[];
  currentFileId: string | null;
  metadataByFileId: Record<string, MetadataRecord>;
  settings: Settings;
  istockMap: IStockMap;
  hint: string;
}

interface AppActions {
  setFiles: (f: FileEntry[]) => void;
  addFiles: (f: File[]) => void;
  setCurrentFileId: (id: string | null) => void;
  setMetadata: (id: string, r: MetadataRecord) => void;
  updateMetadata: (id: string, patch: Partial<MetadataRecord>) => void;
  setSettings: (s: Settings) => void;
  saveSettings: (s: Settings) => void;
  setIstockMap: (m: IStockMap) => void;
  saveIstockMap: (m: IStockMap) => void;
  setHint: (h: string) => void;
  downloadCsvExport: () => void;
  applyFindReplace: (find: string, replace: string) => void;
}

const AppContext = createContext<AppState & AppActions | null>(null);

function AppProvider({ children }: { children: ReactNode }) {
  const [files, setFilesState] = useState<FileEntry[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [metadataByFileId, setMetadataByFileId] = useState<Record<string, MetadataRecord>>({});
  const [settings, setSettingsState] = useState<Settings>(loadSettings());
  const [istockMap, setIstockMapState] = useState<IStockMap>(loadIStockMap());
  const [hint, setHint] = useState('');

  const setFiles = useCallback((f: FileEntry[]) => setFilesState(f), []);
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
    setMetadataByFileId((prev) => ({ ...prev, [id]: record }));
  }, []);

  const updateMetadata = useCallback((id: string, patch: Partial<MetadataRecord>) => {
    setMetadataByFileId((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return { ...prev, [id]: { ...current, ...patch } };
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

  const applyFindReplace = useCallback((find: string, replace: string) => {
    if (!currentFileId || !find.trim()) return;
    const record = metadataByFileId[currentFileId];
    if (!record) return;
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const repl = (s: string) => s.replace(re, replace);
    const arrRepl = (arr: string[]) => (arr ?? []).map(repl);
    setMetadataByFileId((prev) => ({
      ...prev,
      [currentFileId]: {
        ...record,
        title_en: repl(record.title_en), title_tr: repl(record.title_tr),
        description_en: repl(record.description_en), description_tr: repl(record.description_tr),
        adobe_keywords_en: arrRepl(record.adobe_keywords_en), adobe_keywords_tr: arrRepl(record.adobe_keywords_tr),
        shutter_keywords_en: arrRepl(record.shutter_keywords_en), shutter_keywords_tr: arrRepl(record.shutter_keywords_tr),
        istock_keywords_en: arrRepl(record.istock_keywords_en), istock_keywords_tr: arrRepl(record.istock_keywords_tr),
      },
    }));
  }, [currentFileId, metadataByFileId]);

  const value = useMemo(
    () => ({
      files, currentFileId, metadataByFileId, settings, istockMap, hint,
      setFiles, addFiles, setCurrentFileId, setMetadata, updateMetadata,
      setSettings: (s: Settings) => setSettingsState(s), saveSettings: saveSettingsAction,
      setIstockMap: (m: IStockMap) => setIstockMapState(m), saveIstockMap: saveIstockMapAction,
      setHint, downloadCsvExport, applyFindReplace,
    }),
    [files, currentFileId, metadataByFileId, settings, istockMap, hint, saveSettingsAction, saveIstockMapAction, downloadCsvExport, applyFindReplace]
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
  onOpenFindReplace,
  onOpenIStock,
  onOpenSettings,
}: {
  onGenerate: () => void;
  generating: boolean;
  onOpenFindReplace: () => void;
  onOpenIStock: () => void;
  onOpenSettings: () => void;
}) {
  const { hint, setHint } = useApp();
  return (
    <header className="h-14 flex items-center justify-between px-4 bg-[#090c14] border-b border-border shrink-0">
      <span className="text-text font-semibold text-sm">◈ Stock Metadata Generator</span>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border bg-card2 px-3 py-1.5">
          <span className="text-text3 text-xs mr-2">Referans</span>
          <input type="text" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="AI'ya ek ipucu..." className="w-48 bg-transparent border-0 text-text text-sm placeholder-text3 outline-none" />
        </div>
        <button type="button" onClick={onGenerate} disabled={generating} className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white font-semibold text-sm disabled:opacity-50">
          {generating ? '⏳ Generating…' : '⚡ Metadata Üret'}
        </button>
        <div className="w-px h-7 bg-border" />
        <button type="button" onClick={onOpenFindReplace} className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm">⌘ Bul & Değiştir</button>
        <button type="button" onClick={onOpenIStock} className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm">📚 iStock</button>
        <div className="w-px h-7 bg-border" />
        <button type="button" onClick={onOpenSettings} className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm">⚙ Ayarlar</button>
      </div>
    </header>
  );
}

function Thumbnail({ entry, selected, hasMetadata, onClick }: { entry: FileEntry; selected: boolean; hasMetadata: boolean; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    getThumbnailUrl(entry.file)
      .then((u) => { objectUrl = u; if (!revoked) setUrl(u); })
      .catch(() => { if (!revoked) setUrl(null); });
    return () => {
      revoked = true;
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id]);
  return (
    <button type="button" onClick={onClick} className={`w-full text-left rounded-lg p-1.5 transition-colors ${selected ? 'bg-sel' : 'bg-card hover:bg-hover'}`}>
      <div className="rounded overflow-hidden bg-bg flex items-center justify-center" style={{ width: THUMB_W, height: THUMB_H }}>
        {url ? <img src={url} alt="" className="max-w-full max-h-full object-contain" style={{ maxWidth: THUMB_W, maxHeight: THUMB_H }} /> : <span className="text-text3 text-2xl">🖼</span>}
      </div>
      <p className="text-text text-xs mt-1 truncate px-1" style={{ maxWidth: THUMB_W + 8 }}>{entry.name.length > 28 ? entry.name.slice(0, 25) + '...' : entry.name}</p>
      {hasMetadata && <div className="h-0.5 bg-green rounded-full mx-1" />}
    </button>
  );
}

function FileList() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState('');
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }
  }, []);
  const { files, setFiles, currentFileId, setCurrentFileId, metadataByFileId, downloadCsvExport } = useApp();

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected?.length) return;
    const list: File[] = [];
    let name = '';
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      if (i === 0 && path) name = path.split('/')[0] || f.name;
      if (isImage(f) || isVideo(f)) list.push(f);
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
      if (isImage(f) || isVideo(f)) list.push(f);
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    setFiles(list.map((file) => ({ id: getFileId(file), file, name: file.name })));
    setFolderName('');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <button type="button" onClick={() => folderInputRef.current?.click()} className="h-10 rounded-lg bg-card2 hover:bg-sel text-text font-semibold text-sm border border-border mb-2">📁 Select folder</button>
      <input ref={folderInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFolderChange} className="hidden" />
      <p className="text-text3 text-xs mb-2 truncate" title={folderName || undefined}>{files.length ? (folderName ? `📁 ${folderName}` : `📁 ${files.length} files`) : 'No folder selected'}</p>
      <div className="text-text3 text-xs font-semibold mb-1 flex justify-between"><span>FILES</span><span>{files.length}</span></div>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        {files.length === 0 && <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-text3 text-sm" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>Drop images/videos here or use the button above</div>}
        {files.map((entry) => {
          const meta = metadataByFileId[entry.id];
          const hasMeta = !!(meta && (meta.title_en || meta.title_tr || (meta.adobe_keywords_en?.length ?? 0) > 0));
          return <Thumbnail key={entry.id} entry={entry} selected={currentFileId === entry.id} hasMetadata={hasMeta} onClick={() => setCurrentFileId(entry.id)} />;
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
  return (
    <div className="rounded-xl border border-border bg-card2 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text2 font-semibold text-sm">{label}</span>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badgeBg, color: badgeFg }}>{lang}</span>
        <button type="button" onClick={() => navigator.clipboard.writeText(value)} className="text-xs text-text2 hover:text-text px-2 py-1 rounded bg-card border border-border">⎘ Copy</button>
      </div>
      {multiline ? <textarea value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-20 rounded-lg bg-input border border-border text-text text-sm p-2 resize-none outline-none focus:ring-1 focus:ring-accent" placeholder={label} /> : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" placeholder={label} />}
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

type KeywordKey = 'adobe_keywords_en' | 'adobe_keywords_tr' | 'shutter_keywords_en' | 'shutter_keywords_tr' | 'istock_keywords_en' | 'istock_keywords_tr';

function KeywordList({ platform, maxKw, record, onUpdate }: { platform: KeywordKey; maxKw: number; record: MetadataRecord; onUpdate: (kw: string[]) => void }) {
  const key = platform as keyof MetadataRecord;
  const keywords = (record[key] as string[]) ?? [];
  const list = [...keywords];
  while (list.length < maxKw) list.push('');
  const setOne = (index: number, value: string) => { const next = [...list]; next[index] = value; onUpdate(next); };
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text2 font-semibold text-sm">Keywords</span>
        <span className="text-text3 text-xs">max {maxKw}</span>
        <button type="button" onClick={() => navigator.clipboard.writeText(list.filter(Boolean).join(', '))} className="text-xs text-text2 hover:text-text px-2 py-1 rounded bg-card2 border border-border">⎘ Copy</button>
      </div>
      <div className="flex-1 overflow-y-auto rounded-lg bg-input border border-border p-2 space-y-0.5 min-h-[120px]">
        {list.slice(0, maxKw).map((kw, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="text-text3 text-xs w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
            <input type="text" value={kw} onChange={(e) => setOne(i, e.target.value)} className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-border rounded px-2 py-1 text-text text-sm outline-none focus:border-accent" />
          </div>
        ))}
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

function KeywordTabs() {
  const [activeTab, setActiveTab] = useState<TabId>('adobe');
  const { currentFileId, metadataByFileId, updateMetadata, istockMap } = useApp();
  if (!currentFileId) return null;
  const record = metadataByFileId[currentFileId];
  if (!record) return null;
  const tab = TABS.find((t) => t.id === activeTab)!;
  const keys = KEY_MAP[activeTab];
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-1 mb-2 rounded-lg bg-card2 border border-border p-1.5">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === t.id ? 'bg-accent text-white' : 'bg-transparent text-text2 hover:bg-hover'}`}>{t.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        <KeywordList platform={keys.en} maxKw={tab.maxKw} record={record} onUpdate={(kw) => updateMetadata(currentFileId, { [keys.en]: kw })} />
        <KeywordList platform={keys.tr} maxKw={tab.maxKw} record={record} onUpdate={(kw) => updateMetadata(currentFileId, { [keys.tr]: kw })} />
      </div>
      {activeTab === 'istock' && (
        <div className="mt-2">
          <button type="button" onClick={() => { const en = (record.istock_keywords_en ?? []).map((k) => istockMap[k.toLowerCase().trim()] ?? k); updateMetadata(currentFileId, { istock_keywords_en: en }); }} className="px-4 py-2 rounded-lg text-sm bg-[#2a1060] hover:bg-[#3a1880] text-[#c4b5fd]">iStock Eşleştir</button>
        </div>
      )}
    </div>
  );
}

function MainForm() {
  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-transparent">
      <TitleDescriptionForm />
      <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-card border border-border p-3">
        <KeywordTabs />
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

function FindReplaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { applyFindReplace } = useApp();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const handleApply = () => { if (find.trim()) { applyFindReplace(find, replace); onClose(); } };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border p-6 w-[500px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-text font-bold text-lg mb-4">Bul & Değiştir</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3"><label className="text-text2 w-20 text-sm">Bul:</label><input type="text" value={find} onChange={(e) => setFind(e.target.value)} className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" /></div>
          <div className="flex items-center gap-3"><label className="text-text2 w-20 text-sm">Değiştir:</label><input type="text" value={replace} onChange={(e) => setReplace(e.target.value)} className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent" /></div>
        </div>
        <button type="button" onClick={handleApply} className="mt-4 w-full h-9 rounded-lg bg-accent hover:bg-accentH text-white font-semibold">🔄 Tümünü Değiştir</button>
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
        <h2 className="text-text font-bold text-lg mb-2">iStock Keyword Eşleştirme</h2>
        <div className="flex gap-2 mb-4 p-3 rounded-lg bg-card2 border border-border">
          <input type="text" value={generic} onChange={(e) => setGeneric(e.target.value)} placeholder="Generic word" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none" />
          <span className="text-text2 self-center">→</span>
          <input type="text" value={istock} onChange={(e) => setIstock(e.target.value)} placeholder="iStock equivalent" className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none" />
          <button type="button" onClick={handleAdd} className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white text-sm font-medium">+ Add</button>
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
  const { files, currentFileId, metadataByFileId, setMetadata, settings, hint, istockMap } = useApp();
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [iStockOpen, setIStockOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentEntry = files.find((f) => f.id === currentFileId);

  useEffect(() => {
    if (currentFileId && currentEntry && !metadataByFileId[currentFileId]) setMetadata(currentFileId, emptyRecord(currentEntry.name));
  }, [currentFileId, currentEntry, metadataByFileId, setMetadata]);

  const mapIstock = useCallback((kws: string[]) => kws.map((k) => istockMap[k.toLowerCase().trim()] ?? k), [istockMap]);

  const handleGenerate = useCallback(async () => {
    if (!currentFileId || !currentEntry) { setError('Select a file first.'); return; }
    const key = settings.groq_api_key?.trim();
    if (!key) { setError('Enter Groq API key in Settings.'); return; }
    setError(null);
    setGenerating(true);
    try {
      const b64 = await fileToBase64Jpeg(currentEntry.file);
      const hintText = hint.trim();
      let adobeEn: string[];
      const epId = settings.everypixels_id?.trim();
      const epSecret = settings.everypixels_secret?.trim();
      if (epId && epSecret) {
        try { adobeEn = (await apiEverypixels(currentEntry.file, epId, epSecret)).slice(0, ADOBE_MAX); }
        catch { adobeEn = (await apiKeywords(b64, key, hintText, 'adobe')).slice(0, ADOBE_MAX); }
      } else adobeEn = (await apiKeywords(b64, key, hintText, 'adobe')).slice(0, ADOBE_MAX);
      const shutterEn = (await apiKeywords(b64, key, hintText, 'shutterstock')).slice(0, SHUTTER_MAX);
      const istockRaw = (await apiKeywords(b64, key, hintText, 'istock')).slice(0, ISTOCK_MAX);
      const istockEn = mapIstock(istockRaw);
      const meta = await apiMetadata(b64, key, hintText);
      const adobeTr = await apiTranslateKw(adobeEn, key);
      const shutterTr = await apiTranslateKw(shutterEn, key);
      const istockTr = await apiTranslateKw(istockEn, key);
      const record: MetadataRecord = {
        file_name: currentEntry.name,
        created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
        title_en: meta.title_en ?? '', title_tr: meta.title_tr ?? '',
        description_en: meta.description_en ?? '', description_tr: meta.description_tr ?? '',
        adobe_keywords_en: adobeEn, adobe_keywords_tr: adobeTr,
        shutter_keywords_en: shutterEn, shutter_keywords_tr: shutterTr,
        istock_keywords_en: istockEn, istock_keywords_tr: istockTr,
      };
      setMetadata(currentFileId, record);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [currentFileId, currentEntry, settings, hint, mapIstock, setMetadata]);

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Toolbar onGenerate={handleGenerate} generating={generating} onOpenFindReplace={() => setFindReplaceOpen(true)} onOpenIStock={() => setIStockOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
      {error && <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm">{error}</div>}
      <div className="flex-1 flex min-h-0 p-2 gap-2">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <MainForm />
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FindReplaceModal open={findReplaceOpen} onClose={() => setFindReplaceOpen(false)} />
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
