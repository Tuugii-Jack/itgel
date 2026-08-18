import { Prisma, type Order } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { generateOrderCode } from '../lib/code.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { subtotalOf } from '../lib/money.js';
import { resolveOptionPrice } from '../lib/optionPrices.js';
import { comboLabel, findSku } from '../lib/skuStock.js';
import { normalizeSelections, optionsFromVariants, sizeColorFromSelections } from '../lib/options.js';
import { consumeReadyStock } from './readyStock.js';
import { changeOrderStatus } from './orders.js';
import { recordPayment } from './payments.js';

export interface CreateOrderItemInput {
  /** Тойргийн id (дэлгүүрийн productId). */
  productId: string;
  qty: number;
  selections?: Record<string, string>;
  size?: string;
  color?: string;
}

export interface CreateOrderInput {
  customerId: string;
  items: CreateOrderItemInput[];
  note?: string | null;
  actor: string;
  /** Админ: хаагдсан тойрог зөвшөөрөх. */
  allowClosed?: boolean;
  /** NEW (анхдагч) эсвэл CONFIRMED. */
  status?: 'NEW' | 'CONFIRMED';
  /** CONFIRMED үед бүрэн төлсөн гэж тэмдэглэх. */
  markPaid?: boolean;
  /** Хэрэглэгчийн нэрийг шинэчлэх. */
  customerName?: string;
  now?: Date;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const now = input.now ?? new Date();
  if (!input.items.length) throw badRequest('Дор хаяж нэг бараа сонгоно уу.');

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');

  const rounds = await prisma.productRound.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, deletedAt: null },
    include: { product: { include: { variants: true } }, optionPrices: true, skuStocks: true },
  });
  const byId = new Map(rounds.map((r) => [r.id, r]));

  for (const item of input.items) {
    const round = byId.get(item.productId);
    if (!round) throw badRequest(`Бараа олдсонгүй: ${item.productId}`);
    const name = round.product.name;

    if (round.product.deletedAt !== null) throw conflict(`"${name}" олдсонгүй.`);
    if (round.status !== 'ACTIVE' && !(input.allowClosed && round.status === 'CLOSED')) {
      throw conflict(`"${name}" одоогоор захиалах боломжгүй байна.`);
    }
    if (!input.allowClosed && round.closeAt && round.closeAt <= now) {
      throw conflict(`"${name}" барааны захиалга хаагдсан байна.`);
    }
    const options = optionsFromVariants(round.product.variants);
    const selections = normalizeSelections({
      selections: item.selections,
      size: item.size,
      color: item.color,
    });
    for (const opt of options) {
      const value = selections[opt.name];
      if (!value || !opt.values.includes(value)) {
        throw badRequest(`"${name}" барааны ${opt.name}-г сонгоно уу.`, {
          option: opt.name,
          values: opt.values,
        });
      }
    }
    if (round.closeAt === null) {
      const picked = Object.fromEntries(options.map((opt) => [opt.name, selections[opt.name]!]));
      if (round.skuStocks.length > 0) {
        const sku = findSku(round.skuStocks, picked);
        if (!sku) {
          throw conflict(`"${name}" барааны сонголтыг сонгоно уу.`);
        }
        if (sku.stock < item.qty) {
          throw conflict(
            `"${name}" — ${comboLabel(picked)} үлдэгдэл хүрэлцэхгүй байна (${sku.stock}).`,
          );
        }
      } else if (round.stock < item.qty) {
        throw conflict(`"${name}" барааны үлдэгдэл хүрэлцэхгүй байна (${round.stock}).`);
      }
    }
  }

  const items = input.items.map((item) => {
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

  const subtotal = subtotalOf(items);

  const order = await prisma.$transaction(async (tx) => {
    if (input.customerName && input.customerName !== customer.name) {
      await tx.customer.update({
        where: { id: input.customerId },
        data: { name: input.customerName },
      });
    }

    for (const mapped of items) {
      const round = byId.get(mapped.roundId)!;
      if (round.closeAt !== null) continue;
      await consumeReadyStock(tx, round, mapped.qty, mapped.selections);
    }

    const created = await createWithUniqueCode(tx, {
      customerId: input.customerId,
      subtotal,
      note: input.note ?? null,
      items,
    });

    await audit(
      {
        actor: input.actor,
        action: 'CREATE',
        entity: 'Order',
        entityId: created.id,
        after: { code: created.code, subtotal },
      },
      tx,
    );

    return created;
  });

  if (input.status === 'CONFIRMED') {
    if (input.markPaid) {
      await recordPayment({
        orderId: order.id,
        kind: 'PAYMENT',
        amount: subtotal,
        method: 'CASH',
        note: 'Админ гараар бүртгэсэн',
        actor: input.actor,
      });
    }
    await changeOrderStatus(order.id, 'CONFIRMED', {
      actor: input.actor,
      reason: 'Админ гараар оруулсан',
      now,
    });
  }

  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

type TxClient = Prisma.TransactionClient;

async function createWithUniqueCode(
  tx: TxClient,
  data: {
    customerId: string;
    subtotal: number;
    note: string | null;
    items: {
      roundId: string;
      productId: string;
      nameSnapshot: string;
      selections: Record<string, string>;
      size: string | null;
      color: string | null;
      qty: number;
      unitPrice: number;
      costPriceSnapshot: number;
      arriveFrom: Date | null;
      arriveTo: Date | null;
    }[];
  },
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await tx.order.create({
        data: {
          code: generateOrderCode(),
          customerId: data.customerId,
          subtotal: data.subtotal,
          paidAmount: 0,
          refundedAmount: 0,
          dueAmount: data.subtotal,
          note: data.note,
          items: { create: data.items },
        },
      });
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isDuplicate) throw error;
    }
  }
  throw conflict('Захиалгын код үүсгэж чадсангүй. Дахин оролдоно уу.');
}
