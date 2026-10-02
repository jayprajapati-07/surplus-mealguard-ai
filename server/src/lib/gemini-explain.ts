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

export interface DayReportInput {
  dateLabel: string;
  hotelName: string;
  predictedKg: number | null;
  producedKg: number;
  soldKg: number;
  surplusKg: number;
  wasteKg: number;
  inconsistency: boolean;
}

export function templateDaySummary(i: DayReportInput): string {
  const head = `Daily food waste report for ${i.hotelName} on ${i.dateLabel}: `;
  if (i.inconsistency) {
    return (
      head +
      `data inconsistency detected — recorded sold (${i.soldKg} kg) exceeds produced (${i.producedKg} kg). ` +
      `No surplus forwarded. Please review today's entries.`
    );
  }
  const pred = i.predictedKg === null ? 'no ML prediction was generated that day' : `predicted ${i.predictedKg} kg`;
  return (
    head +
    `${pred}; actually produced ${i.producedKg} kg and sold ${i.soldKg} kg, ` +
    `leaving ${i.surplusKg} kg surplus food with ${i.wasteKg} kg waste.`
  );
}

/** Optional Gemini polish of the deterministic day summary; numbers verified before trusting. */
export async function summarizeDayReport(i: DayReportInput): Promise<ExplanationOutput> {
  const fallback = (): ExplanationOutput => ({ text: templateDaySummary(i), source: 'template' });
  if (!geminiConfigured()) return fallback();
  try {
    const key = process.env.GEMINI_API_KEY as string;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const prompt =
      'Rewrite this kitchen report in ONE friendly sentence. Repeat every number exactly, add no new numbers, ' +
      `and keep the hotel name: ${templateDaySummary(i)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 150 },
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
    const mustEcho = [i.producedKg, i.soldKg, i.surplusKg, i.wasteKg]
      .concat(i.predictedKg === null ? [] : [i.predictedKg]);
    if (!explanationContainsNumbers(text, mustEcho)) return fallback();
    return { text, source: 'gemini' };
  } catch {
    return fallback();
  }
}

export default { explanationContainsNumbers, templateExplanation, explainPrediction, templateDaySummary, summarizeDayReport };
