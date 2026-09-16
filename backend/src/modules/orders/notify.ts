import type { Order } from '@prisma/client';
import { arrivalSmsEligibility, type ArrivalSmsItem } from '../../lib/arrivalSms.js';
import { prisma } from '../../prisma.js';
import { mailTemplates, sendMail } from '../../services/mail.js';
import { shopSms, smsTemplates } from '../../services/sms.js';

/** Захиалга баталгаажсан тухай и-мэйл. `notifyPayment` асаалттай үед. */
export async function notifyOrderConfirmed(order: Order): Promise<boolean> {
  const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
  if (!customer?.email || !customer.notifyPayment) return false;

  const template = mailTemplates.orderConfirmed(order.code, customer.name);
  const sent = await sendMail({
    to: customer.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
  if (!sent.ok) {
    console.warn(`[mail] ${order.code} баталгаажилт илгээгдсэнгүй: ${sent.error}`);
    return false;
  }
  return true;
}

/** Захиалга ирснийг мэдэгдэх SMS. Админ товчоор л илгээнэ. Илгээгдээгүй бол arrivalNotifiedAt тавихгүй. */
export async function notifyArrival(
  order: Order & { items?: ArrivalSmsItem[] },
  opts: { resend?: boolean } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (order.status === 'CANCELLED' || order.deletedAt) {
    return { ok: false, error: 'Цуцлагдсан эсвэл устгасан захиалга.' };
  }

  const items =
    order.items ??
    (await prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: {
        cancelledAt: true,
        arrivedAt: true,
        arrivedQty: true,
        qty: true,
        handedOverAt: true,
      },
    }));
  const eligible = arrivalSmsEligibility({
    deletedAt: order.deletedAt,
    status: order.status,
    items,
  });
  if (!eligible.ok) return { ok: false, error: eligible.reason };

  if (order.arrivalNotifiedAt && !opts.resend) return { ok: true, skipped: true };

  const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
  if (!customer?.phone) return { ok: false, error: 'Утасны дугаар алга.' };

  const result = await shopSms.send({
    phone: customer.phone,
    text: smsTemplates.arrived(order.code),
  });
  if (!result.ok) {
    console.warn(`[sms] ${order.code} мэдэгдэл илгээгдсэнгүй: ${result.error}`);
    return { ok: false, error: result.error ?? 'SMS илгээгдсэнгүй.' };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { arrivalNotifiedAt: new Date() },
  });
  return { ok: true };
}
