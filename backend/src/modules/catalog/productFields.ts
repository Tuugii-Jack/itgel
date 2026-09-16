import { z } from 'zod';

/** Админ болон лизингийн барааны нийтлэг Zod — HTTP route-оос тусдаа. */

export const productStatus = z.enum([
  'ACTIVE',
  'HIDDEN',
  'DRAFT',
  'CLOSED',
  'SOLD_OUT',
  'ARCHIVED',
]);

export const sizeChartSchema = z.array(
  z.object({
    size: z.string().trim().min(1).max(20),
    heightRange: z.string().trim().max(40).default(''),
    chestCm: z.string().trim().max(40).default(''),
  }),
);

/** Загварын талбарууд — тойрог болгонд давтагдахгүй хэсэг. */
export const templateFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  categoryId: z.string().min(1),
  images: z.array(z.string().url()).max(12).default([]),
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        values: z.array(z.string().trim().min(1).max(40)).max(40),
      }),
    )
    .max(12)
    .default([]),
  /** Хуучин клиент — options руу хөрвүүлнэ. */
  sizes: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  colors: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  sizeChart: sizeChartSchema.max(30).default([]),
};

export const optionPriceRow = z
  .object({
    kind: z.string().trim().max(40).optional().default(''),
    value: z.string().trim().max(40).optional().default(''),
    selections: z
      .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40))
      .optional(),
    sellPrice: z.coerce.number().int().min(0).max(100_000_000),
    costPrice: z.coerce.number().int().min(0).max(100_000_000).default(0),
  })
  .refine(
    (row) =>
      (row.selections && Object.keys(row.selections).length > 0) ||
      (row.kind.trim().length > 0 && row.value.trim().length > 0),
    { message: 'Сонголтын үнэ — selections эсвэл kind+value.' },
  );

export const skuStockRow = z.object({
  selections: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)),
  stock: z.number().int().min(0).max(1_000_000),
});

export const roundFields = {
  costPrice: z.coerce.number().int().min(0),
  sellPrice: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).default(0),
  closeAt: z.coerce.date().nullable().optional(),
  leadMinDays: z.coerce.number().int().min(0).max(365).optional(),
  leadMaxDays: z.coerce.number().int().min(0).max(365).optional(),
  status: productStatus.default('DRAFT'),
  note: z.string().trim().max(300).optional(),
  optionPrices: z.array(optionPriceRow).max(400).optional(),
  skuStocks: z.array(skuStockRow).max(400).optional(),
};
