# dig.haus — Claude Code context

Persistent brief for new Claude sessions. Read before answering. Skim `README.md` for the public-facing project intro; this file is for internal working context that isn't captured in code comments.

---

## Vision

dig.haus is a **digital record store**, not an algorithmic music feed. The core user experience recreates the tactile reality of crate-digging in a physical store:

- Covers + prices first, metadata after (the album-card flip captures this)
- "Overheard" comments via the ticker — peripheral voices in the store
- Serendipity over recommendation — we do NOT build spoon-feeding curation
- Tagline: "dig by cover, find by feel"

**Target audience**: vinyl collectors + Korean-language listeners of international / niche music. The albums covered are deliberately maniacal; there is no mainstream-chart ambition.

**What we don't do** (explicit non-goals from prior discussions):
- Heavy Korean long-form editorial (1-person dev, niche audience)
- Full-fledged tracking/alert tool for power collectors (Track & Alert was considered, rejected as misaligned with the atmosphere-first vision — though we may revisit if usage patterns demand it)
- Any kind of algorithmic "for you" recommendation carousel

---

## Current state

- **Phase 1 done**: album archive, reviews, similar albums, Discogs prices, streaming links
- **Phase 2 done**: Google auth, 50자 평, 굿굿/별루 voting, 샀음/살거 collections, community-contributed purchase links with reporting, admin dashboard, review-collection cost controls
- **Phase 3 planned** (see below): mydig (personal digger pages)
- **Phase 4+ deferred**: follow / global activity feed / main page overhaul to "discover diggers" view

---

## Phase 3 plan — 마이딕 (personal digger page)

**URL**: `dig.haus/my/:username`

**Four display layers**, each with its own physical metaphor and interaction:

| Layer | Metaphor | Content | Interaction |
|-------|----------|---------|-------------|
| Vinyl Wall | front display | 10–20 curated albums (user-picked favorites/recommendations) | covers visible; drag-drop to rearrange |
| Shelf | bookshelf of LPs | full 샀음 collection, automatic | spines only (vertical text, dominant-color background); click pops one out |
| Crate | dig box | multiple user-defined playlists/themes, up to 5 shown on front page | dig peek: pull up partial → drop back, or fully pull to detail |
| Now Playing | store ambience | optional Spotify/YouTube/Bandcamp embed | iframe player, lower priority |

**Ancillary**:
- **Guestbook** — notebook/clipboard in a corner. Visitor one-liners.
- **Visitor counter** — 싸이월드-style "오늘 방문 / 전체" in a corner.
- **Private mode** — page shows an "under construction" visual: fabric drape over the storefront + an A4 notice taped on. NOT an error page. The private state must preserve the shop aesthetic.
- **Per-layer privacy toggles** — possibly (wall public / shelf private, etc.) — confirm before building.

**Username system**:
- New column `users.username` — URL-safe slug, unique, lowercase alphanumeric + `_` + `-`, 3–20 chars.
- Existing `users.display_name` also needs uniqueness added (breaks on migration if there are duplicates — suffix `_2` etc.).
- First `/my` visit forces onboarding for username picker.
- Changing username freely for first 3–7 days, then 30-day cooldown (to prevent shared-link breakage).

**Sub-phases for build order**:
- **3a**: skeleton — schema, URL route, username onboarding, 4-layer placeholder scaffold, private-mode "under construction" screen
- **3b**: Vinyl Wall — grid with drag-drop pinning from 샀음
- **3c**: Shelf — dominant-color extraction (server-side, on album register, backfill existing rows), spine CSS render, sort options (A-Z / genre+A-Z / purchase order), pop-out
- **3d**: Crate — multi-crate CRUD, dig peek interaction (desktop mouse + mobile touch + keyboard), 살거 absorbed as the default system crate
- **3e**: ambience — Now Playing, guestbook, visitor counter

**Data model deltas** (approximate — refine at 3a):
- `users.username TEXT UNIQUE` + `users.mydig_public INTEGER DEFAULT 1`
- `mydig_wall_items(user_id, album_id, position)` — vinyl wall pins
- `crates(id, user_id, name, description, position)` + `crate_items(crate_id, album_id, position)`
- `albums.cover_dominant_color TEXT` — hex string, server-computed once
- `mydig_now_playing(user_id, kind, external_url, album_id, updated_at)`
- `mydig_guestbook(id, page_user_id, author_user_id, body, created_at)`
- `mydig_visits(user_id, day, count)` — rolled up daily for the counter

**Visual implementation philosophy**: CSS + `perspective` / `rotateY` tricks, same as the existing album flip card. No WebGL. Framer Motion is allowed but optional. Mobile parity is mandatory — every interaction needs a touch equivalent.

---

## Communication conventions

- User speaks Korean. Respond in Korean. **Code, commit messages, and file content stay in English.**
- Prior responses in this project have been concise + structured with short headers. Keep that tone.
- No emojis in code or file content unless explicitly requested. Emojis already present in the codebase (🔍 리뷰 모아오기, ⚙️ 관리, etc.) are user-facing UI labels and stay.
- File comments explain **why** (non-obvious context, prior bugs, trade-offs). Don't narrate what the code does.
- Commit messages are prose explaining motivation + what changed, not bullet lists of file edits. Multi-sentence, detailed — see recent history on `main` for examples.

---

## Development workflow

- **Branch strategy**: direct push to `main`. No feature branches. No PRs unless explicitly requested.
- **Push policy**: wait for the user to say "푸시해" / "push" before pushing. Commits can be staged and prepared, but the `git push` step is gated.
- **Phase 3 local-first**: the mydig build involves heavy visual iteration. Expect to work on a local SQLite copy, iterate CSS/interactions, then push larger bundles at phase boundaries rather than per-change.
- **Local DB**: use a sanitized copy of production (see `server/scripts/sanitize-db.ts` when written). Admin account (the primary user's Google email) is whitelisted — survives sanitization so login works locally.
- **No auto-generated files**: don't create `.md` planning documents unless the user asks. Conversation context + this file are enough.

---

## API cost discipline

Claude API spend was ~$3 for 10 albums before optimization; post-optimization target is ~$0.04/album via the manual flow.

**Cost-sensitive rules** (do not break without discussion):
- `reviews.ts` Step 1: `max_uses: 3` for `web_search`, no thin-response retry, hard abort if Step 1 cost > $0.10
- Anthropic SDK: `maxRetries: 2` (was 5 — amplification risk)
- `getOrFetchAlbumBase` **never** fires review warm-up. Every album registration lands with `reviews_crawled_at IS NULL`. Admin explicitly triggers via 🔍 리뷰 모아오기 on the album page.
- `GET /albums/:id/reviews` does NOT auto-trigger `searchReviews` on cache miss. Cached reads only.
- `scrapeReviewFromUrl` (admin manual add-URL) is the preferred path for most albums. ~$0.003 per review.
- `generateKoreanSummary` + `stripSummaryPreamble` post-processes to remove markdown headers and title/artist preamble lines. Do not remove that post-process.
- Admin dashboard API usage panel supports monthly window + manual reset + a "상세" drawer listing individual recent calls. Keep these visibility tools when adding new Claude call sites.

**When adding any new Claude call**, present an estimated per-call cost and per-user / per-album frequency before implementing.

---

## Recent architecture decisions worth knowing

- **Cover stickers** (home grid): NEW (sky #5aa9e6) / HOT (red #e84a3b) / PRE-ORDER (green, multi-line) / SALE (yellow) / SOLD OUT (orange, multi-line). Stack top-down in that order. Per-sticker font/padding/min-width overrides live in `STICKER_PALETTE` in `client/src/components/AlbumCard.tsx`.
- **HOT rule**: top 10 albums by `MAX(upvotes, downvotes)` with each side ≥3 floor. Celebrates both hits and controversies.
- **NEW rule**: released within 30 days.
- **Average review score**: hidden on both home grid and album-page review section when `scoredCount < 3`. One or two scored reviews don't justify a headline average.
- **Admin pending badge** (nav avatar): counts only `requested_by_user_id IS NOT NULL` pending albums. Visiting the admin page writes `admin:pending:seenAt` to localStorage; badge filters `createdAt > seenAt`. Same-tab sync via `admin-pending-seen` window event.
- **Timestamps**: server stores UTC via SQLite `datetime('now')`. Client-side `parseServerTimestamp` (in `utils/relativeTime.ts`) normalises to ISO UTC before display so KST users don't see a 9-hour offset.
- **Similar albums**: `isAdmin || albums.length >= 1` gate. Admin only sees it if no picks exist yet. `similar_albums_lastfm IS NULL` is the auto-regen gate (so admin clearing picks doesn't re-fire the call).
- **Voting + ownership**: split-pill buttons — 굿굿/별루 (blue/red halves, muted palette) and 샀음/살거 (amber/purple halves) share the pill shape. Format selection for 샀음/살거 is intentionally removed at the UI layer; data defaults to Vinyl.

---

## Phase 3 cleanup candidates (known debt at Phase 2 close)

Known-but-deliberately-deferred items surfaced by the Phase 2 closeout audit. Each is functional today — don't fix just because you're in the area, but bundle into a Phase 3 cleanup pass if the file needs other work.

- **Legacy `album_requests` table + `requestNotifier` cron job**: user submissions now land directly in `albums` with `requested_by_user_id`; nothing writes to `album_requests` anymore. The cron (`server/src/jobs/requestNotifier.ts`) queries it every 5 minutes and finds nothing. Defer DROP TABLE until Phase 3 schema pass so the migration is batched with mydig-related schema changes.
- **Home-feed N+1 subqueries** (`GET /api/albums`, `ALBUM_ROW_SELECT` around `server/src/routes/albums.ts:598`): 7 correlated subqueries per row (votes SUM×2, reviews AVG/COUNT, user_reviews COUNT, collections, wants). Fine at current traffic. Collapse into a single JOIN+GROUP BY if the feed shows up in latency telemetry. Same pattern in `server/src/routes/userReviews.ts:118` feed.
- **`generate-summary` missing per-call budget tracking** (`server/src/routes/albums.ts` — the `/:id/reviews/generate-summary` handler): admin-only, `adminClaudeLimiter` (20/min) caps the worst case at ~$0.40/min of Sonnet. Adequate for now; add an explicit budget check when other admin Claude paths gain tracking.
- **No orphan sweep for `server/data/avatars/` and `custom-covers/`**: account/album deletion removes DB rows but leaves uploaded files on disk. Disk is cheap on Railway so this is accumulation, not a bug. A weekly cron that lists the dirs and deletes files not referenced by any row would close the loop.
- **Approve-button concurrent-click race** (`approveAlbumRequest` in `server/src/routes/albums.ts`): two admins clicking 승인 on the same pending album in the same second can both fire the Claude review-search (~$0.05 per duplicate). Low-probability one-operator operation; skip a dedup lock unless a second admin joins the project.

---

## File map (where things live)

### Client

- `client/src/pages/` — `Home.tsx`, `Album.tsx`, `Admin.tsx`, `Profile.tsx`
- `client/src/components/` — top-level: `AlbumCard`, `TopNav`, `LoginButton`, `SearchBar`, `RegisterAlbumModal`, `VoteButtons`, `CoverArt`, `PurchaseLinksPanel`, `SiteFooter`
- `client/src/components/AlbumDetail/` — `HeaderSection`, `BuySection`, `UserReviewsSection` (50자 평), `ReviewSection`, `SimilarAlbums`, `OwnershipButtons`
- `client/src/components/Home/` — `CommentTicker`, `SortMenu`
- `client/src/hooks/` — data hooks keyed by domain (`useAlbum`, `useMe`, `useAlbumRequests`, `useOwnership`, `usePurchaseLinks`, `useUserReviews`, `useUserReviewsFeed`, `useSearch`)
- `client/src/contexts/` — `AuthContext`, `HomeStateContext`, `SearchOverlayContext`
- `client/src/lib/` — `homeSort`, `adminSeen` (localStorage seenAt helpers)
- `client/src/utils/` — `apiUrl`, `relativeTime`, `score`, `spotify`

### Server

- `server/src/routes/` — `albums` (large — includes admin, similar, reviews endpoints), `albumRequests` (user submissions + approve flow), `admin` (stats, Claude usage, reset/dump), `me` (profile), `userReviews` (50자 평 feed + CRUD), `ownership`, `purchaseLinks`, `reviews` (delete/retranslate)
- `server/src/services/` — `claude` (Anthropic client + pronunciation + summary + similar-descriptions), `reviews` (the 3-step review pipeline), `musicbrainz`, `lastfm`, `discogs`, `spotify`, `youtube`, `bandcamp`, `exchangeRates`, `avatarHost`
- `server/src/utils/` — `cache` (DB read/write helpers for albums + reviews), `slug`, `albumSearch`, `externalSearch`, `memoCache`
- `server/src/db/` — `index.ts` (DB init + query helpers), `schema.ts` (all CREATE TABLE + migrations via `runOnce`)
- `server/src/jobs/` — `rankScheduler`, `requestNotifier`
- `server/src/middleware/auth.ts` — `requireAuth`, `requireAdmin`
- `server/src/auth/passport.ts` — Google OAuth
- `server/seed/diggershaus.db` — ships-with-repo seed used on first boot when data/ is empty
- `server/data/diggershaus.db` — live DB (gitignored, Railway volume mount target)
