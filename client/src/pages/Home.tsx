import HomeWall from '../components/Home/HomeWall';
import { useDocumentHead } from '../hooks/useDocumentHead';

// Home page = dig.haus's own mydig. A 5-5 wood-rail wall of 10
// admin-curated picks. The dense album-browsing grid that used to live
// here moved to /dig (DigPage). Right rail is reserved for the
// multi-channel "최근 방문자 활동" feed in a follow-up; for now the
// layout is a single centred column so the wall reads as the page's
// only purpose.
//
// Width capped at 960px (mydig column is 890). With 5 cols and the
// overhang/gap math, 960 yields ~165px LPs, ~10% bigger than mydig's
// effective ~150px. Earlier passes pushed +20% but felt too dominant
// against the storefront backdrop; +10% holds the visual hierarchy
// while still distinguishing home from mydig. HomeWall cap raised
// to 180 in lockstep so the new fit is reachable.
//
// Vertical layout: flex justify-center for true vertical centring.
// Backdrop lives in App.tsx (absolute inset-0 of the App root) and
// stays pinned to the viewport's bottom-centre. Earlier passes added
// a maxHeight cap here to stop the wall drifting upward on tall
// viewports, but that introduced backdrop-vs-content drift on huge
// screens, so the cap got dropped — wall floats with the viewport
// centre at the price of looking sparse on very tall displays.

export default function Home() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디깅하기',
    type: 'website',
  });

  return (
    <div className="flex-1 flex flex-col justify-center px-4 md:px-8 lg:px-12 xl:px-16 pt-12 pb-12">
      <section className="w-full max-w-[960px] mx-auto">
        <HomeWall />
      </section>
    </div>
  );
}
