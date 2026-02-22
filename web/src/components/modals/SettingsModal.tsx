import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, saveSettings } = useApp();
  const [groq, setGroq] = useState('');
  const [epId, setEpId] = useState('');
  const [epSecret, setEpSecret] = useState('');

  useEffect(() => {
    if (open) {
      setGroq(settings.groq_api_key);
      setEpId(settings.everypixels_id);
      setEpSecret(settings.everypixels_secret);
    }
  }, [open, settings]);

  const handleSave = () => {
    saveSettings({
      groq_api_key: groq.trim(),
      everypixels_id: epId.trim(),
      everypixels_secret: epSecret.trim(),
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border p-6 w-[500px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text font-bold text-lg mb-4">API Ayarları</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-text2 w-48 text-sm">Groq API Key</label>
            <input
              type="password"
              value={groq}
              onChange={(e) => setGroq(e.target.value)}
              placeholder="••••••••"
              className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-text2 w-48 text-sm">Everypixels Client ID</label>
            <input
              type="text"
              value={epId}
              onChange={(e) => setEpId(e.target.value)}
              className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-text2 w-48 text-sm">Everypixels Client Secret</label>
            <input
              type="password"
              value={epSecret}
              onChange={(e) => setEpSecret(e.target.value)}
              placeholder="••••••••"
              className="flex-1 h-9 rounded-lg bg-input border border-border text-text text-sm px-3 outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="mt-4 w-full h-9 rounded-lg bg-accent hover:bg-accentH text-white font-semibold"
        >
          💾 Kaydet
        </button>
      </div>
    </div>
  );
}
