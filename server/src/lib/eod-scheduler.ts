// After-10PM automatic EOD scheduler — dependency-free.
// A single timer fires at the next 22:00 server-local time, runs the sweep,
// then re-arms every 24h. Started from src/index.ts (never in test env).
// Heartbeat goes to scheduler-state (read by status endpoints) plus an
// audit row, so the dashboard shows real run history — never hardcoded.
import { nextRunAfter } from './eod-report';
import { setSchedulerArmed, recordSweep, recordSchedulerError, schedulerTimeZone } from './scheduler-state';
import { runAutoEodAll } from '../routes/eod';
import { audit } from '../auth';

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function sweep() {
  try {
    const out = await runAutoEodAll();
    const created = out.results.filter((r) => r.status === 'created').length;
    const failedResults = out.results.filter((r) => r.status === 'failed');
    const errors = failedResults.map((r) => `${r.kitchenName || r.kitchenUnitId}: ${r.error ?? 'failed'}`).slice(0, 10);
    recordSweep({ at: new Date().toISOString(), date: out.date, created, failed: failedResults.length, errors });
    await audit('eod.scheduler-run', {
      entityType: 'EndOfDayReport', entityId: out.date,
      metadata: { date: out.date, created, failed: failedResults.length, errors },
    });
    // eslint-disable-next-line no-console
    console.log(`[eod-scheduler] Auto-report sweep for ${out.date}: ${created} created, ${failedResults.length} failed.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSchedulerError(message);
    // eslint-disable-next-line no-console
    console.error('[eod-scheduler] Auto-report sweep failed:', message);
  } finally {
    timer = setTimeout(sweep, 24 * 3600 * 1000);
  }
}

export function startEodScheduler(): void {
  if (started) return;
  started = true;
  const tz = schedulerTimeZone();
  const next = nextRunAfter(new Date(), tz);
  setSchedulerArmed(next.toISOString());
  const waitMs = Math.max(1000, next.getTime() - Date.now());
  // eslint-disable-next-line no-console
  console.log(`[eod-scheduler] Armed — next sweep in ${Math.round(waitMs / 60000)} min (after 10 PM ${tz ?? 'server-local time'}).`);
  timer = setTimeout(sweep, waitMs);
}

export function stopEodScheduler(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export default { startEodScheduler, stopEodScheduler };
