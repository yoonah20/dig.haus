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

### Layout — real-record-shop mapping

Three vertical tiers modelled on a physical shop (see `prototypes/` for source reference image), then ambience. The three tiers stack top-down and their widths align: one shelf bin width = one crate width, so the whole storefront reads as a unified furniture piece.

```
┌─────────────────────────────────────────────────┐
│ Vinyl Wall — 22 curated (5-5-6-6)               │   Tier 1
├───────┬───────┬───────┬───────┬───────┬───────┤
│ Shelf │ Shelf │ Shelf │ Shelf │ Shelf │ Shelf │   Tier 2
│ bin 0 │ bin 1 │ bin 2 │ bin 3 │ bin 4 │ bin 5 │
├───────┼───────┼───────┼───────┼───────┼───────┤
│ Crate │ Crate │ Crate │ Crate │ Crate │ Crate │   Tier 3 (0–6, variable)
├─────────────────────────────────────────────────┤
│ Now Playing strip                               │   Ambience
└─────────────────────────────────────────────────┘
```

### Four layers

| Layer | Metaphor | Content | Fixed slots | Interaction |
|-------|----------|---------|-------------|-------------|
| Vinyl Wall | front wall display | 22 user-picked favourites | 22 (5-5-6-6, covers identical size) | drag-drop to rearrange, click → album page |
| Shelf | mid-store flip-through bins | each bin = one admin-defined genre | 6 fixed bins, manually filled by user | click bin → flip-through one album at a time (swipe / ← → / click edge) |
| Crate | milk-crate floor stack | user-defined themed playlists with freeform labels | 0–6 visible (positions 0-5), extras kept server-side | click crate → pops out, flip-through same as Shelf |
| Now Playing | store ambience | optional Spotify/YouTube/Bandcamp embed | single slot | iframe, low priority |

Spine view was considered for Shelf and **explicitly rejected**: physical spines get their presence from depth, texture, and lighting, none of which CSS tricks reproduce convincingly (the rendered "spines" read as paper strips, not LPs). The flip-through UX is the actual "digging" motion — covers forward, one at a time, stack edges peeking — and maps to the mid-store bins in the reference photo where browsing actually happens. Spine-out storage in the reference is the overflow tier (shop has thousands of records; we don't), so it has no analog here.

### Core principles

- **Empty-is-OK aesthetic** — Wall slots render as empty picture frames, Shelf bins render as empty bin furniture with only the genre label, Crate row just shows whatever crates the user has made. No "drag albums here!" CTA, no collapsing-when-empty. The furniture is the page; albums populate it over time.
- **Duplicates allowed** — same album can sit in multiple Wall positions (event-day motif: 22 copies of one album), multiple Shelf bins, multiple crates. Schema enforces `UNIQUE(container, position)` only, never `UNIQUE(user, album)`.
- **샀음 ≠ mydig candidates**. 샀음 represents real-world physical ownership. mydig is an identity-expression canvas — users should feature albums they love even when they don't own them. Edit-mode search is always over the full `albums` table; 샀음 / 살거 / 내 Crate exposures are optional filters in the picker panel, not the default pool.
- **Tier widths aligned** — Wall last-row column count (6) = Shelf bin count (6) = Crate visible max (6). The three tiers read as one storefront instead of three unrelated grids.

### Shelf genre system

Admin-curated preset list, shared across all users. Avoids the tag-mess of Last.fm data and keeps Shelf distinct from Crate (genres vs freeform themes).

Initial seed (16, tuned to dig.haus audience — metal-forward with adjacent digger-vinyl niches):

```
Death Metal, Black Metal, Thrash, Doom & Stoner,
Grindcore & Powerviolence, Hardcore & Crust,
Post-Metal & Sludge, Progressive, Traditional Heavy Metal,
Punk & Post-Punk, Shoegaze & Dreampop, Indie Rock,
Ambient & Drone, Jazz, Hip-Hop, Electronic
```

Admin CRUD for this list lives under /admin. Users pick 6 from the list to fill their Shelf bins. No free-form shelf names (that's what Crate is for).

### Edit mode — 80/20 split

```
┌──────────────────────────────────┬────────────┐
│  Wall / Shelf / Crate preview    │ 🔍 search  │
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

Desktop uses native HTML5 drag-drop. Touch uses tap-to-select then tap-to-place (drag on touch devices is too finicky for grid targets; skipping react-dnd because 100KB+ bundle isn't worth a cross-device abstraction we'd only use on one page). Candidate cards show a small badge indicating existing placements ("Wall×2 · Shelf(Death Metal)") so admin can see current state without blocking deliberate duplication.

### Ancillary layers

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

- **3a** — skeleton: schema (genres + wall/shelf/crate tables), `/my/:username` route, username onboarding, empty-furniture placeholder render, private-mode "under construction" screen, admin genre CRUD
- **3b** — Vinyl Wall: 22-slot 5-5-6-6 layout, edit-mode 80/20 with drag-drop, candidate picker with 전체 / 내 Crate / 샀음 / 살거 tabs
- **3c** — Shelf: 6-bin horizontal row, flip-through interaction (swipe / ← → / click-edge / keyboard), per-bin genre assignment, edit-mode shares 80/20 with Wall
- **3d** — Crate: 0-6 visible variable layout, milk-crate visual (grid pattern + label tape), CRUD for crate boxes, flip-through interaction reuses 3c component, 살거 dropped as default system crate (user creates manually if desired)
- **3e** — ambience: Now Playing, guestbook, visitor counter, private-mode per-layer toggles if needed

### Data model deltas (refined at 3a)

```sql
-- Username + privacy
users.username TEXT UNIQUE
users.mydig_public INTEGER DEFAULT 1

-- Admin-curated genre taxonomy for Shelf bins
genres (
  id, slug,
  name_ko, name_en,
  position, is_active
)

-- Vinyl Wall — 22 slots, duplicates allowed
vinyl_wall_items (
  id, user_id, album_id, position INT (0-21),
  UNIQUE(user_id, position)
)

-- Shelf — 6 fixed bins per user, each bin scoped to one genre
shelf_slots (
  id, user_id, position INT (0-5),
  genre_id,
  UNIQUE(user_id, position)
)
shelf_items (
  id, slot_id, album_id, position,
  UNIQUE(slot_id, position)
)

-- Crate — variable count, positions 0-5 front-page visible, 6+ hidden
crate_boxes (
  id, user_id, position INT,
  title, description,
  UNIQUE(user_id, position)
)
crate_items (
  id, crate_id, album_id, position,
  UNIQUE(crate_id, position)
)

-- Deferred to 3e
mydig_now_playing (user_id, kind, external_url, album_id, updated_at)
mydig_guestbook (id, page_user_id, author_user_id, body, created_at)
mydig_visits (user_id, day, count)
```

Dropped from the original plan: `albums.cover_dominant_color` — spine view is out, so dominant-color extraction is no longer needed.

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
