import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { generateOrderCode } from '../../lib/code.js';
import { computeArrival, parseUbDay, startOfUbDay } from '../../lib/date.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { subtotalOf } from '../../lib/money.js';
import { ipRateLimit } from '../../lib/rateLimit.js';
import { requireCustomer, actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import { buildTimeline } from '../../services/orders.js';
import { batchSummary, publicDelivery, publicOrderItem, orderStatusLabel } from '../../services/serialize.js';
import { computeTotals, paymentState, recalcOrderTotals } from '../../services/money.js';
import { deliveryFeeFor, getSettings } from '../../services/settings.js';
import { syncOrderStorageFee } from '../../services/storageFee.js';
import { sms, smsTemplates } from '../../services/sms.js';
import { claimDeliverySlot } from '../../services/delivery.js';
import {
  normalizeSelections,
  optionsFromVariants,
  sizeColorFromSelections,
} from '../../lib/options.js';

export const publicOrdersRouter = Router();

const createBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.coerce.number().int().min(1).max(50),
        selections: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)).optional(),
        /** Хуучин клиент. */
        size: z.string().trim().max(40).optional(),
        color: z.string().trim().max(40).optional(),
      }),
    )
    .min(1, 'Дор хаяж нэг бараа сонгоно уу.')
    .max(30),
});

/** POST /api/orders — нэвтэрсэн хэрэглэгч. IP-ээр 10 минутад 10 захиалга. */
publicOrdersRouter.post(
  '/',
  requireCustomer,
  ipRateLimit(10, 10 * 60 * 1000),
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const customerId = req.auth!.sub;
    const now = new Date();

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');
    if (!customer.emailVerifiedAt) throw badRequest('И-мэйлээ баталгаажуулсны дараа захиална уу.');

    // `productId` нь дэлгүүрийн зүгээс ТОЙРГИЙН id — /products тэрийг буцаадаг.
    const rounds = await prisma.productRound.findMany({
      where: { id: { in: body.items.map((i) => i.productId) }, deletedAt: null },
      include: { product: { include: { variants: true } } },
    });
    const byId = new Map(rounds.map((r) => [r.id, r]));

    // Захиалахын өмнө бүх мөрийг шалгана — хэсэгчилсэн захиалга үүсгэхгүй.
    for (const item of body.items) {
      const round = byId.get(item.productId);
      if (!round) throw badRequest(`Бараа олдсонгүй: ${item.productId}`);
      const name = round.product.name;

      if (round.product.deletedAt !== null) throw conflict(`"${name}" олдсонгүй.`);
      if (round.status !== 'ACTIVE') {
        throw conflict(`"${name}" одоогоор захиалах боломжгүй байна.`);
      }
      if (round.closeAt && round.closeAt <= now) {
        throw conflict(`"${name}" барааны захиалга хаагдсан байна.`);
      }
      if (round.closeAt === null && round.stock < item.qty) {
        throw conflict(`"${name}" барааны үлдэгдэл хүрэлцэхгүй байна (${round.stock}).`);
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
    }

    const items = body.items.map((item) => {
      const round = byId.get(item.productId)!;
      const arrival = computeArrival(round.closeAt, round.leadMinDays, round.leadMaxDays, now);
      const options = optionsFromVariants(round.product.variants);
      const raw = normalizeSelections({
        selections: item.selections,
        size: item.size,
        color: item.color,
      });
      const selections = Object.fromEntries(
        options.map((opt) => [opt.name, raw[opt.name]!]),
      );
      const { size, color } = sizeColorFromSelections(selections);
      return {
        roundId: round.id,
        productId: round.productId,
        nameSnapshot: round.product.name,
        selections,
        size,
        color,
        qty: item.qty,
        unitPrice: round.sellPrice,
        costPriceSnapshot: round.costPrice,
        arriveFrom: round.closeAt === null ? null : arrival.arriveFrom,
        arriveTo: round.closeAt === null ? null : arrival.arriveTo,
      };
    });

    const subtotal = subtotalOf(items);

    const order = await prisma.$transaction(async (tx) => {
      if (body.name && body.name !== customer.name) {
        await tx.customer.update({ where: { id: customerId }, data: { name: body.name } });
      }

      for (const item of body.items) {
        const round = byId.get(item.productId)!;
        if (round.closeAt !== null) continue;

        const updated = await tx.productRound.updateMany({
          where: { id: round.id, stock: { gte: item.qty } },
          data: { stock: { decrement: item.qty } },
        });
        if (updated.count === 0) {
          throw conflict(`"${round.product.name}" барааны үлдэгдэл хүрэлцэхгүй байна.`);
        }

        const after = await tx.productRound.findUniqueOrThrow({ where: { id: round.id } });
        if (after.stock === 0) {
          await tx.productRound.update({ where: { id: round.id }, data: { status: 'SOLD_OUT' } });
        }
      }

      const created = await createWithUniqueCode(tx, {
        customerId,
        subtotal,
        note: body.note ?? null,
        items,
      });

      await audit(
        {
          actor: actorOf(req),
          action: 'CREATE',
          entity: 'Order',
          entityId: created.id,
          after: { code: created.code, subtotal },
        },
        tx,
      );

      return created;
    });

    if (customer.phone) {
      void sms
        .send({ phone: customer.phone, text: smsTemplates.orderCreated(order.code, subtotal) })
        .then((r) => {
          if (!r.ok) console.warn(`[sms] ${order.code} захиалгын мэдэгдэл илгээгдсэнгүй: ${r.error}`);
        })
        .catch((e) => console.warn(`[sms] ${order.code} захиалгын мэдэгдэл алдаа:`, e));
    }

    res.status(201).json({
      data: {
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        subtotal,
        dueAmount: subtotal,
        createdAt: order.createdAt.toISOString(),
      },
    });
  }),
);

type TxClient = Prisma.TransactionClient;

interface NewOrderData {
  customerId: string;
  subtotal: number;
  note: string | null;
  items: {
    roundId: string;
    productId: string;
    nameSnapshot: string;
    size: string | null;
    color: string | null;
    qty: number;
    unitPrice: number;
    costPriceSnapshot: number;
    arriveFrom: Date | null;
    arriveTo: Date | null;
  }[];
}

/** `PH-XXXXXX` код давхардвал дахин оролдоно. */
async function createWithUniqueCode(tx: TxClient, data: NewOrderData) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await tx.order.create({
        data: {
          code: generateOrderCode(),
          customerId: data.customerId,
          subtotal: data.subtotal,
          // Мөнгө ороогүй: төлбөр нь дэвтэрт бүртгэгдэх үед л тоологдоно.
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

/** GET /api/orders/:code — публик хяналт, timeline-тай. */
publicOrdersRouter.get(
  '/:code',
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null },
      include: {
        items: { include: { product: true } },
        batch: true,
        delivery: true,
        customer: true,
      },
    });

    if (!order) throw notFound('Захиалга олдсонгүй.');

    const storage = await syncOrderStorageFee(order.id);
    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: { include: { product: true } },
        batch: true,
        delivery: true,
        customer: true,
      },
    });

    res.json({
      data: {
        code: fresh.code,
        status: fresh.status,
        statusLabel: orderStatusLabel(fresh.status),
        subtotal: fresh.subtotal,
        deliveryFee: fresh.deliveryFee,
        storageFee: fresh.storageFee,
        storage: {
          freeDays: storage.freeDays,
          feePerDay: storage.feePerDay,
          freeDaysLeft: storage.freeDaysLeft,
          billableItemDays: storage.billableItemDays,
          fee: storage.fee,
        },
        paidAmount: fresh.paidAmount,
        refundedAmount: fresh.refundedAmount,
        dueAmount: fresh.dueAmount,
        paymentState: paymentState(computeTotals(fresh)),
        paymentClaimedAt: fresh.paymentClaimedAt?.toISOString() ?? null,
        fulfilment: fresh.fulfilment,
        createdAt: fresh.createdAt.toISOString(),
        customer: {
          name: fresh.customer.name,
          phone: maskPhone(fresh.customer.phone),
          email: fresh.customer.email,
        },
        items: fresh.items.map(publicOrderItem),
        batch: batchSummary(fresh.batch),
        delivery: publicDelivery(fresh.delivery),
        timeline: buildTimeline(fresh),
        canChooseFulfilment: fresh.status === 'ARRIVED' && fresh.fulfilment === null,
      },
    });
  }),
);

/**
 * POST /api/orders/:code/payment-claim — "мөнгө шилжүүлсэн" гэж мэдэгдэх.
 *
 * Энэ нь төлбөр орсны БАТАЛГАА БИШ. Зөвхөн админд "эхэнд шалгаарай" гэж
 * дохио өгч, автомат цуцлалтаас хамгаална. Мөнгө нь дэвтэрт бүртгэгдэх үед л
 * тоологдоно. Хүчээр дарахаас сэргийлж IP-ээр хязгаарлав.
 */
publicOrdersRouter.post(
  '/:code/payment-claim',
  ipRateLimit(20, 10 * 60 * 1000),
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({ where: { code, deletedAt: null } });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    if (order.status === 'CANCELLED') {
      throw conflict('Цуцлагдсан захиалга дээр төлбөр мэдэгдэх боломжгүй.');
    }
    if (order.dueAmount <= 0) {
      throw conflict('Энэ захиалгын төлбөр аль хэдийн бүрэн орсон байна.');
    }

    // Давхар дарахад анхны огноог хадгална — дарааллын шударга байдлын төлөө.
    if (!order.paymentClaimedAt) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentClaimedAt: new Date() },
      });
      await audit({
        actor: `customer:${order.customerId}`,
        action: 'PAYMENT_CLAIM',
        entity: 'Order',
        entityId: order.id,
        after: { code: order.code, dueAmount: order.dueAmount },
      });
    }

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    res.json({
      data: {
        code: updated.code,
        paymentClaimedAt: updated.paymentClaimedAt?.toISOString() ?? null,
      },
    });
  }),
);

const fulfilmentBody = z
  .object({
    type: z.enum(['PICKUP', 'DELIVERY']),
    district: z.string().trim().min(1).max(60).optional(),
    khoroo: z.string().trim().max(30).optional(),
    address: z.string().trim().max(300).optional(),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Огноо YYYY-MM-DD хэлбэртэй байна.')
      .optional(),
  })
  .refine((v) => v.type === 'PICKUP' || (v.district && v.day), {
    message: 'Хүргэлтэд дүүрэг болон өдөр заавал шаардлагатай.',
  });

/** POST /api/orders/:code/fulfilment — бараа ирсний дараа авах хэлбэрээ сонгоно. */
publicOrdersRouter.post(
  '/:code/fulfilment',
  validate({ params: z.object({ code: z.string().min(3).max(20) }), body: fulfilmentBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof fulfilmentBody>;
    const code = param(req, 'code').toUpperCase();

    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null },
      include: { delivery: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    if (order.status !== 'ARRIVED') {
      throw conflict('Бараа агуулахад ирсний дараа авах хэлбэрээ сонгоно.');
    }
    if (order.fulfilment !== null) {
      throw conflict('Авах хэлбэр аль хэдийн сонгогдсон байна.');
    }

    const settings = await getSettings();

    const updated = await prisma.$transaction(async (tx) => {
      if (body.type === 'PICKUP') {
        await tx.order.update({
          where: { id: order.id },
          data: { fulfilment: 'PICKUP', deliveryFee: 0 },
        });
        // Хураамж өөрчлөгдсөн тул дүнг дахин бодуулна.
        await recalcOrderTotals(tx, order.id);
        return tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { delivery: true },
        });
      }

      const day = startOfUbDay(parseUbDay(body.day!));
      const fee = deliveryFeeFor(settings, body.district!);

      // Сул зайг атомикаар эзэлнэ — хоёр хүн сүүлийн зайг зэрэг авахаас сэргийлнэ.
      await claimDeliverySlot(tx, day, settings.deliveryDailyLimit);

      await tx.delivery.create({
        data: {
          orderId: order.id,
          scheduledDay: day,
          district: body.district!,
          khoroo: body.khoroo ?? null,
          addressText: body.address ?? null,
          fee,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          fulfilment: 'DELIVERY',
          deliveryFee: fee,
        },
      });
      await recalcOrderTotals(tx, order.id);

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { delivery: true },
      });
    });

    await audit({
      actor: `customer:${order.customerId}`,
      action: 'FULFILMENT',
      entity: 'Order',
      entityId: order.id,
      after: { fulfilment: body.type, district: body.district, day: body.day },
    });

    res.json({
      data: {
        code: updated.code,
        fulfilment: updated.fulfilment,
        deliveryFee: updated.deliveryFee,
        dueAmount: updated.dueAmount,
        delivery: publicDelivery(updated.delivery),
      },
    });
  }),
);

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? phone : `${phone.slice(0, 4)}****`;
}
