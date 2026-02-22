const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function groqVision(
  b64: string,
  prompt: string,
  key: string,
  maxTokens = 700
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq vision: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

export async function groqText(
  prompt: string,
  key: string,
  maxTokens = 500
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq text: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

const METADATA_PROMPT = `You are a professional stock photo metadata expert.
Analyze this image and generate optimized metadata for microstock platforms.

Consider: current market trends, buyer search behavior, commercial appeal, and SEO best practices.
Focus on what buyers actually search for on Adobe Stock, Shutterstock, and iStock.

Return ONLY valid JSON, nothing else:
{"title_en":"...","title_tr":"...","description_en":"...","description_tr":"..."}

Rules:
- title: max 70 chars, commercial, SEO-optimized, specific
- description: 150-200 chars, descriptive, includes mood/setting/use-case
- Both Turkish and English must be natural, not literal translations`;

export async function apiMetadata(
  b64: string,
  key: string,
  hint = ''
): Promise<{ title_en: string; title_tr: string; description_en: string; description_tr: string }> {
  const hintTxt = hint.trim() ? `\n\nEk referans bilgi (mutlaka dikkate al): ${hint}` : '';
  const prompt = METADATA_PROMPT + hintTxt;
  const raw = await groqVision(b64, prompt, key, 600);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Invalid response: no JSON');
  return JSON.parse(m[0]);
}

const KEYWORDS_BY_PLATFORM: Record<string, string> = {
  adobe: 'Adobe Stock (max 49 keywords, broad to specific)',
  shutterstock: 'Shutterstock (max 50 keywords, high commercial value)',
  istock: 'iStock/Getty (max 50 keywords, Getty controlled vocabulary preferred)',
};

const KEYWORDS_PROMPT = `You are a microstock SEO expert. Generate optimized English keywords for {platform}.{hint}

Analyze this image considering:
- What buyers currently search for (2024-2025 trends)
- Commercial use cases (advertising, editorial, web, print)
- Specific and broad terms mix
- Emotions, concepts, technical aspects
- Location/demographic descriptors if visible

Return ONLY comma-separated keywords, nothing else. Generate exactly 50 keywords.`;

export async function apiKeywords(
  b64: string,
  key: string,
  hint = '',
  platform: 'adobe' | 'shutterstock' | 'istock' = 'adobe'
): Promise<string[]> {
  const hintTxt = hint.trim() ? `\nExtra context (important): ${hint}` : '';
  const platformNote = KEYWORDS_BY_PLATFORM[platform] ?? 'microstock platforms';
  const prompt = KEYWORDS_PROMPT.replace('{platform}', platformNote).replace('{hint}', hintTxt);
  const raw = await groqVision(b64, prompt, key, 450);
  const kws = raw
    .replace(/["'*\-\n\d.]/g, '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return kws.slice(0, 50);
}

export async function apiTranslate(text: string, toLang: 'tr' | 'en', key: string): Promise<string> {
  const lang = toLang === 'tr' ? 'Türkçe' : 'English';
  return groqText(
    `Translate to ${lang}. Keep it natural and professional. Return ONLY the translation:\n\n${text}`,
    key,
    350
  );
}

export async function apiTranslateKw(kws: string[], key: string): Promise<string[]> {
  try {
    const chunk = kws.slice(0, 50).join(', ');
    const raw = await apiTranslate(chunk, 'tr', key);
    const parts = raw.split(',').map((p) => p.trim());
    return [...parts, ...kws].slice(0, kws.length);
  } catch {
    return kws;
  }
}
