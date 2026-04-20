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
    <div className="flex-1 flex items-start justify-center py-6 bg-[#0a0703]">
      {/* Outer dark chrome (rest of site) frames the storefront so
          it reads as "looking into a lit shop from a dim street."
          The storefront itself is responsible for its own bg / scene. */}
      <div
        style={{
          width,
          maxWidth: '100%',
          boxShadow:
            '0 30px 80px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(60, 40, 20, 0.4)',
        }}
      >
        <Storefront width={width} username="choedong" mobile={isMobile} />
      </div>
    </div>
  );
}
