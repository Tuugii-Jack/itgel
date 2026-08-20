import type {
  Batch,
  Category,
  Delivery,
  Order,
  OrderItem,
  Product,
  ProductRound,
  ProductVariant,
  RoundOptionPrice,
  RoundSkuStock,
  SizeChartRow,
} from '@prisma/client';
import { computeArrival, payoutDateForReturn, toIso } from '../lib/date.js';
import { effectiveRoundStatus } from '../lib/roundShop.js';
import { marginPercent } from '../lib/money.js';
import {
  adminOptionPrices,
  displayPriceRange,
  publicOptionPrices,
} from '../lib/optionPrices.js';
import {
  optionsFromVariants,
  selectionsOf,
  sizeColorCompat,
  sizeColorFromSelections,
} from '../lib/options.js';
import { BATCH_STAGE_LABEL, ORDER_STATUS_LABEL } from '../lib/orderStatus.js';
import { publicSkuStocks } from '../lib/skuStock.js';

export type ProductWithRelations = Product & {
  category?: Category | null;
  variants?: ProductVariant[];
  sizeChart?: SizeChartRow[];
};

/** Тойрог нь өөрийн загвартайгаа — дэлгүүрт харагдах нэгж. */
export type RoundWithProduct = ProductRound & {
  product: ProductWithRelations;
  /** Аль багцад зориулж гаргасан бэ — админ жагсаалтад холбоос болно. */
  batch?: Pick<Batch, 'id' | 'name' | 'stage'> | null;
  optionPrices?: Pick<
    RoundOptionPrice,
    'kind' | 'value' | 'sellPrice' | 'costPrice' | 'selections'
  >[];
  skuStocks?: Pick<RoundSkuStock, 'selections' | 'stock'>[];
};

/**
 * Хэрэглэгчийн API — `costPrice` хэзээ ч энд гарахгүй.
 *
 * `id` нь ТОЙРГИЙН id. Дэлгүүрийн зүгээс «бараа» гэдэг нь нэг тойрог гэсэн үг
 * тул захиалга шууд тухайн тойрог руу холбогдоно.
 */
export function publicProduct(round: RoundWithProduct, now = new Date()) {
  const { product } = round;
  const arrival = round.closeAt === null ? computeArrival(null, 0, 0, now) : null;
  const options = optionsFromVariants(product.variants);
  const range = displayPriceRange(round.sellPrice, round.optionPrices);
  return {
    id: round.id,
    productId: product.id,
    roundNo: round.roundNo,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    price: range.price,
    priceMax: range.priceMax,
    optionPrices: publicOptionPrices(round.optionPrices),
    skuStocks: publicSkuStocks(round.skuStocks),
    stock: round.stock,
    type: round.closeAt === null ? ('ready' as const) : ('order' as const),
    status: effectiveRoundStatus(round.status, round.closeAt, now),
    closeAt: toIso(round.closeAt),
    leadMinDays: round.leadMinDays,
    leadMaxDays: round.leadMaxDays,
    arriveFrom: arrival?.arriveFrom.toISOString() ?? '',
    arriveTo: arrival?.arriveTo.toISOString() ?? '',
    images: product.images,
    options,
    ...sizeColorCompat(options),
    sizeChart: (product.sizeChart ?? []).map((row) => ({
      size: row.size,
      heightRange: row.heightRange,
      chestCm: row.chestCm,
    })),
    createdAt: round.createdAt.toISOString(),
  };
}

/** Тойрог тус бүрийн захиалгын хураангуй — жагсаалтад шууд харуулна. */
export interface RoundStats {
  /** Хэдэн өөр хэрэглэгч авсан бэ. */
  customerCount: number;
  /** Нийт ширхэг (цуцлагдсаныг оруулахгүй). */
  qty: number;
}

/** Админ — өртөг, ашгийн мэдээлэлтэй нэг тойрог. */
export function adminRound(
  round: RoundWithProduct,
  now = new Date(),
  stats?: RoundStats,
) {
  return {
    ...publicProduct(round, now),
    costPrice: round.costPrice,
    // `price` нь хэрэглэгчийн нэр — админд `sellPrice` гэж бас өгнө.
    sellPrice: round.sellPrice,
    optionPrices: adminOptionPrices(round.optionPrices),
    skuStocks: publicSkuStocks(round.skuStocks),
    profit: round.sellPrice - round.costPrice,
    marginPercent: marginPercent(round.sellPrice, round.costPrice),
    note: round.note,
    batchId: round.batchId,
    batch: round.batch
      ? {
          id: round.batch.id,
          name: round.batch.name,
          stage: round.batch.stage,
          stageLabel: BATCH_STAGE_LABEL[round.batch.stage],
        }
      : null,
    /** Хэн хэн авсныг задалж харахгүйгээр тоог нь мэдэх. */
    customerCount: stats?.customerCount ?? 0,
    orderedQty: stats?.qty ?? 0,
    updatedAt: round.updatedAt.toISOString(),
    deletedAt: toIso(round.deletedAt),
  };
}

/**
 * Админы барааны жагсаалт — загвар ба түүний тойргууд.
 * Тойргийг шинэ дараалалаар нь өгнө: хамгийн сүүлийнх эхэнд.
 */
export function adminProduct(
  product: ProductWithRelations & {
    rounds?: (ProductRound & { batch?: Pick<Batch, 'id' | 'name' | 'stage'> | null })[];
  },
  now = new Date(),
  /** Тойргийн id → захиалгын хураангуй. Нэг асуулгаар бэлдэж дамжуулна. */
  statsByRound?: Map<string, RoundStats>,
) {
  const rounds = (product.rounds ?? []).map((round) =>
    adminRound({ ...round, product }, now, statsByRound?.get(round.id)),
  );
  const options = optionsFromVariants(product.variants);

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    images: product.images,
    options,
    ...sizeColorCompat(options),
    sizeChart: (product.sizeChart ?? []).map((row) => ({
      id: row.id,
      size: row.size,
      heightRange: row.heightRange,
      chestCm: row.chestCm,
    })),
    rounds,
    roundCount: rounds.length,
    /** Одоо зарагдаж буй тойрог — жагсаалтад үнэ, төлвийг харуулахад. */
    currentRound:
      rounds.find((r) => r.status === 'ACTIVE') ??
      rounds[0] ??
      null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    deletedAt: toIso(product.deletedAt),
  };
}

export function publicOrderItem(
  item: OrderItem & { round?: { cargoFee: number } | null },
  paidDays?: ReadonlySet<string>,
) {
  const selections = (() => {
    const fromJson = selectionsOf(item.selections);
    if (Object.keys(fromJson).length > 0) return fromJson;
    return normalizeLegacy(item.size, item.color);
  })();
  const { size, color } = sizeColorFromSelections(selections);
  const arrived = item.arrivedAt !== null || item.arrivedQty >= item.qty;
  const handedOver = item.handedOverAt !== null;
  const itemStatus = item.cancelledAt
    ? ('cancelled' as const)
    : handedOver
      ? ('handed_over' as const)
      : arrived
        ? ('arrived' as const)
        : ('waiting' as const);
  const refundPayoutOn = item.cancelledAt ? payoutDateForReturn(item.cancelledAt) : null;
  return {
    id: item.id,
    cancelled: item.cancelledAt !== null,
    productId: item.productId,
    roundId: item.roundId,
    name: item.nameSnapshot,
    selections,
    size: size ?? item.size,
    color: color ?? item.color,
    qty: item.qty,
    arrivedQty: item.arrivedQty,
    unitPrice: item.unitPrice,
    total: item.unitPrice * item.qty,
    cargoFee: item.qty * (item.round?.cargoFee ?? 0),
    /** Захиалах үед амласан огноо — тойрог дахин гарсан ч хөдлөхгүй. */
    arriveFrom: toIso(item.arriveFrom),
    arriveTo: toIso(item.arriveTo),
    arrivedAt: toIso(item.arrivedAt),
    cancelledAt: toIso(item.cancelledAt),
    handedOverAt: toIso(item.handedOverAt),
    fulfilment: item.fulfilment,
    /** waiting | arrived | handed_over | cancelled */
    itemStatus,
    /** Сар бүрийн 10/20/30 — цуцлагдсан мөрийн буцаалт аль өдөрт орох. */
    refundPayoutOn,
    /** Админ данс руу шилжүүлснийг баталгаажуулсан. */
    refundPaid: Boolean(refundPayoutOn && paidDays?.has(refundPayoutOn)),
  };
}

/** Захиалгын буцаалтын 10/20/30 өдрүүд (давхардалгүй, өсөхөөр). */
export function refundPayoutDatesFor(input: {
  items: { cancelledAt: Date | null }[];
  refunds?: { createdAt: Date }[];
}): string[] {
  return [
    ...new Set([
      ...input.items
        .filter((item) => item.cancelledAt)
        .map((item) => payoutDateForReturn(item.cancelledAt!)),
      ...(input.refunds ?? []).map((row) => payoutDateForReturn(row.createdAt)),
    ]),
  ].sort();
}

/** Захиалгын хамгийн ойрын буцаалтын 10/20/30. */
export function refundPayoutOnFor(input: {
  items: { cancelledAt: Date | null }[];
  refunds?: { createdAt: Date }[];
}): string | null {
  return refundPayoutDatesFor(input)[0] ?? null;
}

/** Төлөгдөөгүй хамгийн ойрын өдөр; бүгд орсон бол сүүлийн өдөр + paid. */
export function refundPayoutStatus(
  dates: string[],
  paidDays: ReadonlySet<string>,
): { refundPayoutOn: string | null; refundPaid: boolean } {
  if (dates.length === 0) return { refundPayoutOn: null, refundPaid: false };
  const unpaid = dates.filter((day) => !paidDays.has(day));
  if (unpaid.length === 0) {
    return { refundPayoutOn: dates[dates.length - 1]!, refundPaid: true };
  }
  return { refundPayoutOn: unpaid[0]!, refundPaid: false };
}

function normalizeLegacy(size: string | null, color: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (size) out['Хэмжээ'] = size;
  if (color) out['Өнгө'] = color;
  return out;
}

export function adminOrderItem(item: OrderItem) {
  const cancelled = item.cancelledAt !== null;
  return {
    ...publicOrderItem(item),
    costPriceSnapshot: item.costPriceSnapshot,
    // Цуцлагдсан мөр ашиг үүсгэхгүй.
    profit: cancelled ? 0 : (item.unitPrice - item.costPriceSnapshot) * item.qty,
    cancelled,
    cancelledAt: toIso(item.cancelledAt),
    cancelReason: item.cancelReason,
  };
}

export function publicDelivery(delivery: Delivery | null | undefined) {
  if (!delivery) return null;
  return {
    scheduledDay: delivery.scheduledDay.toISOString(),
    district: delivery.district,
    khoroo: delivery.khoroo,
    addressText: delivery.addressText,
    fee: delivery.fee,
    status: delivery.status,
    courierName: delivery.courierName,
  };
}

export function batchSummary(batch: Batch | null | undefined) {
  if (!batch) return null;
  return {
    id: batch.id,
    name: batch.name,
    stage: batch.stage,
    stageLabel: BATCH_STAGE_LABEL[batch.stage],
    deadline: toIso(batch.deadline),
    closedAt: toIso(batch.closedAt),
    weightKg: batch.weightKg,
    etaFrom: toIso(batch.etaFrom),
    etaTo: toIso(batch.etaTo),
  };
}

export const orderStatusLabel = (status: Order['status']) => ORDER_STATUS_LABEL[status];
