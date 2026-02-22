import { useRef, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Thumbnail } from './Thumbnail';
import { getFileId, isImage, isVideo } from '../lib/thumbnails';
import type { FileEntry } from '../types';

export function FileList() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState<string>('');
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);
  const {
    files,
    setFiles,
    currentFileId,
    setCurrentFileId,
    metadataByFileId,
    downloadCsvExport,
  } = useApp();

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
    const entries: FileEntry[] = list.map((file) => ({
      id: getFileId(file),
      file,
      name: file.name,
    }));
    setFiles(entries);
    setFolderName(name || (list[0]?.name ? 'Folder' : ''));
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const list: File[] = [];
    const items = e.dataTransfer?.files;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const f = items[i];
        if (isImage(f) || isVideo(f)) list.push(f);
      }
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const entries: FileEntry[] = list.map((file) => ({
        id: getFileId(file),
        file,
        name: file.name,
      }));
      setFiles(entries);
      setFolderName('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="flex flex-col h-full min-h-0">
      <button
        type="button"
        onClick={() => folderInputRef.current?.click()}
        className="h-10 rounded-lg bg-card2 hover:bg-sel text-text font-semibold text-sm border border-border mb-2"
      >
        📁 Select folder
      </button>
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFolderChange}
        className="hidden"
      />
      <p className="text-text3 text-xs mb-2 truncate" title={folderName || undefined}>
        {files.length ? (folderName ? `📁 ${folderName}` : `📁 ${files.length} files`) : 'No folder selected'}
      </p>
      <div className="text-text3 text-xs font-semibold mb-1 flex justify-between">
        <span>FILES</span>
        <span>{files.length}</span>
      </div>
      <div
        className="flex-1 overflow-y-auto space-y-1 min-h-0"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {files.length === 0 && (
          <div
            className="border-2 border-dashed border-border rounded-lg p-6 text-center text-text3 text-sm"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            Drop images/videos here or use the button above
          </div>
        )}
        {files.map((entry) => {
          const meta = metadataByFileId[entry.id];
          const hasMeta = !!(
            meta &&
            (meta.title_en ||
              meta.title_tr ||
              (meta.adobe_keywords_en && meta.adobe_keywords_en.length > 0))
          );
          return (
            <Thumbnail
              key={entry.id}
              entry={entry}
              selected={currentFileId === entry.id}
              hasMetadata={hasMeta}
              onClick={() => setCurrentFileId(entry.id)}
            />
          );
        })}
      </div>
      <div className="border-t border-border mt-2 pt-2">
        <button
          type="button"
          onClick={downloadCsvExport}
          className="w-full h-9 rounded-lg bg-greenBg hover:bg-[#143020] text-green font-semibold text-sm"
        >
          💾 Download CSV
        </button>
      </div>
    </div>
  );
}
