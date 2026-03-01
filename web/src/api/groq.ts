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

const METADATA_PROMPT = `You are a professional stock photo metadata expert. Analyze this image for Adobe Stock, Shutterstock, iStock.

Consider: current market trends, buyer search behavior, commercial appeal, and SEO best practices.
Focus on what buyers actually search for on Adobe Stock, Shutterstock, and iStock.

Title (title_en / title_tr):
- Use the "Who, What, Where, When" formula: one clear sentence (e.g. who is doing what, where, and when if relevant).
- Ideal length: 5–10 words. No unnecessary embellishments.
- Natural language: write a meaningful sentence, do NOT stack keywords. Algorithms rank human-like titles higher. Example: "Woman working on laptop in bright modern office" — NOT "Woman laptop office business".
- Both EN and TR must read naturally.

Description (description_en / description_tr):
- Longer and more detailed than the title. Include mood, setting, lighting, use-cases, and context.
- 150–200 characters. Must be DIFFERENT from the title; never copy or repeat the title verbatim.`;

/** Extract the first complete JSON object from a string (handles trailing text or multiple objects). */
function extractFirstJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return '';
}

export async function apiMetadata(
  b64: string,
  key: string,
  hint = ''
): Promise<{ title_en: string; title_tr: string; description_en: string; description_tr: string }> {
  const hintTxt = hint.trim() ? `\n\nEk referans bilgi (mutlaka dikkate al): ${hint}` : '';
  const prompt = METADATA_PROMPT + hintTxt;
  const raw = await groqVision(b64, prompt, key, 600);
  const jsonStr = extractFirstJsonObject(raw);
  if (!jsonStr) throw new Error('Invalid response: no JSON');
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Invalid response: JSON parse failed');
  }
}

const KEYWORDS_BY_PLATFORM: Record<string, string> = {
  adobe: 'Adobe Stock (max 49 keywords, broad to specific)',
  shutterstock: 'Shutterstock (max 50 keywords, high commercial value)',
  istock: 'iStock/Getty (max 50 keywords, Getty controlled vocabulary preferred)',
};

const KEYWORDS_PROMPT = `You are a microstock SEO expert. Generate optimized English keywords for {platform}.{hint}

First, interpret the image as a story in your mind only (who, what, why, when, where, concept). Do NOT output this story or any explanation—use it only internally to choose keywords.

Then generate keywords that reflect this story: who/what first (specific subject), then category, then place/time, then concepts (why, inspiration). Put the 10 most story-critical terms first.

Keyword rules (follow strictly):
- Hierarchical order: Put the 10 most important keywords FIRST. Adobe Stock and Getty rank early positions higher; order by importance.
- Specific to general order: (1) Specific subject (e.g. Golden Retriever), (2) Category (e.g. Dog, Pet), (3) Concepts (e.g. Loyalty, Friendship).
- Use singular form only; do not add plural variants (e.g. "dog" not "dogs") to save the keyword limit.
- Include conceptual tags that reflect the mood or message (e.g. Loneliness, Success, Sustainability); these are highly searched by agencies.
- Only tag what is clearly visible and central to the image; do not add small background objects or elements that are not the main subject.

Also consider: buyer trends (2024-2025), commercial use (advertising, editorial, web, print), emotions, technical aspects, location/demographics if visible.

Output format (critical): Your response must be exactly one line of comma-separated keywords. No introductory phrase (e.g. no "Here are the keywords:"), no sentences, no bullet points, no story text. Example: wind turbine, power line, renewable energy, sustainability, outdoor, sunset. Generate exactly 50 keywords.`;

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
