"use client";

import { Card } from "@/components/ui";
import { dayTimeLabel, money } from "@/lib/format";
import type { PaymentLedger as PaymentLedgerData } from "@/lib/types";

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
        <div className="flex flex-col gap-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 text-[14px]">
              <div className="min-w-0">
                <div>
                  {p.kind === "PAYMENT" ? "Орлого" : "Буцаалт"}
                  {p.reference && (
                    <span className="tnum text-[13px] text-muted"> · {p.reference}</span>
                  )}
                </div>
                <div className="text-[13px] text-muted">
                  {dayTimeLabel(p.createdAt)}
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
