# dig.haus — Claude Code context

Persistent brief for new Claude sessions. Read before answering. Skim `README.md` for the public-facing project intro; this file is for internal working context that isn't captured in code comments.

---

## Vision

dig.haus is a **digital record store**, not an algorithmic music feed. The core user experience recreates the tactile reality of crate-digging in a physical store:

- Covers + prices first, metadata after (the album-card flip captures this)
- "Overheard" comments via the ticker — peripheral voices in the store
- Serendipity over recommendation — we do NOT build spoon-feeding curation
- Tagline: "No algorithms needed. Keep digging." (positioning — states who the site is for and echoes crate-digger community vernacular). Previous method-based tagline "dig by cover, find by feel" was replaced at Phase 3 kickoff because it described the how without stating the who, and the site's differentiation is precisely the anti-algorithm stance.

**Target audience**: vinyl collectors + Korean-language listeners of international / niche music. The albums covered are deliberately maniacal; there is no mainstream-chart ambition.

**What we don't do** (explicit non-goals from prior discussions):
- Heavy Korean long-form editorial (1-person dev, niche audience)
- Full-fledged tracking/alert tool for power collectors (Track & Alert was considered, rejected as misaligned with the atmosphere-first vision — though we may revisit if usage patterns demand it)
- Any kind of algorithmic "for you" recommendation carousel

---

## Current state

- **Phase 1 done**: album archive, reviews, similar albums, Discogs prices, streaming links
- **Phase 2 done**: Google auth, 50자 평, 굿굿/별루 voting, 샀음/살거 collections, community-contributed purchase links with reporting, admin dashboard, review-collection cost controls
- **Phase 3 winding down**: mydig wall + snapshots + follow system + persistent player shipped. Shelf/crate mutation endpoints + storefront illustrated visual deferred. Outstanding items listed in the Phase 3 section below.
- **Phase 4 drafted** (`docs/phase4-nightly-pipeline.md`): nightly local-LLM curation pipeline (RTX 5080 + Qwen3-14B, /admin/overnight confirm UI, Railway sync of approved batches).
- **Phase 5+ deferred**: follow-based activity feed, "discover diggers" main page overhaul, per-layer privacy, guestbook, visitor counter.

---

## Phase 3 — 마이딕 (personal digger page)

**URL**: `dig.haus/my/:username`

**Design source of truth**: `docs/phase3-storefront-decisions.md`. The visual direction has pivoted multiple times since this file last described it (record-shop interior → lofi-bedroom with turntable console + floor wooden crates → wireframe-first MVP at entry 19). When judging UI work or the layout shape, read the decisions log first; the per-tier counts and primitives have moved enough that any layout description in CLAUDE.md would rot the moment another pivot lands.

### What's shipped

- **Username system** — `users.username` (URL-safe slug, lowercase a-z0-9 + `_`/`-`, 3–20 chars). Reserved-name list in `server/src/utils/username.ts`. Onboarding modal on first `/my/*` visit. Cooldown rules from the original plan are not yet enforced (any change is currently allowed).
- **Vinyl Wall** — 15 slots in 5-5-5 layout. Drag-drop edit mode with 80/20 picker (sources: 전체 / 내 콜렉션(샀음) / 내 굿굿(upvotes) / 내 살거). Bulk replace via `PUT /api/mydig/vinyl-wall/items`. Theme title + description editable. The slot count walked 22 → 15 → 10 → 15 across migrations as the visual scale was tuned; current target is 15, decisions log entry 11 (which still says 10) is stale on this point and the live constraint in `vinyl_wall_items.position < 15` wins.
- **Vinyl Wall Snapshots** — owner archives a wall state, names it, marks public/private. Snapshot items are immutable post-create (only name/description/visibility editable). Reachable at `/my/:username/snap/:slug`. Album FK has no CASCADE so snapshots survive album deletions (rendered with a "삭제된 앨범" tag on the missing slot).
- **Persistent player** — Spotify embed strip pinned at the bottom of mydig, ghost-anchored across client-side route changes. ▶ chip on wall LPs and similar-album cards triggers playback in the same iframe (mbid identity, swap survives).
- **Follow system** — `POST/DELETE /api/users/:id/follow`, `GET /api/users/:id/{followers,following}`. Self-follow rejected at the table CHECK and in JS. Follower/following counts surface in the public profile card and the mydig sidebar graffiti.
- **Public profile card** — `GET /api/users/:id/public` powers the avatar-hover popover with stats (review count, vote split, owned/wanted counts), follow state, and a mydig link with wall-item count.

### What's open

- **Shelf + Crate mutation endpoints** — `shelf_slots`, `shelf_items`, `crate_boxes`, `crate_items` exist as tables and are read-only via `GET /mydig/:username`. No POST/PATCH/PUT/DELETE handlers; the edit-mode UI is dashed-placeholder for both tiers. Build was deferred while the storefront design itself was still moving (see decisions log entries 11–19).
- **Storefront illustrated visual** — `/my-preview` is intended to be a wireframe per entry 19. The illustrated lofi-bedroom pass (Path B per entry 18 — AI-generated background asset behind CSS overlays) is the long-term aesthetic target. The live `/my/:username` runs the earlier Hongdae-dusk composition until the wireframe interactions settle.
- **Schema vs plan divergences** — three known mismatches that should be reconciled before Phase 4 starts (or explicitly accepted as the new design):
  1. `shelf_slots.genre_id` references the `genres` table (still seeded with 16 entries via `seed-genres-initial-2026-04-20`). Decisions log entry 2 said freeform masking-tape labels per slot replaced this. Either migrate to a `label TEXT` column or codify the genre design — pick one explicitly.
  2. `shelf_slots` + separate `shelf_items` is non-polymorphic. The original plan was `target_type` + `target_id` letting one slot point at either an album or a crate. Functionally similar today; revisit if and when polymorphism becomes useful for the redesigned floor crates.
  3. `crate_boxes.position` exists for floor placement. After entry 1's pivot, crates were supposed to live in the user's private library and surface only when placed on a shelf slot — which made the position column dormant. Then entries 14–15 brought back floor crates as 3D wooden boxes (0–6 visible), which makes a position column relevant again, but **for floor visibility, not library order**. Wiring the column to whichever semantic wins is open.
- **Now Playing customization** — the persistent Spotify embed strip exists, but per-user "currently spinning" state with owner-edit UI is not built. The lofi-bedroom turntable (entry 13) is meant to render this LP on the platter when the illustrated pass ships.
- **`mydig_public` visibility flag** — column exists but vestigial; no per-page reader/writer. The "fabric drape + A4 notice" private-mode visual is unbuilt.
- **Per-layer privacy toggles** — wall public / shelf private etc. — deferred.
- **Guestbook + visitor counter** — deferred to Phase 5+ ambience pass; no schema yet.
- **샀음 / 살거 vs Crate boundary** — decisions log entry 20. Open question: do 샀음/살거 absorb into auto-populated system crates, stay separate, or get dropped? Resolve before Phase 4 to avoid the confusion compounding once curation flows multiply.

### Core principles (still apply)

- **Empty-is-OK aesthetic** — empty wall slots render as bare wall + rail (no ghost frames, no "drop here" text). The furniture is the page; albums populate it over time.
- **Duplicates allowed** — schema enforces `UNIQUE(container, position)` only, never `UNIQUE(user, album)`. Same album in multiple wall positions / multiple slots is a feature.
- **샀음 ≠ mydig candidates** — 샀음 is real-world ownership; mydig is identity expression. Edit-mode picker defaults to the full `albums` table; 샀음 / 살거 / 내 Crate are optional source filters in the picker panel, not the default pool.
- **Records are the same size everywhere** — wall LPs and any future shelf/crate front covers render at identical pixel dimensions; the furniture differs, not the records.

### File map — mydig

- Server: `routes/mydig.ts` (wall + snapshots + candidate picker + read-only shelf/crate), `routes/follows.ts`, `routes/me.ts` (`/me/profile`, `/me/username`, `/me/avatar`, `/me/{reviews,upvotes,collection,wantlist}`, `/users/:id/public`).
- Client: `pages/MyDig.tsx` for `/my/:username`, `pages/MyPreview.tsx` for `/my-preview`. `components/MyDig/` (VinylWallEditor, GraffitiSnapshotList, SnapshotSaveModal, ShareButton, QuickRegister) + `components/MyDig/storefront/` (palettes, primitives, scene).

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

Phase 1 spent ~$0.30/album via Claude's web_search tool. That path (`searchReviews` / 🔍 리뷰 모아오기) was removed entirely in the Phase 3a review-pipeline rebuild after a single session racked up ~$5 across 10 albums: each web_search invocation pulled tens of thousands of tokens of page content back into context as input tokens, and Claude re-fetching popular sites on every album scaled badly.

Current per-review cost is ~$0.001 via the `scrapeReviewFromUrl` path, which routes page fetches through Jina Reader (`r.jina.ai/`) — free proxy that renders JS and converts to clean markdown, so Claude sees the article instead of the whole HTML boilerplate. URL discovery happens via Serper.dev (admin clicks 🔎 자동 검색), returns 10–20 candidates, Haiku picks the editorial ones (~$0.0003 per pick call).

**Cost-sensitive rules** (do not break without discussion):
- Anthropic SDK: `maxRetries: 2` (was 5 — amplification risk)
- `getOrFetchAlbumBase` **never** warm-ups reviews. Every album registration lands with `reviews_crawled_at IS NULL`.
- `GET /albums/:id/reviews` is cache-only — no auto-fetch on miss.
- `scrapeReviewFromUrl` is the ONLY automated review fetch path. Jina primary, raw HTML as fallback for detectors (star / filename-image / numeric) that need the original markup.
- `generateKoreanSummary` + `stripSummaryPreamble` + `normaliseKoreanTerms` post-process every Korean output to strip markdown and literal-translation artefacts. Do not remove.
- Admin dashboard API usage panel + /api/admin/scrape-failures + /api/admin/excerpt-edits are the observability trio. Keep them working when adding new Claude call sites.

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

## Cleanup candidates (known debt at Phase 3 close)

Known-but-deliberately-deferred items. Each is functional today — don't fix just because you're in the area, but bundle into a Phase 4 cleanup pass if the file needs other work.

- **Home-feed N+1 subqueries** (`GET /api/albums`, `ALBUM_ROW_SELECT` around `server/src/routes/albums.ts:598`): 7 correlated subqueries per row (votes SUM×2, reviews AVG/COUNT, user_reviews COUNT, collections, wants). Fine at current traffic. Collapse into a single JOIN+GROUP BY if the feed shows up in latency telemetry. Same pattern in `server/src/routes/userReviews.ts` feed.
- **`generate-summary` missing per-call budget tracking** (`server/src/routes/albums.ts` — the `/:id/reviews/generate-summary` handler): admin-only, `adminClaudeLimiter` (60/min) caps the worst case at ~$1/min of Sonnet. Adequate for now; add an explicit budget check when other admin Claude paths gain tracking.
- **No orphan sweep for `server/data/avatars/` and `custom-covers/`**: account/album deletion removes DB rows but leaves uploaded files on disk. Disk is cheap on Railway so this is accumulation, not a bug. A weekly cron that lists the dirs and deletes files not referenced by any row would close the loop.
- **Wall reorder is last-write-wins** (`PUT /api/mydig/vinyl-wall/items` in `server/src/routes/mydig.ts`): the bulk-replace transaction can clobber a concurrent edit from another tab/device. Fine for the single-owner-single-tab default; add ETag/version CAS if multi-device editing becomes a real complaint.
- **Concurrent external-API fan-out** in similar-album enrichment (`server/src/routes/albums.ts:1501-1598`): each similar album gets searchTrack + searchVideo + searchBandcamp + searchMasterUrl in parallel, no rate limiter. Worth wrapping in `p-limit` before the Phase 4 nightly pipeline lands a second fan-out path on the same external services.
- **`port-kill` via `execSync(lsof | xargs kill)`** in `server/src/index.ts`: works, PORT comes from env so no real injection vector, but the shell glob style is unsafe-looking and doesn't belong on the boot path. Replace with native `net.Server` probe + `process.kill` when something else in that file needs work.
- **`users.mydig_public` vestigial column**: declared but never read or written. Either drop it in the next schema batch or wire it to a real privacy gate when the per-layer privacy work happens.
---

## File map (where things live)

### Client

- `client/src/pages/` — `Home`, `Album`, `Admin`, `Profile`, `MyDig`, `MyPreview`
- `client/src/components/` — top-level: `AlbumCard`, `TopNav`, `LoginButton`, `SearchBar`, `RegisterAlbumModal`, `VoteButtons`, `CoverArt`, `PurchaseLinksPanel`, `SiteFooter`
- `client/src/components/AlbumDetail/` — `HeaderSection`, `BuySection`, `UserReviewsSection` (50자 평), `ReviewSection`, `SimilarAlbums`, `OwnershipButtons`
- `client/src/components/Home/` — `CommentTicker`, `SortMenu`
- `client/src/components/MyDig/` — `VinylWallEditor`, `GraffitiSnapshotList`, `SnapshotSaveModal`, `ShareButton`, `QuickRegister`, plus `storefront/` (palettes + primitives + scene composition)
- `client/src/hooks/` — data hooks keyed by domain (`useAlbum`, `useMe`, `useAlbumRequests`, `useOwnership`, `usePurchaseLinks`, `useUserReviews`, `useUserReviewsFeed`, `useSearch`, mydig hooks)
- `client/src/contexts/` — `AuthContext`, `HomeStateContext`, `SearchOverlayContext`, persistent-player context
- `client/src/lib/` — `homeSort`, `adminSeen` (localStorage seenAt helpers)
- `client/src/utils/` — `apiUrl`, `relativeTime`, `score`, `spotify`

### Server

- `server/src/routes/` — `albums` (large; album CRUD + similar + admin), `albumReviews` (review-pipeline: discover, scrape, summary, score/excerpt admin), `albumRequests` (user submissions land in `albums.requested_by_user_id`), `admin` (stats, Claude usage, reset/dump), `me` (profile + username + avatar + collection feeds + account delete), `userReviews` (50자 평 feed + CRUD), `mydig` (wall + snapshots + candidate picker + read-only shelf/crate), `follows`, `ownership`, `purchaseLinks`, `votes`, `reviews` (delete/retranslate), `home`, `search`, `labels`, `labelFeed`, `cover`, `customCovers`, `avatars`, `sitemap`, `stats`, `auth` (Google OAuth callback)
- `server/src/services/` — `claude` (Anthropic client + pronunciation + summary + similar-descriptions), `reviews` (3-step review pipeline), `albumUrlExtract`, `musicbrainz`, `lastfm`, `discogs`, `spotify`, `youtube`, `bandcamp`, `serper`, `jina`, `deepseek`, `exchangeRates`, `avatarHost`, `customCoverHost`
- `server/src/utils/` — `cache` (DB read/write helpers for albums + reviews), `slug`, `username`, `albumSearch`, `externalSearch`, `memoCache`
- `server/src/db/` — `index.ts` (DB init + query helpers), `schema.ts` (all CREATE TABLE + migrations via `runOnce`)
- `server/src/jobs/` — `rankScheduler`, `labelFeedPoller`, `usageLogPruner`
- `server/src/middleware/auth.ts` — `requireAuth`, `requireAdmin`
- `server/src/auth/passport.ts` — Google OAuth
- `server/seed/diggershaus.db` — ships-with-repo seed used on first boot when data/ is empty
- `server/data/diggershaus.db` — live DB (gitignored, Railway volume mount target)
