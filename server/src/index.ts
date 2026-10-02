import dotenv from 'dotenv';
import { createApp } from './app';
import { startEodScheduler } from './lib/eod-scheduler';

dotenv.config();

const port = Number(process.env.PORT ?? 4000);
const host = '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`MealGuard API listening on port ${port}`);
  // Automatic end-of-day reports after 10 PM server-local (skipped in tests).
  if (process.env.NODE_ENV !== 'test') startEodScheduler();
});
