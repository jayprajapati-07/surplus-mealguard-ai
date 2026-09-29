import dotenv from 'dotenv';
import { createApp } from './app';

dotenv.config();

const port = Number(process.env.PORT ?? 4000);
const host = '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`MealGuard API listening on port ${port}`);
});
