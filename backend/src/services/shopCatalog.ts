import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { shopRoundWhere } from '../lib/roundShop.js';
import { publicProduct } from './serialize.js';
import { districtList, districtNames, getSettingsCached } from './settings.js';
import { qpayPublicStatus } from './qpay.js';

const ORDER_PREVIEW = 8;
const READY_PAGE = 20;

const listProductSelect = {
  id: true,
  name: true,
  categoryId: true,
  images: true,
  category: { select: { id: true, name: true } },
  variants: {
    orderBy: { sortOrder: 'asc' as const },
    select: { kind: true, value: true, sortOrder: true },
  },
} satisfies Prisma.ProductSelect;

/** Жагсаалт — size chart, тайлбар, бүх зураг хэрэггүй. */
export function listRoundInclude(type?: 'order' | 'ready'): Prisma.ProductRoundInclude {
  return {
    product: { select: listProductSelect },
    optionPrices: {
      select: { kind: true, value: true, selections: true, sellPrice: true, costPrice: true },
    },
    ...(type === 'order'
      ? {}
      : { skuStocks: { select: { selections: true, stock: true } } }),
  };
}

export const detailRoundInclude = {
  product: {
    include: {
      category: true,
      variants: { orderBy: { sortOrder: 'asc' as const } },
      sizeChart: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  optionPrices: true,
  skuStocks: true,
} satisfies Prisma.ProductRoundInclude;

export async function listShopRounds(opts: {
  type?: 'order' | 'ready';
  category?: string;
  q?: string;
  page: number;
  pageSize: number;
  sort: 'new' | 'priceAsc' | 'priceDesc' | 'closing';
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const where: Prisma.ProductRoundWhereInput = {
    ...shopRoundWhere(now),
    product: {
      deletedAt: null,
      ...(opts.category ? { categoryId: opts.category } : {}),
      ...(opts.q
        ? {
            OR: [
              { name: { contains: opts.q, mode: 'insensitive' } },
              { description: { contains: opts.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    ...(opts.type === 'order' ? { closeAt: { not: null } } : {}),
    ...(opts.type === 'ready' ? { closeAt: null } : {}),
  };

  const orderBy: Prisma.ProductRoundOrderByWithRelationInput =
    opts.sort === 'priceAsc'
      ? { sellPrice: 'asc' }
      : opts.sort === 'priceDesc'
        ? { sellPrice: 'desc' }
        : opts.sort === 'closing'
          ? { closeAt: 'asc' }
          : { createdAt: 'desc' };

  const [total, rounds] = await Promise.all([
    prisma.productRound.count({ where }),
    prisma.productRound.findMany({
      where,
      orderBy,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: listRoundInclude(opts.type),
    }),
  ]);

  return {
    data: rounds.map((r) =>
      publicProductListItem(r as Parameters<typeof publicProduct>[0], now),
    ),
    meta: {
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pages: Math.ceil(total / opts.pageSize),
    },
  };
}

/** Карт дээр хэрэггүй талбарыг хасна — дэлгэрэнгүй `/products/:id` дээр бүрэн ирнэ. */
export function publicProductListItem(
  round: Parameters<typeof publicProduct>[0],
  now = new Date(),
) {
  const full = publicProduct(round, now);
  return {
    ...full,
    description: null,
    images: full.images.slice(0, 1),
    sizeChart: [] as typeof full.sizeChart,
    optionPrices: [] as typeof full.optionPrices,
    skuStocks: full.type === 'order' ? [] : full.skuStocks,
  };
}

export async function listShopCategories(now = new Date()) {
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      products: {
        some: {
          deletedAt: null,
          rounds: {
            some: {
              deletedAt: null,
              status: 'ACTIVE',
              OR: [{ closeAt: null }, { closeAt: { gt: now } }],
            },
          },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sortOrder: true },
  });
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    productCount: 1,
  }));
}

export async function listShopAds() {
  return prisma.ad.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, title: true, imageUrl: true, linkUrl: true },
  });
}

export async function publicStorePayload() {
  const settings = await getSettingsCached();
  return {
    storeName: settings.storeName,
    phone: settings.phone,
    address: settings.address,
    workHours: settings.workHours,
    facebookUrl: settings.facebookUrl,
    deliveryDistricts: districtNames(settings),
    deliveryFees: districtList(settings),
    bank: null,
    qpay: qpayPublicStatus(),
    unpaidCancelHours: settings.unpaidCancelHours,
    storageFreeDays: settings.storageFreeDays,
    storageFeePerDay: settings.storageFeePerDay,
  };
}

/** Нүүр — нэг хүсэлтээр store + ангилал + зар + хоёр жагсаалт. */
export async function shopHome(now = new Date()) {
  const [store, categories, ads, order, ready] = await Promise.all([
    publicStorePayload(),
    listShopCategories(now),
    listShopAds(),
    listShopRounds({
      type: 'order',
      page: 1,
      pageSize: ORDER_PREVIEW,
      sort: 'closing',
      now,
    }),
    listShopRounds({
      type: 'ready',
      page: 1,
      pageSize: READY_PAGE,
      sort: 'new',
      now,
    }),
  ]);
  return { store, categories, ads, order, ready };
}
