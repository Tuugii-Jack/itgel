import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { generateOrderCode, normalizePhone, PHONE_RE } from '../../lib/code.js';
import { parseUbDay, startOfUbDay } from '../../lib/date.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { subtotalOf } from '../../lib/money.js';
import { ipRateLimit } from '../../lib/rateLimit.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import { buildTimeline } from '../../services/orders.js';
import { batchSummary, publicDelivery, publicOrderItem, orderStatusLabel } from '../../services/serialize.js';
import { computeTotals, paymentState, recalcOrderTotals } from '../../services/money.js';
import { deliveryFeeFor, getSettings } from '../../services/settings.js';
import { sms, smsTemplates } from '../../services/sms.js';
import { claimDeliverySlot } from '../../services/delivery.js';

export const publicOrdersRouter = Router();

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((v) => PHONE_RE.test(v), 'Утасны дугаар буруу байна (8 орон).');

const createBody = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.coerce.number().int().min(1).max(50),
        size: z.string().trim().max(40).optional(),
        color: z.string().trim().max(40).optional(),
      }),
    )
    .min(1, 'Дор хаяж нэг бараа сонгоно уу.')
    .max(30),
});

/** POST /api/orders — IP-ээр 10 минутад 10 захиалга. */
publicOrdersRouter.post(
  '/',
  ipRateLimit(10, 10 * 60 * 1000),
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const settings = await getSettings();
    const now = new Date();

    const products = await prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) }, deletedAt: null },
      include: { variants: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Захиалахын өмнө бүх мөрийг шалгана — хэсэгчилсэн захиалга үүсгэхгүй.
    for (const item of body.items) {
      const product = byId.get(item.productId);
      if (!product) throw badRequest(`Бараа олдсонгүй: ${item.productId}`);
      if (product.status !== 'ACTIVE') {
        throw conflict(`"${product.name}" одоогоор захиалах боломжгүй байна.`);
      }
      if (product.closeAt && product.closeAt <= now) {
        throw conflict(`"${product.name}" барааны захиалга хаагдсан байна.`);
      }
      if (product.closeAt === null && product.stock < item.qty) {
        throw conflict(`"${product.name}" барааны үлдэгдэл хүрэлцэхгүй байна (${product.stock}).`);
      }
      const sizes = product.variants.filter((v) => v.kind === 'SIZE').map((v) => v.value);
      const colors = product.variants.filter((v) => v.kind === 'COLOR').map((v) => v.value);
      if (sizes.length > 0 && (!item.size || !sizes.includes(item.size))) {
        throw badRequest(`"${product.name}" барааны хэмжээг сонгоно уу.`, { sizes });
      }
      if (colors.length > 0 && (!item.color || !colors.includes(item.color))) {
        throw badRequest(`"${product.name}" барааны өнгийг сонгоно уу.`, { colors });
      }
    }

    const items = body.items.map((item) => {
      const product = byId.get(item.productId)!;
      return {
        productId: product.id,
        nameSnapshot: product.name,
        size: item.size ?? null,
        color: item.color ?? null,
        qty: item.qty,
        unitPrice: product.sellPrice,
        costPriceSnapshot: product.costPrice,
      };
    });

    // Төлбөр 100% — захиалга өгөхөд бүтнээр шилжүүлнэ. Мөнгө хараахан
    // ороогүй тул `paidAmount` нь 0; админ шалгаад дэвтэрт бүртгэнэ.
    const subtotal = subtotalOf(items);

    const order = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { phone: body.phone },
        create: { phone: body.phone, name: body.name ?? null },
        update: body.name ? { name: body.name } : {},
      });

      // Бэлэн барааны үлдэгдлийг хасна.
      for (const item of body.items) {
        const product = byId.get(item.productId)!;
        if (product.closeAt !== null) continue;

        const updated = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.qty } },
          data: { stock: { decrement: item.qty } },
        });
        if (updated.count === 0) {
          throw conflict(`"${product.name}" барааны үлдэгдэл хүрэлцэхгүй байна.`);
        }

        const after = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
        if (after.stock === 0) {
          await tx.product.update({ where: { id: product.id }, data: { status: 'SOLD_OUT' } });
        }
      }

      const created = await createWithUniqueCode(tx, {
        customerId: customer.id,
        subtotal,
        note: body.note ?? null,
        items,
      });

      await audit(
        {
          actor: `customer:${customer.id}`,
          action: 'CREATE',
          entity: 'Order',
          entityId: created.id,
          after: { code: created.code, subtotal },
        },
        tx,
      );

      return created;
    });

    await sms.send({ phone: body.phone, text: smsTemplates.orderCreated(order.code, subtotal) });

    res.status(201).json({
      data: {
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        subtotal,
        /** Шилжүүлэх дүн — бараа бүтнээрээ. */
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
    productId: string;
    nameSnapshot: string;
    size: string | null;
    color: string | null;
    qty: number;
    unitPrice: number;
    costPriceSnapshot: number;
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

    res.json({
      data: {
        code: order.code,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        paidAmount: order.paidAmount,
        refundedAmount: order.refundedAmount,
        dueAmount: order.dueAmount,
        paymentState: paymentState(computeTotals(order)),
        fulfilment: order.fulfilment,
        createdAt: order.createdAt.toISOString(),
        customer: { name: order.customer.name, phone: maskPhone(order.customer.phone) },
        items: order.items.map(publicOrderItem),
        batch: batchSummary(order.batch),
        delivery: publicDelivery(order.delivery),
        timeline: buildTimeline(order),
        canChooseFulfilment: order.status === 'ARRIVED' && order.fulfilment === null,
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

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 4)}****`;
}
