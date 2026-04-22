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

**Note**: Superseded by entry 11 below during the second-round lofi-bedroom pivot. The 22-slot count held while the scene was a record-shop interior; once the scene became "my bedroom wall", a smaller count read as more intimate.

---

### 11. Vinyl Wall 22 → 10 (5-5) — bedroom intimacy scale

**Context**: After the lofi-bedroom mood pivot (entry 12), 22 felt wrong again. A shop wall wants a big archive; a bedroom wall above a desk wants curated favorites.

**Decided**: Drop from 22 to 10 (5-5, two rows of five).

**Why**:
- 22 was shop-scale ("collector showing off a large catalog"). 10 is room-scale ("my current favorites above the turntable").
- Lower onboarding friction: "pick 10 albums you love right now" is tractable; "pick 22 curated favorites" reads as an archive curation task.
- Visual balance: with the turntable console + floor crates added below, a 22-slot wall dominated the composition. 10 gives the wall presence without overwhelming the rest of the scene.
- Always extensible: if a user wants a bigger display, we can add "extra row" slots later. Starting small is reversible; starting at 22 and shrinking is not.

---

### 12. Mood pivot — record shop interior → lofi-bedroom

**Context**: After all the decisions up through entry 10 rendered at `/my-preview`, the result was a "dark Hongdae record shop interior" scene. Structurally correct per spec. But when the user visited the page they kept flagging a jarring brightness/warmth transition against the rest of dig.haus's dark chrome — the shop scene read as "a different website's interior" rather than a continuation of dig.haus.

**User's nano banana reference** (Google's Gemini image gen, 2026-04): a Korean vinyl-collector's bedroom at night, warm desk lamp from upper-left pooling amber light, cool cyan-purple neon leaking from an off-screen window on the right, painted wall covered with minimal LP sleeves, a low wooden console with a turntable + 2 speakers + small amp + plant, four wooden record crates on the floor with masking-tape labels, viewed from a seated position facing the wall. The image nailed the direction: warm + cool dual-source lighting, lived-in wall with postcards and sticky notes as texture, crates with records poking up top-edge-first, and a turntable console bridging wall and floor.

**Aesthetic anchors**: LoFi Hip Hop Radio imagery (specifically the "LoFi Girl" visual universe minus the character), Makoto Shinkai's warm atmospheric color palette, Wong Kar-wai interior tungsten, Japanese izakaya late-night warmth, Edward Hopper nocturnes.

**Decided**: Replace the record-shop framing with "a Korean vinyl-collector's bedroom at night, viewed from the seat of a chair directly facing the wall." Keep the structural decisions (wall above, open shelf below, etc.) but re-skin everything from "shop interior" to "bedroom wall + desk + floor".

**Why**:
- The record-shop metaphor was always a touch off: mydig is supposed to be a *personal* digger page, not a commercial storefront. "My shop" implies curator/dealer; "my bedroom wall" implies fan/collector.
- The lofi-girl aesthetic resonates with dig.haus's Korean 20s–30s audience and has direct lineage to 싸이월드 미니홈피 culture (already referenced as a touchpoint elsewhere in the plan).
- Dual-source lighting (warm lamp + cool neon) carries depth better than a single shop-pendant pool. The two light temperatures meeting in a horizontal gradient across the scene is the lofi visual signature.
- Window-to-city peripheral hints (corner peeks only, never the main event) let us imply "this is a real place in the world" without committing to rendering a full room.
- Allows non-musical identity markers (plant, sticky notes, polaroids, desk lamp style) to contribute to the user's expression without cluttering the core wall/shelf/crate structure.

**Mood scope note (narrow, not full redesign)**: We explicitly did NOT redo the viewpoint, the tier structure, or the core primitives. Wall on top, shelf/crate-zone in the middle, floor at the bottom — unchanged. The pivot was strictly the MOOD layer (lighting, wall texture, furniture style, room context peeks). The structural decisions from entries 1–9 all carry over.

---

### 13. Shelf → Turntable console (Now Playing integration)

**Context**: Once the mood moved to bedroom, the open 6-cubby shelf felt like transplanted shop furniture. Real vinyl collectors' bedrooms don't have 6-slot labeled cubby shelves — that's inventory display for a store. A bedroom has a low console against the wall with a turntable and speakers on top, and records stored in crates on the floor.

**Decided**: Replace the open shelf unit with a **turntable console** — a low wooden piece of furniture holding a turntable + 2 bookshelf speakers + small amp + potted plant, sitting between the wall above and the floor crates below.

**This also solves the Now-Playing problem**: previously Now Playing was an awkward ambient "strip" parked for later iteration (entry 9). The turntable console IS Now Playing. The LP that sits on the platter is what the user is "currently spinning" — a natural, integrated identity element rather than an after-the-fact strip.

**Composition**: speaker (left) — turntable (center, with LP on platter) — small amp with VU meters — potted plant — speaker (right). Console spans ~75% of the scene width, centered. Small amp + plant fill the right-of-turntable gap so the layout doesn't look like two speakers with nothing between them.

**Why**:
- Solves an unresolved feature (Now Playing) by integrating it into the new metaphor rather than bolting it on.
- Matches what real collectors' bedrooms look like — there's always some gear between the wall and the crates.
- Creates a natural "bridge" tier between wall LPs (display) and floor crates (storage) — the console is where records get *played*.
- Unlocks the interactive killer moment (entry 17) by giving the hover/click target a place to land visually.

---

### 14. Cubby → Wooden floor crate (3D box)

**Context**: Once the shelf became a console, the question was where the crate-style collections live. Keeping them inside cubby-shaped slots on the console didn't make sense — a console carries gear, not record bins. And the original milk-crate tier (entry 1, deferred-then-merged-into-shelf) came back naturally as "crates on the floor" when we dropped the shelf-slot metaphor.

**Decided**: Floor crates render as **3D wooden boxes** with two visible faces — front face (vertical wood panel with masking-tape label) and top face (tilted parallelogram showing the interior from a slight above-angle, with the **top edges** of vertically-stored records visible as a packed row of thin dark strips).

**Key distinction the 3D view locks in**:
- **Wall LPs = covers forward** (display items)
- **Crate LPs = top edges only** (storage items, stored vertically spine-up, we see the top of each sleeve from above)

This matches how real records are stored in crates on the floor — you don't see the covers from a seated viewing angle, you see the tops poking up. When a visitor opens a crate (clicks it), *then* they see the covers via the flip-through modal.

**Why**:
- Makes the crate read as actually holding records (dense top-edge row communicates volume), not just as a labeled empty box.
- Differentiates wall from crate functionally: "here are my favorites on display" vs "here's a stack I'm digging through."
- The wooden 3D box reads as a real object in a real room far better than the flat cubby did against a bedroom floor.
- Cheap to render: the 3D illusion is built from a clip-path trapezoid (top face) plus a flat rectangle (front face) — no real 3D CSS transforms, no preserve-3d chains.

**Not used**: plastic milk crates (too harsh against the bedroom warmth), cardboard apple boxes (too disposable), transparent storage bins (too modern/sterile). Plain wooden boxes with masking-tape labels carry the intended "collector's private rack" read.

---

### 15. Crate count: 0–6 on the floor, user-selectable

**Decided**: Up to 6 crates visible on the bedroom floor at once. User picks which of their crate library entries to "put out" vs. "keep in storage". 0 is a valid state (empty floor reads as "I haven't put anything out").

**Why**:
- 6 matches the original Tier-3 visible-count spec (entry 1's milk-crate row), preserving the "crate library has more than what's on display" concept.
- 4 is the current preview seed, leaving headroom for variety without overcrowding the floor.
- More than 6 starts packing the floor too densely at normal viewport widths — the crates overlap awkwardly or the scene gets busy.
- 0 needs to be graceful: the floor with no crates should read as "the owner cleared up" or "still setting up" rather than "error: missing content".

**Library vs. floor distinction is critical**: A user's crate library is unlimited (private, in the edit-mode picker). The floor slots (≤6) are the public-facing subset. Dragging a crate onto a floor slot "puts it out"; dragging it off "puts it back in the library". Same mental model as "which crates am I leaving out right now vs. storing".

---

### 16. 3D perspective strategy — partial, not full

**Considered**: Applying a full one-point perspective to the whole scene (wall tilts toward vanishing point, floor recedes, everything sits in a coherent 3D space).

**Decided**: **Partial perspective keyed to vertical position**. The wall stays flat (head-on view, zero foreshortening). The turntable console is slightly tilted so its top surface is visible. The floor crates are fully 3D (front face + top face + implied depth). The floor itself recedes gently via a one-point perspective.

**Rule of thumb**: flatness scales with height in the scene — the higher something is in the composition, the flatter it renders. This matches how a seated viewer's eye actually sees a bedroom: the wall far away reads as flat, objects near the floor are perceived from a top-down angle because the viewer is looking forward and slightly down at them.

**Why**:
- Full one-point perspective would distort the wall LP sleeves (covers would become trapezoids depending on position), which breaks the "display" function of the wall tier.
- Partial perspective localizes the 3D work to the pieces that benefit from it (crates need to look like boxes you could open; the console wants to feel like a surface you can put gear on) without forcing a global recalculation of the whole scene.
- Keeps CSS implementation tractable: each "3D" piece uses flat shapes with clip-path trickery, not real preserve-3d transform chains.
- Matches how a real seated viewpoint reads a room — the perceived geometry isn't uniform, objects at different distances get different amounts of visible top/side surface.

**Cost of the approach**: The scene isn't a strictly correct 3D projection. Someone with a CAD-trained eye might notice the wall and the floor don't share a single vanishing point. In practice the scene reads fine because every viewer already accepts that bedroom illustrations take these liberties.

---

### 17. Interactive design — hover pop-out, click moves to turntable, sample plays

**Context**: Once the turntable console exists and holds an LP on its platter, the static scene begs an obvious question: "what happens if I click one of the wall LPs?" The answer we landed on connects the three tiers into one interaction loop.

**The full sequence (to ship across S2–S5)**:

1. **Idle** — turntable holds a default LP (the user's "currently spinning" pick). Wall LPs are static displays. Scene is purely decorative.
2. **Hover** a wall LP → the black vinyl disc slides partially out of the sleeve (~60% to the right, half-revealed). Cursor leaves → vinyl retracts. Stateless preview.
3. **Click** a wall LP → the vinyl fully exits its sleeve and animates across the scene onto the turntable platter. The LP that was previously on the platter either retreats first (back to wherever it came from) or swaps in place. Tonearm descends, platter spins, sample begins.
4. **While playing** — platter rotates continuously, tonearm sits on the record. Clicking another wall LP swaps.
5. **Sample ends** (30-second preview cap) — tonearm parks itself, platter stops. User can re-click or let the room sit idle.

**Sample playback source**: Spotify's `preview_url` track field (30-second MP3) is the primary path — free, no auth, already present in the album data we store. YouTube as fallback for albums without Spotify coverage. Silent graceful degradation for albums with neither.

**Why this matters**:
- Turns the storefront from static decoration into an interactive listening station. A visitor can actually *hear* through what the owner has chosen to display. This is the killer moment the page hinges on.
- Grounds the three tiers in a physical metaphor: wall records are pulled down, placed on the turntable, played, returned. It's the actual motion of using a real record collection.
- Uses physical-world affordances to teach the interaction — the hover pop-out previews what the click will do, which is exactly how a real record being pulled halfway out of a sleeve telegraphs that it's about to be played.
- Low-risk implementation: each phase (hover pop-out, click animation, sample playback, swap UX) ships independently. S1 is static decoration; S2 is hover-only; etc.

**Phase ordering** (per entry 18's MVP realization, we defer this): S1 ships static. S2–S5 layer in after the wireframe validates the data model and interaction affordances.


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
