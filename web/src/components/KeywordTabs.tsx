import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { KeywordList } from './KeywordList';
import { ADOBE_MAX, SHUTTER_MAX, ISTOCK_MAX } from '../types';

type TabId = 'adobe' | 'shutterstock' | 'istock';

const TABS: { id: TabId; label: string; maxKw: number }[] = [
  { id: 'adobe', label: 'Adobe Stock', maxKw: ADOBE_MAX },
  { id: 'shutterstock', label: 'Shutterstock', maxKw: SHUTTER_MAX },
  { id: 'istock', label: 'iStock', maxKw: ISTOCK_MAX },
];

type KeywordKey = 'adobe_keywords_en' | 'adobe_keywords_tr' | 'shutter_keywords_en' | 'shutter_keywords_tr' | 'istock_keywords_en' | 'istock_keywords_tr';
const KEY_MAP: Record<TabId, { en: KeywordKey; tr: KeywordKey }> = {
  adobe: { en: 'adobe_keywords_en', tr: 'adobe_keywords_tr' },
  shutterstock: { en: 'shutter_keywords_en', tr: 'shutter_keywords_tr' },
  istock: { en: 'istock_keywords_en', tr: 'istock_keywords_tr' },
};

export function KeywordTabs() {
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
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-accent text-white'
                : 'bg-transparent text-text2 hover:bg-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        <KeywordList
          platform={keys.en}
          lang="en"
          maxKw={tab.maxKw}
          record={record}
          onUpdate={(kw) => updateMetadata(currentFileId, { [keys.en]: kw })}
        />
        <KeywordList
          platform={keys.tr}
          lang="tr"
          maxKw={tab.maxKw}
          record={record}
          onUpdate={(kw) => updateMetadata(currentFileId, { [keys.tr]: kw })}
        />
      </div>
      {activeTab === 'istock' && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              const en = (record.istock_keywords_en ?? []).map(
                (k) => istockMap[k.toLowerCase().trim()] ?? k
              );
              updateMetadata(currentFileId, { istock_keywords_en: en });
            }}
            className="px-4 py-2 rounded-lg text-sm bg-[#2a1060] hover:bg-[#3a1880] text-[#c4b5fd]"
          >
            iStock Eşleştir
          </button>
        </div>
      )}
    </div>
  );
}
