"use client";

import { useCallback, useEffect, useState } from "react";
import { OrderBadge, PageHead, Select } from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorNote,
  Field,
  Input,
  Spinner,
  type Tone,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import type {
  AdminOrderDetail,
  PaymentLedger,
  PaymentMethod,
  PaymentState,
} from "@/lib/types";

const STATE_TONE: Record<PaymentState, Tone> = {
  UNPAID: "danger",
  PARTIAL: "warn",
  PAID: "ok",
  OVERPAID: "info",
  REFUNDED: "neutral",
};

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Шилжүүлэг" },
  { value: "CASH", label: "Бэлэн" },
  { value: "CARD", label: "Карт" },
  { value: "OTHER", label: "Бусад" },
];

/**
 * Захиалгын дэлгэрэнгүй — төлбөрийн дэвтэр энд байна.
 * Захиалгыг баталгаажуулахын өмнө мөнгө орсныг эндээс бүртгэнэ.
 */
export function OrderDetail({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, l] = await Promise.all([
        adminApi.order(orderId),
        adminApi.ledger(orderId),
      ]);
      setOrder(o);
      setLedger(l);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !order || !ledger) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const { totals } = ledger;

  return (
    <div className="max-w-[860px]">
      <PageHead
        title={order.code}
        hint={`${order.customer.name ?? "Нэргүй"} · ${phoneLabel(order.customer.phone)}`}
        actions={
          <Button variant="ghost" onClick={onClose}>
            Буцах
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrderBadge status={order.status} />
        <Badge tone={STATE_TONE[order.paymentState]}>{order.paymentStateLabel}</Badge>
        {order.batch && <Badge tone="info">{order.batch.name}</Badge>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="flex flex-col gap-4">
          <Card className="divide-y divide-line">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div
                    className={`text-[15px] leading-[1.4] ${item.cancelled ? "text-muted line-through" : ""}`}
                  >
                    {item.name}
                  </div>
                  <div className="text-[13px] text-muted">
                    {[item.size, item.color].filter(Boolean).join(" · ")}
                    {[item.size, item.color].filter(Boolean).length > 0 ? " · " : ""}
                    {item.qty} ш × {money(item.unitPrice)}
                  </div>
                  {item.cancelled && item.cancelReason && (
                    <div className="mt-1 text-[13px] text-danger">
                      Цуцлагдсан: {item.cancelReason}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`tnum text-[15px] ${item.cancelled ? "text-muted line-through" : ""}`}>
                    {money(item.total)}
                  </span>
                  {!item.cancelled && order.status !== "HANDED_OVER" && (
                    <CancelItem
                      disabled={busy}
                      onCancel={(reason, refund) =>
                        run(() => adminApi.cancelOrderItem(order.id, item.id, { reason, refund }))
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          </Card>

          <Card className="p-4">
            <div className="mb-3 text-[15px] font-medium">Төлбөрийн түүх</div>
            {ledger.payments.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">Бичилт алга. Мөнгө ороогүй байна.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {ledger.payments.map((p) => (
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
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 p-4">
            <SumRow label="Барааны дүн" value={money(totals.subtotal)} />
            {totals.deliveryFee > 0 && (
              <SumRow label="Хүргэлт" value={money(totals.deliveryFee)} />
            )}
            <SumRow label="Нийт" value={money(totals.total)} />
            <Divider />
            <SumRow label="Орсон" value={money(totals.paidAmount)} />
            {totals.refundedAmount > 0 && (
              <SumRow label="Буцаасан" value={`−${money(totals.refundedAmount)}`} />
            )}
            <Divider />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] text-ink-2">
                {totals.dueAmount < 0 ? "Илүү төлсөн" : "Үлдэгдэл"}
              </span>
              <span
                className={`tnum text-[20px] font-medium ${totals.dueAmount > 0 ? "text-warn" : totals.dueAmount < 0 ? "text-info" : ""}`}
              >
                {money(Math.abs(totals.dueAmount))}
              </span>
            </div>
          </Card>

          {totals.dueAmount > 0 && (
            <RecordPayment
              suggested={totals.dueAmount}
              disabled={busy}
              onSubmit={(body) => run(() => adminApi.recordPayment(order.id, body))}
            />
          )}

          {ledger.maxRefundable > 0 && (
            <RecordRefund
              max={ledger.maxRefundable}
              disabled={busy}
              onSubmit={(body) => run(() => adminApi.recordRefund(order.id, body))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RecordPayment({
  suggested,
  disabled,
  onSubmit,
}: {
  suggested: number;
  disabled: boolean;
  onSubmit: (body: {
    amount: number;
    method: PaymentMethod;
    reference?: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(suggested));
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Төлбөр бүртгэх</div>
      <p className="m-0 text-[13px] text-ink-2">
        Данс шалгаад мөнгө орсныг энд бичнэ. Захиалга үүнээс өмнө баталгаажихгүй.
      </p>
      <Field label="Дүн">
        <Input
          value={amount}
          onChange={(v) => setAmount(v.replace(/\D/g, ""))}
          inputMode="numeric"
        />
      </Field>
      <Field label="Арга">
        <Select
          value={method}
          onChange={(v) => setMethod(v as PaymentMethod)}
          options={METHODS}
          className="w-full"
        />
      </Field>
      <Field label="Гүйлгээний утга" hint="Заавал биш">
        <Input value={reference} onChange={setReference} placeholder="Жишээ: TXN-4821" />
      </Field>
      <Button
        full
        disabled={disabled || !amount || Number(amount) <= 0}
        onClick={() =>
          onSubmit({
            amount: Number(amount),
            method,
            reference: reference.trim() || undefined,
          })
        }
      >
        Бүртгэх
      </Button>
    </Card>
  );
}

function RecordRefund({
  max,
  disabled,
  onSubmit,
}: {
  max: number;
  disabled: boolean;
  onSubmit: (body: { amount: number; method: PaymentMethod; note?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(max));
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Буцаалт хийх
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Буцаалт</div>
      <p className="m-0 text-[13px] text-ink-2">
        Хамгийн ихдээ <span className="tnum">{money(max)}</span> буцаана.
      </p>
      <Field label="Дүн">
        <Input
          value={amount}
          onChange={(v) => setAmount(v.replace(/\D/g, ""))}
          inputMode="numeric"
        />
      </Field>
      <Field label="Шалтгаан" hint="Заавал биш">
        <Input value={note} onChange={setNote} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={disabled || !amount || Number(amount) <= 0 || Number(amount) > max}
          onClick={() =>
            onSubmit({
              amount: Number(amount),
              method: "BANK_TRANSFER",
              note: note.trim() || undefined,
            })
          }
        >
          Буцаах
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Болих
        </Button>
      </div>
    </Card>
  );
}

function CancelItem({
  disabled,
  onCancel,
}: {
  disabled: boolean;
  onCancel: (reason: string | undefined, refund: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-danger underline disabled:opacity-40"
      >
        Цуцлах
      </button>
    );
  }

  return (
    <div className="flex w-[220px] flex-col gap-2 rounded-[8px] border border-line p-2">
      <Input value={reason} onChange={setReason} placeholder="Шалтгаан" />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={disabled}
          onClick={() => onCancel(reason.trim() || undefined, true)}
        >
          Цуцлаад буцаах
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Болих
        </Button>
      </div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[14px]">
      <span className="text-ink-2">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}
