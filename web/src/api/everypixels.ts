/** Everypixels keywords API. May be blocked by CORS in browser; use from backend proxy if needed. */
export async function apiEverypixels(
  file: File,
  clientId: string,
  clientSecret: string
): Promise<string[]> {
  const form = new FormData();
  form.append('data', file, file.name);
  const res = await fetch('https://api.everypixel.com/v1/keywords', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Everypixels: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const keywords = data?.keywords ?? [];
  return keywords.map((k: { keyword?: string }) => k.keyword ?? '').filter(Boolean);
}
