import rateLimit from 'express-rate-limit';

// Rate limiter for admin endpoints that call Claude or scrape external
// pages. 60 calls per minute per IP — raised from 20 to accommodate the
// batch add-url flow after Serper discovery started returning 20+ URLs
// per album. Admin is effectively one IP (the site owner), so the limit
// just needs to catch runaway loops without strangling legitimate
// review-batch work. Shared across routes/albums.ts and
// routes/albumReviews.ts so the minute-window count is unified, not
// doubled up per router.
export const adminClaudeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many admin requests, slow down.' },
});
