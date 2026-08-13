import type { BatchStage, OrderStatus } from '@prisma/client';

/** Урагшлах гинж: NEW → CONFIRMED → IN_BATCH → IN_TRANSIT → ARRIVED → HANDED_OVER. */
export const ORDER_FLOW: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'IN_BATCH',
  'IN_TRANSIT',
  'ARRIVED',
  'HANDED_OVER',
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'Шинэ',
  CONFIRMED: 'Баталгаажсан',
  IN_BATCH: 'Багцад орсон',
  IN_TRANSIT: 'Зам дээр',
  ARRIVED: 'Агуулахад ирсэн',
  HANDED_OVER: 'Хүлээлгэн өгсөн',
  CANCELLED: 'Цуцлагдсан',
};

/**
 * Шилжилт зөвшөөрөгдөх эсэх.
 * — Гинжин дагуу зөвхөн нэг алхам урагш.
 * — CANCELLED руу HANDED_OVER-с бусад бүх төлвөөс.
 * — CANCELLED-с хаашаа ч шилжихгүй (буцаах нь тусдаа `canRevert`).
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (from === 'CANCELLED') return false;
  if (to === 'CANCELLED') return from !== 'HANDED_OVER';
  if (to === 'NEW') return false;

  const fromIndex = ORDER_FLOW.indexOf(from);
  const toIndex = ORDER_FLOW.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

/** Гинжин дээрх өмнөх алхам — NEW/CANCELLED дээр null. */
export function previousInFlow(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  if (i <= 0) return null;
  return ORDER_FLOW[i - 1] ?? null;
}

/**
 * Админ санамсаргүй урагшлуулсныг нэг алхам буцаах.
 * CANCELLED-с буцаахыг audit-аас өмнөх төлөвтэй нь зөвшөөрнө (энд зөвхөн flow).
 */
export function canRevert(from: OrderStatus): boolean {
  if (from === 'NEW') return false;
  if (from === 'CANCELLED') return true;
  return previousInFlow(from) !== null;
}

/**
 * Багцын шат ахихад дотор байгаа захиалга шилжих төлөв.
 * Хуучин COLLECTING/CLOSED/AT_SUPPLIER — ladder-ээс гарсан; null.
 */
export function orderStatusForBatchStage(stage: BatchStage): OrderStatus | null {
  switch (stage) {
    case 'IN_TRANSIT':
      return 'IN_TRANSIT';
    case 'AT_WAREHOUSE':
      return 'ARRIVED';
    default:
      return null;
  }
}

/**
 * Багц ахих үед захиалгыг зорилтот төлөв рүү аваачих алхмуудын жагсаалт.
 * Аль хэдийн урагшилсан эсвэл цуцлагдсан захиалгад хоосон массив.
 */
export function stepsToStatus(from: OrderStatus, target: OrderStatus): OrderStatus[] {
  if (from === 'CANCELLED') return [];
  const fromIndex = ORDER_FLOW.indexOf(from);
  const targetIndex = ORDER_FLOW.indexOf(target);
  if (fromIndex === -1 || targetIndex === -1 || targetIndex <= fromIndex) return [];
  return ORDER_FLOW.slice(fromIndex + 1, targetIndex + 1);
}

/**
 * Идэвхтэй багцын шатууд: Зам дээр → Агуулахад → Дууссан.
 * (COLLECTING/CLOSED/AT_SUPPLIER enum-д үлдсэн ч ladder-д байхгүй.)
 */
export const BATCH_STAGES: BatchStage[] = ['IN_TRANSIT', 'AT_WAREHOUSE', 'DONE'];

export const BATCH_STAGE_LABEL: Record<BatchStage, string> = {
  COLLECTING: 'Цуглуулж байна',
  CLOSED: 'Хаагдсан',
  AT_SUPPLIER: 'Нийлүүлэгч дээр',
  IN_TRANSIT: 'Зам дээр',
  AT_WAREHOUSE: 'Агуулахад',
  DONE: 'Дууссан',
};

/** Багцын бүрэлдэхүүн (бараа нэмэх/хасах) зөвшөөрөгдөх эсэх. */
export function canEditBatchComposition(stage: BatchStage): boolean {
  return stage === 'IN_TRANSIT';
}

/** Дараагийн шат — эцсийн шатанд null. */
export function nextBatchStage(stage: BatchStage): BatchStage | null {
  const i = BATCH_STAGES.indexOf(stage);
  return i === -1 || i === BATCH_STAGES.length - 1 ? null : BATCH_STAGES[i + 1]!;
}

/** Өмнөх шат — эхний шатанд null. */
export function previousBatchStage(stage: BatchStage): BatchStage | null {
  const i = BATCH_STAGES.indexOf(stage);
  return i <= 0 ? null : BATCH_STAGES[i - 1]!;
}
