import dotenv from 'dotenv';
import { createApp } from './app';
import { startEodScheduler } from './lib/eod-scheduler';
import { resendConfigured, smtpConfigured } from './lib/mailer';
import { geminiConfigured } from './lib/gemini';

dotenv.config();

const port = Number(process.env.PORT ?? 4000);
const host = '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`MealGuard API listening on port ${port}`);
  // Integration checklist (names only, never values) so a missing key is
  // visible in the boot log instead of surfacing later as a vague UI error.
  // eslint-disable-next-line no-console
  console.log(
    `[integrations] ngo_discovery=openstreetmap(keyless) ` +
    `email=${resendConfigured() ? 'resend' : smtpConfigured() ? 'smtp' : 'simulated'} ` +
    `gemini=${geminiConfigured() ? 'on' : 'OFF'} scheduler_tz=${process.env.EOD_TIMEZONE ?? 'server-local'}`
  );
  // Automatic end-of-day reports after 10 PM server-local (skipped in tests).
  if (process.env.NODE_ENV !== 'test') startEodScheduler();
});
