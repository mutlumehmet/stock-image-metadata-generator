import type { MetadataRecord } from '../types';

function copyWords(words: string[]) {
  navigator.clipboard.writeText(words.filter(Boolean).join(', '));
}

interface KeywordListProps {
  platform: keyof Pick<
    MetadataRecord,
    | 'adobe_keywords_en'
    | 'adobe_keywords_tr'
    | 'shutter_keywords_en'
    | 'shutter_keywords_tr'
    | 'istock_keywords_en'
    | 'istock_keywords_tr'
  >;
  lang: 'en' | 'tr';
  maxKw: number;
  record: MetadataRecord;
  onUpdate: (keywords: string[]) => void;
}

export function KeywordList({ platform, maxKw, record, onUpdate }: KeywordListProps) {
  const key = platform as keyof MetadataRecord;
  const keywords = (record[key] as string[]) ?? [];
  const list = [...keywords];
  while (list.length < maxKw) list.push('');

  const setOne = (index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    onUpdate(next);
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text2 font-semibold text-sm">Keywords</span>
        <span className="text-text3 text-xs">max {maxKw}</span>
        <button
          type="button"
          onClick={() => copyWords(list.filter(Boolean))}
          className="text-xs text-text2 hover:text-text px-2 py-1 rounded bg-card2 border border-border"
        >
          ⎘ Copy
        </button>
      </div>
      <div className="flex-1 overflow-y-auto rounded-lg bg-input border border-border p-2 space-y-0.5 min-h-[120px]">
        {list.slice(0, maxKw).map((kw, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="text-text3 text-xs w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
            <input
              type="text"
              value={kw}
              onChange={(e) => setOne(i, e.target.value)}
              className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-border rounded px-2 py-1 text-text text-sm outline-none focus:border-accent"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
