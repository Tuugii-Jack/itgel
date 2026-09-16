"use client";

import { Metric } from "@/components/admin/shared";
import { Badge, Button, Card } from "@/components/ui";
import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import type { HandoverReceiptStore } from "@/lib/handoverReceipt";
import { formatSelections } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { HandoverHistoryDay } from "@/lib/types";
import { printHistoryRow } from "../utils";

export function HistoryDayDetail({
  day,
  store,
}: {
  day: HandoverHistoryDay;
  store?: HandoverReceiptStore;
}) {
  const toast = useToast();
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Metric label="Энэ өдрийн бэлэн" value={money(day.cash)} tone="ok" />
        <Metric label="Карт" value={money(day.card)} />
        <Metric label="Данс" value={money(day.bank)} />
      </div>
      <div className="flex flex-col gap-3">
        {day.rows.map((row) => (
          <Card key={`${row.customerId}-${row.at}`} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[16px] font-medium">{row.name ?? "Нэргүй"}</div>
                <div className="mt-0.5 text-[13px] text-ink-2">
                  {row.phone ? (
                    <a href={`tel:${row.phone}`} className="tnum">
                      {phoneLabel(row.phone)}
                    </a>
                  ) : (
                    "Утасгүй"
                  )}
                  {" · "}
                  <span className="tnum">{dayTimeLabel(row.at)}</span>
                </div>
              </div>
              {(row.cash > 0 || row.card > 0 || row.bank > 0) && (
                <div className="shrink-0 text-right text-[13px]">
                  {row.cash > 0 && (
                    <div className="tnum font-medium text-ok">{money(row.cash)} бэлэн</div>
                  )}
                  {row.card > 0 && (
                    <div className="tnum text-ink-2">{money(row.card)} карт</div>
                  )}
                  {row.bank > 0 && (
                    <div className="tnum text-ink-2">{money(row.bank)} данс</div>
                  )}
                </div>
              )}
            </div>
            {row.orderCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.orderCodes.map((code) => (
                  <Badge key={code} tone="neutral">
                    {code}
                  </Badge>
                ))}
              </div>
            )}
            {row.items.length > 0 && (
              <div className="mt-3 divide-y divide-line border-t border-line">
                {row.items.map((item, i) => {
                  const sel = formatSelections(item.selections, item.size, item.color);
                  return (
                    <div key={`${item.name}-${i}`} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="text-[14px]">{item.name}</div>
                        {sel ? <div className="text-[12px] text-muted">{sel}</div> : null}
                      </div>
                      <span className="tnum shrink-0 text-[14px] font-medium">{item.qty} ш</span>
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              full
              variant="outline"
              className="mt-3"
              disabled={row.items.length === 0}
              onClick={() => {
                try {
                  printHistoryRow(row, store);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
                }
              }}
            >
              Баримт хэвлэх
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
