// Gemini structure-understanding helper — server-only. NEVER import from client.
// Contract: Gemini may SUGGEST a column mapping; backend VALIDATES every
// suggested column against actual spreadsheet headers. Hallucinated columns
// are rejected. No historical values are ever invented.
import { suggestMapping as deterministicSuggest, type ExpectedField } from './flow';

export const REQUIRED_FIELDS: ExpectedField[] = ['date', 'food', 'produced', 'sold', 'waste'];

export interface MappingValidation {
  ok: boolean;
  errors: string[];
}

export function geminiConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function normHeader(h: string): string {
  return h.trim();
}

/** Validate an AI-suggested mapping against ACTUAL headers. Rejects hallucinations. */
export function validateGeminiMapping(
  mapping: Record<string, string | null | undefined>,
  actualHeaders: string[]
): MappingValidation {
  const errors: string[] = [];
  const headerSet = new Set(actualHeaders.map(normHeader));
  for (const field of REQUIRED_FIELDS) {
    const col = mapping[field];
    if (!col || !String(col).trim()) {
      errors.push(`Required field "${field}" is unmapped.`);
      continue;
    }
    if (!headerSet.has(normHeader(String(col)))) {
      errors.push(`Mapped column "${String(col)}" for "${field}" does not exist in the uploaded file.`);
    }
  }
  // Optional fields, when mapped, must also exist.
  for (const [field, col] of Object.entries(mapping)) {
    if (col == null || String(col).trim() === '') continue;
    if (!headerSet.has(normHeader(String(col)))) {
      if (!errors.some((e) => e.includes(String(col)))) {
        errors.push(`Mapped column "${String(col)}" for "${field}" does not exist in the uploaded file.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export interface GeminiSuggestResult {
  source: 'gemini' | 'deterministic';
  mapping: Record<ExpectedField, { column: string | null; confidence: 'high' | 'medium' | 'none' }>;
  needsMapping: boolean;
  geminiNotes: string | null;
  validated: boolean;
}

function buildPrompt(headers: string[], sampleRows: Record<string, unknown>[]): string {
  const samples = sampleRows.slice(0, 3).map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers.slice(0, 20)) o[h] = String(r[h] ?? '').slice(0, 60);
    return o;
  });
  return (
    'You map spreadsheet columns to a fixed food-record schema. ' +
    'Return ONLY JSON: {"mapping": {"date": col|null, "food": col|null, "target": col|null, ' +
    '"produced": col|null, "sold": col|null, "waste": col|null, "surplus": col|null, ' +
    '"meal": col|null, "unit": col|null, "kitchen": col|null}, "notes": "short"}. ' +
    'Rules: every mapped value MUST be an exact column name from the provided headers list, ' +
    'or null when uncertain. Never invent column names. Never invent data values.\n' +
    `Headers: ${JSON.stringify(headers)}\nSamples: ${JSON.stringify(samples)}`
  );
}

/**
 * Ask Gemini for a column mapping, then VALIDATE it. Any failure
 * (no key, network, bad JSON, hallucinated columns) falls back to the
 * deterministic mapper so uploads never block.
 */
export async function suggestMappingWithGemini(
  headers: string[],
  sampleRows: Record<string, unknown>[]
): Promise<GeminiSuggestResult> {
  const fallback = (): GeminiSuggestResult => {
    const d = deterministicSuggest(headers);
    return { source: 'deterministic', mapping: d.mapping, needsMapping: d.needsMapping, geminiNotes: null, validated: true };
  };
  if (!geminiConfigured()) return fallback();
  try {
    const key = process.env.GEMINI_API_KEY as string;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(headers, sampleRows) }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return fallback();
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return fallback();
    let parsed: { mapping?: Record<string, string | null>; notes?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      // Model may wrap JSON in fences — extract the first {...} block.
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return fallback();
      try {
        parsed = JSON.parse(m[0]) as typeof parsed;
      } catch {
        return fallback();
      }
    }
    const rawMap = parsed.mapping ?? {};
    const flat: Record<string, string | null | undefined> = {};
    for (const [k, v] of Object.entries(rawMap)) flat[k] = typeof v === 'string' ? v : null;
    const check = validateGeminiMapping(flat, headers);
    if (!check.ok) return fallback();
    const det = deterministicSuggest(headers);
    const merged = { ...det.mapping };
    for (const [field, col] of Object.entries(flat)) {
      const f = field as ExpectedField;
      if (!(f in merged)) continue;
      if (col && headers.includes(col)) {
        merged[f] = { column: col, confidence: det.mapping[f]?.confidence === 'high' ? 'high' : 'medium' };
      }
    }
    const needs = deterministicSuggest(headers).needsMapping;
    return { source: 'gemini', mapping: merged, needsMapping: needs, geminiNotes: (parsed.notes ?? '').slice(0, 500) || null, validated: true };
  } catch {
    const d = deterministicSuggest(headers);
    return { source: 'deterministic', mapping: d.mapping, needsMapping: d.needsMapping, geminiNotes: null, validated: true };
  }
}

export default { geminiConfigured, validateGeminiMapping, suggestMappingWithGemini, REQUIRED_FIELDS };
