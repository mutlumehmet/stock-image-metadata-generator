import { useApp } from '../context/AppContext';

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function Field({
  label,
  lang,
  value,
  onChange,
  multiline,
}: {
  label: string;
  lang: 'EN' | 'TR';
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const badgeBg = lang === 'EN' ? '#162a52' : '#0f2c1a';
  const badgeFg = lang === 'EN' ? '#5b9af8' : '#4ade80';

  return (
    <div className="rounded-xl border border-border bg-card2 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text2 font-semibold text-sm">{label}</span>
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: badgeBg, color: badgeFg }}
        >
          {lang}
        </span>
        <button
          type="button"
          onClick={() => copyToClipboard(value)}
          className="text-xs text-text2 hover:text-text px-2 py-1 rounded bg-card border border-border"
        >
          ⎘ Copy
        </button>
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-20 rounded-lg bg-input border border-border text-text text-sm p-2 resize-none outline-none focus:ring-1 focus:ring-accent"
          placeholder={label}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
          placeholder={label}
        />
      )}
    </div>
  );
}

export function TitleDescriptionForm() {
  const { files, currentFileId, metadataByFileId, updateMetadata } = useApp();
  if (!currentFileId) return null;
  const entry = files.find((f) => f.id === currentFileId);
  const record = metadataByFileId[currentFileId];
  if (!entry || !record) return null;

  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      <Field
        label="Başlık"
        lang="EN"
        value={record.title_en ?? ''}
        onChange={(v) => updateMetadata(currentFileId, { title_en: v })}
      />
      <Field
        label="Başlık"
        lang="TR"
        value={record.title_tr ?? ''}
        onChange={(v) => updateMetadata(currentFileId, { title_tr: v })}
      />
      <Field
        label="Açıklama"
        lang="EN"
        value={record.description_en ?? ''}
        onChange={(v) => updateMetadata(currentFileId, { description_en: v })}
        multiline
      />
      <Field
        label="Açıklama"
        lang="TR"
        value={record.description_tr ?? ''}
        onChange={(v) => updateMetadata(currentFileId, { description_tr: v })}
        multiline
      />
    </div>
  );
}
