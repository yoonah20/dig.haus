# Phase 3 storefront — design decisions log

**Status**: active, iterating visually at `/my-preview`.
**Drafted**: 2026-04-21, with local Claude Code.

This log captures *why* the Phase 3 plan moved away from the original four-tier spec that used to live in `CLAUDE.md`. The plan itself (current shape, schema, sub-phases) lives in `CLAUDE.md`; this file is the "why" and the history. If a future session wants to reopen one of these decisions, this is where the arguments against are written down.

---

## Context

Original Phase 3 spec (pre-iteration):

- **Wall** 22 slots (5-5-6-6), each a framed picture on the wall
- **Shelf** 6 bins, each scoped to one admin-curated genre from a 16-entry preset
- **Crate** 0–6 variable milk-crates on the floor, user-named freeform playlists
- **Now Playing** strip at the bottom
- Separate `genres`, `shelf_slots`, `shelf_items`, `crate_boxes`, `crate_items` tables

Iteration driven by Claude Design (`claude.ai/design`) visual prototypes — three rounds of desktop+mobile renders at 1200/390px with a Hongdae Dusk palette — and follow-up conversations reviewing each render against the physical-shop metaphor.

The pivots below were taken during that iteration, applied both to the code under `client/src/components/MyDig/storefront/` (the ported primitives + scene) and, finally, to the plan in CLAUDE.md.

---

## Decisions

### 1. Crate tier removed from the public storefront

**Before**: Three visual tiers (Wall → Shelf → Crate), each with its own flip-through interaction. Crates sat on the floor as physical milk crates.

**After**: Two tiers (Wall → Shelf). Crate remains a **first-class data entity** (user-named collection of albums, stored server-side), but it only surfaces publicly when placed inside a Shelf slot. Crates that exist only in the user's library stay invisible to visitors.

**Why**:
- Shelf and Crate did the same UX work — both were "themed flip-through collections". The user scanning the page hit the same mental model twice, with the only difference being who authored the label (admin for Shelf, user for Crate).
- Collapsing the two concepts into one public tier (Shelf) with **polymorphic slots** (each slot holds either a single album or a crate) eliminates the redundancy without losing any user capability. A user who wants to feature "Doom & Stoner" just builds a crate with that title and drops it on a shelf slot.
- Reduces the storefront's vertical real estate, which also addressed a separate "too much to scan at once" concern.

Milk-crate visual language survives in the **edit-mode picker panel**, where the user's private library of crates shows up as stacks they can drag onto shelf slots.

### 2. Admin-curated genre preset dropped

**Before**: `genres` table with 16 seed entries (Death Metal, Black Metal, Thrash, …) plus admin CRUD under `/admin`. Users picked 6 from this list to assign one genre per Shelf bin.

**After**: Each shelf slot gets a **freeform user-written label** (masking tape over the front wood lip). No shared taxonomy, no admin screen, no `genres` table in the schema.

**Why**:
- With Shelf and Crate unified into one polymorphic tier, the "genre preset vs freeform theme" distinction — the whole original reason for a separate Shelf concept — evaporated.
- Admin genre CRUD was overhead the project couldn't justify once users had full freedom to name their own slots.
- The user's own label is more expressive ("비 오는 일요일", "최애 ONE") than any preset could be.

### 3. No picture frames on wall records

**Before**: Each wall record rendered inside a framed display (wooden frame + recessed inner well + mount dot), giving a gallery feel.

**After**: Bare 12" LP sleeves lean back against the plaster wall, resting on a plain wooden horizontal rail with a small gap-shadow underneath. No frames, no mats, no mounting hardware.

**Why**:
- Claude Design's second-pass render read as "art gallery at a museum opening" rather than "record shop". Picture frames were the strongest signal driving that misread.
- Real record shops mount featured records on plain rails or slat walls without individual framing. The prototypes matched the shop vocabulary once the frames came off.
- Keeps visual emphasis on the sleeve art itself (the "wares") rather than on the presentation apparatus.

### 4. Perfect grid on the wall; imperfection lives on Tier 2

**Before**: The second Claude Design render applied a ±2° random rotation to each wall frame to suggest "someone put these up by hand".

**After**: Wall records are perfectly aligned — zero rotation, even spacing, horizontal rail running flush across each row. The *only* wall imperfection is the gap-shadow cast by the slight backward lean (records aren't flat against the wall; they're at ~5°).

All wear and casual imperfection moves to the Shelf tier: masking-tape labels tilt ±5–8°, cubbies can lean slightly from implied browsing wear, records inside cubbies aren't perfectly stacked.

**Why**:
- Real record shops that take themselves seriously mount their wall displays flush. The ±2° rotation read as "poorly maintained" rather than "characterful".
- Splitting the visual dialect — gallery-straight on the wall, shop-browsing-chaos on the shelf — gives the two tiers distinct personalities and reinforces the "featured display vs. browsing bin" functional difference.

### 5. 12" LP size is uniform across tiers

**Before**: Earlier prototypes sized wall records and shelf records differently (wall bigger, shelf smaller). This was tempting for information-hierarchy reasons but visually wrong.

**After**: Every rendered LP, whether on the wall or in a shelf cubby, uses the same pixel width. The furniture the LP sits on is what differs, not the LP.

**Why**:
- "A 12-inch is a 12-inch" — the metaphor falls apart the moment the visitor registers different sizes. The illusion is of records at the same physical scale on two different pieces of furniture; breaking that breaks the whole scene.
- Simplifies the layout math: each cubby's interior is sized to fit the shared LP dimensions, not the other way around.

### 6. Shelf is an open-top floor unit with trestle legs

**Before**: The third Claude Design render built the Shelf as a wooden box with a continuous top board capping the cubby row, and with its bottom flush to the floor.

**After**: **No top board** — each cubby is open-top; looking down into it from directly above, you'd see straight into the cubby interior. Two visible **trestle-style end-panel legs** extend below the cubby row, lifting the unit off the floor with a small cast shadow underneath.

**Why**:
- The top board made the shelf read as 수납장 (a closed wardrobe/cabinet), not an open shop rack. Records are supposed to stick up slightly above the cubby walls, the way they do in real floor bins.
- Legs push the unit into "freestanding piece of furniture" territory. Without them, the unit looked *built in* to the wall, which undercuts the "standalone record shop shelf" read.

### 7. Shelf cubbies show flip-through stacks, not dividers-and-wood-boxes

**Before**: An earlier render filled each cubby with thin vertical wooden "divider cards" standing upright — a common way to display empty record storage.

**After**: Each cubby holds a **stack of LPs packed cover-forward**. The front record's full 12" cover faces the viewer; the records behind appear as thin peek-lines at the top edge, implying depth. Flipping through pulls the front record aside to reveal the next.

**Why**:
- The reference the user shared (record-shop bin photo) showed the actual digging metaphor — covers packed tight, front one visible, back ones peeking. The divider-card interpretation was a step removed from that.
- Peek-lines give the cubby a genuine "this bin has records in it" density cue; the count scales with how many records are in the slot, so a packed crate looks different from a single-album slot.

### 8. Dark-mode primary; light variant retired

**Before**: The Claude Design prototypes landed on a warm cream-plaster "Hongdae Dusk" palette — daylight interior, uniform ambient brightness.

**After**: **Dark warm-brown wood-panel walls** with strong pooled lamp light from upper-left. The scene reads as the shop at 8pm with only a pendant lamp on — records in the center of the light pool are bright and readable; records at the edges fade into warm shadow.

**Why**:
- The light palette looked fine in isolation but clashed with dig.haus's dark site chrome. Visiting `/my-preview` after a dark home grid produced an abrupt brightness transition the user repeatedly flagged as "suddenly a different website".
- Dark-mode with pooled lighting also makes **lighting carry depth** — the uniform-brightness variants had no "center of attention", whereas a pendant pool naturally draws the eye into the middle of the scene. That's what a real late-night shop looks like.
- The preview page frames the dark storefront inside an even-darker "street" chrome with a wooden window frame and a subtle warm glow leaking through, reinforcing the "looking into a lit shop from a dim street" framing.

### 9. Now Playing strip deferred

**Before**: Ambience tier at the bottom of the scene — turntable strip with optional Spotify/YouTube/Bandcamp embed.

**After**: Still in scope, but explicitly **parked** until the Wall+Shelf MVP ships. Not rendered in the current storefront prototype.

**Why**:
- The two populated tiers (Wall, Shelf) carry the primary personal-expression work. Now Playing is *ambient* — a nice-to-have.
- Designing it well (working turntable art + embedding iframe UX + "nothing playing" empty state) is enough work that pinning it to 3e lets the earlier sub-phases ship on their own.

### 10. Vinyl Wall stayed at 22 (5-5-6-6)

**Considered**: Shrinking to 18 (6×3) or 15 (5×3) was seriously discussed during the iteration — the 22-slot render was dominating vertical space on some layouts.

**Decided**: Keep the original 22-slot 5-5-6-6. The other decisions on the list (removing frames, dark-mode, the shelf pivot) collectively reduced the wall's visual weight enough that the 22 count didn't feel overwhelming anymore, and 22 remains the canonical count the plan was built around.

---

## Implementation status

- Claude Design prototype ported to `client/src/components/MyDig/storefront/`:
  - `palettes.ts` — dark Hongdae Dusk ROOM tokens, font stacks, cover background palette
  - `FakeCover.tsx` — 17 minimal ECM/Factory/23-Envelope-style placeholder sleeves
  - `primitives.tsx` — WallRail, WallLP, TapeLabel, ShelfUnit, Cubby. The three structural fixes (no top board, trestle legs, wall-zone measurement) were applied inline during the port.
  - `Storefront.tsx` — Room + Header + Wall + full scene composition, measures shelf `offsetTop` to position the wall/floor boundary correctly.
- `/my-preview` route renders the scene at 1200px desktop / 390px mobile with a single 768px breakpoint.
- `/my/:username` still runs the earlier Phase 3a skeleton (dashed borders on grid slots) while the storefront visual iterates at `/my-preview`. The two pages merge when the visual is locked and the real data wiring swaps in.

## What's still open

- **Edit-mode UI** — the 80/20 split picker panel for drag-drop and crate library management isn't built yet. Needs its own Claude Design round at minimum.
- **Private-mode visual** — "fabric drape + A4 notice" concept is agreed on; illustration not yet designed.
- **Real populated states** — `/my-preview` uses fake sleeves; the transition from FakeCover placeholders to real album covers + the behavior when a slot holds a real crate's first record (vs. a single-album slot) needs another pass once the wiring goes in.
- **Mobile refinement** — the current mobile layout works structurally but hasn't had its own dedicated iteration round. The pooled-lighting effect particularly may need re-tuning at 390px where the "pool" covers proportionally more of the scene.
- **Now Playing return** — open at 3e, no decisions made yet beyond "eventually".
