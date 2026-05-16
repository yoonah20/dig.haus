# dig.haus

**디지털 레코드 스토어** — A digital record store for vinyl collectors and Korean-language listeners of international / niche music. Cover art and prices first, metadata after. No algorithms, no for-you carousels, no spoon-fed recommendations.

> **No algorithms needed. Keep digging.**

Live: https://dig.haus

---

## 무엇을 하는 사이트 (What it is)

dig.haus reproduces the tactile reality of crate-digging in a physical store on the web. Users browse a wall of cover art, vote 굿굿 / 별루 on what they hear, leave 50자 평 (50-character reviews), mark albums 샀음 (bought) or 살거 (will buy), and curate a personal vinyl wall (마이딕) at `/my/:username`.

It is **not** an algorithmic recommender. There is no "for you" feed, no engagement-tuned ranking, no surfacing layer between the user and the catalog. The catalog itself is deliberately maniacal — vinyl collectors digging into international and niche work that mainstream Korean charts ignore.

Tagline positioning: dig.haus is for people who already know what algorithms feel like and would rather work for the discovery.

---

## 기술 스택 (Tech Stack)

| Layer | Technologies |
|-------|--------------|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS v4 + TanStack Query + React Router |
| **Backend** | Node.js + Express + TypeScript + Passport (Google OAuth) |
| **Database** | SQLite (better-sqlite3) — single-file, runtime migrations via `runOnce` |
| **Catalog APIs** | MusicBrainz, Last.fm, Discogs, Spotify, YouTube, Bandcamp, Cover Art Archive |
| **LLM (hot path)** | DeepSeek v4 Flash via env-driven router for review extraction, editorial pick, Korean summary, similar-album descriptions, pronunciation |
| **LLM (ad-hoc)** | Anthropic Claude Sonnet — available via the same router for one-off cases and the `/admin/compare` blind shadow comparator |
| **Review pipeline** | Serper.dev (URL discovery) → Jina Reader (`r.jina.ai/` proxy for JS-rendered markdown) → DeepSeek (extract + summarise) |
| **Streaming embed** | Spotify iframe pinned at the bottom of the mydig page; ▶ chips swap tracks without losing playback context |

Per-album curation runs at roughly **~$0.01** for a typical 9–15 review pull (~$0.001 per review). The pipeline is built around that ceiling — see *API Cost Discipline* below.

---

## 진행 상황 (Current state)

### Phase 1 — Catalog (done)

- Album search with MusicBrainz + Discogs autocomplete
- Album detail pages: cover art, metadata, genre tags, label info
- Reviews scraped + summarised in Korean (Pitchfork, AllMusic, Metacritic, RYM, et al.)
- AI-powered similar-album recommendations in Korean (cached)
- Discogs marketplace prices and buy links
- Streaming links (Spotify, YouTube, Bandcamp)
- Aggressive caching at every layer

### Phase 2 — Shop experience (done)

- Google OAuth login with SQLite-backed session persistence
- **굿굿 / 별루** split-pill voting (blue / red, muted palette)
- **샀음 / 살거** collection markers (amber / purple split-pill)
- **50자 평** — community 50-character reviews on every album with their own feed
- **Community 구매처 links** with currency-aware prices (USD / JPY / GBP / EUR / KRW) and a reporting flow
- **Record-shop price-tag stickers** overlaid on album artwork (NEW / HOT / PRE-ORDER / SALE / SOLD OUT)
- **Admin dashboard** at `/admin` (auto-promoted via `ADMIN_EMAILS`): pending request triage, Claude usage panel, scrape failures, excerpt edits, review pipeline controls, LLM compare
- **Cost-controlled review pipeline**: Serper for URL discovery, Jina for fetch, DeepSeek for extract + summary, manual scrape-from-URL as the only automated review path

### Phase 3 — 마이딕 (done, 2026-04-25)

Personal digger page at `/my/:username`.

- **Username system** — URL-safe slug (a-z0-9, `_`, `-`, 3–20 chars), onboarding modal on first visit, reserved-name list
- **Vinyl Wall** — 15 slots in a 5-5-5 layout, drag-drop edit mode with an 80/20 picker (전체 / 샀음 / 굿굿 / 살거 source filters), bulk replace, theme title + description
- **Vinyl Wall Snapshots** — owner archives a wall state, names it, marks public/private. Reachable at `/my/:username/snap/:slug`. Snapshot items survive album deletions.
- **Persistent Spotify player** — embed strip pinned at the bottom of mydig, ghost-anchored across client-side route changes. ▶ chips on wall LPs and similar-album cards trigger playback in the same iframe.
- **Follow system** — follower / following counts surface in the public profile card and the mydig sidebar graffiti
- **Public profile card** — avatar-hover popover with stats (review count, vote split, owned / wanted counts), follow state, and a mydig link with wall-item count

### Phase 4 — Nightly curation pipeline (drafted)

Local-LLM nightly review extraction (RTX 5080 + Qwen3-14B), with an admin confirm UI at `/admin/overnight` and a Railway sync of approved batches. Sequenced in parallel with the album-page refactor; will land once a local LLM wins the comparison toolbox. See `docs/phase4-nightly-pipeline.md` and `docs/post-phase3-roadmap.md`.

---

## 사전 요구사항 (Prerequisites)

- Linux / macOS / WSL2 on Windows 11
- Node.js 20+ (recommend installing via nvm)
- API keys for external services (see [Get API Keys](#4-api-키-발급-get-api-keys))

## 설치 방법 (Setup)

### 1. WSL2 (Windows only)

```bash
# In PowerShell (Admin)
wsl --install
# Restart, then set up Ubuntu username/password
```

### 2. Node.js via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 3. Clone and install

```bash
cd ~/
git clone <repo-url> dig.haus
cd dig.haus

cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 4. API 키 발급 (Get API Keys)

| Service | Link | Notes |
|---------|------|-------|
| **Last.fm** | https://www.last.fm/api/account/create | Create app, copy API key |
| **Discogs** | https://www.discogs.com/settings/developers | Personal access token |
| **Spotify** | https://developer.spotify.com/dashboard | Client ID + Secret |
| **YouTube Data API** | https://console.cloud.google.com/apis/library/youtube.googleapis.com | Enable API, create API key |
| **DeepSeek** | https://platform.deepseek.com/ | API key — primary LLM |
| **Anthropic Claude** | https://console.anthropic.com/ | API key — ad-hoc / fallback |
| **Serper.dev** | https://serper.dev/ | Google search API for review URL discovery |
| **Google OAuth** | https://console.cloud.google.com/ | See *Google OAuth 설정* below |

> **No auth required:** MusicBrainz, Cover Art Archive, Jina Reader (`r.jina.ai/`), Bandcamp metadata.

### 4-1. Google OAuth 설정

1. Visit https://console.cloud.google.com/ and select (or create) your dig.haus project.
2. **APIs & Services → Credentials** → **Create Credentials** → **OAuth 2.0 Client ID** → *Web application*.
3. Under **Authorized redirect URIs** add: `http://localhost:3001/auth/google/callback`
4. Copy the **Client ID** and **Client Secret** into `server/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Generate a long random session secret: `openssl rand -hex 48` and set it as `SESSION_SECRET`.
6. Set `ADMIN_EMAILS` to the comma-separated Gmail addresses that should be auto-promoted to admin on login (e.g. `ADMIN_EMAILS=owner@gmail.com,coowner@gmail.com`).

### 5. 환경 설정

```bash
cp .env.example server/.env
# Edit server/.env with your API keys
```

### 6. 로컬 실행

```bash
# Terminal 1: server
cd server && npm run dev

# Terminal 2: client
cd client && npm run dev
```

Open http://localhost:3000

---

## 프로젝트 구조 (Project Structure)

```
dig.haus/
├── CLAUDE.md                       # Internal working context for Claude sessions
├── docs/                           # Phase write-ups, roadmap, decisions log
│   ├── phase3-storefront-decisions.md
│   ├── phase4-nightly-pipeline.md
│   └── post-phase3-roadmap.md
├── client/
│   └── src/
│       ├── App.tsx, main.tsx, index.css
│       ├── pages/                  # Home (HomeNext), Album, Admin, Profile,
│       │                           # MyDig, DigPage, ApiConsole, LlmCompare, NotFound
│       ├── components/             # Top-level: AlbumCard, TopNav, SearchBar,
│       │   │                       # CoverArt, VoteButtons, FollowButton, etc.
│       │   ├── AlbumDetail/        # HeaderSection, BuySection, UserReviewsSection
│       │   │                       # (50자 평), ReviewSection, SimilarAlbums,
│       │   │                       # OwnershipButtons
│       │   ├── Home/               # CommentTicker, SortMenu
│       │   ├── MyDig/              # VinylWallEditor, GraffitiSnapshotList,
│       │   │   │                   # SnapshotSaveModal, ShareButton, QuickRegister
│       │   │   └── storefront/     # Palettes, primitives, scene composition
│       │   └── ui/
│       ├── hooks/                  # useAlbum, useMe, useMyDig, useFollow,
│       │                           # useSearch, useUserReviews, useNowPlaying, etc.
│       ├── contexts/               # AuthContext, HomeStateContext,
│       │                           # SearchOverlayContext, CurationProgressContext
│       ├── lib/                    # homeSort, adminSeen (localStorage helpers)
│       └── utils/                  # apiUrl, relativeTime, score, spotify
└── server/
    └── src/
        ├── index.ts
        ├── routes/                 # albums, albumReviews, albumRequests, admin,
        │                           # me, userReviews, mydig, follows, ownership,
        │                           # purchaseLinks, votes, reviews, home,
        │                           # homeFeatures, search, labels, labelFeed,
        │                           # cover, customCovers, avatars, sitemap,
        │                           # stats, crates, auth
        ├── services/               # claude, deepseek, llmRouter, llmAdapter,
        │                           # llmCompare, claudeBudget, reviews,
        │                           # albumUrlExtract, musicbrainz, lastfm,
        │                           # discogs, spotify, youtube, bandcamp,
        │                           # serper, exchangeRates, avatarHost,
        │                           # customCoverHost, email, toasterRenderer
        ├── jobs/                   # rankScheduler, labelFeedPoller, usageLogPruner
        ├── db/                     # index (init + helpers), schema (CREATE TABLE
        │                           # + runOnce migrations)
        ├── auth/passport.ts        # Google OAuth
        ├── middleware/auth.ts      # requireAuth, requireAdmin
        ├── utils/                  # cache, slug, username, albumSearch,
        │                           # externalSearch, memoCache, coverColor,
        │                           # coverImage, albumPreview
        ├── seed/diggershaus.db     # Ships-with-repo seed for first boot
        └── data/diggershaus.db     # Live DB (gitignored, Railway volume mount)
```

---

## API Cost Discipline

Phase 1 originally spent ~$0.50/album via Claude's `web_search` tool ($5/session for 10 albums). That path was removed in the Phase 3a review-pipeline rebuild after a single session demonstrated the cost shape: each `web_search` invocation pulled tens of thousands of tokens of page content back into context as input tokens, and Claude re-fetching popular sites on every album scaled badly.

Current per-album cost is **~$0.01** for a typical 9–15 review pull (~$0.001 per review), via:

1. **Serper.dev** for URL discovery (admin clicks 🔎 자동 검색 → 10–20 candidates)
2. **Editorial-picker LLM** narrows to the actually-editorial URLs (~$0.0003 per pick call)
3. **Jina Reader** (`r.jina.ai/` proxy) renders the page and converts to clean markdown — free, JS-rendering, removes HTML boilerplate before the LLM sees it
4. **DeepSeek v4 Flash** extracts the review prose, scores it, and summarises in Korean

Every operation runs through DeepSeek today; the env-driven model router (`server/src/services/llmRouter.ts`) lets admin re-route any operation without code changes, and `/admin/compare` surfaces blind shadow comparisons of any two models on real review prose.

**Cost-sensitive rules** (do not break without discussion):

- Anthropic SDK: `maxRetries: 2` (was 5 — amplification risk)
- `getOrFetchAlbumBase` **never** warm-ups reviews. Every album registration lands with `reviews_crawled_at IS NULL`.
- `GET /albums/:id/reviews` is cache-only — no auto-fetch on miss.
- `scrapeReviewFromUrl` is the **only** automated review fetch path. Jina primary, raw HTML as fallback for star / filename-image / numeric detectors that need the original markup.
- `generateKoreanSummary` + `stripSummaryPreamble` + `normaliseKoreanTerms` post-process every Korean output. Do not remove.
- The admin dashboard API usage panel + `/api/admin/scrape-failures` + `/api/admin/excerpt-edits` are the observability trio. Keep them working when adding new LLM call sites.

---

## 캐싱 전략 (Caching Strategy)

All cache lives in SQLite (single-file, no Redis).

| Data | Cache duration |
|------|----------------|
| LLM responses (review summaries, similar-album descriptions, pronunciation, editorial pick) | Permanent — never call twice for the same album |
| Review scraping (Pitchfork, AllMusic, RYM, etc.) | Per-URL; `reviews_crawled_at` gates re-crawl |
| Discogs marketplace prices | 24 hours |
| MusicBrainz / Last.fm metadata | Indefinite |
| Cover art (Cover Art Archive + custom uploads) | Indefinite, served from `server/data/avatars/` and `custom-covers/` |

---

## 기여 (Contributing)

This is a 1-person dev project with a sharply defined audience and a deliberate anti-algorithm stance. Bug reports and small fixes are welcome via PR. Feature pitches that lean into "for you" recommendations, mainstream-chart coverage, or heavy long-form Korean editorial are out of scope by design — see `CLAUDE.md` for the full list of explicit non-goals.

---

## License

MIT
