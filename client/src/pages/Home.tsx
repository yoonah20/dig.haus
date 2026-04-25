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
// Padding-top pushes the wall toward the vertical middle of the
// viewport on tall screens; with only two rails of LPs, the page
// otherwise stranded a lot of empty space below the wall.

export default function Home() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디깅하기',
    type: 'website',
  });

  return (
    <div
      className="flex-1 flex flex-col px-4 md:px-8 lg:px-12 xl:px-16"
      style={{ paddingTop: 'max(48px, calc((100vh - 460px) * 0.4))' }}
    >
      <section className="w-full max-w-[890px] mx-auto">
        <HomeWall />
      </section>
    </div>
  );
}
