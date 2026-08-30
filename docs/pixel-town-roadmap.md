# Pixel Town (디그타운) — mydig walkable-village roadmap

Strategic roadmap for turning 마이딕 (`/my/:username`) into a Stardew-Valley-style, walkable pixel record-shop **town** you can wander and visit. Drafted 2026-08-30.

This is a **roadmap, not a plan**: it locks the direction, the reuse map, the free-asset strategy, and a stop-anywhere milestone sequence. Per-milestone specs (exact schemas, component lists, PRs) get written when each milestone moves into active work. Treat this as a candidate **Phase 5** — it is larger than any single item left in `post-phase3-roadmap.md`.

---

## Decisions locked (2026-08-30)

- **Look**: Stardew-style pixel / tile art (16px tiles), real game-asset sprites — not the CSS/SVG storefront.
- **Cover treatment: A**. Real album covers render at native resolution inside a **pixel wooden frame**; covers are **never** downsampled to pixels. This protects the site's core "covers first" identity (B — pixelating covers — was rejected; C — hiding covers behind generic sleeves — conflicts with "covers first").
- **Scope target: walkable, solo-instanced visiting (A)**. The player controls an avatar and walks: their own house → a street hub → into a **friend's saved house** (their skin + records, read-only, plus a guestbook). Async, single-player-style visiting — the Animal Crossing / Stardew feel without a live server.
- **Explicitly NOT building: live co-presence (B)**. No websockets, no "who's online", no real-time position sync, no shared-world server. Deferred indefinitely; revisit only if usage genuinely demands it. Most of the "visit friends" fantasy is satisfied by A.
- **Assets: free only, CC0-first.** No paid packs (LimeZu full pack etc. are out).
- **Guardrails carried over from the vision** (hard rules): no rankings / leaderboards / "popular houses" / "for you" sort; street layout is **derived** (recency + light curation), never ranked; no currency / unlocks / streaks; decoration stays record-centric (users arrange **records** and pick a preset house — no user-placed furniture in this scope). These keep the town on the atmosphere-first, anti-algorithm, anti-gamification side of the line.

---

## Why this is feasible (reuse map)

The two things that usually kill a project like this for a solo dev — a from-scratch spatial engine and an art budget — are largely already paid or avoidable here.

- **Placement + persistence already exist.** `crate_items` carries `position_x / position_y / rotation` as normalized `[0,1]` REAL columns (nullable). That is exactly the per-object transform a room needs. The `CrateFloor` drag engine, `layout.ts` default-flow math, and the single-row layout PATCH (`routes/crates.ts`) already read/write it.
- **"Friends" already exist.** The follow graph (`routes/follows.ts`, `GET /users/:id/{followers,following}`) gives the visitable set; `GET /api/users/:id/public` returns everything a house tile needs (name, avatar, wall theme, counts).
- **One-house data already exists.** `GET /mydig/:username` renders a single user's house data in isolation — the per-house fetch a visitor already triggers.
- **NPC dialogue already exists.** The "overheard voices" pillar is live: `CommentTicker` speech-bubble UI + the cross-user 50자 평 feed (`GET /api/user-reviews/feed`, carries speaker + mood + album). An NPC = a digman pose speaking a **real** 평. Zero LLM, zero new content, $0. (LLM-generated dialogue stays barred by cost discipline + the parked Phase-4 Korean-quality failure.)
- **Admin-authored templates already exist.** `home_walls` + `VinylWallEditor` (polymorphic `EditTarget`) + `heroWalls.ts` are the working "operator authors a scene in code/DB, it renders as a storefront" pattern — the model for genre-house skins.
- **Scene → image export already exists.** `toasterRenderer.ts` (satori → resvg → sharp) is the precedent for snapshotting a user-data scene to a shareable PNG.

**Net: the new work is a renderer + an asset layer + a small amount of new API — not a new data model or a new backend paradigm.** The Railway/SQLite backend barely changes.

---

## Tech stack

- **PixiJS** (WebGL 2D, MIT license) as the walkable-scene renderer. Added as an npm dependency, **lazy-loaded on the town route only** so the main app bundle isn't bloated (Pixi + atlases load when you enter the town). Nearest-neighbour texture scaling for crisp pixels.
- **One React route** for the town/interior; keep `/my/:username` as the canonical interior address (see open questions). react-router lazy chunk.
- **Tile authoring**: rooms authored in **Tiled** (free, GPL tool — output JSON is unencumbered) → exported as JSON tilemaps, or hand-defined room configs for the first skins. Collision from a per-tile solid layer.
- **Texture atlases** packed with a free tool (free-tex-packer / TexturePacker free tier) to keep draw calls low.
- **Korean pixel font**: **NeoDunggeunmo (neodgm)** or **Galmuri** — both **SIL OFL 1.1** (free, embeddable, redistributable). Self-host in `client/public/fonts/` (don't depend on a third-party CDN in production). This fixes the Korean-pixel-text gap the mockups hit.
- **Covers (option A)**: loaded as Pixi textures from the existing cover URLs, drawn at native resolution inside a pixel frame sprite; **no pixel filter applied to the cover itself**.
- **Mobile**: on-screen d-pad + interact button, touch-first. The site is heavily mobile — treat touch as primary, not an afterthought.

---

## Free asset plan (CC0-first) + license discipline

**Curated sources** (verify each pack's actual license page at pull time — licenses change):

| Source | License | Use for | Notes |
|---|---|---|---|
| **Kenney** (kenney.nl, OpenGameArt) | **CC0** | Floors, walls, furniture (Roguelike Interior Pack, Furniture Kit), base characters (Roguelike Characters), Tiny Town, RPG pack (1700+ tiles) | Best base. No attribution required, consistent style, huge. Start here. |
| **itch.io CC0 tag** (`itch.io/game-assets/assets-cc0`) | CC0 (filtered) | Interior / top-down / character packs to fill gaps | Filter by CC0 + interior + top-down + pixel-art. |
| **Ninja Adventure Asset Pack** (Pixel-boy / CanariPack) | CC0 (verify) | Characters, tiles, props | Well-known CC0 kit; confirm on the itch page. |
| **Penzilla — Top-Down Retro Interior** | free (verify CC0 vs attribution) | Interior furniture | Confirm exact terms before shipping. |
| **NeoDunggeunmo / Galmuri** | **SIL OFL 1.1** | Korean pixel UI + speech bubbles | Free, embeddable. Self-host. |
| PixiJS | MIT | Renderer | npm dep. |

**Hard rules for assets:**

1. **Prefer CC0** (no attribution, no share-alike) for everything possible.
2. **Avoid copyleft art** — LPC (Liberated Pixel Cup) packs and many OpenGameArt items are **CC-BY-SA / GPL**. Do **not** pull share-alike/copyleft art into this proprietary codebase.
3. If a **CC-BY** asset is genuinely needed, attribution is mandatory — record it and surface it.
4. Keep a **license ledger** at `client/public/town/CREDITS.md`: pack name, author, source URL, license, SPDX id, date pulled, and where it's used. Every asset in the build has a row.
5. **Unify the look**: hold a single tile size (16px) and a shared palette family; recolor mixed-source assets to that palette so a Kenney floor and an itch chair read as one world. The **디거 mascot stays custom** (or a recolored CC0 base) to preserve mascot identity.

---

## Data model deltas (additive, via `migrateTable`)

All nullable / defaulted so the boot-time `ALTER TABLE ADD COLUMN` diff works on the populated prod DB (precedent: `crate_items` coords were added exactly this way; `users.vinyl_wall_theme` is the per-user-scene-metadata precedent).

- `users.house_skin TEXT` (nullable; NULL = default skin) — chosen genre house.
- `users.avatar_config TEXT` (nullable JSON) — character customization (base sprite + palette). **M6, not v1.**
- **Reuse `crate_items(position_x/position_y/rotation)`** for record placement. No new placement table in this scope — records are the only placeable object; furniture is baked into the skin.
- **Skins as a code constant** (mirror `heroWalls.ts`), keyed by id: `{ id, label, genre, tilemap/tileset refs, palette, floorZone, recordZones[], furniture[], npcAnchor }`. A new skin is one commit; whole-town reskin is one edit. This forecloses per-user furniture customization (deliberate — keeps the town coherent and off the gamification path).
- **Deferred** (only if user-placed furniture is ever greenlit, which it currently is not): a generic `crate_decorations` table mirroring `crate_items`.

---

## API deltas (small, no websockets)

- `GET /api/town` — enumerate visitable houses. Copy the `GET /api/home/snapshots` aggregate shape (JOIN users, filter public, batch-load cover thumbs). The viewer's **follows float to the front**; otherwise recency + light curation. **No ranking, no popularity sort.**
- `GET /mydig/:username` — already returns house data; ensure it exposes crate records **with coords** + `house_skin`. Today the page aggregate omits floor coords (they live on the crate-detail endpoint), so the aggregate needs a small extension for the scene to place records.
- `PATCH /api/me/house-skin` (and later `/api/me/avatar-config`).
- Guestbook reuses the existing `crate_comments` endpoints.

---

## `crate_items` → scene mapping

- Each record's normalized `[0,1]` `(x,y)` maps onto the room's floor rect in the pixel scene (same viewport-independent contract `CrateFloor` already uses); `rotation` applies.
- Records beyond a room's floor capacity spill to **shelf/crate props** (or an "open the crate" overflow view) rather than crowding the floor.
- Cover texture = existing cover URL → drawn at native res inside a pixel frame (option A). Walk up + interact → detail card (title / artist / 50자 평 / 담기).

---

## Milestones (each shippable, stop-anywhere)

Ordered so every rung delivers standalone value and stopping anywhere strands nothing. The village-aware decisions (username addressing kept, skins as keyed code constants, derived street layout) are made in the early rungs so later rungs are additive.

- **M0 — Asset kit + pipeline** (~1 wk). Pull CC0 packs; unify to 16px + shared palette; pack atlases; write the `CREDITS.md` ledger; pick + self-host the Korean OFL font; set up the Tiled → JSON workflow. *Deliverable: an asset kit + one rendered static test room.*
- **M1 — Static pixel room** (~1 wk). Pixi renders one crate as a decorated room from `crate_items` coords; covers via option A; one skin (metal). Read-only, behind a flag. *Validates the covers-in-pixel-world look early — the biggest aesthetic risk.*
- **M2 — Walkable single room** (~1–1.5 wk). Avatar + tile collision + input (keyboard + touch); interact (record detail card, 디거 NPC speaking a real 평); exit door.
- **M3 — Genre skins + picker** (~1 wk). 3–5 code-defined skins (메탈 지하실 / 재즈 라운지 / 시티팝 로프트 / 앰비언트 / K-인디); `users.house_skin`; skin picker; render the chosen skin around the walk engine.
- **M4 — Street hub** (~1.5 wk). Walkable outdoor hub; doors; `GET /api/town`; a "동네 둘러보기" nav entry (the site's first-ever cross-user browse surface). Follows float first.
- **M5 — Visiting friends (solo-instanced)** (~1–1.5 wk). Walk into a followed user's saved house (their skin + records, read-only); guestbook write; visitor-vs-owner gating. *This is the payoff of scope A.*
- **M6 — Polish** (~1–2 wk). Character customization (`avatar_config`); camera scroll for larger rooms if needed; pixel-scene PNG/postcard export (extend `toasterRenderer` or snapshot the Pixi canvas); mobile perf pass; accessibility.

**Deferred / cut:** live co-presence (B); user-placed furniture; seasonal / day-night skins; any ranking surface.

**Rough total M0–M5** (the real "walkable town you can visit"): **~7–9 weeks solo**, phaseable. Bigger than any single post-Phase-3 item — treat as Phase 5, not a quick win.

---

## Deploy split

- **Client (Vercel)** carries most of it — renderer, route, assets. Lazy-load Pixi + atlases on the town route so the main bundle is untouched for everyone else.
- **Server (Railway)** gets a small delta — `GET /api/town`, the house-skin / avatar PATCH endpoints, and the `GET /mydig/:username` aggregate tweak. `crate_comments` (guestbook) already exists.

---

## Risks / open questions

- **Asset coherence** across mixed CC0 sources → unified 16px + palette + a recolor pass; keep the mascot custom. Validate in M0/M1.
- **Cover-in-pixel-world material clash** → pixel frames; validate visually in M1 before building further.
- **Bundle size / mobile WebGL perf** with many cover textures → lazy-load, atlas, cap visible records per room, test on mobile early (the persistent player already showed mobile is where things break).
- **Content thinness** at ~350 albums / small userbase → keep the street short + curated; lean on the empty-is-OK aesthetic; a barren full room reads worse than a cozy small one.
- **Scope discipline** → this is A (walk + async visit). Do not let it drift into B (co-presence). Restated as a hard rule because "visit friends" sounds like multiplayer and isn't.
- **Korean pixel legibility** at small sizes → pick a bitmap-accurate OFL face (Neodgm/Galmuri) and test the speech bubble / detail card early.

**Open decisions for the operator:**

1. **Route shape** — new `/동네` (`/town`) hub with `/my/:username` kept as the interior (recommended), vs. re-skinning `/my/:username` in place.
2. **Character model** — 디거 as the single recurring NPC everywhere (cheap, M2) vs. per-user avatars as walkable characters (M6). Both feasible; not mutually exclusive.
3. **Fate of the CSS storefront** — `components/MyDig/storefront/` and the current crate-floor CSS scene can be retired once Pixi lands, or kept as a low-end fallback.

---

## Relationship to existing code / docs

- Reuses: `crate_items` + `crateFloor/` (coords + drag contract), `follows`, `mydig` routes, `user-reviews/feed` (NPC lines), `toasterRenderer` (export), `home_walls`/`VinylWallEditor`/`heroWalls.ts` (template pattern).
- Likely retires: `components/MyDig/storefront/` CSS scene (currently partly dead) once the Pixi renderer covers the same ground.
- When work starts: add a "Phase 5 — Pixel Town" line to `post-phase3-roadmap.md` "Where we are" and to CLAUDE.md's current-state section, and open a per-milestone spec doc for M0.
