import { leasingFeeHold, leasingHoldsGoods, type LeasingPayPlan } from '../../lib/leasing.js';
import {
  arrivedQtyOf,
  handedQtyOf,
  pickableQtyOf,
  waitingQtyOf,
} from '../../lib/itemQty.js';
import { paymentState, type OrderTotals } from '../../services/money.js';
import { pickupQrValue } from '../../lib/pickupQr.js';

export type CustomerProgressKey = 'placed' | 'confirmed' | 'transit' | 'arrived' | 'handed';

export type CustomerNextAction = {
  key: string;
  title: string;
  detail: string;
  cta: 'pay' | 'contact' | 'pickup' | 'fulfilment' | null;
  nextPayAmount: number | null;
  nextPayAt: string | null;
  etaFrom: string | null;
  etaTo: string | null;
  pickupQr: string | null;
  progress: { key: CustomerProgressKey; label: string; reached: boolean; current: boolean }[];
};

const PREORDER_STAGES: { key: CustomerProgressKey; label: string }[] = [
  { key: 'placed', label: 'Захиалсан' },
  { key: 'confirmed', label: 'Баталгаажсан' },
  { key: 'transit', label: 'Замд' },
  { key: 'arrived', label: 'Ирсэн' },
  { key: 'handed', label: 'Олгосон' },
];

const READY_STAGES: { key: CustomerProgressKey; label: string }[] = [
  { key: 'placed', label: 'Захиалсан' },
  { key: 'confirmed', label: 'Баталгаажсан' },
  { key: 'arrived', label: 'Ирсэн' },
  { key: 'handed', label: 'Олгосон' },
];

type ItemLike = {
  cancelledAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  arrivedQty?: number | null;
  qty: number;
  handedOverAt?: Date | string | null;
  handedOverQty?: number | null;
  arriveFrom?: Date | string | null;
  arriveTo?: Date | string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function qtyLine(item: ItemLike) {
  return {
    qty: item.qty,
    arrivedQty: item.arrivedQty,
    handedOverQty: item.handedOverQty,
    handedOverAt: item.handedOverAt,
    arrivedAt: item.arrivedAt,
    cancelledAt: item.cancelledAt,
  };
}

export function customerOrderProgress(input: {
  status: string;
  items: ItemLike[];
  readyStock?: boolean;
}): CustomerNextAction['progress'] {
  const active = input.items.filter((item) => !item.cancelledAt);
  const hasWaiting = active.some((item) => waitingQtyOf(qtyLine(item)) > 0);
  const hasArrivedOpen = active.some((item) => pickableQtyOf(qtyLine(item)) > 0);
  const allHanded =
    active.length > 0 && active.every((item) => handedQtyOf(qtyLine(item)) >= item.qty);
  const stages = input.readyStock ? READY_STAGES : PREORDER_STAGES;

  let current: CustomerProgressKey = 'placed';
  if (input.status === 'CANCELLED') current = 'placed';
  else if (allHanded || input.status === 'HANDED_OVER') current = 'handed';
  else if (hasArrivedOpen) current = 'arrived';
  else if (input.status === 'IN_TRANSIT' || input.status === 'IN_BATCH') current = 'transit';
  else if (input.status === 'ARRIVED' && hasWaiting) current = 'arrived';
  else if (input.status === 'CONFIRMED' || input.status === 'NEW') current = 'confirmed';
  else if (input.status === 'ARRIVED') current = 'arrived';

  const order: CustomerProgressKey[] = stages.map((s) => s.key);
  const currentIndex = order.indexOf(current);
  return stages.map((stage, i) => ({
    ...stage,
    reached: input.status === 'CANCELLED' ? false : i <= currentIndex,
    current: input.status !== 'CANCELLED' && stage.key === current,
  }));
}

export function customerNextActionOf(input: {
  code: string;
  status: string;
  isLeasing?: boolean;
  items: ItemLike[];
  totals: OrderTotals;
  payPlan?: LeasingPayPlan | null;
  canChooseFulfilment?: boolean;
  batchEtaFrom?: Date | string | null;
  batchEtaTo?: Date | string | null;
  readyStock?: boolean;
}): CustomerNextAction {
  const feeHold = leasingFeeHold({
    isLeasing: Boolean(input.isLeasing),
    leasingFee: input.totals.leasingFee,
    paidAmount: input.totals.paidAmount,
    refundedAmount: input.totals.refundedAmount,
    subtotal: input.totals.subtotal,
  });
  const holdsGoods = leasingHoldsGoods({
    isLeasing: Boolean(input.isLeasing),
    leasingFee: input.totals.leasingFee,
    paidAmount: input.totals.paidAmount,
    refundedAmount: input.totals.refundedAmount,
    subtotal: input.totals.subtotal,
    dueAmount: input.totals.dueAmount,
  });
  const pay = paymentState(input.totals);
  const active = input.items.filter((item) => !item.cancelledAt);
  const waitingPieces = active.reduce((sum, item) => sum + waitingQtyOf(qtyLine(item)), 0);
  const pickablePieces = active.reduce((sum, item) => sum + pickableQtyOf(qtyLine(item)), 0);
  const arrivedPieces = active.reduce((sum, item) => sum + arrivedQtyOf(qtyLine(item)), 0);
  const handedPieces = active.reduce((sum, item) => sum + handedQtyOf(qtyLine(item)), 0);
  const allHanded =
    active.length > 0 && active.every((item) => handedQtyOf(qtyLine(item)) >= item.qty);
  const qtyNote =
    arrivedPieces > 0 || handedPieces > 0
      ? ` Ирсэн ${arrivedPieces}, олгосон ${handedPieces}, одоо авах ${pickablePieces}, ирээгүй ${waitingPieces}.`
      : '';
  const etaFrom =
    iso(input.batchEtaFrom) ??
    iso(active.map((i) => i.arriveFrom).find(Boolean) ?? null);
  const etaTo =
    iso(input.batchEtaTo) ??
    iso(active.map((i) => i.arriveTo).find(Boolean) ?? null);
  const dueStep = input.payPlan?.steps.find((s) => s.status === 'due_today' || s.status === 'overdue');
  const nextPayAmount =
    pay === 'PAID' || input.totals.dueAmount <= 0
      ? null
      : dueStep?.remaining ?? input.totals.dueAmount;
  const nextPayAt = dueStep && dueStep.status !== 'paid' ? dueStep.dueDay : null;
  const progress = customerOrderProgress({
    status: input.status,
    items: input.items,
    readyStock: input.readyStock,
  });

  const base = {
    nextPayAmount,
    nextPayAt,
    etaFrom,
    etaTo,
    pickupQr: pickablePieces > 0 ? pickupQrValue(input.code) : null,
    progress,
  };

  if (input.status === 'CANCELLED') {
    return { key: 'cancelled', title: 'Захиалга цуцлагдсан', detail: 'Энэ захиалга цаашид үргэлжлэхгүй.', cta: 'contact', ...base, pickupQr: null };
  }
  if (feeHold) {
    return {
      key: 'pay_fee',
      title: 'Одоо юу хийх вэ?',
      detail: 'Шимтгэл төлөгдөөгүй тул бараа бэлтгэгдэхгүй. Эхлээд шимтгэлээ төлнө үү.',
      cta: 'pay',
      ...base,
      pickupQr: null,
    };
  }
  if (pay === 'UNPAID' || pay === 'PARTIAL') {
    const overdue = Boolean(input.payPlan?.overdue);
    return {
      key: overdue ? 'pay_overdue' : 'pay',
      title: 'Одоо юу хийх вэ?',
      detail: overdue
        ? 'Хугацаа хэтэрсэн төлбөр байна. Төлсний дараа барааны явц үргэлжилнэ.'
        : 'Төлбөр дутуу байна. Төлөөд захиалгаа үргэлжлүүлнэ үү.',
      cta: 'pay',
      ...base,
    };
  }
  if (allHanded || input.status === 'HANDED_OVER') {
    return { key: 'done', title: 'Бараа олгосон', detail: 'Энэ захиалгын барааг хүлээлгэн өгсөн.', cta: 'contact', ...base, pickupQr: null };
  }
  if (pickablePieces > 0) {
    const waitingNote = waitingPieces > 0 ? ' Зарим бараа хараахан ирээгүй.' : '';
    if (holdsGoods) {
      return {
        key: 'pay_then_pickup',
        title: 'Одоо юу хийх вэ?',
        detail: `Ирсэн бараа байна. Лизингийн үлдэгдэл төлөгдөх хүртэл дэлгүүрээс авахгүй.${waitingNote}${qtyNote}`,
        cta: 'pay',
        ...base,
      };
    }
    if (input.canChooseFulfilment) {
      return {
        key: 'choose_fulfilment',
        title: 'Одоо юу хийх вэ?',
        detail: `Ирсэн бараагаа авах аргаа сонгоно уу.${waitingNote}${qtyNote}`,
        cta: 'fulfilment',
        ...base,
      };
    }
    return {
      key: 'pickup',
      title: 'Одоо юу хийх вэ?',
      detail: `Ирсэн бараагаа дэлгүүрээс авна уу. Доорх олголтын QR-ийг ажилтанд үзүүлнэ.${waitingNote}${qtyNote}`,
      cta: 'pickup',
      ...base,
    };
  }
  if (waitingPieces > 0 && (input.status === 'IN_TRANSIT' || input.status === 'IN_BATCH' || input.status === 'ARRIVED')) {
    return {
      key: 'wait_arrival',
      title: 'Одоо юу хийх вэ?',
      detail: etaFrom
        ? 'Бараа замд явж байна. Ирэх төлөвлөсөн огноог доор харна уу.'
        : 'Бараа замд явж байна. Ирэх огноо хараахан тодорхойгүй.',
      cta: 'contact',
      ...base,
      pickupQr: null,
    };
  }
  return {
    key: 'wait',
    title: 'Одоо юу хийх вэ?',
    detail: 'Захиалгыг бэлтгэж байна. Төлбөр болон барааны явцыг эндээс харна.',
    cta: 'contact',
    ...base,
    pickupQr: null,
  };
}
