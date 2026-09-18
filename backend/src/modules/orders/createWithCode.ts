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
  stockHold?: 'NONE' | 'RESERVED' | 'CONSUMED' | 'RELEASED';
};

export type NewOrderData = {
  customerId: string;
  subtotal: number;
  isLeasing: boolean;
  leasingFee: number;
  payeeKind: 'SHOP' | 'LEASING';
  leasingOperatorAdminId?: string | null;
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
          leasingOperatorAdminId: data.leasingOperatorAdminId ?? null,
          paidAmount: 0,
          refundedAmount: 0,
          dueAmount: data.subtotal + data.leasingFee,
          note: data.note,
          items: {
            create: data.items.map((item) => ({
              roundId: item.roundId,
              productId: item.productId,
              nameSnapshot: item.nameSnapshot,
              selections: item.selections,
              size: item.size,
              color: item.color,
              qty: item.qty,
              unitPrice: item.unitPrice,
              costPriceSnapshot: item.costPriceSnapshot,
              arriveFrom: item.arriveFrom,
              arriveTo: item.arriveTo,
              stockHold: item.stockHold ?? 'NONE',
            })),
          },
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
