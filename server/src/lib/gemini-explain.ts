// Gemini prediction explanations — server-only. NEVER import from client.
// The ML engine produces every number; Gemini only turns numbers into words.
// Any response that drops or changes an ML number is discarded and replaced
// with the deterministic template (built from the same verified numbers).
import { geminiConfigured } from './gemini';

export interface ExplanationInput {
  predictedKg: number;
  foodName: string;
  mealType: string;
  dayLabel: string;
  sampleSize: number;
  modelName: string;
  rmse: number | null;
}

export interface ExplanationOutput {
  text: string;
  source: 'gemini' | 'template';
}

/** Every ML number echoed in the text? Numbers compared by shortest exact form. */
export function explanationContainsNumbers(text: string, numbers: number[]): boolean {
  const norm = (s: string) => s.replace(/,/g, '');
  const hay = norm(text);
  return numbers.every((n) => {
    const forms = [String(n), n.toFixed(1), n.toFixed(2)];
    return forms.some((f) => hay.includes(norm(f)));
  });
}

export function templateExplanation(i: ExplanationInput): string {
  const rmse = i.rmse === null ? 'not yet measurable' : `${i.rmse} kg`;
  return (
    `Based on the hotel's historical ${i.dayLabel} ${i.mealType.toLowerCase()} demand for ${i.foodName} ` +
    `and the recent sales trend across ${i.sampleSize} actual records, approximately ${i.predictedKg} kg is recommended. ` +
    `(ML model ${i.modelName}; validation RMSE ${rmse}.)`
  );
}

export async function explainPrediction(i: ExplanationInput): Promise<ExplanationOutput> {
  const fallback = (): ExplanationOutput => ({ text: templateExplanation(i), source: 'template' });
  if (!geminiConfigured()) return fallback();
  try {
    const key = process.env.GEMINI_API_KEY as string;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const prompt =
      'Write ONE short sentence for a kitchen manager. Rules: repeat these exact numbers unchanged: ' +
      `predicted ${i.predictedKg} kg of ${i.foodName} for ${i.dayLabel} ${i.mealType.toLowerCase()}, ` +
      `based on ${i.sampleSize} historical records. Do not add any other numbers. ` +
      'Mention the recent sales trend briefly.';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return fallback();
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().slice(0, 600);
    if (!text) return fallback();
    // Verify BEFORE trusting: the exact predicted quantity and sample size must appear.
    if (!explanationContainsNumbers(text, [i.predictedKg, i.sampleSize])) return fallback();
    return { text, source: 'gemini' };
  } catch {
    return fallback();
  }
}

export default { explanationContainsNumbers, templateExplanation, explainPrediction };
