import { Link } from 'react-router-dom';
import { DigmanEmpty } from '../components/ui';
import { useDocumentHead } from '../hooks/useDocumentHead';

// Catch-all 404. The route table doesn't list every path the site
// could ever generate (admin sub-routes get added without sweeping
// every place that constructs URLs), and old share links from before
// renames occasionally land here. The page's job is to not be a dead
// end — mascot + a one-line acknowledgement + a route back to /.
//
// Copy keeps the crate-digging metaphor: "이 굴은 막혔어요" reads as
// the digger hitting a wall rather than the standard "not found"
// boilerplate, and the back link uses the same "다시 파러 가기"
// vocabulary as the rest of the surface.

export default function NotFound() {
  useDocumentHead({
    title: '굴이 막혔어요 · dig.haus',
    description: '이 경로는 존재하지 않아요. 홈으로 돌아가서 다시 디깅을 시작해보세요.',
    type: 'website',
  });

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center gap-5">
        <DigmanEmpty
          variant="dizzy"
          size="lg"
          message="이 굴은 막혔어요."
          hint="찾고 있던 페이지가 여기엔 없어요."
        />
        <Link
          to="/"
          className="inline-flex items-center text-[#e8a020] text-sm border border-[#e8a020]/60 hover:bg-[#e8a020] hover:text-black transition-colors px-3 py-1.5 rounded-full"
        >
          홈으로 돌아가서 다시 파기
        </Link>
      </div>
    </div>
  );
}
