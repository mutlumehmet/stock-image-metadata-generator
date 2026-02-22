import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { FileEntry, MetadataRecord, Settings, IStockMap } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { getFileId } from '../lib/thumbnails';
import { buildCsv, downloadCsv } from '../lib/csv';

const SETTINGS_KEY = 'stock_metadata_settings';
const ISTOCK_KEY = 'stock_metadata_istock';

/** Parse JSON, or use first complete object if string has trailing content. */
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
  const parsed = safeParseJson<Partial<Settings>>(s, {});
  return { ...DEFAULT_SETTINGS, ...parsed };
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadIStockMap(): IStockMap {
  const s = localStorage.getItem(ISTOCK_KEY);
  if (!s) return {};
  return safeParseJson<IStockMap>(s, {});
}

function saveIStockMap(map: IStockMap): void {
  localStorage.setItem(ISTOCK_KEY, JSON.stringify(map));
}

export function emptyRecord(fileName: string): MetadataRecord {
  return {
    file_name: fileName,
    created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    title_en: '',
    title_tr: '',
    description_en: '',
    description_tr: '',
    adobe_keywords_en: [],
    adobe_keywords_tr: [],
    shutter_keywords_en: [],
    shutter_keywords_tr: [],
    istock_keywords_en: [],
    istock_keywords_tr: [],
  };
}

interface AppState {
  files: FileEntry[];
  currentFileId: string | null;
  metadataByFileId: Record<string, MetadataRecord>;
  settings: Settings;
  istockMap: IStockMap;
  hint: string;
}

interface AppActions {
  setFiles: (files: FileEntry[]) => void;
  addFiles: (newFiles: File[]) => void;
  setCurrentFileId: (id: string | null) => void;
  setMetadata: (id: string, record: MetadataRecord) => void;
  updateMetadata: (id: string, patch: Partial<MetadataRecord>) => void;
  setSettings: (s: Settings) => void;
  saveSettings: (s: Settings) => void;
  setIstockMap: (map: IStockMap) => void;
  saveIstockMap: (map: IStockMap) => void;
  setHint: (h: string) => void;
  downloadCsvExport: () => void;
  applyFindReplace: (find: string, replace: string) => void;
}

const defaultState: AppState = {
  files: [],
  currentFileId: null,
  metadataByFileId: {},
  settings: loadSettings(),
  istockMap: loadIStockMap(),
  hint: '',
};

const AppContext = createContext<AppState & AppActions | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [files, setFilesState] = useState<FileEntry[]>(defaultState.files);
  const [currentFileId, setCurrentFileId] = useState<string | null>(defaultState.currentFileId);
  const [metadataByFileId, setMetadataByFileId] = useState<Record<string, MetadataRecord>>(
    defaultState.metadataByFileId
  );
  const [settings, setSettingsState] = useState<Settings>(defaultState.settings);
  const [istockMap, setIstockMapState] = useState<IStockMap>(defaultState.istockMap);
  const [hint, setHint] = useState(defaultState.hint);

  const setFiles = useCallback((newFiles: FileEntry[]) => setFilesState(newFiles), []);
  const addFiles = useCallback((newFiles: File[]) => {
    setFilesState((prev) => {
      const existing = new Set(prev.map((f) => f.id));
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

  const setSettings = useCallback((s: Settings) => setSettingsState(s), []);
  const saveSettingsAction = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  const setIstockMap = useCallback((map: IStockMap) => setIstockMapState(map), []);
  const saveIstockMap = useCallback((map: IStockMap) => {
    setIstockMapState(map);
    saveIStockMap(map);
  }, []);

  const downloadCsvExport = useCallback(() => {
    const records = files
      .map((f) => ({
        filePath: f.name,
        record: metadataByFileId[f.id] ?? emptyRecord(f.name),
      }))
      .filter((r) => r.record.title_en || r.record.title_tr || r.record.adobe_keywords_en.length > 0);
    if (records.length === 0) return;
    const csv = buildCsv(records);
    downloadCsv(csv);
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
        title_en: repl(record.title_en),
        title_tr: repl(record.title_tr),
        description_en: repl(record.description_en),
        description_tr: repl(record.description_tr),
        adobe_keywords_en: arrRepl(record.adobe_keywords_en),
        adobe_keywords_tr: arrRepl(record.adobe_keywords_tr),
        shutter_keywords_en: arrRepl(record.shutter_keywords_en),
        shutter_keywords_tr: arrRepl(record.shutter_keywords_tr),
        istock_keywords_en: arrRepl(record.istock_keywords_en),
        istock_keywords_tr: arrRepl(record.istock_keywords_tr),
      },
    }));
  }, [currentFileId, metadataByFileId]);

  const value = useMemo(
    () => ({
      files,
      currentFileId,
      metadataByFileId,
      settings,
      istockMap,
      hint,
      setFiles,
      addFiles,
      setCurrentFileId,
      setMetadata,
      updateMetadata,
      setSettings,
      saveSettings: saveSettingsAction,
      setIstockMap,
      saveIstockMap,
      setHint,
      downloadCsvExport,
      applyFindReplace,
    }),
    [
      files,
      currentFileId,
      metadataByFileId,
      settings,
      istockMap,
      hint,
      setFiles,
      addFiles,
      setMetadata,
      updateMetadata,
      saveSettingsAction,
      setIstockMap,
      saveIstockMap,
      downloadCsvExport,
      applyFindReplace,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
