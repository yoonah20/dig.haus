import type { BuyInfo } from '../../types';
import PurchaseLinksPanel from '../PurchaseLinksPanel';
import { SectionTitle } from '../ui';

export default function BuySection({ buy, albumId }: { buy: BuyInfo; albumId: string }) {
  return (
    <section>
      <SectionTitle variant="tape">구하는 곳</SectionTitle>
      <PurchaseLinksPanel albumId={albumId} discogsFormats={buy.formats} />
    </section>
  );
}
