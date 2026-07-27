# dig.haus — Claude Code context

Persistent brief for new Claude sessions. Read before answering. Skim `README.md` for the public-facing intro + environment setup; this file is the internal working context that isn't captured in code comments.

**Maintenance rule**: when a change you ship invalidates a statement in this file, update that statement in the same commit. A stale claim here is worse than a missing one — future sessions act on it.

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
- Discogs **collection import** — declined. Per-user Discogs linking is identity-only (see Architecture decisions); we never store a user's Discogs collection.

**Scale reality**: one developer, ~350 albums in the catalog, Railway hosting behind Cloudflare, SQLite as the only datastore. Judge every proposal against this scale — no infrastructure for problems we don't have.

---

## Stack & verification

- **Client** (`client/`): React 19, TypeScript 5.7, Vite 6, Tailwind CSS v4, TanStack Query 5, react-router-dom 7, axios. Scripts: `npm run dev`, `npm run build` (= `tsc -b && vite build`).
- **Server** (`server/`): Express 4, better-sqlite3 12, passport (Google OAuth), node-cron, satori + resvg + sharp (toaster PNG rendering), Resend (email). Scripts: `npm run dev` (nodemon), `npm run build` (tsc).
- **There is no test runner and no linter in either package.** `tsc` (via the build scripts) is the only automated gate. "Verified" therefore means: both builds pass AND you exercised the changed flow against the local dev servers. Do not claim a change works from a clean compile alone, and do not write guidance that assumes a test suite exists.

---

## Live surfaces (route → page)

Routes live in `client/src/App.tsx` (React Router, lazy-loaded pages).

| Route | Page | Notes |
|---|---|---|
| `/` | `pages/HomeNext.tsx` (imported as `Home`) | Painted-basement hero with admin-curated LP walls (`home_walls` table, `routes/homeFeatures.ts`), recent-albums feed, 50자 평 feed, snapshot feed, CommentTicker |
| `/dig` | `pages/DigPage.tsx` | Catalog browse grid: density toggle (comfortable/dense/ultra), lenses — `?lens=artist` shipped; label/genre/curated lenses are open roadmap |
| `/album/:slug` | `pages/Album.tsx` | Album detail |
| `/my/:username` | `pages/MyDig.tsx` | 마이딕 (see section below) |
| `/my/:username/snap/:slug` | redirect | Back-compat only — snapshots now render in-page via `#<slug>` hash |
| `/profile` | `pages/Profile.tsx` | Own account management |
| `/admin` (+ `/admin/curation`, `/admin/api`, `/admin/maintenance`) | `pages/Admin.tsx` | One component, four tabs; maintenance tab hosts the 정리 (duplicate-album merge) tools |
| `/admin/compare` | `pages/LlmCompare.tsx` | Blind shadow-comparison viewer for LLM routing decisions |
| `/admin/api-console` | `pages/ApiConsole.tsx` | Live LLM + Serper spend monitor, 15s auto-refresh |
| `*` | `pages/NotFound.tsx` | 404 with dizzy digman |

There is no `Home.tsx` and no `MyPreview.tsx` — both are gone; don't reference them.

---

## Current state (as of 2026-07)

- **Phases 1–3 done.** Phase 1: album archive, reviews, similar albums, Discogs prices, streaming links. Phase 2: Google auth, 50자 평, 굿굿/별루 voting, purchase links, admin dashboard, cost controls. Phase 3 (closed 2026-04-25): mydig vinyl wall + snapshots + follow system + persistent player + public profile card.
- **The post-Phase-3 roadmap was reconciled with shipped reality on 2026-05-03** — `docs/post-phase3-roadmap.md` is the source of truth; read its "Where we are" section before proposing what's next. The original sequenced chain (album refactor → crate → shop-feel → topster → nightly pipeline) is mostly retired because most of it shipped:
  - **Crate** — shipped. The unlimited "magic record cabinet" that absorbed 샀음/살거 entirely (see mydig section).
  - **Toaster (토스터) PNG export** — shipped (`services/toasterRenderer.ts`).
  - **Album page chrome refactor** — shipped 2026-04-25.
  - **Home hero multi-wall carousel** — shipped (`HomeNextHero`, `home_walls`, admin UI).
  - Shipped later, off-roadmap: `/dig` page + artist lens, Discogs per-user OAuth linking, admin duplicate-album merge (정리 tab + `scripts/dedupe-albums.ts`), release-day auto-sync job, Cloudflare edge caching of hot GETs.
- **Parked — do not treat as active plans**:
  - **Phase 4 nightly local-LLM pipeline** (`docs/phase4-nightly-pipeline.md`) — PARKED 2026-04-27. The Pre-L0 spot check failed: no local candidate (Qwen3-14B et al. on RTX 5080 16GB) matched production Korean quality. Bench harness torn down (revivable from commit `c051df8`; `server/scripts/preL0-spot-check.ts` kept). Revival needs a better 14–30B Korean model or 32GB+ VRAM.
  - **Album-page zine visual** (`docs/album-page-zine-vision.md` + mockup PNG) — built end-to-end as `/album-zine/:slug`, then scrapped 2026-05-04: cream-paper texture × Korean text never reached screen readability. Only the mascot + "Every Day I Dig" signature survived onto the live album page. The vision doc stays as the long-term aesthetic reference.
- **Open items** (per reconciled roadmap): design-system audit; label pages as first-class destinations; remaining `/dig` lenses (label/genre/curated_artist); Phase-3 schema cleanup (`users.mydig_public`, `crate_boxes.position`). Blocked on design: shop-feel visual (plastic wrap, 3D jacket thickness) + Crate magic-cabinet visual. Blocked on vision: right-rail ambient ticker.

---

## mydig (마이딕) — `/my/:username`

Design history lives in `docs/phase3-storefront-decisions.md` (entries 1–20). Treat it as a **historical decision log**, not a live spec: its tail "implementation status" predates Phase 3 close, and entry 11's slot count (10) is stale — the live wall is 15.

### Crate system (primary surface since the 2026-05-17 crate-floor redesign)

- **Crates replaced 샀음/살거 entirely.** The `collections`/`wants` tables were dropped (`migrate-collections-wants-to-crates-2026-04-28`) and their rows copied into ordinary per-user crates titled 샀음/살거. The album page's ownership pill was replaced by `CrateButton.tsx` (담기). `/me/collection` and `/me/wantlist` endpoints were removed; the public profile card shows a single "총 N장 담음" crate count instead of an owned/wanted split.
- **Schema**: `crate_boxes` (UNIQUE(user_id, position), `is_public`/`is_default` flags), `crate_items` (UNIQUE(crate_id, album_id) — one copy of an album per crate, unlike the wall; nullable `position_x`/`position_y`/`rotation` floor coordinates), `crate_comments` (guestbook, threaded via self-ref `parent_id`).
- **Mutations live in `routes/crates.ts`** (mounted under `/api/mydig/crates`): create/rename/describe/public-toggle/delete/reorder, add/remove items, per-item floor-layout PATCH, guestbook GET/POST/DELETE, and `album-membership/:albumId` for the 담기 button. `GET /mydig/:username` (in `routes/mydig.ts`) embeds crates read-only for page render.
- **UI**: `components/MyDig/crateFloor/` — `CrateFloor` (main floor scene), `CrateBar` (crate selector), `FloorRecord` (draggable records), `CrateEditModal`, `AddAlbumSearch`, `Guestbook`, `layout.ts` (placement math), `LiveToasterPreview`. Plus `CrateSection` / `CrateDetailModal` (crate list + detail modal, FLOOR_CAP=20 in detail view).
- `shelf_slots`, `shelf_items`, and `genres` were **dropped** (`drop-shelf-and-genres-2026-05-17`). The shelf tier is dead; don't resurrect it or reference those tables.

### Vinyl wall + snapshots

- **Wall**: 15 slots, 5-5-5 layout, `CHECK (position < 15)` on `vinyl_wall_items`. Bulk replace via `PUT /api/mydig/vinyl-wall/items` (delete-all + reinsert in one transaction — last-write-wins, see Cleanup candidates). Theme title/description via `PATCH /mydig/vinyl-wall/theme`. Candidate picker `GET /mydig/candidates` defaults to the full `albums` pool; crates are optional source filters.
- **`VinylWallEditor` no longer lives on mydig** — its only consumer is the home hero (`components/Home/HomeNextHero.tsx`), where the admin edits the curated LP walls.
- **Snapshots**: owner archives a wall state (name, public/private). Items immutable post-create; only name/description/visibility editable. Rendered in-page via `#<slug>` hash. Album FK has no CASCADE so snapshots survive album deletion ("삭제된 앨범" tag on the missing slot).
- **Toaster (토스터)**: server-rendered shareable PNG (1080×1350, satori → resvg → sharp in `services/toasterRenderer.ts`) at `/api/mydig/:username/toaster.png` plus snapshot and crate variants. `ToasterButton` downloads it (OS share sheet on mobile); `LiveToasterPreview` shows it in-page.

### Identity & social

- **Username**: `users.username`, URL-safe slug (lowercase a-z0-9 + `_`/`-`, 3–20 chars), reserved-name list in `server/src/utils/username.ts`, onboarding modal on first `/my/*` visit. No cooldown enforced — any change allowed.
- **Follows**: `POST/DELETE /api/users/:id/follow`, `GET /api/users/:id/{followers,following}`. Self-follow rejected at table CHECK and in JS.
- **Public profile card**: `GET /api/users/:id/public` — avatar-hover popover with review count, vote split, crate count, follow state, mydig link.
- **Discogs linking**: per-user OAuth 1.0a link/unlink (`routes/discogsAuth.ts`, `services/discogsOauth.ts`), identity shown on the member card. No collection data stored — distinct from the app-level PAT price reads in `services/discogs.ts`.

### Core principles (hard rules)

- **Empty-is-OK aesthetic** — empty wall slots render as bare wall + rail (no ghost frames, no "drop here" text). The furniture is the page; albums populate it over time.
- **Duplicates allowed on the wall** — `vinyl_wall_items` enforces `UNIQUE(user_id, position)` only, never `UNIQUE(user, album)`. Same album in multiple wall positions is a feature. (Crates dedupe per box via `UNIQUE(crate_id, album_id)` — that's deliberate, not a bug.)
- **샀음 ≠ mydig candidates** — crate contents are real-world collecting; mydig wall is identity expression. The picker defaults to the full `albums` table; crates are optional filters, not the default pool.
- **Records are the same size everywhere** — wall LPs and crate front covers render at identical pixel dimensions; the furniture differs, not the records.

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
- **Push policy (hard rule)**: wait for the user to say "푸시해" / "push" before pushing. Commits can be staged and prepared, but the `git push` step is gated.
- **Visual iteration local-first**: work that touches the visual layer iterates on a local DB copy and lands as larger bundles at natural break points, not per-change. The mydig wireframe-vs-illustrated decision (decisions log entry 19) is the canonical example.
- **Local DB**: load a production snapshot with `server/scripts/load-snapshot.sh` (pulls the tar.gz produced by `/api/admin/snapshot-dump`: DB + avatars + custom-covers; backs up the current DB, clears stale `-shm`/`-wal` files, refuses to run while the dev server is up). The snapshot is a full prod copy, so the admin Google account logs in locally as-is. There is no sanitize script.
- **No auto-generated files**: don't create `.md` planning documents unless the user asks. Conversation context + this file are enough. Exception: `docs/review-collection-errors.md` is the append-only log for score/extraction detector bugs — new detector regressions go there.

---

## API cost discipline

Phase 1 spent ~$0.50/album via Claude's web_search tool ($5/session for 10 albums). That path (`searchReviews` / 🔍 리뷰 모아오기) was removed entirely in the Phase 3a review-pipeline rebuild: each web_search invocation pulled tens of thousands of tokens of page content back as input tokens, and re-fetching popular sites per album scaled badly. Current per-album cost is **~$0.01** for a typical 9–15 review pull (~$0.001 per review).

**Review pipeline shape**: URL discovery → editorial pick → scrape/extract → Korean summary.

- **Page fetches** go through Jina Reader (`r.jina.ai`) — free proxy that renders JS and returns clean markdown. Lives as the `fetchViaJina` path inside `services/reviews.ts`, with a premium-key recovery branch for Cloudflare-challenged pages and raw HTML as fallback for detectors (star / filename-image / numeric) that need original markup.
- **URL discovery** dispatches through `services/discovery.ts`. Engines: **Tavily** (default — 1000 searches/mo recurring free, no card; `DISCOVERY_ENGINE` env, default `tavily`), **Serper** (Google SERP proxy, one-time free credits then paid floor; kept as A/B alternative — showed `gl: us` bias even with `gl: kr`, losing KR-ranked review sites on some albums), **Jina** (`s.jina.ai`, reuses `JINA_API_KEY`; under evaluation). The admin's per-click engine selector (next to 🔎 자동 검색) overrides the env default for manual runs and persists in localStorage. The **default** engine (auto-curation batch + discover fallback) is admin-editable at runtime via the `app_settings.discovery_engine` key (dropdown in `/admin/api`, `GET/POST /api/admin/discovery-engine`); `defaultDiscoveryEngine()` precedence is `DISCOVERY_ENGINE` env > `app_settings` value > `tavily`. **Brave and Google CSE were removed 2026-07-05** (Brave dropped its free tier; Google's Custom Search JSON API is closed to new customers and shuts down 2027-01-01 — a dead end, not a dormant fallback). Offline probing: `server/scripts/serper-probe.ts`, `server/scripts/discover-debug.ts`.
- The editorial picker LLM selects actually-editorial URLs from 10–20 candidates (~$0.0003 per pick call).

**LLM routing** — every default path runs on **DeepSeek v4 Flash** (model id `deepseek-v4-flash`): scrape extraction, manual review, editorial pick, pronunciation, similar-album descriptions, Korean review summary. **Anthropic Haiku was dropped from every default path on 2026-07-06** (constants and pricing rows remain only for env-override use). **The `deepseek-chat` alias was retired by DeepSeek 2026-07-25** — the API now 400s on it (`supported names are deepseek-v4-pro / deepseek-v4-flash`), so `DEEPSEEK_MODEL` and every call-site default are the explicit `deepseek-v4-flash` id. The blanket primary model is **admin-editable at runtime** via the `app_settings.llm_primary_model` key (dropdown of suggested ids **plus a free-text field** in `/admin/api`, `GET/POST /api/admin/llm-model`, `utils/settings.ts`) — switch flash ↔ pro or type a future/other model id without a redeploy. The POST validates a loose id shape only (not a hard allowlist); llmAdapter routes `deepseek-*` to DeepSeek and any other id to Anthropic. Precedence in `resolvePrimaryModel`: per-op env > blanket env > `app_settings` value > code default. Routing machinery:

- `services/llmRouter.ts` (op → model resolution) + `services/llmAdapter.ts` (provider dispatch) + `services/llmCompare.ts` (shadow comparisons surfaced at `/admin/compare`).
- Env knobs: `LLM_PRIMARY_MODEL` (blanket), `LLM_PRIMARY_MODEL_<OP>` (per-op; `default` sentinel), `LLM_SHADOW_MODEL[_<OP>]` (`off` sentinel), `LLM_COMPARE=1` (back-compat → shadow deepseek-v4-flash), `LLM_FALLBACK=off`. A blanket `LLM_PRIMARY_MODEL` env still overrides the admin `app_settings` value, so if the `/admin/api` dropdown looks ignored, an env var is set (the panel says so and locks). `deepseek-v4-pro` is registered as a per-op upgrade knob (e.g. `LLM_PRIMARY_MODEL_SCRAPE_REVIEW=deepseek-v4-pro`); on failure it degrades pro → flash, never to Anthropic. Claude models are reachable only via explicit env override or as shadow targets.
- `services/claudeBudget.ts` is a rolling 24h spend accountant across all providers (`ROLLING_24H_USD_CAP = 1.0`), currently display-only on the admin dashboard — not a request-layer gate.

**Cost-sensitive rules (hard — do not break without discussion)**:
- Anthropic SDK: `maxRetries: 2` (was 5 — amplification risk).
- `getOrFetchAlbumBase` **never** warm-ups reviews. Every album registration lands with `reviews_crawled_at IS NULL`.
- `GET /albums/:id/reviews` is cache-only — no auto-fetch on miss.
- `scrapeReviewFromUrl` is the ONLY automated review fetch path (the release-day sync job and `services/autoCuration.ts` both go through it).
- `generateKoreanSummary` + `stripSummaryPreamble` + `normaliseKoreanTerms` post-process every Korean output to strip markdown and literal-translation artefacts. Do not remove.
- Admin dashboard API usage panel + `/api/admin/scrape-failures` + `/api/admin/excerpt-edits` are the observability trio. Keep them working when adding new LLM call sites.
- **When adding any new paid LLM or search-API call, present an estimated per-call cost and per-user / per-album frequency before implementing.**

---

## Architecture decisions worth knowing

- **Cover stickers** (album cards): the cover corner now carries only **soon** (D-N release countdown), **hot**, and **date** (recent release — replaced the old NEW chip; ≤30 days via `NEW_BADGE_DAYS` / `isRecentRelease`, soon takes precedence). **PRE-ORDER / SALE / SOLD OUT moved off the cover onto the price tag** (`PriceTagSticker` / PriceTagStack: green fill / yellow fill / strikethrough) to stop crowding the corner. Sticker specs in `STICKER_PALETTE` in `client/src/components/AlbumCard.tsx`.
- **dig.haus PICK sticker**: `pick.webp` badge rendered inside AlbumCard, gated by the `showPickSticker` prop AND `!compact` AND `averageScore >= 86` AND `reviewCount >= 3`. Surfaces opt in (home 새 앨범 grid, `/dig` cards); hero LPs share the same threshold.
- **HOT rule** (server-side, `routes/albums.ts` ~line 949): top 10 albums by `MAX(up_count, down_count)`, floor of 3 on the **qualifying side** (`up >= 3 OR down >= 3`). Celebrates both hits and controversies — a pile of 별루 is as flag-worthy as a pile of 굿굿.
- **Rank scheduler** (`jobs/rankScheduler.ts`, midnight KST): `rank_score = up − down`; `is_vinyl_wall` marks the top 20 positive-score albums.
- **Average review score**: hidden until `MIN_SCORED_FOR_AVG = 3` scored reviews (`client/src/lib/reviewThresholds.ts`). One or two scores don't justify a headline average.
- **Admin pending badge** (nav avatar): counts only `requested_by_user_id IS NOT NULL` pending albums. Visiting the admin page writes `admin:pending:seenAt` to localStorage (`client/src/lib/adminSeen.ts`); badge filters `createdAt > seenAt`; same-tab sync via `admin-pending-seen` window event.
- **Timestamps**: server stores UTC via SQLite `datetime('now')`. Client-side `parseServerTimestamp` (`utils/relativeTime.ts`) normalises to ISO UTC before display so KST users don't see a 9-hour offset.
- **Similar albums**: `isAdmin || albums.length >= 1` visibility gate. `similar_albums_lastfm IS NULL` is the auto-regen gate (admin clearing picks doesn't re-fire the call) — cache + gate logic around `routes/albums.ts:2055-2090`.
- **Voting**: 굿굿/별루 split-pill (blue/red halves, muted palette) remains. The old 샀음/살거 pill is gone — replaced by `CrateButton` (담기) since crates absorbed ownership.
- **Edge caching** (Cloudflare in front of `/api`): `setEdgeCache` / `setAnonEdgeCache` in `server/src/utils/edgeCache.ts` — responses identical for every viewer get `Cache-Control` for all; viewer-dependent responses only seed from anonymous requests. Post-mutation freshness is client-driven: the axios interceptor appends `v=<generation>` to hot GETs and `client/src/lib/edgeGen.ts` bumps the generation (sessionStorage) after every successful mutation, so refetches land on a fresh cache key. Known gaps are documented in the edgeCache.ts comments — read them before touching cache headers.
- **Persistent player**: global, not mydig-only. `PersistentNowPlayingPlayer.tsx` mounts once at App root with a single Spotify iframe (iFrame API); driven by the `useNowPlaying` external store (`useSyncExternalStore` singleton in `hooks/useNowPlaying.ts`) — **not** a React context. ▶ chips on the home grid, mydig wall, and album detail all feed the same iframe. The Spotify mobile-app hand-off logic went through several fix rounds (2026-07 commits) — treat it as delicate; test on mobile before touching.
- **Digman mascot — pose-specific assets** (`client/public/textures/digman_*.webp`, 12 poses). Hard rule: never add a surface that reaches for a generic mascot — pick a pose matching the surface's emotional role. The original generic `digman.webp` was retired.
  - **Empty states go through `DigmanEmpty`** (`client/src/components/ui/DigmanEmpty.tsx`) — the canonical empty-state primitive. Variants: `thinking` (question / no results), `sad` (relational void), `sleep` (paused / inactive), `dizzy` (404 / error), `sign` (go-here signpost — maps to `digman_signpost.webp`, larger framing), `digging` (in-flight, full opacity). New empty-state poses extend the variant enum + `VARIANT_SRC` map, never a new component.
  - **Direct-use poses** (imported by name where the surface owns its framing): `digman_digging` (RouteFallback spinner), `digman_listening`, `digman_excited`, `digman_sweat`, `digman_feed`, `digman_turntable`, `digman_sign`.

---

## Cleanup candidates (known, deliberately deferred)

Each is functional today — don't fix just because you're in the area; bundle into work that already touches the same surface.

- **Home-feed N+1 subqueries** (`ALBUM_ROW_SELECT`, `server/src/routes/albums.ts` ~line 672): ~6 correlated subqueries per row (votes SUM×2, review AVG/COUNT, user_reviews COUNT, crate_count). Fine at current traffic; collapse into JOIN+GROUP BY only if latency telemetry says so. Same pattern in `routes/userReviews.ts`.
- **`generate-summary` lacks per-call budget tracking** (handler now in `routes/albumReviews.ts` ~line 497): admin-only, rate-limited (60/min). Its comment still says "hands them to Sonnet" — actually routes to deepseek-v4-flash; fix the comment when touching the file.
- **Stale comment in `llmRouter.ts`** (~line 66): claims fallback "degrades to Haiku/Sonnet" — it actually retries with the op's `defaultModel` (deepseek-v4-flash) and never lands on Claude.
- **No orphan sweep for `server/data/avatars/` and `custom-covers/`**: deletions remove DB rows but leave files. `coverCachePruner` only handles `cover-cache/`. Accumulation, not a bug.
- **Wall reorder is last-write-wins** (`PUT /api/mydig/vinyl-wall/items`, `routes/mydig.ts` ~line 290): bulk replace can clobber a concurrent edit from another tab/device. Fine for single-owner default; ETag/version CAS only if multi-device editing becomes a real complaint.
- **Concurrent external-API fan-out without a limiter** in similar-album enrichment: `Promise.allSettled([searchTrack, searchVideo, searchBandcamp, searchMasterUrl])` per similar album at `routes/albums.ts` ~2167 and again in `POST /:id/similar` ~2426. Wrap in `p-limit` before adding any new fan-out on the same services.
- **`port-kill` via `execSync(lsof | xargs kill)`** (`server/src/index.ts` ~line 54): works, PORT comes from env so no real injection vector, but doesn't belong on the boot path. Replace with a native probe when that file needs other work.
- **`components/MyDig/storefront/Storefront.tsx` is dead code** — the scene component has no importer since the crate-floor redesign; the rest of `storefront/` (primitives, palettes, FakeCover, WallHoverCard) is live via the home hero. Mention it, don't delete unprompted.
- **Phase-3 schema leftovers**: `users.mydig_public`, `crate_boxes.position` (per roadmap cleanup bucket).

Line numbers above drift — treat them as anchors, re-locate with grep before editing.

---

## File map (where things live)

### Client (`client/src/`)

- `pages/` — `HomeNext` (the `/` page), `DigPage`, `Album`, `Admin`, `Profile`, `MyDig`, `ApiConsole`, `LlmCompare`, `NotFound`
- `components/` top-level — `AlbumCard` (stickers, PICK, score gate), `TopNav`, `LoginButton`, `SearchBar`, `VoteButtons`, `CoverArt`, `PriceTagSticker`, `PurchaseLinksPanel`, `PersistentNowPlayingPlayer`, `PlayChip`, `FollowButton`, `FollowListModal`, `FollowingDropdown`, `UserHoverCard`, `UsernameModal`, `ArtistCredit`, `CurationProgressPanel`, `ErrorBoundary`, `SiteFooter`, `LoadingSkeleton`, `CardOverlayButton`, `CopyTitleButton`, `ShareLinkButton`, `LoginRequiredTooltip`
- `components/AlbumDetail/` — `HeaderSection`, `BuySection`, `UserReviewsSection` (50자 평), `ReviewSection`, `ReviewsAdminBar`, `SimilarAlbums`, `CrateButton` (담기 — replaced OwnershipButtons)
- `components/Home/` — `HomeNextHero` (+ `HomeNextHeroMobile`), `ActivityRail`, `SnapshotFeed`, `SnapshotCard`, `PostItNote`, `CommentTicker`, `HomeFeatureSticker`
- `components/MyDig/` — `crateFloor/` (CrateFloor, CrateBar, FloorRecord, CrateEditModal, AddAlbumSearch, Guestbook, layout, LiveToasterPreview), `CrateSection`, `CrateDetailModal`, `ToasterButton`, `VinylWallEditor` (home-hero-only now), `GraffitiSnapshotList`, `SnapshotSaveModal`, `ShareButton`, `QuickRegister` (album registration — replaced RegisterAlbumModal), `storefront/` (shared primitives consumed by the home hero)
- `components/ui/` — `DigmanEmpty`, `Button`, `Chip`, `Field`, `Panel`, `Popover`, `SectionTitle`
- `hooks/` — `useAlbum`, `useMe`, `useMyDig`, `useCrates`, `useFollow`, `useNowPlaying` (player store), `useSearch`, `useAlbumRequests`, `usePurchaseLinks`, `useUserReviews`, `useUserReviewsFeed`, `useRecentAlbums`, `useHomeSnapshots`, `useHomeFeatures`, `useLabelFeed`, `useActiveWallCell`, `useTapActivate`, `useInView`, `useGridCols`, `useDocumentHead`
- `contexts/` — `AuthContext`, `HomeStateContext`, `SearchOverlayContext`, `CurationProgressContext`
- `lib/` — `axios` (interceptor appends the edge-cache `v=` param), `edgeGen`, `homeSort`, `albumFeeds`, `reviewThresholds`, `adminSeen`
- `utils/` — `apiUrl`, `relativeTime`, `score`, `spotify`, `lens`, `heroSlotLift`

### Server (`server/src/`)

- `routes/` — `albums` (large: CRUD + feed + HOT + similar + admin), `albumReviews` (review pipeline: discover, scrape, summary, score/excerpt admin), `albumRequests`, `admin` (stats, LLM usage, snapshot dump, duplicates/정리), `crates` (crate CRUD + guestbook + membership), `mydig` (wall + snapshots + candidates + read-only page aggregate), `me` (profile, username, avatar, reviews/upvotes feeds, public card, account delete), `follows`, `userReviews` (50자 평), `purchaseLinks`, `votes`, `reviews` (delete/retranslate), `home`, `homeFeatures` (hero walls admin), `search`, `labels`, `labelFeed`, `cover`, `customCovers`, `avatars`, `discogsAuth` (per-user OAuth 1.0a), `sitemap`, `stats`, `auth` (Google OAuth callback)
- `services/` — `claude` (Anthropic client + pronunciation/summary/similar-descriptions entry points), `deepseek`, `llmRouter` / `llmAdapter` / `llmCompare` / `claudeBudget` (routing + spend), `reviews` (review pipeline incl. Jina Reader fetch), `autoCuration` (server-side pipeline for user submissions), `albumUrlExtract`, `albumDedupe`, `discovery` (engine dispatcher) + `tavilySearch` / `serper` / `jinaSearch`, `musicbrainz`, `lastfm`, `discogs`, `discogsOauth`, `spotify`, `youtube`, `bandcamp`, `exchangeRates`, `toasterRenderer`, `email` (Resend wrapper, lazy-init), `avatarHost`, `customCoverHost`
- `utils/` — `cache` (album/review DB helpers), `edgeCache`, `slug`, `username`, `albumSearch`, `externalSearch`, `memoCache`, `albumPreview`, `coverColor`, `coverImage`, `heroWalls`
- `db/` — `index.ts` (init + query helpers), `schema.ts` (all CREATE TABLE + migrations via `runOnce` — check here first for current table shapes)
- `jobs/` — `rankScheduler` (00:00 KST), `labelFeedPoller` (03:00), `usageLogPruner` (04:00, 90-day retention), `releaseSyncJob` (04:00 — re-resolves store links for week-old releases + enqueues the release-day review crawl once), `coverCachePruner` (04:30 — LRU eviction of `cover-cache/` above 2 GiB)
- `middleware/auth.ts` — `requireAuth`, `requireAdmin`; `auth/passport.ts` — Google OAuth
- `scripts/` — `load-snapshot.sh`, `dedupe-albums.ts`, `discover-debug.ts`, `serper-probe.ts`, `score-detect-test.ts`, `preL0-spot-check.ts`
- `server/seed/diggershaus.db` — ships-with-repo seed used on first boot when `data/` is empty
- `server/data/diggershaus.db` — live DB (gitignored, Railway volume mount target)

### Docs (`docs/`)

- `post-phase3-roadmap.md` — **source of truth for what's next** (reconciled 2026-05-03; read "Where we are" first)
- `phase4-nightly-pipeline.md` — PARKED design brief (local-LLM nightly curation)
- `album-page-zine-vision.md` (+ `album-page-zine-mockup.png`) — parked long-term album-page aesthetic
- `phase3-storefront-decisions.md` — historical mydig design log, entries 1–20 (tail sections stale)
- `diary.md` / `project-log.md` — historical build narrative, day 0–15 (2026-04-14 → 04-29); frozen, don't extend unless asked
- `review-collection-errors.md` — append-only detector bug log (URL, expected vs observed, root cause, fix status); add new score/extraction bugs here

---

## Working rules (all tasks)

Behavioral guidelines to reduce common LLM coding mistakes. They bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify. This codebase runs a ~350-album site for one operator — scale solutions accordingly.

### 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused; leave pre-existing dead code alone unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Verify against reality (definition of done)

There is no test suite and no linter — do not plan around one. A task is done only when all of these hold:

1. `cd client && npm run build` passes (tsc + vite) — if client code changed.
2. `cd server && npm run build` passes (tsc) — if server code changed.
3. If runtime behavior changed, you exercised the changed flow on the local dev servers and observed the expected behavior. A clean compile is not verification.
4. Any new paid LLM / search-API call came with a per-call cost + frequency estimate **before** implementation (see API cost discipline).
5. Commit message is English prose (motivation + what changed); user-facing reply is Korean.
6. Nothing was pushed — pushing waits for the user's explicit "푸시해" / "push".
7. Statements in this file invalidated by your change were updated in the same commit.

For multi-step tasks, state a brief plan with a verify step per item before starting.
