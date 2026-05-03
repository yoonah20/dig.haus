# Post-Phase 3 roadmap

Strategic backlog. Originally drafted 2026-04-25. **Reconciled with shipped reality on 2026-05-03** — several items the original doc listed as "next" had already shipped between Apr 25 and May 3.

This is intentionally a **roadmap**, not a plan. It captures what's on the table and recommended sequencing. Per-item plans (schemas, PRs, costs) live in their own docs once an item moves into active work.

---

## Where we are (2026-05-03)

- **Phase 1, 2, 3 done** (Phase 3 closed 2026-04-25): vinyl wall + snapshots + follow + persistent player + public profile card all shipped.
- **Crate functionality shipped** (originally roadmap item 2). Schema (`crate_boxes` + `crate_items`), full CRUD API at `/api/mydig/crates`, `CrateSection.tsx` listing + `CrateDetailModal.tsx` management, VinylWallEditor "내 상자" source filter. 샀음/살거 absorbed into the crate system via `CrateButton.tsx` (replaced the prior split-pill). The "magic cabinet" *visual* is the only remaining piece, blocked on design.
- **Home hero multi-wall carousel shipped** (originally roadmap addition D). 3 walls seeded against `hero_*.avif` backdrops, per-wall ink/shadow tokens on `home_walls`, `HomeNextHero.tsx` carousel with IntersectionObserver + sessionStorage memory, admin add/order/name/per-wall metadata UI in `routes/homeFeatures.ts`.
- **Toaster (Topster-style) PNG export shipped** (originally roadmap item 1a). Server-rendered at `/api/mydig/:user/toaster.png` via `services/toasterRenderer.ts`, web share API path for mobile, "토스터" button on `/my/:username` header beside the URL share button.
- **Album page chrome refactor shipped** (PR1–PR7, 2026-04-25). Tokens + four chrome primitives (Panel/Chip/Field/SectionTitle), section title migration, palette/rounding consistency. Foundation for the zine pass (item 0b below) which is still pending.
- **Phase 4 nightly pipeline PARKED** — Pre-L0 spot-check failed on Qwen3-14B; bench harness torn down; revivable from c051df8 if a better local model appears.
- **Live MyDig storefront** is the transitional Hongdae-dusk composition. Long-term target is Path B per `docs/phase3-storefront-decisions.md` entries 18–19 (illustrated lofi-bedroom background asset behind CSS/SVG overlays).
- **DB scale**: ~350 albums. Comfortable usable scale is closer to 30,000.

---

## What's actually undone

After the May cleanup, the roadmap reduces to four buckets:

### Active candidates (no blockers)

- **Design system audit + consolidation** — see brief below. The album page refactor (PR1–PR7) introduced tokens + four chrome primitives (Panel/Chip/Field/SectionTitle), but they haven't propagated evenly across surfaces (home / mydig storefront / admin / album each carry their own dialect). Pre-zine cleanup pass — identifies drift, consolidates where it makes sense, documents intentional divergence. ~1 week.
- **B: Label pages as first-class destinations** — see brief below. Substantial (multi-week). Strongest dig.haus-vs-Discogs/RYM differentiation lever the original brief identified.
- **G: /dig lenses (label / genre / curated_artist)** — see brief below. Independent chain, 1.5–2 weeks. Reuses /dig grid; schema delta is just `curated_artists` table.
- **Phase 3 schema cleanup** — `users.mydig_public` vestigial column, `shelf_slots.genre_id` vs freeform-label decision, `crate_boxes.position` semantics. Originally meant to land with the Crate work; Crate shipped without it, so it's now standalone debt. ~1–2 days.

### Blocked on design

- **0b: Album page zine pass** — Tier 1 typography pivot waiting on visual direction. See `docs/album-page-zine-vision.md`. Confirmed parked 2026-05-03 pending a design step.
- **3: Shop-feel visual polish** — needs asset purchase + visual identity decisions. Pairs with the Crate "magic cabinet" visual (same asset pipeline).
- **Crate "magic cabinet" visual** — the storefront surface for the now-functional Crate system. Functionality done; visual undone.
- **Hardhat mascot character** — yellow-hardhat mascot direction parked in `docs/`; greenlight pending per memory.

### Blocked on vision

- **1b: Right-rail social ticker** — needs the dig.haus answer to "what is this without being a feed" before any code lands. See brief below for the tension.

### Probably won't ship (or not in this cycle)

- **A: Discogs collection import** — useful pre-growth, not needed at current scale per a 2026-05-03 decision. Reconsider before any user-growth push.
- **C: Random dig button** — author themselves doesn't use random buttons. Kept on the list philosophically but flagged for drop on next review.
- **E: 라이너 노트 promotion** — small UI peel-off, on hold per a 2026-05-03 decision. Trivial to revive (1–2 days) when wanted.
- **F: Letter to a stranger** — design-tied (handwriting/paper asset family). Not in active scope; ship together with the broader paper-asset pass if that ever lands.

### Direction questions parked

- **/en multilingual mirror** — per memory, "Korean-only is not the long-term shape." Staged path described but no commitment yet.

---

## Briefs for active candidates

Detail kept here for the items that haven't shipped. Items that did ship had their original briefs collapsed into the bullet entries above; the source of truth for those is now the code, not this doc.

### Design system audit + consolidation

The album page chrome refactor (PR1–PR7, 2026-04-25) hoisted tokens and shipped four chrome primitives — Panel / Chip / Field / SectionTitle. Those primitives unified the album page itself, but they haven't propagated to the rest of the app on any consistent schedule. The codebase now has several visual dialects coexisting:

- **Album page** uses the new chrome primitives + masking-tape headers + amber unification on OwnershipButtons.
- **Home (`HomeNextHero` + carousel)** carries its own per-wall ink/shadow tokens stored on `home_walls` rows, plus its own price-tag/post-it/sticker dialect.
- **MyDig storefront** has its own palette/primitive set under `components/MyDig/storefront/` (Hongdae-dusk composition).
- **Admin** is largely utilitarian, no shared design language.
- **Modals, voting pills, ownership/crate buttons, hover cards** each evolved independently and don't reliably share spacing, radius, or shadow tokens.

The result is *coherent within each surface, drifting across surfaces*. The user reports the overall feel as "중구난방." Before the zine pass (item 0b) lands and adds yet another visual dialect, an audit pass is worth the time:

1. **Inventory** — catalog all token usage (color, spacing, radius, shadow, typography) across surfaces. Identify which surfaces re-import the album page tokens vs invent local ones.
2. **Identify drift vs intentional divergence** — the per-wall ink/shadow on `home_walls` is intentional (each wall has its own paper colour, must read against its backdrop); the admin's separate styles are accidental drift. Mark each.
3. **Consolidate accidental drift** — promote the chrome primitives to wherever they fit; centralise the spacing/radius scale; pick one shadow stack.
4. **Document intentional divergence** — write down *why* mydig storefront has its own palette, *why* per-wall tokens exist, so the next refactor doesn't accidentally collapse them.

**Output**: a short tokens reference doc + a list of consolidation PRs. Most consolidation can ship incrementally (one surface per PR) rather than as a single big-bang cleanup.

**Sequencing**: best done *before* the zine pass (0b) so the zine inherits a clean foundation rather than adding a fifth dialect to the existing four. Independent of B and G.

### B. Label pages as first-class destinations

Real record-shop culture identifies a digger by **label** more than by genre or era — "ECM 좋아함," "Numero Group은 무조건 사," "Stones Throw 신보 챙김." Currently labels are a single line of album metadata, not a destination. Promoting labels into their own first-class surface (label vinyl wall, admin-written label intro, chronological discography, label-level reviews, follow-this-label) is the strongest dig.haus-vs-Discogs/RYM differentiation lever on the table. Aligns directly with the (now-parked) Phase 4 "curate by label sweep" instead of chart-scraping.

Backend already has `/api/labels/:name` (Discogs + MusicBrainz lookup) and label tracking infrastructure in `routes/labelFeed.ts` for admin-side new-release polling. What's missing is the *destination page* — no `/label/:name` route in the client, no first-class label surface. The starting point is a `LabelPage.tsx` + admin tools to attach an editorial intro to a label.

**Sequencing**: substantial enough to plan as its own phase rather than fold into another item's PR chain. Good pair with item G (/dig lenses) — the label lens on /dig becomes the natural entry point into per-label pages.

### G. /dig as a browse-by-lens surface

/dig is currently a flat sort/density grid; for a curation-first site that's an under-used surface. Promote it into a multi-lens digging board: tabs or chips for **artist / label / genre / tag** that group the same catalog along different axes. The current flat grid stays as the "전체" lens / default — lenses are additive, not a replacement.

**Artist lens is the curation hook, not a taxonomy dump.** Auto-generating a page for every MusicBrainz artist was rejected in Phase 1 (artist detail pages out of scope). The lens here is the *opposite shape*: a small admin-curated `curated_artists` table for multi-project people who span many releases — Erik Mårtensson (Eclipse / W.E.T. / Nordic Union / ...), prolific producers, label founders who play across acts. The list itself is editorial; clicking a curated entry shows every album they touched across the catalog.

**Label and genre lenses are pure aggregation** — both already in schema (`labels` table + `albums.label_id`; genres as tags). No new tables, just grouped views.

**Schema delta**: `curated_artists (id, name, ko_name?, blurb?, ...)` + `album_curated_artists (album_id, curated_artist_id, role?)` many-to-many. Label and genre lenses need zero schema work.

**Sequencing**: independent — doesn't depend on items 0b / B / 3, can land any time. Reinforces B if/when both ship.

### 1b. Right-rail social ticker (vision-blocked)

The home right rail currently shows only "최근 기록." Original brief was to open it up to: following users' recent activity, recently-snapshotted walls, shared crates, "지금 듣는" turntable picks.

**Tension to resolve before code**: the "long stay" framing is engagement-maximizing language, which is exactly what dig.haus's anti-algorithm positioning rejects (CLAUDE.md vision section, "no spoon-feeding curation" rule, "no for-you carousel" non-goal). The dig.haus version of social has to be **passive ambience** rather than **active feed** — closer to the existing CommentTicker (peripheral overheard voices) than to a TikTok-style scroll.

Concrete shape that respects the vision: a **multi-channel ambient ticker** in the rail — same metaphor as the existing comment ticker but with channels you can switch between (latest comments / following activity / fresh snapshots / labels you watch). No ranking, no "for you," strict reverse-chronological. A user staying long because they're enjoying ambient activity is fine; a user staying long because we made the feed sticky is not.

Don't ship until the vision shape is decided; the easy implementation choice will be the engagement-maximizing one each pass.

---

## Recommended sequencing (post-cleanup)

```
Phase 3 schema cleanup    (1-2 days, anytime; closes lingering debt)
   └─ users.mydig_public, shelf_slots.genre_id, crate_boxes.position

Design system audit       (~1 week, before zine pass)
   ├─ inventory tokens + primitives across surfaces
   ├─ consolidate accidental drift (incremental PRs)
   └─ document intentional divergence

G  /dig lenses             (1.5-2 weeks, independent)
   ├─ label/genre lenses ship first (zero schema)
   └─ curated_artists table + admin tool ships second

B  Label pages             (multi-week phase of its own)
   ├─ best paired with G — label lens on /dig clicks through to here
   └─ admin-written intros + per-label vinyl wall + follow-this-label

[design unblocks, then:]
0b  Album page zine pass   (multi-week, Tier 1-4)
3   Shop-feel visual       (after 0b, shares asset pipeline)
    Crate magic-cabinet visual (after 3, same asset pipeline)
```

The original sequencing chain (0 → 4 → 2 → 3 → 1a → 1b) is mostly retired because 1a / 2 / D shipped and 4 is parked. What remains is: close the schema debt, run the design system audit so future visual work inherits a clean foundation, then pick between "curatorial expansion" (G + B) and "design unblocks" (0b → 3 → magic cabinet).

---

## Cross-cutting concerns

**Vision discipline**. 1b and any future curation-by-LLM work both push toward "more content, more activity," which is exactly the failure mode CLAUDE.md flags ("no spoon-feeding curation," "no for-you carousel"). The mitigation has to be re-stated each time the work actually lands, because the easy implementation choice will be the engagement-maximizing one each pass.

**Korean cultural alignment**. Topster (shipped as 토스터), Post-Its on home wall (shipped), magic record cabinet (Crate functionality shipped, visual pending), masking-tape labels (shipped) — all 미니홈피 / 싸이월드-coded. Strong fit. Worth being explicit in any future visual brief that this is the lineage we're drawing on (alongside lofi-bedroom from `phase3-storefront-decisions.md` entry 12), so it doesn't drift into a generic "cute UI" pastiche.

**Cost stack**. Local LLM hardware (already owned, currently unused since Phase 4 PARK) + cloud Claude for review pipeline + asset packs ($100–300 one-time per visual theme). No recurring infrastructure bumps until DB scale forces a Postgres migration (well past 30k albums).

---

## Anti-features — explicitly out of scope

These are not "deferred." They are wrong for dig.haus regardless of timing. Preserved here so the next contributor — or the next month's version of this team — doesn't accidentally re-propose them.

- **Personalized recommendations / "이거 좋아하면 저것도"** — direct contradiction of CLAUDE.md's anti-algorithm vision and the "no spoon-feeding curation" rule. Every other site does this; dig.haus's positioning *is* not doing it.
- **Trending / 인기 차트** — the HOT sticker is the limit of chart surface dig.haus tolerates. Beyond that, the site becomes a chart site, which already has many strong competitors.
- **Live chat rooms / synchronous discussion threads** — moderation cost is unsustainable for a 1-person operation. dig.haus's social model is intentionally asymmetric (post-its, anonymous notes, ambient ticker), not synchronous.
- **AI voice / in-store audio announcements** — kitsch risk. Breaks the handwriting metaphor that the rest of the visual identity converges on.
- **Spotify Wrapped-style annual stats cards** — that vocabulary belongs to platforms. dig.haus is a shop, not a platform. If a year-end surface is wanted, it should be editorial (the home hero carousel extended to year-end form) rather than algorithmic stats.
