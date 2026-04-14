# dig.haus

**레코드 컬렉터를 위한 음악 리서치 허브** — Music Research Hub for Record Collectors

A web app where record collectors can search for any album and get everything in one place: reviews summarized in Korean, buy links with prices, streaming links, label info, and similar album recommendations. Stop opening 10 tabs for every album you discover.

---

## 기술 스택 (Tech Stack)

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React + TypeScript + Vite + Tailwind CSS v4 + TanStack Query |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | SQLite (better-sqlite3), migration-ready for PostgreSQL |
| **APIs** | MusicBrainz, Last.fm, Discogs, Spotify, YouTube, iTunes, Bandcamp, Claude AI |

## 사전 요구사항 (Prerequisites)

- Windows 11 with WSL2 (Ubuntu) — or any Linux/macOS system
- Node.js 18+ (recommend installing via nvm)
- API keys for external services (see [Get API Keys](#4-api-키-발급-get-api-keys) below)

## 설치 방법 (Setup on Windows 11 with WSL2)

### 1. WSL2 설치 (Install WSL2)

```bash
# In PowerShell (Admin)
wsl --install
# Restart, then set up Ubuntu username/password
```

### 2. Node.js 설치 via nvm (Install Node.js)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 3. 프로젝트 설치 (Clone and Install)

```bash
cd ~/
git clone <repo-url> diggershaus
cd diggershaus

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

### 4. API 키 발급 (Get API Keys)

| Service | Link | Instructions |
|---------|------|-------------|
| **Last.fm** | https://www.last.fm/api/account/create | Create account, create API app, copy API key |
| **Discogs** | https://www.discogs.com/settings/developers | Create account, generate personal access token |
| **Spotify** | https://developer.spotify.com/dashboard | Create app, copy Client ID and Client Secret |
| **YouTube Data API** | https://console.cloud.google.com/apis/library/youtube.googleapis.com | Enable API, create API key in Credentials |
| **Claude API (Anthropic)** | https://console.anthropic.com/ | Create account, generate API key |
| **Google OAuth (Phase 2 login)** | https://console.cloud.google.com/ | See *Google OAuth 설정* below |

> **Note:** MusicBrainz, Cover Art Archive, and iTunes Search API require NO authentication.

### 4-1. Google OAuth 설정 (Phase 2)

1. Visit https://console.cloud.google.com/ and select your dig.haus project (or create one).
2. **APIs & Services → Credentials** → **Create Credentials** → **OAuth 2.0 Client ID** → *Web application*.
3. Under **Authorized redirect URIs** add: `http://localhost:3001/auth/google/callback`
4. Copy the **Client ID** and **Client Secret** into `server/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Generate a long random session secret: `openssl rand -hex 48` and set it as `SESSION_SECRET`.
6. Set `ADMIN_EMAILS` to the comma-separated Gmail addresses that should be auto-promoted to admin on login (e.g. `ADMIN_EMAILS=owner@gmail.com,coowner@gmail.com`).

### 5. 환경 설정 (Configure Environment)

```bash
cp .env.example server/.env
# Edit server/.env with your API keys
```

### 6. 로컬 실행 (Run Locally)

```bash
# Terminal 1: Start server
cd server && npm run dev

# Terminal 2: Start client
cd client && npm run dev
```

Open http://localhost:3000

---

## 프로젝트 구조 (Project Structure)

```
diggershaus/
├── .env.example
├── .gitignore
├── client/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── components/
│       │   ├── AlbumCard.tsx
│       │   ├── AlbumDetail/
│       │   ├── LoadingSkeleton.tsx
│       │   └── SearchBar.tsx
│       ├── hooks/
│       │   ├── useAlbum.ts
│       │   ├── useArtist.ts
│       │   └── useSearch.ts
│       ├── pages/
│       │   ├── Album.tsx
│       │   ├── Artist.tsx
│       │   └── Home.tsx
│       └── types/
│           └── index.ts
└── server/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── db/
        │   ├── index.ts
        │   └── schema.ts
        ├── routes/
        │   ├── albums.ts
        │   ├── artists.ts
        │   ├── labels.ts
        │   └── search.ts
        ├── services/
        │   ├── bandcamp.ts
        │   ├── claude.ts
        │   ├── discogs.ts
        │   ├── lastfm.ts
        │   ├── musicbrainz.ts
        │   ├── reviews.ts
        │   ├── spotify.ts
        │   └── youtube.ts
        └── utils/
            └── cache.ts
```

---

## 주요 기능 (Features) — Phase 1

- **Album search** with MusicBrainz autocomplete
- **Album detail page**: cover art, metadata, genre tags, label info
- **Streaming links**: Spotify, Apple Music, YouTube, Bandcamp
- **Buy section**: Discogs marketplace prices and links
- **Reviews**: scraped from Pitchfork, AllMusic, Metacritic, RYM
- **Korean review summary** via Claude AI (cached, called once per album)
- **AI-powered similar album recommendations** in Korean (cached)
- **Label info** with notable releases
- **Album-level discography** view
- **Recently viewed albums** on homepage
- **Aggressive caching strategy** to minimize API costs

## Phase 2 — Shop Experience (Current)

- **Google OAuth login** with session persistence (SQLite session store)
- **굿굿 / 별루 voting** on every album; per-user toggle, amber highlight
- **Community-registered 구매처 links** with currency-aware prices (USD/JPY/GBP/EUR/KRW)
- **Record-shop price-tag stickers** overlaid on album artwork (max 3 + overflow)
- **Admin dashboard** at `/admin` (auto-promoted via `ADMIN_EMAILS`)
- **Admin-only mutations**: delete album, manual review score, re-translate excerpt, refresh reviews
- **🏆 Vinyl Wall**: daily `node-cron` job at midnight KST ranks top 20 by `upvotes - downvotes`; homepage pins them first

---

## 향후 계획 (Planned Features)

### Phase 2: 사용자 계정 & 컬렉션 (User Accounts & Collections)

- User registration/login
- Personal collection tracking (format, condition, purchase info)
- Wishlist and wants list
- Saved purchase links with price alerts

### Phase 3: 커뮤니티 (Community)

- Digging journal (Twitter-style posts about discoveries)
- Album DNA mindmap (influence relationships between albums)
- Community album recommendations with upvote system
- Follow system
- One-line reviews
- Monthly digging report

---

## 캐싱 전략 (Caching Strategy)

All cache is stored in SQLite.

| Data | Cache Duration |
|------|---------------|
| Claude API responses (review summaries, recommendations) | Permanent (never call twice for same album) |
| Review scraping (Pitchfork, AllMusic, etc.) | 7 days |
| Discogs prices | 24 hours |
| MusicBrainz / Last.fm metadata | Indefinite |

---

## License

MIT
