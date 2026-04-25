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
import { startLabelFeedPoller } from './jobs/labelFeedPoller.js';
import { startUsageLogPruneScheduler } from './jobs/usageLogPruner.js';
import { warmExchangeRates } from './services/exchangeRates.js';
import searchRouter from './routes/search.js';
import albumsRouter from './routes/albums.js';
import albumReviewsRouter from './routes/albumReviews.js';
import labelsRouter from './routes/labels.js';
import authRouter from './routes/auth.js';
import votesRouter from './routes/votes.js';
import purchaseLinksRouter from './routes/purchaseLinks.js';
import adminRouter from './routes/admin.js';
import labelFeedRouter from './routes/labelFeed.js';
import reviewsRouter from './routes/reviews.js';
import mydigRouter from './routes/mydig.js';
import homeRouter from './routes/home.js';
import homeFeaturesRouter from './routes/homeFeatures.js';
import coverRouter from './routes/cover.js';
import customCoversRouter from './routes/customCovers.js';
import sitemapRouter from './routes/sitemap.js';
import userReviewsRouter from './routes/userReviews.js';
import meRouter from './routes/me.js';
import followsRouter from './routes/follows.js';
import avatarsRouter from './routes/avatars.js';
import albumRequestsRouter from './routes/albumRequests.js';
import ownershipRouter from './routes/ownership.js';
import publicStatsRouter from './routes/stats.js';

let server: Server;

async function start() {
  const PORT = Number(process.env.PORT) || 3001;

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
  app.use('/api', userReviewsRouter);
  app.use('/api', meRouter);
  app.use('/api', followsRouter);
  app.use('/api', albumRequestsRouter);
  app.use('/api', ownershipRouter);
  app.use('/api/stats', publicStatsRouter);
  app.use('/api/avatars', avatarsRouter);
  app.use('/api/albums', albumsRouter);
  // Second router at the same prefix for the review pipeline (discover,
  // add-url, manual, generate-summary, mark-none) + per-review admin
  // actions (score, excerpt, retranslate) + GET /:id/reviews. Express
  // walks routers in registration order and each only handles its own
  // paths — no conflict with albumsRouter above.
  app.use('/api/albums', albumReviewsRouter);
  app.use('/api/labels', labelsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', labelFeedRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api', mydigRouter);
  app.use('/api', homeRouter);
  app.use('/api', homeFeaturesRouter);
  app.use('/api/cover', coverRouter);
  app.use('/api/custom-covers', customCoversRouter);
  app.use(sitemapRouter);

  startRankScheduler();
  startLabelFeedPoller();
  startUsageLogPruneScheduler();
  warmExchangeRates();

  // Explicit IPv4 bind. Node 18+ defaults to "::" (IPv6 dual-stack)
  // which is supposed to accept IPv4 too, but WSL2's TCP stack
  // quirks make the browser's IPv4 `localhost` connections hit
  // ECONNREFUSED against the IPv6-bound listener. Binding 0.0.0.0
  // listens on IPv4 all-interfaces and works reliably cross-host.
  server = app.listen(PORT, '0.0.0.0', () => {
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
