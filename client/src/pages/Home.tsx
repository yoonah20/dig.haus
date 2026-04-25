import HomeWall from '../components/Home/HomeWall';
import { useDocumentHead } from '../hooks/useDocumentHead';

// Home page = dig.haus's own mydig. A 5-5-5 wood-rail wall of 15
// admin-curated picks plus the graffiti signature header above. The
// dense album-browsing grid that used to live here moved to /dig
// (DigPage). Right rail is reserved for the multi-channel "최근 방
// 문자 활동" feed in a follow-up; for now the layout is a single
// centred column so the wall reads as the page's only purpose.

export default function Home() {
  useDocumentHead({
    title: 'dig.haus',
    description:
      'No algorithms needed. Keep digging. — 운영자가 발굴한 vinyl wall + 디깅하기',
    type: 'website',
  });

  return (
    <div
      className="flex-1 flex flex-col px-4 md:px-8 lg:px-12 xl:px-16 pt-8"
      style={{ paddingTop: 'max(24px, calc((100vh - 900px) * 0.25))' }}
    >
      <section className="w-full max-w-[1120px] mx-auto">
        <HomeWall />
      </section>
    </div>
  );
}
