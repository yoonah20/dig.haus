import HomeWall from '../components/Home/HomeWall';
import { useDocumentHead } from '../hooks/useDocumentHead';

// Home page = dig.haus's own mydig. A 5-5 wood-rail wall of 10
// admin-curated picks. The dense album-browsing grid that used to live
// here moved to /dig (DigPage). Right rail is reserved for the
// multi-channel "최근 방문자 활동" feed in a follow-up; for now the
// layout is a single centred column so the wall reads as the page's
// only purpose.
//
// Width capped at 890px to match mydig's wall column — that keeps the
// 5-col layout's effective lpSize identical between the two surfaces
// (≈150px on desktop) so covers don't read bigger here than on mydig.
//
// Vertical layout: bottom-anchored, NOT viewport-percentage. Earlier
// iterations used paddingTop = (100vh − wallHeight) × ratio so the
// wall floated near the vertical middle, but that recomputes whenever
// the viewport height changes — when the user resized the window the
// rails wobbled up + down even though the LPs stayed at the same
// horizontal position, which made the page feel unstable to build on.
// Switching to flex justify-end + a constant paddingBottom pins the
// rails at a fixed distance from the viewport bottom regardless of
// height; tall screens just gain empty wallpaper above the wall (and
// that empty wallpaper is the storefront backdrop, which is the page's
// atmospheric register anyway).

export default function Home() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디깅하기',
    type: 'website',
  });

  return (
    <div className="flex-1 flex flex-col justify-end px-4 md:px-8 lg:px-12 xl:px-16 pt-12 pb-[100px] md:pb-[116px]">
      <section className="w-full max-w-[890px] mx-auto">
        <HomeWall />
      </section>
    </div>
  );
}
