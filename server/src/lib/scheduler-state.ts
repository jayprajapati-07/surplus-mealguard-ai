// Shared scheduler heartbeat — written by the sweep, read by status endpoints.
// No import cycles: neither the scheduler nor the routes import each other here.
import { nextRunAfter } from './eod-report';

export interface SweepSummary {
  at: string;
  date: string;
  created: number;
  failed: number;
  errors: string[];
}

const state = {
  armed: false,
  nextRunISO: null as string | null,
  lastSweep: null as SweepSummary | null,
  lastError: null as string | null,
};

export function setSchedulerArmed(nextRunISO: string): void {
  state.armed = true;
  state.nextRunISO = nextRunISO;
}

export function recordSweep(summary: SweepSummary): void {
  state.lastSweep = summary;
  state.nextRunISO = nextRunAfter(new Date()).toISOString();
  if (summary.failed === 0) state.lastError = null;
}

export function recordSchedulerError(message: string): void {
  state.lastError = message;
}

export function getSchedulerState() {
  return { ...state };
}

export default { setSchedulerArmed, recordSweep, recordSchedulerError, getSchedulerState };
