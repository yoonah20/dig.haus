# dig.haus — 16-day project log

A narrative chronicle of dig.haus from day 0 — domain purchase +
the first browser-based prototype on 2026-04-14 — through the
day-15 Korean-term backfill on 2026-04-29. Compressed from ~600
commits, seven phase documents, and Claude's session memory into
one read-through. Each section names the dates it covers and
bookmarks a few specific commits worth digging into.

This is a **single-developer log**. "We" doesn't appear; the
operator is the curator, the engineer, the designer, and the
copywriter. Claude pairs in via vibe-coding sessions but the
project shape — what gets built, what gets cut, what gets parked —
is the operator's call.

The thesis at the start was, and still is: **a digital record
store, not an algorithmic music feed**. Vinyl collectors + Korean-
language listeners of international / niche music. Anti-algorithm
positioning enforced explicitly when features tempt away from it.
Tagline: "No algorithms needed. Keep digging."

---

## Day 0 — pre-git origins (2026-04-14)

Day 0 doesn't appear in `git log` because the work happened in a
browser-based vibe-coding session before the repo was initialised
locally. The same day:

- **dig.haus domain purchased**.
- **First album-grid prototype** built — the visual ancestor of
  what later became `/dig`. Cover-first layout, sort + page
  controls, the bones of the catalog browse surface.
- **First album detail page** drafted — the layout that became
  `/album/:slug` after migration into the local + Railway repo
  the next day.

The day-1 Railway commit (`77c5240` on 2026-04-15) wasn't a from-
scratch start — it was a *port* of this browser-side work into a
proper Vite + Express + SQLite scaffold. That's why day 1's 55
commits already include polished album cards, price stickers, and
cover-art proxying: the design instincts had been exercised in
the browser session the day before, and the local-repo move was
about turning that prototype into a deployable, version-controlled
shape.

No artefacts survive from this day other than the visual
direction it set. Worth recording explicitly so the git log's
sudden density on day 1 doesn't read as miraculous — it was
preceded by a day of unsourced exploration.

---

## Day 1 — foundation (2026-04-15)

55 commits in one day. The ground floor:

- Initial Vite + Express scaffold deployed to Railway. Postgres
  optional but SQLite in `server/data/diggershaus.db` shipped as
  the default. The seed DB ships with the repo so a fresh boot or
  empty volume comes up populated.
- Album card + price-sticker palette landed visually intact on day
  one. The "record-shop" framing was decided *before* the first
  feature shipped.
- Cover art proxy + cache (`/api/cover`) so external image hosts
  don't break the home grid when they 404 / rate-limit.
- Touch-device tap-to-flip overlay + scroll-aware close. Mobile
  treated as a first-class surface from the start.

What's notable here is that nothing in this day was thrown away
later. The album card design, the price-sticker style, the cover-
proxy pattern — all still load-bearing fifteen days later. The
operator's design instincts had been exercised in day 0's
browser-based prototype, so day 1's port-into-repo arrived with
the visual language pre-decided.

  Bookmark: `77c5240` (initial commit), `02138ed` (server/data/
  runtime split), `c42cba2` (cover proxy).

---

## Days 2-6 — Phase 1: album archive + reviews (2026-04-15 to 04-20)

Phase 1 cemented the basic shape — albums, reviews, similar
albums, Discogs prices, streaming links. The headline event of
this stretch was the **review pipeline cost crisis**.

The original review-fetch path went through Claude's `web_search`
tool — Sonnet would search the open web for review URLs and
extract excerpts in one shot. Worked, but each search invocation
pulled tens of thousands of input tokens of page content into
context. A single curation session burned ~$5 across 10 albums
(~$0.50/album), and Claude re-fetching the same popular sites for
every album scaled badly.

The original `searchReviews` / 🔎 리뷰 모아오기 path was deleted
outright during a rebuild that landed across **04-21** (50
commits in one day). The new pipeline:

  - **URL discovery via Serper.dev** ($0.0003/call) returns 10-20
    candidates. Free Google-results-as-JSON.
  - **Haiku editorial filter** picks the actually-editorial URLs
    from the candidates. Cheap pre-filter before expensive scrape.
  - **`scrapeReviewFromUrl`** routes page fetches through Jina
    Reader (`r.jina.ai`) — free proxy that renders JS and converts
    to clean markdown. Claude sees article prose instead of HTML
    boilerplate.
  - **Per-site detectors** for Sputnik / Metal Storm / WordPress
    star-rating widgets / schema.org ratingValue / Metal Trenches
    / Chaos Zine etc. Site-specific score extraction beats a
    generic regex.
  - **Bot-wall + paywall blacklist** (DB + hardcoded domains).
    Rockhard, ultimatemetal, iheart, plus six others that
    consistently bot-blocked.
  - **Wayback Machine fallback** (added 04-28) — for sites that
    block the scraper directly but archive.org has indexed.

Per-review cost dropped from $0.50/album to $0.001/album —
**500x reduction** while improving signal quality.

This rebuild also produced the **`normaliseKoreanTerms` post-
process pass** (slowly grew from one rule to ten) that strips
markdown artefacts and rewrites literal-translated genre nouns:

  - 신발 응시 → 슈게이즈
  - 후기 펑크 → 포스트 펑크
  - 새로운 물결 → 뉴 웨이브
  - 진보적 록 → 프로그레시브 록
  - 산업적 메탈 → 인더스트리얼 메탈
  - 지하 힙합 → 언더그라운드 힙합
  - {장르}\s*장면 → {장르} 씬
  - 에모 → 이모 (added day 15)

Each rule has a comment in `claude.ts` explaining the false-positive
guard. The community-vernacular outputs read as written by someone
who actually listens to the music, not as a machine translation.

  Bookmark: `9cb07c3` (drop legacy album_requests), `1411664` (LLM
  router with primary + shadow), `e7fdd9c` (Gemini 2.5 Flash
  pricing fix), `46e9b14` (Wayback fallback).

---

## Days 4-7 — Phase 2: community contributions (2026-04-18 to 04-21)

(Overlapped with Phase 1's pipeline rebuild — both were running.)

Phase 2 was the user-account layer. Auth, contributions,
moderation:

  - **Google OAuth** via Passport. Single-tap login, no password.
    `users.email` UNIQUE keeps duplicate accounts out.
  - **50자 평** (50-character reviews) — short opinion form per
    album, unique-per-user, editable.
  - **굿굿 / 별루 voting** — split-pill UI in blue-red palette,
    paired with the 샀음 / 살거 ownership pill in amber-purple.
  - **샀음 / 살거 collections** — physical-ownership flag (vinyl
    real-world collecting) and wantlist. Both later absorbed into
    the Crate system on 04-28.
  - **Community purchase links + admin moderation** — visitors can
    add buying URLs (Bandcamp, label shops, eBay listings),
    flagged for admin review with reporting + dismissal flow.
  - **Admin dashboard** — counters, recent feed, scrape-failure
    log, Claude usage panel with rolling 24h budget cap.

The cost-discipline thread that started in Phase 1 carried into
admin tooling: every Claude call site logs to `claude_usage`, the
admin panel surfaces rolling spend against `ROLLING_24H_USD_CAP`,
and the LLM router (`server/src/services/llmRouter.ts`) supports
shadow-mode comparisons for evaluating cheaper alternatives
(DeepSeek, Gemini Flash) against Haiku/Sonnet on real review prose.

  Bookmark: `f3b9065` (admin ⚡ register-and-curate button),
  `e2c5bc7` (LLM shadow-comparison page), `b48d8c1` (admin source
  whitelist / blacklist UI).

---

## Days 8-11 — Phase 3: 마이딕 vinyl wall (2026-04-22 to 04-25)

The defining feature of dig.haus's identity. Each user gets a
public profile at `/my/<username>` with:

  - **Vinyl Wall** — 15 LP slots in a 5-5-5 layout. Drag-drop
    edit with an 80/20 picker (sources: 전체 / 샀음 / 굿굊 / 살거).
    Per-row wooden rails. Drop-shadow + variance-on-x so the LPs
    don't read as a perfect grid.
  - **Snapshots** — name + describe a wall state, mark public or
    private, share via `/my/:u/snap/:slug`. Items immutable
    post-create.
  - **Persistent Spotify embed** — pinned at the bottom of mydig,
    survives client-side route changes.
  - **Follow system** — `user_follows` table, follower/following
    counts, public profile card with hover popover.
  - **Username system** — URL-safe slug derived from email local
    part, reserved-word list, onboarding modal on first `/my/*`
    visit.

The build was full of pivots, all documented in
`docs/phase3-storefront-decisions.md` (19+ entries). The visual
direction walked through:

  - Record-shop interior (rejected: too literal)
  - Lofi-bedroom with turntable console + floor crates
  - Wireframe-first MVP at decisions-log entry 19
  - Hongdae-dusk composition (current live)
  - Path B: illustrated lofi-bedroom asset (long-term target,
    deferred to roadmap item 3)

The slot count walked **22 → 15 → 10 → 15** across migrations.
Visual scale tuning, not feature scope. The decisions log is
honest about which earlier entries are now stale.

Phase 3 closed officially on **2026-04-25** (`a5d2c51`). Deferred
work — Shelf + Crate mutation endpoints, illustrated storefront,
샀음/살거-vs-Crate boundary — moved into `docs/post-phase3-roadmap
.md` rather than carrying as Phase 3 leftovers. Five sequenced
items, six brainstorm additions, four explicit anti-features.

  Bookmark: `c07e26f` (mydig wired to wall primitives), `bdabd3b`
  (Hongdae-dusk → lofi-bedroom palette swap), `a5d2c51` (Phase 3
  close), `716b50b` (post-Phase 3 roadmap committed).

---

## Days 11-13 — Phase 3.5: home consolidation (2026-04-25 to 04-27)

Three days of dense home-page work that didn't have a name when
it started but ended up being a real phase.

The home page used to be three separate surfaces — `/` (album
grid), `/dig` (catalog browse), and a HomeWall / ActivityRail
combo on `/`. The split made sense individually but read as three
different sites stitched together.

Phase 3.5 collapsed the three into one identity:

  - **Home (`/`) became dig.haus's own mydig** — a 5-5-5 vinyl
    wall + handwritten signature header. Same primitives the user
    walls use, applied to the site-level admin-curated picks.
  - **`/dig` became the pure catalog browse surface** — flat
    grid, sort + density toggles, infinite scroll on mobile. No
    hero, no rails, no curation chrome. Just covers.
  - **HomeWall.tsx + ActivityRail-on-/dig got deleted** — they
    were redundant after the consolidation.
  - **Home wall + mydig wall editors collapsed into one
    component** — `VinylWallEditor` with an `EditTarget` discrim
    (wall / snapshot / home-features / fresh-snapshot). One save
    button, one drag-drop, one search-and-add flow.
  - **Home tuner UI** — the per-LP positioning + handwritten-
    title placement, previously per-admin localStorage, moved
    into `home_meta` columns so a 저장 click published to every
    visitor.
  - **Mobile hero** — per-row painted-rail composition with
    handwritten "딕하우스 이번달 픽" title. Desktop runs the
    fixed-aspect AVIF backdrop; mobile renders a flatter tile-able
    pattern that doesn't clip on tall phone viewports.

Closed **2026-04-27** (per memory). After this, dig.haus reads as
one site with two surfaces (browse vs. curated) instead of three
separate fragments.

  Bookmark: `58a4a86` (home = dig.haus's mydig), `de0e54e` (mobile
  hero scaffolding), `d5494e8` (collapse wall editors).

---

## Day 13 — Phase 4 attempted, parked (2026-04-27)

The plan was a local-LLM nightly curation pipeline: RTX 5080 +
Qwen3-14B (or whichever model won the comparison toolbox) would
generate Korean review summaries overnight, freeing Claude budget
and unlocking a 350 → 30,000 album scale.

`docs/phase4-nightly-pipeline.md` drafted the architecture in
detail. `c051df8` shipped the L0c blind-bench harness — admin
could run side-by-side comparisons of local-model output vs the
canonical Sonnet output on real review prose, blind-scored.

**The bench results disqualified Pre-L0**. Local model outputs
read as machine translations relative to Sonnet's editorial prose;
the cost saving wasn't worth the quality drop at this corpus
scale. Phase 4 PARKED in `0ed7605` later the same day.

The harness itself was torn down (`server/scripts/preL0-spot-
check.ts` kept for future model evaluations; bench tables dropped
from schema). The phase's *artifacts* are gone but the
*decision context* is preserved in the memory entry — so the
next time a "should we self-host the LLM" question comes up, the
2026-04-27 bench data is available rather than re-relitigating
from scratch.

This is the most product-disciplined moment of the fifteen days.
Several weeks' worth of planned engineering walked away from
because the bench said it wasn't worth shipping. Not the typical
first-vibe-coder move.

  Bookmark: `c051df8` (bench harness), `0ed7605` (PARK decision).

---

## Day 14-15 — the post-Phase 3 burst (2026-04-28 to 04-29)

The week's two-day stretch was an unusual amount of work:

### Invitation gate (04-28)

The DB-pollution worry surfaced — Korean-language vinyl niche is
small, but open Google OAuth signup means anyone-with-a-Google-
account could land. With the curation positioning, every off-brand
50자 평 / wall item is identity drift.

Solution: invitation-only. `invited_emails` table holds the
allowlist; `pending_signups` holds un-invited Google attempts.
`upsertGoogleUser` gates the INSERT path on `isInvited()`; new
visitors land in the pending queue with a friendly "운영자에게
신청이 전달됐고, 검토 후 알려드릴게요" modal. Existing users were
grandfathered in via a runOnce migration so the gate shipped
transparently.

  Bookmark: `fb6b232`. Memory: `project_invitation_gate.md`.

### Multi-wall hero carousel (04-28)

The home hero used to be a single wall. That worked but the
operator wanted multiple curatorial tracks — "이번주 발굴" + "시즌
무드" + "장르 여행" — the visitor swipes between.

Built end-to-end in one session:

  - **Schema**: new `home_walls` table with per-wall backdrop +
    HERO_THEME tokens (ink_color / shadow_css / wall_color) + 15
    tuner columns. `home_features.wall_id` FK with composite
    UNIQUE(wall_id, position). Migration grandfathered the
    singleton home_meta into wall_id=1 + dropped the legacy table.
  - **Server**: `/api/home/features` returns `walls[]` instead of
    `{ items, meta }`. PATCH and PUT endpoints take `?wallId=N`.
  - **Client**: HomeNextHero + HomeNextHeroMobile both wrap their
    per-wall content in CSS scroll-snap-x containers. Dot
    pagination + active-wall tracking via IntersectionObserver.
  - **Admin reorder**: inline ← → arrows on the active wall slide
    swap positions with neighbors via `POST /api/home/walls/:id/
    move`. Atomic transaction with a temp -1 step so the UNIQUE
    constraint can't fire mid-update.
  - **Last-viewed wall persistence**: sessionStorage restore on
    mount so navigating to an album page and back doesn't snap
    the user to wall 1.
  - **Auto-advance**: 7-second cycle, pauses on hover / touch /
    focus / admin-edit / tuner-open / `prefers-reduced-motion:
    reduce`.
  - **Per-wall HERO_THEME**: `extract-hero-theme.ts` retooled to
    sample a backdrop AVIF and write the auto-flipped ink/shadow/
    wall_color tokens into a specific home_walls row. One CLI
    invocation per new backdrop.

The backdrop set itself iterated three times across the day:
basement_purple/black/plant → operator judged plant too murky →
hero_afternoon (cream) + hero_purple + hero_basement (the current
plum → black → afternoon-light cycle reading as different rooms
at different times).

  Bookmark: `d4a7df3` (schema), `9165dc7` (carousel UI),
  `c30e27f` (reorder + remember + chevron drop), `489cd4a` (hero_*
  swap), `a8e8acf` (auto-advance).

### Spotify diagnosis (04-28 to 04-29)

User-reported issue: Spotify URL frequently null on album register
even for albums that exist on Spotify. Hawthorne Heights — "If
Only You Were Lonely" was the reproducible example.

**Root cause** found by reading the code: `searchTrack` was
sending `q: artist:${artist} album:${album}` to Spotify's
structured-field search. Without quotes around multi-word values,
Spotify's parser consumed only the first whitespace-separated
token as the field value — `artist:Hawthorne Heights` parsed as
`artist:Hawthorne` with "Heights" treated as free text. Multi-word
artists + multi-word albums (which is most albums) hit this.

  Fix in `f6ed91e`: quote field values + cascade through fallback
  queries — primary-artist-only, parenthetical-stripped,
  free-text. Verified end-to-end against the live Spotify API.

**Second issue surfaced**: Spotify's 30-day rolling-window 429
fired during diagnostic testing (Retry-After: 7918 seconds — over
two hours). Worse, the existing code had no 429 detection, so
every register during the cooldown burned four sequential API
calls (the structured query + three fallbacks), each a 429 strike
that extended the window further.

  Fix in `6541036`: module-level cooldown timestamp. After a 429,
  every searchTrack call early-returns until Retry-After expires.
  Plus `POST /api/admin/spotify/backfill` for recovering null-
  URL albums after the cooldown clears, and `GET /api/admin/
  spotify/status` for read-only cooldown checks.

### Misc polish on day 15

  - **News URL filter** (`3ed6bff`): `/news/` paths blocked from
    review discovery + scrape pipeline. Verb-shape press-release
    slugs were already filtered (unleash, premiere, etc.); the
    `\bnews\b` directory-pattern was the missing piece.
  - **Korean term: 에모 → 이모** (`42b99b2`): genre-name normaliser
    rule + (`096215c`) one-shot SQL backfill of existing summaries
    + excerpts. The Korean vinyl / hardcore-adjacent community
    uses 이모 exclusively; 에모 reads as machine translation.
  - **Discogs URL register** (`58b4a93`): paste a Discogs release
    URL into the search bar → server canonicalises to `discogs-
    release-{id}` MBID → register button skips the MB picker
    entirely. Tested against the underground-metal album the user
    submitted as the proof case.
  - **Search separator strip** (`58b4a93`): "Artist - Album" /
    "Artist – Album" / "Artist : Album" copy-pastes now match the
    same as "Artist Album". Word-boundary regex skips intra-word
    hyphens (AC-DC, Sigur Rós).

---

## Where it stands (end of day 15)

**Live and stable**:
- Album archive: 350+ albums, full review summaries, Discogs
  prices, streaming links
- 50자 평 + 굿굿/별루 + 샀음/살거 (now Crates) + community
  purchase-link moderation
- Mydig vinyl wall + snapshots + persistent player + follow + public
  profile card
- Three-wall home hero carousel with auto-advance, swipe nav,
  per-wall admin tuning
- Invitation-only signup gate with admin approval flow
- Review pipeline at $0.001/album (500x improvement from Phase 1)

**Tooling + observability**:
- Admin dashboard with stats, recent feeds, scrape-failures,
  Claude usage rollover, source whitelist/blacklist, tag
  blacklist, LLM shadow comparisons
- Cost telemetry on every Claude call, rolling-24h budget cap
- Email notifications via Resend for new signup requests
- `extract-hero-theme.ts` — per-backdrop wall-color sampler that
  writes directly to home_walls rows

**Tech debt acknowledged but deferred**:
- Home-feed N+1 subqueries (fine at current traffic)
- Generate-summary missing per-call budget tracking
- No orphan sweep for `server/data/avatars` and `custom-covers/`
- Wall reorder is last-write-wins (no CAS for multi-device edit)
- Concurrent Spotify fan-out lacks rate-limit aware p-limit

**Vision discipline log**:
- Anti-algorithm thesis defended in CLAUDE.md, post-phase3-roadmap
  anti-features section, D/E reframing
- Phase 4 PARKED on bench evidence (mature decision)
- Curation depth over phase progression (memory rule)
- Track & Alert rejected (against atmosphere-first vision)
- Heavy Korean long-form editorial deliberately not built (1-person
  dev, niche audience reality check)

**Next on the table** (per `docs/post-phase3-roadmap.md`):
- 0b: album page zine pass — Tier 1 first ship
- 2: Crate as unlimited "magic record cabinet" replacing 샀음/살거
- 3: shop-feel visual polish — plastic-wrap on covers
- 1a: topster PNG export of vinyl walls
- 1b: right-rail social ambient ticker (last, gated on a vision
  answer)

**Brainstorm queue** (A-G in roadmap):
- A: Discogs collection import
- B: Label pages as first-class destinations
- C: Random dig button (under "actually useful?" review)
- D: 오늘의 발굴 — reframed onto the existing hero carousel
- E: 라이너 노트 — promote admin-authored 50자 평
- F: Letter to a stranger — anonymous album notes
- G: /dig as browse-by-lens surface (artist / label / genre)

**Multilingual horizon** (per `project_multilingual_direction.md`):
Korean-only is not the long-term shape — moat is curation + anti-
algorithm + tactile, not language. Staged path: invitation Korean
now → X-style on-demand UGC translation toggle → `/en` parallel
surface with curated editorial auto-translated once + cached.

---

## Where the history lives (so this log doesn't have to be the only one)

- **`git log`** — 600 commits, prose-form messages with WHY in
  the body. `git log --reverse --pretty=format:"%h %ad %s%n%n%b%n
  ---" --date=format:"%m-%d %H:%M"` for full chronology.
- **`CLAUDE.md`** — persistent brief for new Claude sessions.
  Vision, current state, conventions, tech debt notes.
- **`README.md`** — public-facing intro.
- **`docs/post-phase3-roadmap.md`** — strategic backlog with
  decision context built in. Items A-G + anti-features list.
- **`docs/phase3-storefront-decisions.md`** — 19+ entries logging
  the mydig visual direction's pivots.
- **`docs/album-page-zine-vision.md`** — vision doc for the album-
  page zine pass (Phase 0b, not yet started).
- **`docs/phase4-nightly-pipeline.md`** — drafted Phase 4
  (PARKED). Kept as decision-context archive.
- **Claude side-memory** at `~/.claude/projects/-home-yoonah-
  diggershaus/memory/` — sixteen files covering user profile,
  feedback rules, project decisions. Not in git; lives across
  vibe-coding sessions.

This log itself sits on top of all of the above as the single
read-through entry point.
