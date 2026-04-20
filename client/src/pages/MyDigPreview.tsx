import { useEffect, useState } from 'react';
import { Storefront } from '../components/MyDig/storefront/Storefront';

// Visual-only preview of the /my/:username storefront scene. Not
// wired to the mydig API — it renders with fake album covers so we
// can iterate on the record-shop look without touching the data
// layer. The real MyDig page (/my/:username) stays as the Phase 3a
// skeleton until the scene is final, then we swap the tier renders.
//
// The scene ports the Claude Design handoff (api.anthropic.com/
// v1/design/h/EJGHFcN0…) with three structural fixes applied:
//   · ShelfUnit lost its solid top board (was reading as a cabinet)
//   · ShelfUnit gained trestle-style end-panel legs
//   · Wall zone height is measured from the shelf's DOM position
//     so wall row 3 never bleeds onto the floor background
//
// Breakpoint is a single md cutoff (768px). The scene has two size
// modes — desktop uses 1200px design width, mobile uses 390px — and
// we pick based on viewport. No intermediate sizes; the LP-size
// constants are tuned for those two targets and anything in between
// just takes the nearest.
const DESKTOP_WIDTH = 1200;
const MOBILE_WIDTH = 390;
const MOBILE_BREAKPOINT = 768;

function useIsMobile(): boolean {
  const initial =
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
  const [isMobile, setIsMobile] = useState(initial);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

export default function MyDigPreview() {
  useEffect(() => {
    document.title = 'mydig · storefront preview | dig.haus';
  }, []);

  const isMobile = useIsMobile();
  const width = isMobile ? MOBILE_WIDTH : DESKTOP_WIDTH;

  return (
    // Deepened the outer bg past the rest of dig.haus's '#0a0703'
    // so the storefront frame reads as genuinely in a darker room.
    // This is the "dim street" the storefront window sits inside.
    <div className="flex-1 flex items-start justify-center py-10 bg-[#050301]">
      <div
        // Wooden window frame wrapping the scene. The padding is
        // the frame thickness — a dark brown band around the lit
        // interior. The outer box-shadow does two jobs: (1) a
        // deep ambient shadow falling below+around the frame, and
        // (2) a subtle warm glow bleeding outward, implying the
        // light inside is leaking through the glass onto the
        // surrounding darkness.
        style={{
          width,
          maxWidth: '100%',
          padding: 12,
          background: 'linear-gradient(180deg, #3a2614, #1a0f08)',
          boxShadow: `
            0 50px 140px -20px rgba(0,0,0,0.95),
            0 0 80px -10px rgba(255, 190, 120, 0.09),
            inset 0 1px 0 rgba(255, 218, 175, 0.12),
            inset 0 -1px 0 rgba(0,0,0,0.55)
          `,
          position: 'relative',
        }}
      >
        {/* Inner clip + reflection layer. overflow:hidden keeps any
            glass-effect overlays from leaking past the frame edge. */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <Storefront width={width} username="choedong" mobile={isMobile} />
          {/* Subtle diagonal glass-reflection streak. mixBlendMode:
              screen keeps it strictly additive — the covers and
              furniture can't be darkened by this overlay, only
              slightly brightened where the streak passes. Opacity
              is intentionally low (0.04): any stronger and it
              starts reading as fog rather than glass. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(115deg, transparent 38%, rgba(255, 230, 180, 0.05) 48%, transparent 58%)',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
              zIndex: 100,
            }}
          />
        </div>
      </div>
    </div>
  );
}
