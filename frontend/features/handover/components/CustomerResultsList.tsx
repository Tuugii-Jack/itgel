"use client";

import { Button, Card } from "@/components/ui";
import { money, phoneLabel } from "@/lib/format";
import type { HandoverCustomer } from "@/lib/types";

export function CustomerResultsList({
  customers,
  onBack,
  onOpen,
}: {
  customers: HandoverCustomer[];
  onBack: () => void;
  onOpen: (c: HandoverCustomer) => void;
}) {
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[17px] font-medium">{customers.length} хэрэглэгч олдлоо</div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Буцах
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {customers.map((c) => {
          const shopDue = c.totals.shopDueAmount ?? c.totals.dueAmount ?? 0;
          const leasingDue = c.totals.leasingDueAmount ?? 0;
          return (
            <Card key={c.id} className="p-4">
              <div className="text-[16px] font-medium">{c.name ?? "Нэргүй"}</div>
              <div className="mt-1 text-[13px] text-ink-2">
                {c.phone ? phoneLabel(c.phone) : "—"} · {c.email}
              </div>
              <div className="mt-2 text-[13px] text-muted">
                Нийт {c.totals.items} · Ирсэн {c.totals.arrived} · Авсан {c.totals.handedOver}
              </div>
              {shopDue > 0 && (
                <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-line pt-3">
                  <span className="text-[13px] text-ink-2">Дэлгүүрт авах</span>
                  <span className="tnum text-[17px] font-medium text-warn">{money(shopDue)}</span>
                </div>
              )}
              {leasingDue > 0 && (
                <div className={`flex items-baseline justify-between gap-2 ${shopDue > 0 ? "mt-1" : "mt-3 border-t border-line pt-3"}`}>
                  <span className="text-[13px] text-muted">Лизингийн данс</span>
                  <span className="tnum text-[14px] text-ink-2">{money(leasingDue)}</span>
                </div>
              )}
              <Button full variant="outline" className="mt-3" onClick={() => onOpen(c)}>
                Нээх
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
