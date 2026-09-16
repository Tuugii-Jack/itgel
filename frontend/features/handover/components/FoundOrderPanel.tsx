"use client";

import { OrderBadge } from "@/components/admin/shared";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { money, phoneLabel } from "@/lib/format";
import { leasingAccountDue, shopDueOf } from "@/lib/leasing";
import { formatSelections } from "@/lib/options";
import type { HandoverPayMethod } from "@/lib/types";
import { ITEM_STATUS_LABEL } from "../constants";
import { isReceiptItem, paySub, type Found } from "../utils";
import { HandoverActionBar } from "./HandoverActionBar";
import { PaymentDueCard } from "./PaymentDueCard";

export function FoundOrderPanel({
  found,
  payMethod,
  error,
  busy,
  onPayMethod,
  onCancel,
  onPrint,
  onComplete,
}: {
  found: Found;
  payMethod: HandoverPayMethod | null;
  error: string | null;
  busy: boolean;
  onPayMethod: (v: HandoverPayMethod) => void;
  onCancel: () => void;
  onPrint: () => void;
  onComplete: () => void;
}) {
  return (
    <div className="mx-auto max-w-[480px] pb-40">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="tnum text-[24px] font-medium">{found.code}</div>
          <div className="mt-1">
            <OrderBadge status={found.status} />
          </div>
          <p className="mt-2 mb-0 text-[12px] leading-[1.4] text-muted">
            Баримт хэвлэ → гарын үсэг зуруул → хүлээлгэн өгөх.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Цуцлах
        </Button>
      </div>

      <Card className="mb-3 p-4">
        <div className="text-[17px]">{found.customer.name ?? "Нэргүй"}</div>
        <div className="text-[14px] text-ink-2">
          {found.customer.phone ? (
            <a href={`tel:${found.customer.phone}`} className="tnum">
              {phoneLabel(found.customer.phone)}
            </a>
          ) : (
            "Утасгүй"
          )}
          {found.customer.email ? ` · ${found.customer.email}` : ""}
        </div>
      </Card>

      <PaymentDueCard
        dueAmount={found.dueAmount}
        shopDueAmount={shopDueOf(found)}
        leasingDueAmount={leasingAccountDue(found)}
        isLeasing={found.isLeasing}
        subtotal={found.subtotal}
        deliveryFee={found.deliveryFee}
        storageFee={found.storageFee}
        cargoFee={found.cargoFee}
        paidAmount={found.paidAmount}
        payMethod={payMethod}
        onPayMethod={onPayMethod}
      />

      <Card className="mb-3 divide-y divide-line">
        {found.items.map((item) => {
          const sel = formatSelections(item.selections, item.size, item.color);
          return (
            <div key={item.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={`text-[17px] leading-[1.4] ${
                      item.itemStatus === "handed_over" || item.cancelled
                        ? "text-muted line-through"
                        : ""
                    }`}
                  >
                    {item.name}
                  </div>
                  <Badge
                    tone={
                      item.itemStatus === "arrived"
                        ? "ok"
                        : item.itemStatus === "handed_over"
                          ? "neutral"
                          : item.itemStatus === "cancelled"
                            ? "danger"
                            : "warn"
                    }
                  >
                    {ITEM_STATUS_LABEL[item.itemStatus]}
                  </Badge>
                  {item.fulfilment === "DELIVERY" && item.itemStatus === "arrived" ? (
                    <Badge tone="info">Хүргэлт</Badge>
                  ) : null}
                  {found.isLeasing ? <Badge tone="neutral">Лизинг</Badge> : null}
                </div>
                {sel ? <div className="text-[14px] text-muted">{sel}</div> : null}
              </div>
              <span className="tnum shrink-0 text-[20px] font-medium">{item.qty} ш</span>
            </div>
          );
        })}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!found.canHandOver && found.blockReason && (
        <div className="mt-3">
          <ErrorNote>{found.blockReason}</ErrorNote>
        </div>
      )}

      <HandoverActionBar
        maxWidth="480px"
        printDisabled={!found.items.some(isReceiptItem)}
        onPrint={onPrint}
        primaryLabel={
          shopDueOf(found) > 0 ? `${money(shopDueOf(found))} авч өгөх` : "Хүлээлгэн өгөх"
        }
        primaryAmount={shopDueOf(found) > 0 ? shopDueOf(found) : null}
        primarySub={paySub(payMethod)}
        primaryDisabled={!found.canHandOver || (shopDueOf(found) > 0 && !payMethod)}
        primaryLoading={busy}
        onPrimary={onComplete}
      />
    </div>
  );
}
