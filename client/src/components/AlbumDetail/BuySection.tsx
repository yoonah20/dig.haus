import type { BuyInfo } from '../../types';
import PurchaseLinksPanel from '../PurchaseLinksPanel';
import { SectionTitle } from '../ui';

export default function BuySection({ buy, albumId }: { buy: BuyInfo; albumId: string }) {
  return (
    <section>
      {/* Typeset SectionTitle here, while 리뷰 모음집 / 비앨추 use the
          tape variant. Two reasons: 구하는 곳 is the section that
          carries the most "transactional" weight on the page (links
          to outside shops), so a clean typeset heading reads more
          appropriate than a hand-placed label; and the page rhythm
          alternates tape ↔ typeset across the five sections so no
          one ornament dominates. */}
      <SectionTitle>구하는 곳</SectionTitle>
      <PurchaseLinksPanel albumId={albumId} discogsFormats={buy.formats} />
    </section>
  );
}
