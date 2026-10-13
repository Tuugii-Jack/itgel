"use client";

import { Badge, Card } from "@/components/ui";
import { dayTimeLabel, money } from "@/lib/format";
import type { PaymentLedger as PaymentLedgerData } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = { BANK_TRANSFER: 'Дансаар', QPAY: 'QPay', CASH: 'Бэлэн', CARD: 'Карт', OTHER: 'Бусад', LEASING: 'Лизинг' };

export function PaymentLedger({
  payments,
}: {
  payments: PaymentLedgerData["payments"];
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-[15px] font-medium">Төлбөрийн түүх</div>
      {payments.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">Бичилт алга. Мөнгө ороогүй байна.</p>
      ) : (
        <div className="divide-y divide-line">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 py-4 text-[14px] first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.kind === "PAYMENT" ? "Орлого" : "Буцаалт"}</span>
                  <Badge tone={p.method === 'QPAY' ? 'ok' : p.method === 'BANK_TRANSFER' ? 'info' : 'neutral'}>{METHOD_LABEL[p.method] ?? p.method}</Badge>
                  {p.reference && (
                    <span className="tnum max-w-full break-all text-[13px] text-muted"> · {p.reference}</span>
                  )}
                </div>
                <div className="text-[13px] text-muted">
                  {dayTimeLabel(p.createdAt)}
                  {p.payeeKind ? ` · ${p.payeeKind === 'SHOP' ? 'Итгэл' : 'Лизинг'}` : ''}
                  {p.note ? ` · ${p.note}` : ""}
                </div>
              </div>
              <span
                className={`tnum shrink-0 ${p.kind === "REFUND" ? "text-danger" : "text-ok"}`}
              >
                {p.signedAmount > 0 ? "+" : ""}
                {money(p.signedAmount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
