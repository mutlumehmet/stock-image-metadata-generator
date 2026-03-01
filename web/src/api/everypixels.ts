/** Everypixel Image Keywording API. May be blocked by CORS in browser; use from backend proxy if needed. */

export interface EverypixelKeyword {
  keyword: string;
  score: number;
}

export interface EverypixelColor {
  name: string;
  rgb: [number, number, number];
  hex: string;
  percentage: number;
}

export interface EverypixelKeywordsResult {
  keywords: EverypixelKeyword[];
  colors?: EverypixelColor[];
}

export interface EverypixelOptions {
  num_keywords?: number;
  threshold?: number;
  colors?: boolean;
  num_colors?: number;
  lang?: string;
}

const DEFAULT_OPTIONS: EverypixelOptions = {
  num_keywords: 50,
  threshold: 0.2,
  colors: true,
  num_colors: 5,
  lang: 'en',
};

function everypixelErrorMessage(status: number, body: string): string {
  if (status === 401) return 'Everypixel: Geçersiz API anahtarı (Client ID / Secret kontrol edin).';
  if (status === 429) return 'Everypixel: Kota aşıldı. Lütfen kullanım limitinizi kontrol edin.';
  if (status === 502) return 'Everypixel: Sunucu yoğun. İstekleri biraz yavaşlatıp tekrar deneyin.';
  return `Everypixel: ${status} ${body.slice(0, 150)}`;
}

export async function apiEverypixels(
  file: File,
  clientId: string,
  clientSecret: string,
  options: EverypixelOptions = {}
): Promise<EverypixelKeywordsResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const params = new URLSearchParams();
  if (opts.num_keywords != null) params.set('num_keywords', String(opts.num_keywords));
  if (opts.threshold != null) params.set('threshold', String(opts.threshold));
  if (opts.colors != null) params.set('colors', String(opts.colors));
  if (opts.num_colors != null) params.set('num_colors', String(opts.num_colors));
  if (opts.lang != null) params.set('lang', opts.lang);

  const url = `https://api.everypixel.com/v1/keywords?${params.toString()}`;
  const form = new FormData();
  form.append('data', file, file.name);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(everypixelErrorMessage(res.status, text));
  }

  let data: { keywords?: Array<{ keyword?: string; score?: number }>; colors?: Array<{ name?: string; rgb?: number[]; hex?: string; percentage?: number }>; status?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Everypixel: Geçersiz yanıt.');
  }

  const keywords: EverypixelKeyword[] = (data?.keywords ?? [])
    .map((k) => ({ keyword: k.keyword ?? '', score: typeof k.score === 'number' ? k.score : 0 }))
    .filter((k) => k.keyword.trim() !== '');

  const colors: EverypixelColor[] | undefined = data?.colors?.length
    ? (data.colors ?? []).map((c) => ({
        name: c.name ?? '',
        rgb: Array.isArray(c.rgb) && c.rgb.length >= 3 ? [c.rgb[0], c.rgb[1], c.rgb[2]] as [number, number, number] : [0, 0, 0],
        hex: c.hex ?? '',
        percentage: typeof c.percentage === 'number' ? c.percentage : 0,
      }))
    : undefined;

  return { keywords, colors };
}

/** Returns keyword strings in Everypixel's order (score-based). No reordering; colors are not added so platform lists keep API relevance order. */
export function everypixelToKeywordStrings(result: EverypixelKeywordsResult): string[] {
  return result.keywords.map((k) => k.keyword.trim()).filter(Boolean);
}
