import { useState } from 'react';
import { useApp } from '../../context/AppContext';

interface FindReplaceModalProps {
  open: boolean;
  onClose: () => void;
}

export function FindReplaceModal({ open, onClose }: FindReplaceModalProps) {
  const { applyFindReplace } = useApp();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [result, setResult] = useState('');

  const handleApply = () => {
    if (!find.trim()) return;
    applyFindReplace(find, replace);
    setResult('✅ Replaced in current file');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border p-6 w-[500px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text font-bold text-lg mb-4">Bul & Değiştir</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-text2 w-20 text-sm">Bul:</label>
            <input
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-text2 w-20 text-sm">Değiştir:</label>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        {result && <p className="text-green text-sm mt-2">{result}</p>}
        <button
          type="button"
          onClick={handleApply}
          className="mt-4 w-full h-9 rounded-lg bg-accent hover:bg-accentH text-white font-semibold"
        >
          🔄 Tümünü Değiştir
        </button>
      </div>
    </div>
  );
}
