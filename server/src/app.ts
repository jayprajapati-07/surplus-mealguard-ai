import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import orgRoutes from './routes/organizations';
import adminRoutes from './routes/admin';
import foodItemRoutes from './routes/food-items';
import menuRoutes from './routes/menus';
import foodRecordRoutes from './routes/food-records';
import importRoutes from './routes/imports';
import memoryRoutes from './routes/memory';
import targetRoutes from './routes/targets';
import dashboardRoutes from './routes/dashboard';
import flowRoutes from './routes/flow';
import notificationRoutes from './routes/notifications';
import riskThresholdRoutes from './routes/risk-thresholds';
import inventoryRoutes from './routes/inventory';
import eodRoutes from './routes/eod';
import wasteRoutes from './routes/waste';
import eligibilityRoutes from './routes/eligibility';
import ngoRoutes from './routes/ngos';
import redistributionRoutes from './routes/redistribution';
import impactRoutes from './routes/impact';
import analyticsRoutes from './routes/analytics';
import reportsRoutes from './routes/reports';

dotenv.config();

export function createApp() {
  const app = express();

  const clientOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        if (!requestOrigin) return callback(null, true);
        if (
          clientOrigins.includes('*') ||
          clientOrigins.includes(requestOrigin) ||
          requestOrigin.endsWith('.onrender.com') ||
          requestOrigin.startsWith('http://localhost:')
        ) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false });
  app.use('/api', limiter);

  // Stricter brute-force protection on authentication endpoints (local prototype values; relaxed in test/dev).
  const authMax = process.env.NODE_ENV === 'test' ? 10000 : Number(process.env.RATE_LIMIT_AUTH_MAX ?? 5000);
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: authMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-test-suite'] === 'true' || process.env.NODE_ENV === 'test',
    message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', authLimiter);
  app.use('/api/auth/forgot', authLimiter);
  app.use('/api/auth/reset', authLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mealguard-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/organizations', orgRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/food-items', foodItemRoutes);
  app.use('/api/menus', menuRoutes);
  app.use('/api/food-records', foodRecordRoutes);
  app.use('/api/imports', importRoutes);
  app.use('/api/memory', memoryRoutes);
  app.use('/api/targets', targetRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/flow', flowRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/risk-thresholds', riskThresholdRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/eod', eodRoutes);
  app.use('/api/waste', wasteRoutes);
  app.use('/api/eligibility', eligibilityRoutes);
  app.use('/api/ngos', ngoRoutes);
  app.use('/api/redistribution', redistributionRoutes);
  app.use('/api/impact', impactRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/reports', reportsRoutes);

  // 404 for unknown API routes — prevents silent dead ends
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Centralized safe error handler — never leaks stacks or secrets to the browser
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (process.env.NODE_ENV !== 'production') console.error(err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
