import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAndResize } from '../utils/coverImage.js';
// LOGO_PATH constant kept for backwards reference but the rendered
// brand stamp at the bottom is now drawn with the Syne typeface to
// match the live nav (CSS-styled wordmark) instead of embedding the
// raster sticker — keeps the footer crisp at any scale and doesn't
// fight the resvg PNG output's anti-aliasing.

// 토스터 — shareable PNG of a user's vinyl wall in a 3×5 grid with
// per-row caption columns. 1080×1350 (Instagram 4:5 portrait, the
// format that gets the largest feed area on IG, also fits Twitter /
// KakaoTalk inline previews fine). Used by GET /api/mydig/:username/
// toaster.png and the snapshot variant.
//
// Naming: the format is the RYM/Charts.fm "topster" cultural
// artifact, but in dig.haus we ship it under the Korean transliteration
// 토스터 because the Korean wordplay (토스트 굽기 ↔ CD-R 굽기, both
// "burning") slots into the site's music-nostalgia identity better
// than the english jargon. Internal identifiers carry the romanised
// `toaster` so code reads in one register; user-facing strings stay
// Korean-only.
//
// Slot reflow: the live wall is 5×3 but this export uses 3×5 to fit
// portrait aspect. Positions 0-14 are taken in reading order
// (0,1,2 → row 1; 3,4,5 → row 2; …) — the visual divergence from the
// live wall is intentional, signals "this is an export, not a
// screenshot" the way the original topster format did on RYM.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');

// Font binaries are loaded once and cached for the process lifetime.
// JetBrains Mono carries the topster-coded monospace look; Noto Sans
// KR is the fallback so Korean glyphs in album titles + artist names
// + theme strings render rather than dropping to tofu. Syne Bold
// renders the dig.haus wordmark at the footer — same family the live
// nav uses (TopNav.tsx CSS-styled wordmark), so the brand stamp on
// the export looks like the same brand the visitor came from rather
// than a separate raster logo.
let _fonts:
  | Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }>
  | null = null;
function loadFonts() {
  if (_fonts) return _fonts;
  _fonts = [
    {
      name: 'JetBrains Mono',
      data: fs.readFileSync(path.join(FONTS_DIR, 'JetBrainsMono-Regular.ttf')),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Noto Sans KR',
      data: fs.readFileSync(path.join(FONTS_DIR, 'NotoSansKR-Regular.otf')),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Syne',
      data: fs.readFileSync(path.join(FONTS_DIR, 'Syne-Bold.ttf')),
      weight: 700,
      style: 'normal',
    },
  ];
  return _fonts;
}

// Each slot maps to one of 15 wall positions. Empty slots (no album
// pinned) come through with everything null and render as a flat
// black square — matching the live wall's "empty-is-OK aesthetic"
// (CLAUDE.md vision). artistName + title carry the caption text;
// coverDataUrl is pre-fetched as a data URL because satori has no
// async resource loader.
export interface ToasterSlot {
  position: number;
  albumMbid: string | null;
  albumTitle: string | null;
  artistName: string | null;
  coverDataUrl: string | null;
}

export interface ToasterInput {
  username: string;
  themeTitle: string | null;
  slots: ToasterSlot[];
}

// Layout math for 1080×1350 portrait (IG 4:5):
//   side padding 36 × 2 = 72  → 1008 internal width
//   3 covers × 220 + 2 gaps × 14 = 688
//   text col gap 20 (tucked close to the cover so the caption reads
//                    as belonging to the row, not floating to the side)
//   text col width = 1008 - 688 - 20 = 300
//   header 80 + 5 rows × 220 + 4 row gaps × 18 + footer 90 = 1342
//   fits inside 1350 with thin top/bottom margin.
const W = 1080;
const H = 1350;
const COVER = 220;
const COVER_GAP = 14;
const ROW_GAP = 18;
const TEXT_COL_GAP = 20;
const SIDE_PADDING = 36;
const HEADER_HEIGHT = 80;
const FOOTER_HEIGHT = 90;

const COLS = 3;
const ROWS = 5;

// Captions render as two lines — artist on top, `- title` below.
// Always two lines regardless of length so the visual rhythm stays
// consistent across the column; the row band has 220px height with
// only 3 captions sharing it so the extra vertical never overflows.
// Returns null for empty slots so the caller can skip rendering.
function captionLines(slot: ToasterSlot): { artist: string; title: string } | null {
  if (!slot.artistName || !slot.albumTitle) return null;
  return { artist: slot.artistName, title: `- ${slot.albumTitle}` };
}

// Build the satori element tree as plain JSON (no JSX) so this file
// stays .ts and we don't need to add tsx/JSX config to the server.
// Satori accepts the same shape React produces, so this is just a
// hand-rolled VDOM literal.
function buildTree(input: ToasterInput): unknown {
  const rows: ToasterSlot[][] = [];
  for (let r = 0; r < ROWS; r++) {
    rows.push(input.slots.slice(r * COLS, r * COLS + COLS));
  }

  const headerText =
    input.themeTitle && input.themeTitle.trim().length > 0
      ? input.themeTitle.trim()
      : `${input.username}'s wall`;

  const rowChildren = rows.map((rowSlots, rowIdx) => ({
    type: 'div',
    key: `row-${rowIdx}`,
    props: {
      style: {
        display: 'flex',
        // Top-anchor row children so the caption block starts at the
        // cover top edge rather than vertically centering against it.
        // Matches the RYM/Charts.fm reference in docs/topster.jpg —
        // captions read as a "list pinned to this row" rather than a
        // floating side-block.
        alignItems: 'flex-start',
        gap: TEXT_COL_GAP,
      },
      children: [
        // Cover strip
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              gap: COVER_GAP,
              flexShrink: 0,
            },
            children: rowSlots.map((s, i) => ({
              type: 'div',
              key: `cover-${rowIdx}-${i}`,
              props: {
                style: {
                  width: COVER,
                  height: COVER,
                  background: '#0a0703',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                },
                children: s.coverDataUrl
                  ? {
                      type: 'img',
                      props: {
                        src: s.coverDataUrl,
                        width: COVER,
                        height: COVER,
                        style: { objectFit: 'cover' },
                      },
                    }
                  : null,
              },
            })),
          },
        },
        // Caption column — 3 captions pinned to the top of the row.
        // Each caption is two lines: artist on top, `- title` below.
        // Always two lines regardless of length keeps a consistent
        // visual rhythm across the column. wordBreak is 'break-word'
        // as a safety net for super-long single tokens — rare, but
        // we'd rather wrap mid-word than truncate silently.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              flex: 1,
              fontSize: 15,
              lineHeight: 1.3,
              color: '#d8d8d8',
              gap: 12,
              minWidth: 0,
            },
            children: rowSlots.map((s, i) => {
              const lines = captionLines(s);
              return {
                type: 'div',
                key: `cap-${rowIdx}-${i}`,
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    wordBreak: 'break-word',
                  },
                  children: lines
                    ? [
                        {
                          type: 'div',
                          key: 'artist',
                          props: { children: lines.artist },
                        },
                        {
                          type: 'div',
                          key: 'title',
                          props: { children: lines.title },
                        },
                      ]
                    : null,
                },
              };
            }),
          },
        },
      ],
    },
  }));

  return {
    type: 'div',
    props: {
      style: {
        width: W,
        height: H,
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"JetBrains Mono", "Noto Sans KR"',
        color: '#e8e8e8',
        padding: `0 ${SIDE_PADDING}px`,
      },
      children: [
        // Header
        {
          type: 'div',
          props: {
            style: {
              height: HEADER_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              letterSpacing: '0.04em',
              color: '#f0f0f0',
            },
            children: headerText,
          },
        },
        // Body — 5 rows of (3 covers + caption column)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: ROW_GAP,
              flex: 1,
            },
            children: rowChildren,
          },
        },
        // Footer — Syne wordmark stamp (amber bordered box, tilted
        // -3°, mirroring TopNav's CSS-styled wordmark) sits inline
        // with the handle URL on a single row. The URL gets a larger
        // fontSize so it's actually readable on social previews
        // (Twitter / KakaoTalk thumbnails compress aggressively, so
        // the handle has to survive the downscale to be useful as a
        // back-pointer to the wall).
        {
          type: 'div',
          props: {
            style: {
              height: FOOTER_HEIGHT,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    color: '#e8a020',
                    fontFamily: 'Syne',
                    fontWeight: 700,
                    fontSize: 30,
                    letterSpacing: '-0.03em',
                    border: '3px solid #e8a020',
                    padding: '4px 10px',
                    transform: 'rotate(-3deg)',
                    lineHeight: 1,
                  },
                  children: 'dig.haus',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 17,
                    color: '#bdbdbd',
                    letterSpacing: '0.04em',
                  },
                  children: `dig.haus/my/${input.username}`,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export async function renderToasterPng(input: ToasterInput): Promise<Buffer> {
  // Pad slot list out to 15 so an empty wall still renders as a 3×5
  // grid of black squares. Caller is allowed to pass fewer entries
  // (e.g. just the populated positions); we fill the gaps here.
  const slotsByPos = new Map<number, ToasterSlot>();
  for (const s of input.slots) slotsByPos.set(s.position, s);
  const slots: ToasterSlot[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    slots.push(
      slotsByPos.get(i) ?? {
        position: i,
        albumMbid: null,
        albumTitle: null,
        artistName: null,
        coverDataUrl: null,
      }
    );
  }

  const svg = await satori(buildTree({ ...input, slots }) as never, {
    width: W,
    height: H,
    fonts: loadFonts(),
  });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    background: '#000000',
  })
    .render()
    .asPng();
  return png;
}

// Cover-art fetcher used by the route handlers. Tries the primary
// URL plus any fallbacks (`cover_art_fallbacks` is a JSON array on
// the album row), returns null when none work. The disk-cached
// fetchAndResize gives us back webp; satori's image probe only
// recognises PNG/JPEG, so we transcode webp → PNG (resized down to
// COVER px in the same step to avoid satori downsampling huge
// originals at render time).
export async function loadCoverDataUrl(
  coverArtUrl: string | null,
  fallbacks: string[]
): Promise<string | null> {
  const candidates: string[] = [];
  if (coverArtUrl) candidates.push(coverArtUrl);
  for (const f of fallbacks) if (f && !candidates.includes(f)) candidates.push(f);
  for (const url of candidates) {
    try {
      const webpBuffer = await fetchAndResize(url);
      const pngBuffer = await sharp(webpBuffer)
        .resize(COVER, COVER, { fit: 'cover' })
        .png()
        .toBuffer();
      return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch {
      // try next fallback
    }
  }
  return null;
}
