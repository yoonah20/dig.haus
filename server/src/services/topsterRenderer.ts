import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAndResize } from '../utils/coverImage.js';

// Topster PNG renderer for shareable mydig walls. Output is the
// classic RYM/Charts.fm "5×N covers + per-row text column" layout —
// 1500×800 landscape, black background, monospace caption text. Used
// by GET /api/mydig/:username/topster.png and the snapshot variant.
//
// Why this format: it's the topster cultural artifact people already
// know, lets us drop a recognisable dig.haus brand stamp at the
// bottom, and survives downscaled previews on Twitter / KakaoTalk /
// Discord. Sharing format choice + decision log lives in
// docs/post-phase3-roadmap.md item 1a.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');
const LOGO_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'client',
  'public',
  'textures',
  'logo.png'
);

// Font binaries are loaded once and cached for the process lifetime.
// JetBrains Mono carries the topster monospace look (RYM-coded);
// Noto Sans KR is the fallback so Korean glyphs in album titles +
// artist names + theme strings render rather than dropping to tofu.
let _fonts: Array<{ name: string; data: Buffer; weight: 400; style: 'normal' }> | null =
  null;
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
  ];
  return _fonts;
}

let _logoDataUrl: string | null = null;
function loadLogoDataUrl(): string {
  if (_logoDataUrl) return _logoDataUrl;
  const buf = fs.readFileSync(LOGO_PATH);
  _logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return _logoDataUrl;
}

// Each slot maps to one of 15 wall positions. Empty slots (no album
// pinned) come through with everything null and render as a flat
// black square — matching the live wall's "empty-is-OK aesthetic"
// (CLAUDE.md vision). artistName + title carry the caption text;
// coverDataUrl is pre-fetched as a data URL because satori has no
// async resource loader.
export interface TopsterSlot {
  position: number;
  albumMbid: string | null;
  albumTitle: string | null;
  artistName: string | null;
  coverDataUrl: string | null;
}

export interface TopsterInput {
  username: string;
  themeTitle: string | null;
  slots: TopsterSlot[];
}

const W = 1500;
const H = 800;
const COVER = 200;
const COVER_GAP = 14;
const ROW_GAP = 18;
const TEXT_COL_GAP = 40;
const SIDE_PADDING = 36;
const HEADER_HEIGHT = 80;
const FOOTER_HEIGHT = 76;

function captionLine(slot: TopsterSlot): string {
  if (!slot.artistName || !slot.albumTitle) return '';
  return `${slot.artistName} - ${slot.albumTitle}`;
}

// Build the satori element tree as plain JSON (no JSX) so this file
// stays .ts and we don't need to add tsx/JSX config to the server.
// Satori accepts the same shape React produces, so this is just a
// hand-rolled VDOM literal.
function buildTree(input: TopsterInput): unknown {
  const rows: TopsterSlot[][] = [];
  for (let r = 0; r < 3; r++) {
    rows.push(input.slots.slice(r * 5, r * 5 + 5));
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
        alignItems: 'center',
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
        // Caption column — 5 lines aligned to this row of covers
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              fontSize: 15,
              lineHeight: 1.55,
              color: '#d8d8d8',
              gap: 4,
              minWidth: 0,
            },
            children: rowSlots.map((s, i) => ({
              type: 'div',
              key: `cap-${rowIdx}-${i}`,
              props: {
                style: {
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
                children: captionLine(s),
              },
            })),
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
              fontSize: 22,
              letterSpacing: '0.04em',
              color: '#f0f0f0',
            },
            children: headerText,
          },
        },
        // Body — 3 rows of (5 covers + 5-line text)
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
        // Footer — logo + handle URL
        {
          type: 'div',
          props: {
            style: {
              height: FOOTER_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            },
            children: [
              {
                type: 'img',
                props: {
                  src: loadLogoDataUrl(),
                  height: 36,
                  style: { objectFit: 'contain' },
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 13,
                    color: '#888888',
                    letterSpacing: '0.05em',
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

export async function renderTopsterPng(input: TopsterInput): Promise<Buffer> {
  // Pad slot list out to 15 so an empty wall still renders as a 5×3
  // grid of black squares. Caller is allowed to pass fewer entries
  // (e.g. just the populated positions); we fill the gaps here.
  const slotsByPos = new Map<number, TopsterSlot>();
  for (const s of input.slots) slotsByPos.set(s.position, s);
  const slots: TopsterSlot[] = [];
  for (let i = 0; i < 15; i++) {
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
// originals at render time). The transcode cost is small — PNG
// recompress of a ~600×600 webp is single-digit ms — and the
// outer caller can wrap this in its own cache if the per-render
// total ever needs trimming.
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
