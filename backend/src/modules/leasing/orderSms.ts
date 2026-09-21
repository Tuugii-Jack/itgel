import { badRequest, notFound } from '../../lib/errors.js';
import {
  buildLeasingPayPlan,
  fillLeasingSmsTemplate,
  leasingDueTodayReminder,
  leasingOverdueReminder,
  leasingSmsDate,
  leasingSmsName,
  leasingSmsTemplateOf,
  leasingSmsTemplatesOf,
  type LeasingSmsKind,
} from '../../lib/leasing.js';
import { prisma } from '../../prisma.js';
import { getSettingsCached, leasingPayGapsOf } from '../../services/settings.js';
import { CUSTOM_SMS_MAX_CHARS, prepareCustomSms, smsTemplates, stripSmsUrls } from '../../services/sms.js';
import { assertLeasingOrderAccess } from './guards.js';
import type { LeasingAuth } from '../../lib/leasingAccess.js';

export function reminderTemplateOf(
  kind: LeasingSmsKind,
  override: string | undefined,
  settings: { leasingSmsDueToday?: string | null; leasingSmsOverdue?: string | null; leasingSmsArrivedUnpaid?: string | null },
): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return leasingSmsTemplateOf(leasingSmsTemplatesOf(settings), kind);
}

export function assertSendSmsText(raw: string): string {
  const text = prepareCustomSms(raw);
  if (!text) throw badRequest('Мессеж бичнэ үү.');
  if ([...text].length > CUSTOM_SMS_MAX_CHARS) {
    throw badRequest(`Мессеж ${CUSTOM_SMS_MAX_CHARS} тэмдэгтээс хэтрэхгүй.`);
  }
  return text;
}

export async function payReminderPreview(orderId: string, auth: LeasingAuth) {
  await assertLeasingOrderAccess(orderId, auth);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: { select: { phone: true, name: true } } },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  if (!order.isLeasing) throw badRequest('Бэлэн борлуулалтын захиалгад хуваарийн SMS илгээхгүй.');
  if (order.debtClosedAt) throw badRequest('Хаалттай өр дээр сануулга илгээхгүй.');
  if (!order.customer.phone) throw badRequest('Утасны дугаар алга.');
  const amount = Math.max(0, order.dueAmount);
  if (amount <= 0) throw badRequest('Төлөх үлдэгдэл алга.');

  const settings = await getSettingsCached();
  const gaps = leasingPayGapsOf(settings);
  const templates = leasingSmsTemplatesOf(settings);
  const plan = buildLeasingPayPlan({ ...order, payGaps: gaps });
  const dueToday = scheduleReminderText('due_today', order.customer.name, plan, templates.dueToday);
  const overdue = scheduleReminderText('overdue', order.customer.name, plan, templates.overdue);
  return {
    order,
    amount,
    text: stripSmsUrls(dueToday ?? overdue ?? smsTemplates.leasingPay(order.code, amount)),
  };
}

export function arrivedUnpaidReminderText(name: string | null, dueAmount: number, template: string): string | null {
  const amount = Math.max(0, dueAmount);
  if (amount <= 0) return null;
  return fillLeasingSmsTemplate(template, { ner: leasingSmsName(name), dun: amount });
}

export function scheduleReminderText(
  kind: 'due_today' | 'overdue',
  name: string | null,
  plan: ReturnType<typeof buildLeasingPayPlan>,
  template: string,
): string | null {
  const display = leasingSmsName(name);
  if (kind === 'due_today') {
    const due = leasingDueTodayReminder(plan);
    if (!due) return null;
    return fillLeasingSmsTemplate(template, {
      ner: display,
      dun: due.amount,
      ognoo: leasingSmsDate(due.dueDay),
    });
  }
  const overdue = leasingOverdueReminder(plan);
  if (!overdue) return null;
  return fillLeasingSmsTemplate(template, {
    ner: display,
    dun: overdue.amount,
    honog: overdue.overdueDays,
  });
}
