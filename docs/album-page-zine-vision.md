# Album page — record-shop zine vision

Long-term aesthetic target for `/album/:slug`. The PR1–PR7 chrome refactor that landed 2026-04-25 was infrastructure (tokens + primitives + tape headers + lamp wash) that this future pass sits on top of, not the destination. The user explicitly flagged the chrome refactor as "too subtle" and put `album-page-zine-mockup.png` in this folder as the actual ambition.

**Reference image**: `docs/album-page-zine-mockup.png` — a designed mock of how an album page should feel: a crate-digger's promotional flyer / zine / hand-stamped recommendation card, photocopier-aged, 90s record-shop counter material made specifically for this album.

---

## What the mockup is doing

The whole page reads as **one piece of printed paper** — a flyer the shop owner ran off the photocopier and stapled to the bin in front of an album they're championing this week. Every UI element is a physical artifact on that paper rather than a typeset web component. The album is being *recommended*, not *catalogued*.

### Top register — masthead

- `dig.haus RECOMMENDATION` in red letterpress (display sans, condensed, kerned tight)
- `Real Hip Hop.` script tagline pulling toward the right edge
- A round rubber-stamp seal — `HIP HOP CLASSIC` in blue, slightly off-axis, semi-transparent ink

### Hero block

- Album cover top-left, partly obscured by a `CLASSIC 90s HIP HOP ESSENTIAL` sticker stuck across one corner — the cover is a physical object that's been handled, not a clean reproduction
- Album title `BREAKING ATOMS` set HUGE in bold red display type, dominating the page — the *title* is the headline, not a meta-line under a small image
- Artist `MAIN SOURCE` smaller below in the same red but lighter weight
- Release credits `1991.07.23 / ATTIC RECORDS` in tiny mono-style orange/red — the typewriter-credits line every record promo has
- Korean translation block: `메인 소스 — 브레이킹 아톰스 / 원자 깨기` plus `Boom Bap ★ Science of Sound!` ornamental tagline
- Sparkle / star asterisks scattered around the type

### 구하는 곳 — buy section

- `구하는 곳` masking-tape header (the chrome refactor did get this part right — tape variant works here)
- A tiny `SUPPORT THE CULTURE!` ribbon badge
- Three buy buttons rendered as **physical price-tag paper stickers**: Discogs (peach $12.95 with Vinyl), Spotify (green LISTEN NOW), Bandcamp ($9.30 DIGITAL). Each tag has masking-tape attaching it to the page, slight rotation, paper drop shadow

### 반응 한눈에 보기 — quick reactions

- 굿굿 / 별루 / 샀음 / 살거 with counters, but rendered as a hand-stamped form on the page rather than a chrome split-pill. Imagine four checkbox-style icons drawn by hand.

### 고객 50자 평 — user comments

- `REAL PEOPLE, REAL WORDS` ribbon banner above
- Three user comments as **handwritten sticky notes / Polaroids** on different cream / yellow / sky-blue paper
- Each card has slight rotation, paper texture, masking-tape, the user's @ handle in the margin
- Reads as visitors literally pinning notes to the bulletin board around the album

### 리뷰 모음집 — review summary

- `리뷰 모음집` masking-tape header with `AI 요약` chip
- The Korean summary set in **two-column print body type** (proper magazine column layout, not a single full-width paragraph) — this is the editorial lede done right
- The 93 / 100 average score rendered as a **HUGE handwritten red marker number** in the margin next to the body text, like a teacher's grade scrawled on a paper. Visual anchor of the whole page.

### Mini review grid — `Dig Deeper`

Below the lede, a 3-column grid of source-by-source mini-reviews:

```
RapReviews 100/100         King Eric Productions 100/100   Time Is Illmatic 90/100
[2-line Korean blurb]      [2-line Korean blurb]            [2-line Korean blurb]

SputnikMusic 80/100        hip hop isn't dead. /100         Still Crew /100
[2-line Korean blurb]      [2-line Korean blurb]            [2-line Korean blurb]

Albumism /100              HHV Mag /100                     Travelling the Groove /100
[2-line Korean blurb]      [2-line Korean blurb]            [2-line Korean blurb]
```

Each cell is the source name + score in the source's voice, then the dig.haus 2-line summary of what that source said. Reads as a print magazine's "what the critics said" round-up, not a list of cards. This format is the entire raison-d'être of `리뷰 모음집` and the current implementation does not surface it at all — long blurbs sit in cards, scores hide behind a small badge.

### Edge ornaments

- Bottom-right: round `Dig Deeper` rubber-stamp on red ink
- Left edge: `THE SCIENCE OF DIGGING` rotated 90° as a paper-margin marker
- Star/sparkle/snowflake decorations scattered through the layout
- Aged paper edges, occasional photocopy bleed at borders

---

## Visual vocabulary inventory

| Layer | Treatment |
|---|---|
| Background | Cream / aged-newsprint paper texture, subtle photocopy noise overlay |
| Primary palette | Black ink + cream paper + red display accent (#cc1a1a-ish) |
| Secondary palette | Spot colours: green / orange / sky-blue for stickers + sparkles |
| Display type | Heavy condensed sans for the album title (Anton / Bebas-family); tighter kerning, all-caps |
| Body / editorial | Serif body for Korean summary in print columns (Noto Serif KR + a Latin serif companion) |
| Credits / scores | Monospace typewriter (Courier Prime is already loaded) for release credits, source names, mini-review scores |
| Handwritten | User comment cards, score margin numbers — Gaegu / Nanum Pen Script (already loaded) |
| Script accent | Ornamental italic / cursive for taglines like `Real Hip Hop.` — Caveat or similar (already loaded) |
| Stamps | Round / oval rubber-stamp seals, slightly off-axis, semi-transparent ink — bespoke SVG or asset |
| Tape | Masking-tape pieces with ragged edges + slight rotation + drop shadow — the chrome refactor's tape variant is the right primitive, just used more places |
| Stickers | Coloured paper labels stuck onto buttons / badges — drop shadow + slight tilt + paper texture |
| Sparkles | Small star / asterisk / snowflake glyphs scattered — could be Unicode or SVG |

---

## Implementation tiers — easy to hard

The full mock is a multi-week build, not a sprint. Tier the work so each layer ships independently.

### Tier 1 — typography + palette pivot (CSS-only, ~1 week)

- Add a `palette: paper` mode that flips the page from dark mode to cream/black for the album page only. Tokens: `--color-paper-bg: #ede4d3` or similar, `--color-paper-ink: #1a1208`, `--color-stamp-red: #c81e1e`. New `@theme` entries.
- Introduce a `.font-display` utility (Anton / Bebas Neue) for hero headlines. Already-loaded fonts are fine; Anton needs adding to the Google Fonts import.
- Type scale rework: title goes from `text-3xl md:text-4xl` (current) to `text-6xl md:text-8xl` display-bold. Korean serif lede in proper print columns (`columns-2 gap-8` for the summary card).
- Score in marker-style: 93/100 rendered at `text-7xl` in handwritten font with red ink (`text-stamp-red`).
- Mini-review grid: replace the current single Korean summary paragraph with the source-by-source layout from the mock.

This tier alone closes ~60% of the visual gap. No assets needed; everything is fonts + Tailwind utilities.

### Tier 2 — paper + stamps + ornaments (assets, ~1 week)

- Cream paper texture: a single tileable PNG (8–16 KB), applied as `background-image` on the page wrapper. Subtle noise + slight discolouration; no rotation or scale variation needed.
- Round rubber-stamp seals: 2–3 SVG/PNG variants the page uses for `HIP HOP CLASSIC`, `Dig Deeper`, etc. Slightly off-axis, alpha 0.85, blend mode multiply against the paper.
- Ornament glyphs: stars, snowflakes, asterisks. Either Unicode at scale or a tiny SVG sprite.
- 50자 평 cards: rotate them ±2–4°, add masking tape via SVG (already in mydig storefront), shift backgrounds to coloured paper tones (cream / yellow / sky-blue) instead of all `bg-panel`.

After Tier 2, the page reads as a flyer rather than a web page.

### Tier 3 — printing imperfection layer (asset polish, days to weeks)

- Photocopier ink-bleed at ~5–8% opacity along the page edges
- Slight image desaturation + grain on the album cover so it reads as the cover printed onto the flyer, not the original digital file
- Rotation + drop shadow on the cover sticker overlay
- Crop-mark / registration-mark corner ornaments for the print-aesthetic finish

### Tier 4 — interaction polish (post-Tier 1–3)

- Hover on the score makes it nudge slightly as if a marker is wet
- Hover on a sticker peels its corner up
- Buy-button presses make a stamp-press sound (optional, mute by default)

---

## What the chrome refactor (PR1–PR7) gets right

- Tokens are in place — paper-mode tokens slot into the same `@theme` block.
- `SectionTitle.tape` exists — Tier 2's expanded use builds on it.
- Lamp wash + serif lede on the Korean summary are first steps toward Tier 1.
- Admin chrome is isolated (`ReviewsAdminBar`) so the visual pivot doesn't have to thread through admin code paths.

## What the chrome refactor misses

The chrome refactor consolidated *colours and rounding* but didn't change the **layout language**. The mockup's radical move is that it abandons "header / sections / cards" altogether for "a single piece of paper with stuff stuck on it." That layout pivot — display title at hero scale, mini-review grid replacing single-summary card, stamps and stickers as primary visual elements — has to come in Tier 1, not as ornament on top of the existing layout.

---

## Sequencing this against the post-Phase 3 roadmap

`docs/post-phase3-roadmap.md` item 0 is "album page refactor — done after PR1–PR7." That status is technically accurate (the chrome work shipped) but misleading about the actual destination. Add a follow-up item:

- **0b. Album page zine pass** — Tier 1 first, ship to prod, see how it lands. Tier 2 follows once paper / stamp assets are sourced. Item 3 (shop-feel visual: plastic wrap on covers) overlaps with Tier 3 here — same asset pipeline, can land together.

The brainstorm additions in post-phase3-roadmap.md `D. Curatorial daily log` and `E. dig.haus 라이너 노트` start to make a lot more sense once the album page reads as a flyer the shop owner wrote — daily log becomes "this week's shop bulletin," liner notes become "the owner's red-ink margin scribble."
