import { useApp } from '../context/AppContext';

interface ToolbarProps {
  onGenerate: () => void;
  generating: boolean;
  onOpenFindReplace: () => void;
  onOpenIStock: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  onGenerate,
  generating,
  onOpenFindReplace,
  onOpenIStock,
  onOpenSettings,
}: ToolbarProps) {
  const { hint, setHint } = useApp();

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-[#090c14] border-b border-border shrink-0">
      <span className="text-text font-semibold text-sm">◈ Stock Metadata Generator</span>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border bg-card2 px-3 py-1.5">
          <span className="text-text3 text-xs mr-2">Referans</span>
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="AI'ya ek ipucu..."
            className="w-48 bg-transparent border-0 text-text text-sm placeholder-text3 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white font-semibold text-sm disabled:opacity-50"
        >
          {generating ? '⏳ Generating…' : '⚡ Metadata Üret'}
        </button>
        <div className="w-px h-7 bg-border" />
        <button
          type="button"
          onClick={onOpenFindReplace}
          className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm"
        >
          ⌘ Bul & Değiştir
        </button>
        <button
          type="button"
          onClick={onOpenIStock}
          className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm"
        >
          📚 iStock
        </button>
        <div className="w-px h-7 bg-border" />
        <button
          type="button"
          onClick={onOpenSettings}
          className="h-9 px-3 rounded-lg bg-card2 hover:bg-hover text-text2 text-sm"
        >
          ⚙ Ayarlar
        </button>
      </div>
    </header>
  );
}
