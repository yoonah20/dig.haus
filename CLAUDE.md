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
- **Phase 3 planned** (see below): mydig (personal digger pages)
- **Phase 4+ deferred**: follow / global activity feed / main page overhaul to "discover diggers" view

---

## Phase 3 plan — 마이딕 (personal digger page)

**URL**: `dig.haus/my/:username`

For the reasoning behind the pivots from the original four-tier plan (why Crate went away, why the shelf genre preset was dropped, why the scene went dark), see `docs/phase3-storefront-decisions.md`.

### Layout — two tiers plus deferred ambience

Modelled on a Hongdae record shop at dusk: records on the wall, an open shelf unit on the floor below, warm pooled lamp light from upper-left. Two tiers the user actually populates, plus a Now-Playing strip parked for later.

```
┌─────────────────────────────────────────────────┐
│ Vinyl Wall — 22 curated (5-5-6-6)               │   Tier 1
├───────┬───────┬───────┬───────┬───────┬───────┤
│ Shelf │ Shelf │ Shelf │ Shelf │ Shelf │ Shelf │   Tier 2
│ slot0 │ slot1 │ slot2 │ slot3 │ slot4 │ slot5 │
└───────┴───────┴───────┴───────┴───────┴───────┘
(Now Playing strip — deferred to 3e)
```

### Tier roles

| Layer | Metaphor | Content | Fixed slots | Interaction |
|-------|----------|---------|-------------|-------------|
| Vinyl Wall | front wall display on wooden rails | 22 user-picked favourites | 22 (5-5-6-6, covers identical size) | drag-drop to rearrange, click → album page |
| Shelf | floor unit of flip-through cubbies | each slot = single album OR a crate | 6 fixed slots, user-labelled (freeform) | click slot → flip-through the crate inside (swipe / ← → / click-edge / keyboard), or navigate to the single album |

Shelf slots are **polymorphic**: a slot holds either one album (static front cover, clicks through to album page) or one crate (a user-built named collection, clicks pop the flip-through). The user decides per slot whether they want to feature a single record or a themed stack.

Crate is still a first-class data entity — user-named, freeform collection of albums — but lives in the user's private library rather than as its own tier on the public storefront. In edit mode the user drags a crate from the library picker onto a shelf slot (or builds a slot album-by-album); the same crate can stay in the library without being featured.

Spine view was considered for Shelf and **explicitly rejected**: physical spines get their presence from depth, texture, and lighting, none of which CSS tricks reproduce convincingly (the rendered "spines" read as paper strips, not LPs). The flip-through UX is the actual "digging" motion — covers forward, one at a time, stack edges peeking — and is what real record-shop bins look like too.

### Core principles

- **Empty-is-OK aesthetic** — Wall empty slots render as bare wall + rail (no ghost frames, no "drop here" text). Empty shelf slots render as dark cubby interiors with no label. The furniture is the page; albums populate it over time.
- **Duplicates allowed** — same album can sit in multiple Wall positions (event-day motif: 22 copies of one album), multiple Shelf slots, multiple crates. Schema enforces `UNIQUE(container, position)` only, never `UNIQUE(user, album)`.
- **샀음 ≠ mydig candidates**. 샀음 represents real-world physical ownership. mydig is an identity-expression canvas — users should feature albums they love even when they don't own them. Edit-mode search is always over the full `albums` table; 샀음 / 살거 / 내 Crate exposures are optional filters in the picker panel, not the default pool.
- **Tier widths aligned** — Wall last-row column count (6) = Shelf slot count (6). The two tiers read as one storefront rather than unrelated grids.
- **Records are the same size everywhere** — a 12" LP is a 12" LP. Wall LPs and shelf-slot front covers render at identical pixel dimensions; the furniture they sit on is what differs, not the records.

### Edit mode — 80/20 split

```
┌──────────────────────────────────┬────────────┐
│  Wall / Shelf preview            │ 🔍 search  │
│                                  │ [tabs: 전체│
│  edit-mode shows empty slots +   │  | 내Crate│
│  × remove chips on filled ones   │  | 샀음 | │
│                                  │  살거 ]    │
│  drag candidate → drop on slot   │ ┌──┐ meta  │
│  drag within = reorder / move    │ │c.│ ...   │
│                                  │ └──┘       │
│  80% width                       │  20% width │
└──────────────────────────────────┴────────────┘
```

Desktop uses native HTML5 drag-drop. Touch uses tap-to-select then tap-to-place (drag on touch devices is too finicky for grid targets; skipping react-dnd because 100KB+ bundle isn't worth a cross-device abstraction we'd only use on one page). Candidate cards show a small badge indicating existing placements ("Wall×2 · Shelf slot 3") so the user can see current state without blocking deliberate duplication.

The **내 Crate** tab doubles as the library — crates the user has already built show as stacks here, draggable onto shelf slots. Crates that live only in the library (not placed on any shelf slot) stay private; the public storefront only surfaces what's been placed.

### Visual direction — Hongdae basement at dusk

- **Dark-mode primary**. The storefront is a warm shop interior seen from the site's darker chrome, not a bright island. Wall is painted-panel dark brown, floor is walnut, furniture wood reads lighter against both so it visibly belongs to the scene rather than to the walls.
- **Single pooled lamp source from upper-left** drives depth — records under the pendant glow; records at the edges fade into shadow. Uniform ambient brightness is the failure mode to avoid; lighting carries the sense of distance-from-center.
- **No picture frames** on wall records — just bare 12" sleeves leaning back against plaster on wooden rails with a small gap-shadow under each sleeve. Any framed presentation reads as art gallery, which is exactly the not-a-record-shop mistake the earlier Claude Design iterations kept making.
- **Perfect grid alignment on the wall** — zero per-slot rotation. Real record shops mount wall displays flush; the only imperfection up there is the gap-shadow from the lean-back angle.
- **Wear and imperfection live on Tier 2**. Masking-tape labels go ±5–8° (tape is human-placed), shelf cubbies can tilt slightly from implied browsing wear, records inside cubbies lean casually. Gallery-straightness stays on the wall; shop-browsing-chaos stays on the shelf.
- **Shelf unit is free-standing floor furniture** — no top board (open cubbies, not a cabinet), visible trestle-style end-panel legs underneath, a soft cast shadow spilling onto the floor behind it.

CSS + `perspective` / `rotateY` / box-shadow tricks, same as the existing album flip card. No WebGL. Framer Motion is allowed but optional. Mobile parity is mandatory — every interaction needs a touch equivalent.

### Ancillary layers

- **Now Playing** — turntable strip with optional Spotify/YouTube/Bandcamp embed. Currently deferred — Wall + Shelf covers the primary personal-expression need, Now Playing is ambient nice-to-have that we'd rather design right than fit into the MVP.
- **Guestbook** — notebook/clipboard in a corner. Visitor one-liners. Defer until 3e.
- **Visitor counter** — 싸이월드-style "오늘 방문 / 전체" in a corner. Defer until 3e.
- **Private mode** — page shows an "under construction" visual: fabric drape over the storefront + an A4 notice taped on. NOT an error page. The private state must preserve the shop aesthetic.
- **Per-layer privacy toggles** — possibly (wall public / shelf private, etc.) — defer, confirm before building in 3e.

### Username system

- New column `users.username` — URL-safe slug, unique, lowercase alphanumeric + `_` + `-`, 3–20 chars.
- Existing `users.display_name` also needs uniqueness added (breaks on migration if there are duplicates — suffix `_2` etc.).
- First `/my` visit forces onboarding for username picker.
- Changing username freely for first 3–7 days, then 30-day cooldown (shared-link breakage).

### Sub-phases

- **3a** — skeleton: schema (wall + shelf + crate tables), `/my/:username` route, username onboarding, empty-furniture placeholder render, private-mode "under construction" screen
- **3b** — Vinyl Wall: 22-slot 5-5-6-6 layout, bare LPs on rails, edit-mode 80/20 with drag-drop, candidate picker with 전체 / 내 Crate / 샀음 / 살거 tabs
- **3c** — Shelf + Crate: 6 polymorphic slots, flip-through inside cubbies, slot-holds-crate-or-album semantics, user-labelled masking tape, crate library management inside the edit-mode picker (no separate floor tier)
- **3e** — ambience: Now Playing, guestbook, visitor counter, private-mode per-layer toggles if needed

The earlier sub-phase 3d (Crate as separate tier with floor milk-crates) collapsed into 3c — the milk-crate visual moves to the edit-mode picker panel where the user's crate library lives.

### Current implementation status

- `client/src/components/MyDig/storefront/` holds the ported primitives (WallRail, WallLP, TapeLabel, ShelfUnit, Cubby) + Room / Storefront composition + FakeCover placeholders + palettes (dark Hongdae Dusk).
- `/my-preview` route renders the scene with fake data for design iteration. Not wired to the mydig API — that swap happens when the visual is final.
- `/my/:username` still runs the earlier Phase 3a skeleton (dashed borders on grid slots) while the storefront iterates at /my-preview.

### Data model deltas (refined at 3a)

```sql
-- Username + privacy
users.username TEXT UNIQUE
users.mydig_public INTEGER DEFAULT 1

-- Vinyl Wall — 22 slots, duplicates allowed
vinyl_wall_items (
  id, user_id, album_id, position INT (0-21),
  UNIQUE(user_id, position)
)

-- Crates — user-named collections. First-class data entity.
-- Visibility on the public storefront comes from placement in a
-- shelf_slot, not from being "featured" on a separate tier.
crates (
  id, user_id, title, description, created_at,
  UNIQUE(user_id, title)
)
crate_items (
  id, crate_id, album_id, position,
  UNIQUE(crate_id, position)
)

-- Shelf — 6 polymorphic slots per user. Each slot holds either a
-- single album or a crate reference, decided per slot.
shelf_slots (
  id, user_id, position INT (0-5),
  label TEXT,                       -- masking-tape text, freeform
  target_type TEXT CHECK(target_type IN ('album','crate')),
  target_id INTEGER,                -- album_id or crate_id per target_type
  UNIQUE(user_id, position)
)

-- Deferred to 3e
mydig_now_playing (user_id, kind, external_url, album_id, updated_at)
mydig_guestbook (id, page_user_id, author_user_id, body, created_at)
mydig_visits (user_id, day, count)
```

Dropped from the original plan:
- `genres` table + admin CRUD — shelf labels are freeform per slot now; no admin taxonomy needed
- `shelf_items` separate table — replaced by the polymorphic `shelf_slots.target_type` + `target_id`; `crate_items` is the authoritative item list when a slot points at a crate
- `crate_boxes` (position-indexed) — crates no longer live on a floor tier, they live in the user's private library and get placed onto shelf slots
- `albums.cover_dominant_color` — spine view is out, so dominant-color extraction is unneeded

### Visual implementation philosophy

CSS + `perspective` / `rotateY` tricks, same as the existing album flip card. No WebGL. Framer Motion is allowed but optional. Mobile parity is mandatory — every interaction needs a touch equivalent.

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

## Phase 3 cleanup candidates (known debt at Phase 2 close)

Known-but-deliberately-deferred items surfaced by the Phase 2 closeout audit. Each is functional today — don't fix just because you're in the area, but bundle into a Phase 3 cleanup pass if the file needs other work.

- **Legacy `album_requests` table + `requestNotifier` cron job**: user submissions now land directly in `albums` with `requested_by_user_id`; nothing writes to `album_requests` anymore. The cron (`server/src/jobs/requestNotifier.ts`) queries it every 5 minutes and finds nothing. Defer DROP TABLE until Phase 3 schema pass so the migration is batched with mydig-related schema changes.
- **Home-feed N+1 subqueries** (`GET /api/albums`, `ALBUM_ROW_SELECT` around `server/src/routes/albums.ts:598`): 7 correlated subqueries per row (votes SUM×2, reviews AVG/COUNT, user_reviews COUNT, collections, wants). Fine at current traffic. Collapse into a single JOIN+GROUP BY if the feed shows up in latency telemetry. Same pattern in `server/src/routes/userReviews.ts:118` feed.
- **`generate-summary` missing per-call budget tracking** (`server/src/routes/albums.ts` — the `/:id/reviews/generate-summary` handler): admin-only, `adminClaudeLimiter` (20/min) caps the worst case at ~$0.40/min of Sonnet. Adequate for now; add an explicit budget check when other admin Claude paths gain tracking.
- **No orphan sweep for `server/data/avatars/` and `custom-covers/`**: account/album deletion removes DB rows but leaves uploaded files on disk. Disk is cheap on Railway so this is accumulation, not a bug. A weekly cron that lists the dirs and deletes files not referenced by any row would close the loop.
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
