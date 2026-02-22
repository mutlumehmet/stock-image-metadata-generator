const THUMB_W = 244;
const THUMB_H = 152;
const PREV_SIZE = 768;

export function getFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function isImage(file: File): boolean {
  const t = file.type.toLowerCase();
  return t.startsWith('image/');
}

export function isVideo(file: File): boolean {
  const t = file.type.toLowerCase();
  return t.startsWith('video/');
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (isImage(file)) {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    } else if (isVideo(file)) {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => {
        video.currentTime = 0.1;
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas context failed'));
        }
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Video load failed'));
      };
    } else {
      reject(new Error('Unsupported file type'));
    }
  });
}

/** Get base64 JPEG for API (no data URL prefix for Groq: they want data:image/jpeg;base64,<b64>) */
export function fileToBase64Jpeg(file: File): Promise<string> {
  return fileToDataUrl(file).then((dataUrl) => {
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('Invalid data URL');
    return base64;
  });
}

/** Create a blob URL for thumbnail display (image or video first frame) */
export function getThumbnailUrl(file: File): Promise<string> {
  if (isImage(file)) {
    return Promise.resolve(URL.createObjectURL(file));
  }
  if (isVideo(file)) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.onloadeddata = () => {
        video.currentTime = 0.1;
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        const w = Math.min(video.videoWidth, THUMB_W);
        const h = Math.min(video.videoHeight, THUMB_H);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas failed'));
        }
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Video failed'));
      };
    });
  }
  return Promise.reject(new Error('Unsupported file type'));
}

export { THUMB_W, THUMB_H, PREV_SIZE };
