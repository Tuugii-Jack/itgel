import type {
  Batch,
  Category,
  Delivery,
  Order,
  OrderItem,
  Product,
  ProductRound,
  ProductVariant,
  SizeChartRow,
} from '@prisma/client';
import { computeArrival, toIso } from '../lib/date.js';
import { marginPercent } from '../lib/money.js';
import { BATCH_STAGE_LABEL, ORDER_STATUS_LABEL } from '../lib/orderStatus.js';

export type ProductWithRelations = Product & {
  category?: Category | null;
  variants?: ProductVariant[];
  sizeChart?: SizeChartRow[];
};

/** Тойрог нь өөрийн загвартайгаа — дэлгүүрт харагдах нэгж. */
export type RoundWithProduct = ProductRound & {
  product: ProductWithRelations;
};

/**
 * Хэрэглэгчийн API — `costPrice` хэзээ ч энд гарахгүй.
 *
 * `id` нь ТОЙРГИЙН id. Дэлгүүрийн зүгээс «бараа» гэдэг нь нэг тойрог гэсэн үг
 * тул захиалга шууд тухайн тойрог руу холбогдоно.
 */
export function publicProduct(round: RoundWithProduct, now = new Date()) {
  const { product } = round;
  const arrival = computeArrival(round.closeAt, round.leadMinDays, round.leadMaxDays, now);
  return {
    id: round.id,
    productId: product.id,
    roundNo: round.roundNo,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    price: round.sellPrice,
    stock: round.stock,
    type: round.closeAt === null ? ('ready' as const) : ('order' as const),
    status: round.status,
    closeAt: toIso(round.closeAt),
    leadMinDays: round.leadMinDays,
    leadMaxDays: round.leadMaxDays,
    arriveFrom: arrival.arriveFrom.toISOString(),
    arriveTo: arrival.arriveTo.toISOString(),
    images: product.images,
    sizes: (product.variants ?? []).filter((v) => v.kind === 'SIZE').map((v) => v.value),
    colors: (product.variants ?? []).filter((v) => v.kind === 'COLOR').map((v) => v.value),
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
    profit: round.sellPrice - round.costPrice,
    marginPercent: marginPercent(round.sellPrice, round.costPrice),
    note: round.note,
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
  product: ProductWithRelations & { rounds?: ProductRound[] },
  now = new Date(),
  /** Тойргийн id → захиалгын хураангуй. Нэг асуулгаар бэлдэж дамжуулна. */
  statsByRound?: Map<string, RoundStats>,
) {
  const rounds = (product.rounds ?? []).map((round) =>
    adminRound({ ...round, product }, now, statsByRound?.get(round.id)),
  );

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    images: product.images,
    sizes: (product.variants ?? []).filter((v) => v.kind === 'SIZE').map((v) => v.value),
    colors: (product.variants ?? []).filter((v) => v.kind === 'COLOR').map((v) => v.value),
    sizeChart: (product.sizeChart ?? []).map((row) => ({
      id: row.id,
      size: row.size,
      heightRange: row.heightRange,
      chestCm: row.chestCm,
    })),
    rounds,
    roundCount: rounds.length,
    /** Одоо зарагдаж буй тойрог — жагсаалтад үнэ, төлвийг харуулахад. */
    currentRound: rounds.find((r) => r.status === 'ACTIVE') ?? rounds[0] ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    deletedAt: toIso(product.deletedAt),
  };
}

export function publicOrderItem(item: OrderItem) {
  return {
    id: item.id,
    cancelled: item.cancelledAt !== null,
    productId: item.productId,
    roundId: item.roundId,
    name: item.nameSnapshot,
    size: item.size,
    color: item.color,
    qty: item.qty,
    unitPrice: item.unitPrice,
    total: item.unitPrice * item.qty,
    /** Захиалах үед амласан огноо — тойрог дахин гарсан ч хөдлөхгүй. */
    arriveFrom: toIso(item.arriveFrom),
    arriveTo: toIso(item.arriveTo),
  };
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
    closedAt: toIso(batch.closedAt),
    weightKg: batch.weightKg,
    etaFrom: toIso(batch.etaFrom),
    etaTo: toIso(batch.etaTo),
  };
}

export const orderStatusLabel = (status: Order['status']) => ORDER_STATUS_LABEL[status];
