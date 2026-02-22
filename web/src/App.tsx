import { useState, useCallback, useEffect } from 'react';
import { AppProvider, useApp, emptyRecord } from './context/AppContext';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MainForm } from './components/MainForm';
import { SettingsModal } from './components/modals/SettingsModal';
import { FindReplaceModal } from './components/modals/FindReplaceModal';
import { IStockModal } from './components/modals/IStockModal';
import { fileToBase64Jpeg } from './lib/thumbnails';
import {
  apiMetadata,
  apiKeywords,
  apiTranslateKw,
} from './api/groq';
import { apiEverypixels } from './api/everypixels';
import { ADOBE_MAX, SHUTTER_MAX, ISTOCK_MAX } from './types';
import type { MetadataRecord } from './types';

function AppContent() {
  const {
    files,
    currentFileId,
    metadataByFileId,
    setMetadata,
    settings,
    hint,
    istockMap,
  } = useApp();
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [iStockOpen, setIStockOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentEntry = files.find((f) => f.id === currentFileId);

  // Ensure empty record when selecting a file that has no metadata yet
  useEffect(() => {
    if (currentFileId && currentEntry && !metadataByFileId[currentFileId]) {
      setMetadata(currentFileId, emptyRecord(currentEntry.name));
    }
  }, [currentFileId, currentEntry, metadataByFileId, setMetadata]);

  const mapIstock = useCallback(
    (kws: string[]) =>
      kws.map((k) => istockMap[k.toLowerCase().trim()] ?? k),
    [istockMap]
  );

  const handleGenerate = useCallback(async () => {
    if (!currentFileId || !currentEntry) {
      setError('Select a file first.');
      return;
    }
    const key = settings.groq_api_key?.trim();
    if (!key) {
      setError('Enter Groq API key in Settings.');
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const b64 = await fileToBase64Jpeg(currentEntry.file);
      const hintText = hint.trim();

      let adobeEn: string[];
      const epId = settings.everypixels_id?.trim();
      const epSecret = settings.everypixels_secret?.trim();
      if (epId && epSecret) {
        try {
          adobeEn = (await apiEverypixels(currentEntry.file, epId, epSecret)).slice(0, ADOBE_MAX);
        } catch {
          adobeEn = (await apiKeywords(b64, key, hintText, 'adobe')).slice(0, ADOBE_MAX);
        }
      } else {
        adobeEn = (await apiKeywords(b64, key, hintText, 'adobe')).slice(0, ADOBE_MAX);
      }

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
        title_en: meta.title_en ?? '',
        title_tr: meta.title_tr ?? '',
        description_en: meta.description_en ?? '',
        description_tr: meta.description_tr ?? '',
        adobe_keywords_en: adobeEn,
        adobe_keywords_tr: adobeTr,
        shutter_keywords_en: shutterEn,
        shutter_keywords_tr: shutterTr,
        istock_keywords_en: istockEn,
        istock_keywords_tr: istockTr,
      };
      setMetadata(currentFileId, record);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [
    currentFileId,
    currentEntry,
    settings,
    hint,
    mapIstock,
    setMetadata,
  ]);

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Toolbar
        onGenerate={handleGenerate}
        generating={generating}
        onOpenFindReplace={() => setFindReplaceOpen(true)}
        onOpenIStock={() => setIStockOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {error && (
        <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm">
          {error}
        </div>
      )}
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
