import { resolveOptionPrice, type OptionPriceRow } from '../../lib/optionPrices.js';
import { normalizeSelections, optionsFromVariants, sizeColorFromSelections } from '../../lib/options.js';
import type { NewOrderLine } from './createWithCode.js';

type SnapshotRound = {
  id: string;
  productId: string;
  sellPrice: number;
  costPrice: number;
  optionPrices: OptionPriceRow[];
  product: {
    name: string;
    variants: { kind: string; value: string; sortOrder: number }[];
  };
};

/** Сонголт шалгасны дараа мөрийн snapshot — нийтийн checkout болон админ createOrder. */
export function snapshotOrderLines(
  items: {
    productId: string;
    qty: number;
    selections?: Record<string, string>;
    size?: string;
    color?: string;
  }[],
  byId: Map<string, SnapshotRound>,
): NewOrderLine[] {
  return items.map((item) => {
    const round = byId.get(item.productId)!;
    const options = optionsFromVariants(round.product.variants);
    const raw = normalizeSelections({
      selections: item.selections,
      size: item.size,
      color: item.color,
    });
    const selections = Object.fromEntries(options.map((opt) => [opt.name, raw[opt.name]!]));
    const { size, color } = sizeColorFromSelections(selections);
    const priced = resolveOptionPrice(round, round.optionPrices, selections);
    return {
      roundId: round.id,
      productId: round.productId,
      nameSnapshot: round.product.name,
      selections,
      size,
      color,
      qty: item.qty,
      unitPrice: priced.sellPrice,
      costPriceSnapshot: priced.costPrice,
      arriveFrom: null,
      arriveTo: null,
    };
  });
}
