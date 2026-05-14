import type { BuyInfo } from '../../types';
import PurchaseLinksPanel from '../PurchaseLinksPanel';

export default function BuySection({ buy, albumId }: { buy: BuyInfo; albumId: string }) {
  return (
    <section>
      <PurchaseLinksPanel albumId={albumId} discogsFormats={buy.formats} />
    </section>
  );
}
