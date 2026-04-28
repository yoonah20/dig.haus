# Post-Phase 3 roadmap

Strategic backlog after Phase 3 winds down. Drafted 2026-04-25 from a conversation laying out the next ~6 months of dig.haus.

This is intentionally a **roadmap**, not a plan. It captures what's on the table and recommended sequencing. Per-item plans (schemas, PRs, costs) live in their own docs once an item moves into active work.

---

## Where we are (2026-04-25)

- **Phase 1, 2, 3 done** (Phase 3 closed 2026-04-25): vinyl wall + snapshots + follow + persistent player + public profile card all shipped. Shelf/crate mutation endpoints + storefront illustrated visual were deferred during build and are absorbed into items 2 and 3 of this roadmap rather than carried as Phase 3 leftovers.
- **Phase 4 drafted** at `docs/phase4-nightly-pipeline.md` (RTX 5080 + local LLM nightly curation).
- **Live MyDig storefront** is the transitional Hongdae-dusk composition. Long-term target is Path B per `docs/phase3-storefront-decisions.md` entries 18–19 (illustrated lofi-bedroom background asset behind CSS/SVG overlays).
- **DB scale**: ~350 albums. Comfortable usable scale is closer to 30,000.

---

## Items on the table

Numbered as the user listed them. **0 is the immediate work; 1–4 are the strategic queue.**

### 0. Album detail page refactor — *chrome layer shipped 2026-04-25*

PR1–PR7 closed: token hoist, four chrome primitives (Panel/Chip/Field/SectionTitle), section title migration, ReviewSection + SimilarAlbums + UserReviewsSection chrome consolidation, OwnershipButtons amber unification, ReviewsAdminBar extraction, masking-tape section headers + lamp wash on the cover. Page is now consistent in palette and rounding and reads as one composition rather than three islands.

**The chrome refactor is the foundation, not the destination.** The user flagged the result as too subtle — what got built is "more consistent dark-mode chrome", not the parade-level visual identity the album page should carry. The actual ambition lives in `docs/album-page-zine-vision.md` (with `album-page-zine-mockup.png` as the reference image): a record-shop promotional zine / flyer aesthetic — cream paper, photocopier aging, rubber stamps, hand-marker scores, two-column print body type, mini-review grid replacing the single summary card. Multi-week build, tiered into typography pivot (Tier 1) → paper + stamps + ornaments (Tier 2) → printing imperfection (Tier 3) → interaction polish (Tier 4).

### 0b. Album page zine pass — *next major surface work*

Tier 1 first, ship to prod, see how it reads. Tier 2 follows once paper / stamp assets are sourced. Tier 3 overlaps with item 3 (shop-feel visual: plastic wrap on covers) — same asset pipeline, can land together. See `docs/album-page-zine-vision.md` for the tier breakdown.

### 1. Social — main page right rail expansion + shareable wall image

Two distinct sub-items inside this:

**1a. Topster-style PNG export of vinyl wall.**
The current "share" surface is just a URL. A square PNG (Instagram-friendly, 1080×1080) of the user's wall lets the wall escape dig.haus into Instagram / Twitter / Threads / KakaoTalk. The Korean 미니홈피 + topster lineage already has cultural fit.

**1b. Right-rail social pane.**
The home right rail currently shows only "최근 기록." Open it up to: following users' recent activity, recently-snapshotted walls, shared crates, "지금 듣는" turntable picks. Goal stated by the user: "사용자가 오래 머물 수 있게."

**Tension to resolve**: 1b's "long stay" framing is engagement-maximizing language, which is exactly what dig.haus's anti-algorithm positioning rejects (CLAUDE.md vision section, the "no spoon-feeding curation" rule, "no for-you carousel" non-goal). The dig.haus version of social has to be **passive ambience** rather than **active feed** — closer to the existing CommentTicker (peripheral overheard voices) than to a TikTok-style scroll.

Concrete shape that respects the vision: a **multi-channel ambient ticker** in the rail — same metaphor as the existing comment ticker but with channels you can switch between (latest comments / following activity / fresh snapshots / labels you watch). No ranking, no "for you," strict reverse-chronological. A user staying long because they're enjoying ambient activity is fine; a user staying long because we made the feed sticky is not.

### 2. MyDig 강화 — Crate as the unlimited "magic record cabinet"

Crate as a first-class user-named container, **unlimited capacity**, replacing 샀음/살거. Public storefront optionally surfaces selected crates as visual stacks below the wall. The "physically impossible storage" framing is the design hook — what's the visual that says "this holds 1,000 records but it's clearly not a real crate"?

This subsumes two open items from the Phase 3 status:
- Shelf + Crate mutation endpoints (currently read-only).
- Decisions log entry 20 (샀음 / 살거 vs Crate boundary) — this commits to the absorption side: 샀음/살거 disappear, replaced by system-managed default crates if needed.

**Add-on**: visitor comments as Post-Its stuck on the wall. Already aligned with the deferred guestbook concept (Phase 5+ ambience pass), but Post-Its-on-wall fits the existing wall metaphor far better than a separate guestbook corner.

**Open questions**:
- Default crates auto-populated from existing 샀음/살거 data on migration — yes or no?
- Unlimited capacity rendering: virtualization needed past ~200 albums per crate. The "magic cabinet" visual has to gracefully degrade for a 1,000-album crate without dropping frames.
- Post-Its: comment visibility (public / friends-only / owner-only), max count on the wall before they get archived to a side stack, moderation hooks.

### 3. Shop-feel visual polish — vinyl jacket as plastic-wrapped object

Layer a plastic-wrap PNG over jacket covers, render the wrap "tearing" when an album moves into a user's crate. Eventually 3D CSS thickness on the jacket itself.

This is a **direct extension of `docs/phase3-storefront-decisions.md` entry 18 Path B** — accept that CSS can't reach the illustrated aesthetic alone, layer purchased assets on top.

**Sequencing dependency**: the "tearing wrap when moved into crate" payoff moment only exists if crates exist. Item 3 must follow item 2.

**Cost shape**: asset purchase ($20–200 per pack range, modest), no recurring cost. Risk: asset library lock-in if the chosen pack stops getting updated. Mitigate by scoping the visual identity to be replaceable (ratio + lighting hooks defined, specific assets swappable).

### 4. DB scale via local LLM nightly pipeline — *Phase 4*

Already drafted at `docs/phase4-nightly-pipeline.md`. RTX 5080 + Qwen3-14B (or whichever local model wins the comparison toolbox at `pages/LlmCompare.tsx`). Goal: 350 → 30,000 albums with review summaries.

**Cost discipline**: cloud Claude is too expensive at this scale (current ~$0.001/album × 30k = ~$30 just for review summaries, plus discovery + scoring + Korean summary, plus retries — easily 5–10× that in practice). Local LLM with the existing comparison tooling validates quality before bulk-running.

**The actual hard part is curatorial, not technical**: who picks the 30k? "Most popular international albums on Discogs" is one path, "every album above N user-marks on RYM" is another, admin-curated genre sweeps a third. The LLM cost is solvable; the question of *which* 30k albums dig.haus stands behind is a positioning decision and should not be answered by "whatever Discogs's top-N happens to be."

---

## Recommended sequencing

```
0  Album page                  (now, ~2-3 weeks across 7 PRs)
   ├─ ships independently, blocks nothing
   └─ output: tokens + 4 primitives reusable everywhere else

4  Phase 4 nightly pipeline    (start in parallel as soon as a local LLM
                                wins the comparison; runs as background
                                process, doesn't block client work)

2  Crate implementation        (after 0)
   ├─ resolves entry 20 (샀음/살거 boundary)
   └─ unblocks 3 and 1a's "share my crate" surface

3  Shop-feel visual            (after 2; payoff needs crate destination)
   ├─ asset purchase
   └─ plastic-wrap + tear effect on crate transfer

1a Topster PNG export          (after 2; wall is stable, crates exist
                                to share too)

1b Right-rail social ticker    (last; needs the multi-channel ambient
                                ticker shape decided first — do not ship
                                a "feed" without the dig.haus-flavored
                                answer to "what is this without being
                                an algorithm")
```

**Why this order:**
- 0 is independent and produces shared assets — start it now.
- 4 is a background process from the moment a local LLM is picked. The nightly pipeline doesn't conflict with anything else, so it can grind away while client work happens.
- 2 → 3 → 1a is a single sequenced chain (crate → wrap-tear effect needing crates → topster-with-crates).
- 1b last, and gated on a vision answer rather than an engineering one.

---

## Cross-cutting concerns

**Vision discipline**. Items 1b and 4 both push toward "more content, more activity," which is exactly the failure mode CLAUDE.md flags ("no spoon-feeding curation," "no for-you carousel"). The mitigation is built in: 1b's social pane stays as ambient ticker not algorithmic feed, and 4's curatorial selection stays intentional rather than chart-scraped. Both rules will need re-stating when the work actually lands, because the easy implementation choice will be the engagement-maximizing one each time.

**Korean cultural alignment**. Topster, Post-Its on wall, magic record cabinet, masking-tape labels — all 미니홈피 / 싸이월드-coded. Strong fit. Worth being explicit in the visual brief that this is the lineage we're drawing on (alongside lofi-bedroom from entry 12), so it doesn't drift into a generic "cute UI" pastiche.

**Cost stack**. Local LLM hardware (already owned) + cloud Claude for the cleanup pass on local output + asset packs ($100–300 one-time per visual theme). No recurring infrastructure bumps until DB scale forces a Postgres migration (well past 30k albums).

**Phase 3 unresolved items still in scope**. Schema-vs-plan reconciliation (`shelf_slots.genre_id` vs freeform labels, `crate_boxes.position` semantics, `users.mydig_public` vestige) should land as part of item 2's schema work, not as a separate cleanup PR.

---

## Beyond the listed roadmap — additions for consideration

Captured 2026-04-25 from a brainstorm round after the main 0–4 list. **None of these are committed.** They live here so they don't get lost; the next review pass decides which graduate into a sequenced phase and which get dropped.

### A. Discogs collection import — cold-start accelerator

Most serious Korean vinyl collectors already maintain a public Discogs collection. Reading it via the public Discogs API on first signup and pre-filling 샀음 (later: default crate per item 2) lets a first-time visitor land on a populated wall + crate within 5 minutes. Without this, every visual and social feature in items 1–3 sits on top of an empty store for new users. Discogs API is free, OAuth path is clean.

**Sequencing**: independent of the main chain. Lands cleanly any time after item 2's crate schema is settled, since the import target is a crate.

### B. Label pages as first-class destinations — positioning move

Real record-shop culture identifies a digger by **label** more than by genre or era — "ECM 좋아함," "Numero Group은 무조건 사," "Stones Throw 신보 챙김." Currently labels are a single line of album metadata, not a destination. Promoting labels into their own first-class surface (label vinyl wall, admin-written label intro, chronological discography, label-level reviews, follow-this-label) is the strongest dig.haus-vs-Discogs/RYM differentiation lever on the table. Aligns directly with item 4's "curate by label sweep" instead of chart-scraping.

**Sequencing**: substantial enough to plan as its own phase rather than fold into another item's PR chain.

### C. Random dig button — anti-algorithm in one feature

Pulls one random album from a random other user's wall. Zero personalization, zero ranking, zero filter. Pitched here as the purest single-feature expression of "No algorithms needed. Keep digging."

**Honesty caveat from the conversation that surfaced this idea**: the user (themselves a target-persona vinyl collector) reports never having clicked a "random" button on any other site they've used. Strong signal that the feature is *philosophically on-brand* but possibly not *actually useful*. Kept on the list, but the next review pass should specifically ask whether random discovery is something dig.haus visitors will actually invoke, or whether it's a feature that looks great in a vision deck and gets ignored in practice. If the answer is the latter, drop it without hesitation — keeping unused features for ideological reasons would itself be unidiomatic for the site.

If kept: scope is tiny (one-line `ORDER BY RANDOM() LIMIT 1` + a cinematic cover-pull animation reusing MyDig wall assets).

### D. Curatorial daily log / 오늘의 발굴 — hero as multi-wall carousel *(reframed 2026-04-28)*

The hero on `/` already plays this role with 10 admin-curated LPs + theme + description, but it's locked to a single wall. Promote it to a horizontal carousel of N curated walls — each wall its own theme + description + 10 LPs + backdrop, swipeable on mobile, dot pagination on desktop, cyclical wrap. "오늘의 발굴" stays the surface; what changes is that one fixed list becomes multiple parallel curatorial tracks (이번주 / 시즌 무드 / 레이블 여행 / etc.).

**v1 = 3 walls** matching the three backdrops already in `client/public/backdrops/` (basement_purple, basement_gray, basement5). wall2.webp is the mydig surface, stays out of rotation. Adding a 4th/5th wall later is a schema row + new backdrop asset. 7+ walls starts reading as "feed" and breaks the curation positioning, so 3–5 is the practical ceiling.

**Schema delta**: new `home_walls (id, position, theme, description, backdrop_file, + 15 tuner cols)` table; `home_features.wall_id` FK. Migration moves the current `home_meta` + 10 `home_features` into a `wall_id=1, position=0` row, so day-one shape is identical to today (just "first wall in the carousel of one").

**Asset hook**: `extract-hero-theme.ts` re-runs per backdrop give each wall its own ink/shadow tokens automatically — title text colour stays readable across wall variants without hand-tuning.

**Staging**: (1) schema + first wall in carousel container — ships invisibly because it looks identical, but the foundation is in. (2) walls 2 + 3 + admin UI to add / order / name. (3) per-wall HERO_THEME automation if running the extract script per wall gets tedious.

**Why this isn't a new editorial surface**: the prior framing in this doc proposed D as a separate small daily-log slot on the home page. That was wrong — the hero is already that slot, just under-utilised by being locked to one wall. The carousel is the cheapest correct shape because it reuses the wall-rendering primitive that already works.

### E. dig.haus 라이너 노트 — promote admin-authored 50자 평 *(reframed 2026-04-28)*

The 50자 평 surface (UserReviewsSection on the album page) already carries owner notes — admin writes 50자 on albums they care about, same as any user. The "라이너 노트" feature is purely a display promotion: split admin-authored entries into a dedicated slot at the top of the section with masking-tape / handwriting visual + "라이너 노트" label, while the rest of the 50자 평 list renders unchanged.

**Zero schema delta.** The discriminator is `users.is_admin = 1` on the review's author, which the existing join already exposes. UI work only: an `is_admin = 1` check in `UserReviewsSection` to peel admin entries off the top of the list and render them with a distinct paper-stamp / handwriting card style.

**Why this isn't a new content type**: the prior framing proposed E as a separate per-album owner-note column. That was redundant — the curator's voice is already in the 50자 평 system, just lacking visual prominence, not a missing data type. Pairs with D as the same voice surfaced in two places: D on the home hero, E on individual album pages, both sourced from data the admin is already producing.

### F. Letter to a stranger — anonymous asymmetric note on an album

Small paper note (masking-tape attached) on an album page. A random 1–2 of any existing notes show to subsequent visitors of that album page. Quota-limited so it doesn't flood. Anonymous, one-way (no read receipts, no replies), only writable on albums the author 굿굿'd. Distinct from item 2's wall post-its: those are "visitor → my wall" addressed to the wall owner; these are "visitor → an album" addressed to the next visitor. Same handwriting/paper visual asset family — implementing one materially reduces the cost of the other.

### G. /dig as a browse-by-lens surface — artist / label / genre slices *(added 2026-04-28)*

/dig is currently a flat sort/density grid; for a curation-first site that's an under-used surface. Promote it into a multi-lens digging board: tabs or chips for **artist / label / genre / tag** (later: year, country, format) that group the same catalog along different axes. The current flat grid stays as the "전체" lens / default — lenses are additive, not a replacement.

**Artist lens is the curation hook, not a taxonomy dump.** Auto-generating a page for every MusicBrainz artist was rejected in Phase 1 (CLAUDE.md / memory: artist detail pages out of scope). The lens here is the *opposite shape*: a small admin-curated `curated_artists` table for multi-project people who span many releases — Erik Mårtensson (Eclipse / W.E.T. / Nordic Union / ...), prolific producers, label founders who play across acts. The list itself is editorial; clicking a curated entry shows every album they touched across the catalog.

**Label and genre lenses are pure aggregation** — both already in schema (`labels` table + `albums.label_id`; genres as tags). No new tables, just grouped views.

**Schema delta** (when this lands): `curated_artists (id, name, ko_name?, blurb?, ...)` + `album_curated_artists (album_id, curated_artist_id, role?)` many-to-many. Label and genre lenses need zero schema work.

**Sequencing**: independent chain — doesn't depend on items 0–4 or A–F, can land any time. Reinforces item B (label pages as destinations) if/when both ship — the label lens on /dig becomes the natural entry point into individual label pages, and item B's per-label intro is what the lens row clicks through to. Item G alone is just the lens grid; item G + item B together is "browse-by-label as a real shop section." The two are good together but neither requires the other.

---

## Anti-features — explicitly out of scope

These are not "deferred." They are wrong for dig.haus regardless of timing. Preserved here so the next contributor — or the next month's version of this team — doesn't accidentally re-propose them.

- **Personalized recommendations / "이거 좋아하면 저것도"** — direct contradiction of CLAUDE.md's anti-algorithm vision and the "no spoon-feeding curation" rule. Every other site does this; dig.haus's positioning *is* not doing it.
- **Trending / 인기 차트** — the HOT sticker is the limit of chart surface dig.haus tolerates. Beyond that, the site becomes a chart site, which already has many strong competitors.
- **Live chat rooms / synchronous discussion threads** — moderation cost is unsustainable for a 1-person operation. dig.haus's social model is intentionally asymmetric (post-its, anonymous notes, ambient ticker), not synchronous.
- **AI voice / in-store audio announcements** — kitsch risk. Breaks the handwriting metaphor that the rest of the visual identity converges on.
- **Spotify Wrapped-style annual stats cards** — that vocabulary belongs to platforms. dig.haus is a shop, not a platform. If a year-end surface is wanted, it should be editorial (item D extended to year-end form) rather than algorithmic stats.
