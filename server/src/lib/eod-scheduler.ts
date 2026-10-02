// After-10PM automatic EOD scheduler — dependency-free.
// A single timer fires at the next 22:00 server-local time, runs the sweep,
// then re-arms every 24h. Started from src/index.ts (never in test env).
import { nextRunAfter } from './eod-report';
import { runAutoEodAll } from '../routes/eod';

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function sweep() {
  try {
    const out = await runAutoEodAll();
    const created = out.results.filter((r) => r.status === 'created').length;
    const failed = out.results.filter((r) => r.status === 'failed').length;
    // eslint-disable-next-line no-console
    console.log(`[eod-scheduler] Auto-report sweep for ${out.date}: ${created} created, ${failed} failed.`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[eod-scheduler] Auto-report sweep failed:', err instanceof Error ? err.message : err);
  } finally {
    timer = setTimeout(sweep, 24 * 3600 * 1000);
  }
}

export function startEodScheduler(): void {
  if (started) return;
  started = true;
  const waitMs = Math.max(1000, nextRunAfter(new Date()).getTime() - Date.now());
  // eslint-disable-next-line no-console
  console.log(`[eod-scheduler] Armed — next sweep in ${Math.round(waitMs / 60000)} min (after 10 PM server-local).`);
  timer = setTimeout(sweep, waitMs);
}

export function stopEodScheduler(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export default { startEodScheduler, stopEodScheduler };
