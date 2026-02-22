import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

interface IStockModalProps {
  open: boolean;
  onClose: () => void;
}

export function IStockModal({ open, onClose }: IStockModalProps) {
  const { istockMap, setIstockMap, saveIstockMap } = useApp();
  const [generic, setGeneric] = useState('');
  const [istock, setIstock] = useState('');
  const [entries, setEntries] = useState<[string, string][]>([]);

  useEffect(() => {
    if (open) {
      setEntries(Object.entries(istockMap).sort((a, b) => a[0].localeCompare(b[0])));
    }
  }, [open, istockMap]);

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
    const next = { ...istockMap };
    delete next[key];
    setIstockMap(next);
    saveIstockMap(next);
    setEntries(Object.entries(next).sort((a, b) => a[0].localeCompare(b[0])));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border p-6 w-[640px] max-w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text font-bold text-lg mb-2">iStock Keyword Eşleştirme</h2>
        <div className="flex gap-2 mb-4 p-3 rounded-lg bg-card2 border border-border">
          <input
            type="text"
            value={generic}
            onChange={(e) => setGeneric(e.target.value)}
            placeholder="Generic word"
            className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none"
          />
          <span className="text-text2 self-center">→</span>
          <input
            type="text"
            value={istock}
            onChange={(e) => setIstock(e.target.value)}
            placeholder="iStock equivalent"
            className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="h-9 px-4 rounded-lg bg-accent hover:bg-accentH text-white text-sm font-medium"
          >
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {entries.map(([gen, ist]) => (
            <div
              key={gen}
              className="flex items-center justify-between rounded-lg bg-card2 border border-border px-3 py-2"
            >
              <span className="text-text2 truncate flex-1">{gen}</span>
              <span className="text-[#5b9af8] truncate flex-1 text-center">→</span>
              <span className="text-[#5b9af8] truncate flex-1">{ist}</span>
              <button
                type="button"
                onClick={() => handleRemove(gen)}
                className="text-red-400 hover:text-red-300 ml-2 px-2 py-1 rounded text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
