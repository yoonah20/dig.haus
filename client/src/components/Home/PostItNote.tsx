import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GRAFFITI_FONT_STACK } from '../MyDig/GraffitiSnapshotList';
import { useTapActivate } from '../../hooks/useTapActivate';
import { liftHeroSlot, releaseHeroSlot } from '../../utils/heroSlotLift';

// Sticky note rendered below each hero-wall LP, on/around the rail
// rather than on the cover itself. Mounted by ShelfRow / Mobile
// FeatureCell as a sibling to the LP, so it sits in the rail region
// without competing with the play chip + cover stickers.
//
// Default size keeps the handwriting small enough that the visitor
// reads it intentionally, not at a glance — hovering the LP slot
// (group/slot on the parent) expands the note to readable size.
// transformOrigin = top center so the scale grows downward, into
// the gap between LP rows, never over the LP cover above it.

// Five real-photo masking-tape strips with cut-out alpha. Each tape
// is 100×~36 px PNG; when rendered at noteWidth × 0.55 it lands at
// roughly the right scale next to the post-it body. Deterministic
// per-slot pick via mbid hash so successive notes don't share the
// same tape pattern.
const TAPE_TEXTURES = [
  '/textures/masking07.webp',
  '/textures/masking17.webp',
  '/textures/masking34.webp',
  '/textures/masking94.webp',
  '/textures/masking96.webp',
];

// Five-colour Post-It palette sampled from the standard 3M neon pad
// (canary, hot pink, cyan, lime, orange). Each entry is a 3-stop
// gradient — top edge lifted toward white to suggest paper grain,
// mid stop is the dominant tone, bottom slightly deeper for shadow.
// Pick is deterministic per slot via mbid hash so the wall reads as
// a varied stack rather than a single colour wash.
const PAPER_PALETTE = [
  // canary yellow
  'linear-gradient(180deg, #ffe54a 0%, #fcdc2c 38%, #f5cc18 100%)',
  // hot pink
  'linear-gradient(180deg, #ff8ac9 0%, #ff5fb5 38%, #ee3f9b 100%)',
  // cyan
  'linear-gradient(180deg, #95e8f2 0%, #5dd5e6 38%, #2cb8cc 100%)',
  // lime green
  'linear-gradient(180deg, #d8f262 0%, #bce63a 38%, #98cc1c 100%)',
  // orange
  'linear-gradient(180deg, #ffb178 0%, #ff8a3d 38%, #ec6e1e 100%)',
];

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export default function PostItNote({
  text,
  lpSize,
  seed,
  href,
  isMobile = false,
}: {
  text: string;
  /** Source LP size in px so the note can scale relative to the
   *  cover. The component computes its own width / font-size off
   *  this single value. */
  lpSize: number;
  /** Stable per-slot seed (typically the album mbid) so the per-note
   *  rotation + tape pick stays deterministic across renders but
   *  varied across slots. */
  seed: string;
  /** Album route — clicking the note jumps to the same target as
   *  the LP cover above it, so the post-it doubles as a second
   *  affordance for the slot. */
  href: string;
  /** Mobile slides shrink lpSize aggressively, so the percentage
   *  cap shifts up to keep text legible after the hover-scale. */
  isMobile?: boolean;
}) {
  // Note width scales with lpSize so the post-it keeps a sensible
  // proportion to the LP it hangs below — the hero itself rescales
  // on every viewport change, and a fixed-px note would look giant
  // on small phones and tiny on widescreens. Font ratio is tuned
  // for ~9 Korean syllables per line (incl. whitespace) at the
  // chosen horizontal padding. Desktop runs 2 px below the mobile
  // ratio because the desktop note ends up much wider in absolute
  // px (lpSize 320+), so the same ratio would oversize the text.
  const widthPct = isMobile ? 0.336 : 0.256;
  const noteWidth = Math.round(lpSize * widthPct);
  // Desktop runs a tighter ratio than mobile (0.059 vs 0.060) and a
  // lower floor — desktop notes are wider in absolute px so the same
  // ratio would read as oversized hand text. The -2 subtraction stays
  // so the rounded value lands in the "small but legible after 2.8×
  // hover" range, then the whole desktop expression gets a 0.9 trim
  // because the prior desktop sizing still felt a touch heavy on the
  // wall at default rest state. Mobile got the same -10% trim
  // separately — the prior 0.067 ratio was reading a touch loud
  // against the smaller mobile post-its.
  const fontSize = isMobile
    ? Math.max(6, Math.round(noteWidth * 0.060))
    : Math.max(5, Math.round((noteWidth * 0.059 - 2) * 0.9));

  const h = hashStr(seed);
  // Rotation in [-4.5°, +4.5°] from the seed. v5 ran the range up to
  // ±9° which read as "thrown sticker" rather than "stuck on slightly
  // crooked"; halving it keeps the hand-applied feel without tipping
  // over into chaotic.
  const rot = (((h % 901) / 100) - 4.5).toFixed(2);
  // Per-slot horizontal nudge along the rail in [-22%, +22%] of LP
  // width so notes don't all sit dead-centre under their cover. The
  // slot width is the LP, not the note, so we scale by lpSize here.
  const railOffset = Math.round((((h >>> 12) % 45) - 22) / 100 * lpSize);
  // Pick paper colour and masking-tape texture from independent hash
  // bytes so colour and tape vary independently across slots.
  const paperBg = PAPER_PALETTE[(h >>> 4) % PAPER_PALETTE.length];
  const tapeSrc = TAPE_TEXTURES[(h >>> 8) % TAPE_TEXTURES.length];
  const tapeWidth = Math.round(noteWidth * 0.55);
  // Tape PNGs are ~100×36 average; preserve aspect ratio when scaling.
  const tapeHeight = Math.round(tapeWidth * 0.36);
  // Per-slot horizontal nudge in [-12%, +12%] of note width so the
  // tape doesn't sit dead-centre on every note.
  const tapeOffset = ((((h >>> 16) % 25) - 12) / 100) * noteWidth;
  // Per-slot tape rotation in [-6°, +6°] independent of the note's
  // own rotation — real masking tape is rarely applied perfectly
  // parallel to the paper edge.
  const tapeRot = (((h >>> 24) % 121) / 10 - 6).toFixed(1);

  // Hover scale via a CSS variable so the rotate + translateX in
  // the inline transform survives the hover state — Tailwind's
  // `hover:scale-[X]` rewrites the whole `transform` property and
  // wipes our rotation, which made the note snap upright when
  // hovered. Setting `--postit-scale` via the hover class and
  // referencing it inside the inline transform composes cleanly:
  // rotate, translateX, and scale all combine, all anchored at
  // top-center via the inline `transformOrigin`. Both class
  // strings (hover + data-[tap-active]) have to appear literally
  // for Tailwind JIT to emit them, so the mobile / desktop scale
  // variants are spelled out as full strings rather than templated.
  // Mobile scale was sized for the 130% cover hover; once the cover
  // started filling the slide horizontally (~240% on a 390px phone)
  // a 2.2× post-it read as visually undersized next to it. Dialed
  // up to 3.2× so the note keeps roughly the same proportional
  // weight against the lifted sleeve as desktop's 2.8× does against
  // its 1.77× cover.
  const scaleCls = isMobile
    ? 'hover:[--postit-scale:3.2] data-[tap-active=true]:[--postit-scale:3.2]'
    : 'hover:[--postit-scale:2.8] data-[tap-active=true]:[--postit-scale:2.8]';

  // Tap-to-activate on touch devices — first tap expands the
  // post-it (matches the LP cover behaviour, which already routes
  // through useTapActivate), second tap navigates to the album.
  // On desktop the hook short-circuits via its hover-none guard so
  // hover-to-scale + click-to-navigate stays unchanged.
  const navigate = useNavigate();
  const tap = useTapActivate({
    cardId: `postit-${seed}`,
    outsideSelector: '.dig-postit',
    enabled: isMobile,
  });

  const noteRef = useRef<HTMLAnchorElement>(null);
  return (
    <Link
      ref={noteRef}
      to={href}
      aria-label={`${text.slice(0, 24)} 앨범으로 이동`}
      onMouseEnter={() => liftHeroSlot(noteRef.current)}
      onMouseLeave={() => releaseHeroSlot(noteRef.current)}
      onTouchStart={tap.handlers.onTouchStart}
      onTouchMove={tap.handlers.onTouchMove}
      onTouchCancel={tap.handlers.onTouchCancel}
      onTouchEnd={(e) => tap.handlers.onTouchEnd(e, () => navigate(href))}
      onClick={tap.handlers.onClick}
      data-tap-active={tap.isActive ? 'true' : undefined}
      // `dig-postit` is the hook the parent slot uses to bump its
      // own z-index when the post-it is hovered or tap-active (via
      // has-[.dig-postit:hover] / has-[.dig-postit[data-tap-active]]),
      // so the scaled-up note layers above neighbouring slots' LPs
      // and above the carousel dot pagination (z-30) instead of
      // getting buried. z-40 on the post-it itself beats the dot
      // nav even before the slot/row hop kicks in. Default
      // --postit-scale lives in the inline style below; the hover
      // and data-[tap-active] classes rewrite the variable.
      className={`dig-postit relative block select-none z-0 hover:z-40 data-[tap-active=true]:z-40 transition-transform duration-300 ease-out ${scaleCls}`}
      style={{
        width: noteWidth,
        // CSS variable composition with a 1 fallback in var() so the
        // hover class can rewrite the variable without fighting an
        // inline style. Inline `--postit-scale: 1` was the bug —
        // inline custom-property declarations beat the :hover class
        // selector, so the variable stayed at 1 even on hover and
        // the note never grew. Without the inline declaration the
        // variable is undefined at rest, the fallback 1 applies,
        // and the hover class swaps in 2.2 / 2.8 cleanly.
        transform: `translateX(${railOffset}px) rotate(${rot}deg) scale(var(--postit-scale, 1))`,
        transformOrigin: 'top center',
        // Slight downward push so the tape (which sits *above* the
        // top edge with negative top) has room to render without
        // getting clipped by the slot's wrapper.
        marginTop: Math.round(tapeHeight * 0.4),
      }}
    >
      {/* Paper body — square Post-It. Square aspect is the
          recognisable cue; height locked to width regardless of how
          short the text is. Padding scales with note size. */}
      <div
        className="relative"
        style={{
          background: paperBg,
          boxShadow:
            '0 2px 4px rgba(0, 0, 0, 0.32), 0 1px 1px rgba(0, 0, 0, 0.2)',
          // Desktop runs a slightly looser top gap (top 6% + 2px)
          // so the smaller desktop font breathes under the tape;
          // the absolute +2px nudge keeps it visible at the small
          // desktop noteWidth where the percentage alone resolves
          // to only 4-5px. Mobile keeps a flat 10% top, 6% left
          // for optical balance against the jaso-break right gap.
          padding: `${
            isMobile
              ? Math.round(noteWidth * 0.10)
              : Math.round(noteWidth * 0.06) + 2
          }px ${Math.round(noteWidth * 0.04)}px ${Math.round(noteWidth * 0.06)}px ${Math.round(noteWidth * (isMobile ? 0.06 : 0.04))}px`,
          height: noteWidth,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: GRAFFITI_FONT_STACK,
            fontSize,
            lineHeight: 1.25,
            color: '#1a1208',
            letterSpacing: '0.005em',
            // Korean syllable-block break — splitting mid-word reads
            // fine in Hangul (자소 단위) and lets the small square
            // hold longer 50자평 without overflow ellipsis.
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
          }}
        >
          {text}
        </p>
      </div>

      {/* Masking-tape strip — real PNG with alpha cutout. Sits
          across the top edge of the note, tilted independently from
          the note's own rotation so the tape reads as hand-applied.
          Negative top so part of the tape extends above the paper
          edge, like a strip stuck on partly off the page. */}
      <img
        src={tapeSrc}
        alt=""
        aria-hidden
        className="absolute pointer-events-none select-none"
        style={{
          // ~60% of the tape sits above the paper edge so the bottom
          // 40% has visible contact with the paper. Text crossing
          // under the tape reads as natural (real Post-Its often
          // have writing under the tape), so we don't need to clear
          // the tape's footprint from the first line.
          top: -Math.round(tapeHeight * 0.60),
          left: noteWidth / 2 - tapeWidth / 2 + tapeOffset,
          width: tapeWidth,
          height: tapeHeight,
          transform: `rotate(${tapeRot}deg)`,
          transformOrigin: 'center center',
          // Drop max-width override from tailwind preflight so the
          // tape isn't capped by the parent's bounds.
          maxWidth: 'none',
        }}
      />
    </Link>
  );
}
