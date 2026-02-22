import { useEffect, useState } from 'react';
import { getThumbnailUrl } from '../lib/thumbnails';
import type { FileEntry } from '../types';
import { THUMB_W, THUMB_H } from '../lib/thumbnails';

interface ThumbnailProps {
  entry: FileEntry;
  selected: boolean;
  hasMetadata: boolean;
  onClick: () => void;
}

export function Thumbnail({ entry, selected, hasMetadata, onClick }: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    getThumbnailUrl(entry.file)
      .then((u) => {
        objectUrl = u;
        if (!revoked) setUrl(u);
      })
      .catch(() => {
        if (!revoked) setUrl(null);
      });
    return () => {
      revoked = true;
      if (objectUrl && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg p-1.5 transition-colors ${
        selected ? 'bg-sel' : 'bg-card hover:bg-hover'
      }`}
    >
      <div
        className="rounded overflow-hidden bg-bg flex items-center justify-center"
        style={{ width: THUMB_W, height: THUMB_H }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            className="max-w-full max-h-full object-contain"
            style={{ maxWidth: THUMB_W, maxHeight: THUMB_H }}
          />
        ) : (
          <span className="text-text3 text-2xl">🖼</span>
        )}
      </div>
      <p className="text-text text-xs mt-1 truncate px-1" style={{ maxWidth: THUMB_W + 8 }}>
        {entry.name.length > 28 ? entry.name.slice(0, 25) + '...' : entry.name}
      </p>
      {hasMetadata && <div className="h-0.5 bg-green rounded-full mx-1" />}
    </button>
  );
}
