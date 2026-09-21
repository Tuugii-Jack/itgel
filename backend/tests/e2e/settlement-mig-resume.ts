import assert from 'node:assert/strict';
import { attachQpayInvoice, verifySettlementInvoice } from '../../src/services/itgelSettlementPay.js';
import { prisma } from '../../src/prisma.js';

const db = process.env.DATABASE_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(db) || !/itgel_mig_settlement/.test(db)) {
  throw new Error(`resume script isolated DB биш: ${db.replace(/:[^@]+@/, ':***@')}`);
}

const resumed = await attachQpayInvoice('pay_invoiced', 'admin:mig');
assert.equal(resumed.invoice?.invoiceId, 'inv_legacy');
assert.equal(resumed.invoice?.qrText, 'qr:inv_legacy');
assert.equal(resumed.invoicePending, false);

const first = await verifySettlementInvoice('pay_uncertain', 'admin:mig');
assert.equal(first.status, 'CONFIRMED');
const second = await verifySettlementInvoice('pay_uncertain', 'admin:mig');
assert.equal(second.status, 'CONFIRMED');

const row = await prisma.itgelSettlement.findUniqueOrThrow({ where: { id: 'sett_uncertain' } });
assert.equal(row.status, 'PAID');
assert.equal(row.remainingAmount, 0);
assert.equal(row.paidAmount, 9000);

await prisma.$disconnect();
console.log('resume-ok');
