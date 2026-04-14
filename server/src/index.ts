import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import sqliteStoreFactory from 'better-sqlite3-session-store';
import { execSync } from 'child_process';
import type { Server } from 'http';

dotenv.config();

import { initDb, closeDb, getDb } from './db/index.js';
import { configurePassport } from './auth/passport.js';
import { startRankScheduler } from './jobs/rankScheduler.js';
import { warmExchangeRates } from './services/exchangeRates.js';
import searchRouter from './routes/search.js';
import albumsRouter from './routes/albums.js';
import labelsRouter from './routes/labels.js';
import authRouter from './routes/auth.js';
import votesRouter from './routes/votes.js';
import purchaseLinksRouter from './routes/purchaseLinks.js';
import adminRouter from './routes/admin.js';
import reviewsRouter from './routes/reviews.js';

let server: Server;

async function start() {
  const PORT = process.env.PORT || 3001;

  // Kill any orphaned process on our port before starting
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
  await new Promise((r) => setTimeout(r, 200));

  await initDb();
  console.log('Database initialized');

  const app = express();
  const db = getDb();

  app.use(compression());

  const allowedOrigins = [
    process.env.CLIENT_URL,
    'https://dig.haus',
    'https://www.dig.haus',
    'http://localhost:3000',
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json());

  const SqliteStore = sqliteStoreFactory(session);
  app.use(
    session({
      store: new SqliteStore({
        client: db,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 },
      }),
      secret: process.env.SESSION_SECRET || 'dev-insecure-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  app.use('/auth', authRouter);
  app.use('/api/search', searchRouter);
  app.use('/api', votesRouter);
  app.use('/api', purchaseLinksRouter);
  app.use('/api/albums', albumsRouter);
  app.use('/api/labels', labelsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/reviews', reviewsRouter);

  startRankScheduler();
  warmExchangeRates();

  server = app.listen(PORT, () => {
    console.log(`dig.haus server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));
