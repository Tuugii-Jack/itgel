import type {
  Batch,
  Category,
  Delivery,
  Order,
  OrderItem,
  Product,
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

/** Хэрэглэгчийн API — `costPrice` хэзээ ч энд гарахгүй. */
export function publicProduct(product: ProductWithRelations, now = new Date()) {
  const arrival = computeArrival(product.closeAt, product.leadMinDays, product.leadMaxDays, now);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    price: product.sellPrice,
    stock: product.stock,
    type: product.closeAt === null ? ('ready' as const) : ('order' as const),
    status: product.status,
    closeAt: toIso(product.closeAt),
    leadMinDays: product.leadMinDays,
    leadMaxDays: product.leadMaxDays,
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
    createdAt: product.createdAt.toISOString(),
  };
}

/** Админ — өртөг, ашгийн мэдээлэлтэй. */
export function adminProduct(product: ProductWithRelations, now = new Date()) {
  const arrival = computeArrival(product.closeAt, product.leadMinDays, product.leadMaxDays, now);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category ? { id: product.category.id, name: product.category.name } : undefined,
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    profit: product.sellPrice - product.costPrice,
    marginPercent: marginPercent(product.sellPrice, product.costPrice),
    stock: product.stock,
    type: product.closeAt === null ? ('ready' as const) : ('order' as const),
    status: product.status,
    closeAt: toIso(product.closeAt),
    leadMinDays: product.leadMinDays,
    leadMaxDays: product.leadMaxDays,
    arriveFrom: arrival.arriveFrom.toISOString(),
    arriveTo: arrival.arriveTo.toISOString(),
    images: product.images,
    sizes: (product.variants ?? []).filter((v) => v.kind === 'SIZE').map((v) => v.value),
    colors: (product.variants ?? []).filter((v) => v.kind === 'COLOR').map((v) => v.value),
    sizeChart: (product.sizeChart ?? []).map((row) => ({
      id: row.id,
      size: row.size,
      heightRange: row.heightRange,
      chestCm: row.chestCm,
    })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    deletedAt: toIso(product.deletedAt),
  };
}

export function publicOrderItem(item: OrderItem) {
  return {
    id: item.id,
    productId: item.productId,
    name: item.nameSnapshot,
    size: item.size,
    color: item.color,
    qty: item.qty,
    unitPrice: item.unitPrice,
    total: item.unitPrice * item.qty,
  };
}

export function adminOrderItem(item: OrderItem) {
  return {
    ...publicOrderItem(item),
    costPriceSnapshot: item.costPriceSnapshot,
    profit: (item.unitPrice - item.costPriceSnapshot) * item.qty,
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
