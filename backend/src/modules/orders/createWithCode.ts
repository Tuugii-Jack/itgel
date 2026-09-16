import { Prisma } from '@prisma/client';
import { generateOrderCode } from '../../lib/code.js';
import { conflict } from '../../lib/errors.js';

export type NewOrderLine = {
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
};

export type NewOrderData = {
  customerId: string;
  subtotal: number;
  isLeasing: boolean;
  leasingFee: number;
  payeeKind: 'SHOP' | 'LEASING';
  note: string | null;
  items: NewOrderLine[];
};

/** `PH-XXXXXX` код давхардвал дахин оролдоно. */
export async function createOrderWithUniqueCode(
  tx: Prisma.TransactionClient,
  data: NewOrderData,
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await tx.order.create({
        data: {
          code: generateOrderCode(),
          customerId: data.customerId,
          subtotal: data.subtotal,
          isLeasing: data.isLeasing,
          leasingFee: data.leasingFee,
          payeeKind: data.payeeKind,
          paidAmount: 0,
          refundedAmount: 0,
          dueAmount: data.subtotal + data.leasingFee,
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
