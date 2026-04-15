import type { BuyInfo } from '../../types';
import PurchaseLinksPanel from '../PurchaseLinksPanel';

export default function BuySection({ buy, albumId }: { buy: BuyInfo; albumId: string }) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-white mb-6 font-serif">구하는 곳</h2>
      <PurchaseLinksPanel albumId={albumId} discogsFormats={buy.formats} />
    </section>
  );
}
