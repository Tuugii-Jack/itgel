"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ORDER_STATUS_LABEL, OrderBadge, PageHead, Select } from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorNote,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { downloadOrdersExcel, printOrders } from "@/lib/orderExport";
import { PAYMENT_TONE } from "@/lib/payment";
import { useToast } from "@/lib/toast";
import type {
  AdminOrderDetail,
  OrderStatus,
  PaymentLedger,
  PaymentMethod,
} from "@/lib/types";

/**
 * Захиалгын урсгал — backend/src/lib/orderStatus.ts-ийн ORDER_FLOW.
 * Зөвхөн дараагийн алхам руу, эсвэл (хүлээлгэн өгөөгүй бол) цуцлах руу шилжинэ.
 */
const ORDER_FLOW: OrderStatus[] = [
  "NEW",
  "CONFIRMED",
  "IN_BATCH",
  "IN_TRANSIT",
  "ARRIVED",
  "HANDED_OVER",
];

function nextStatus(from: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(from);
  if (i === -1 || i === ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[i + 1];
}

function previousStatus(from: OrderStatus): OrderStatus | null {
  if (from === "CANCELLED") return null; // audit-аас тодорхойлогдоно
  const i = ORDER_FLOW.indexOf(from);
  if (i <= 0) return null;
  return ORDER_FLOW[i - 1];
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Шилжүүлэг" },
  { value: "QPAY", label: "QPay" },
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
  /** Аль үйлдэл явж байгааг заана — зөвхөн тухайн товч spinner-тэй харагдана. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const busy = busyKey !== null;
  /** Төлбөр дутуу гэж 409 өгсөн үед force-оор давах саналыг харуулна. */
  const [shortfall, setShortfall] = useState<{ status: OrderStatus; missing: number } | null>(
    null,
  );

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

  const run = async (key: string, action: () => Promise<unknown>, okMessage: string) => {
    setBusyKey(key);
    setError(null);
    setShortfall(null);
    try {
      await action();
      toast.success(okMessage);
      await load();
      onChanged();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Төлөв солих. Төлбөр дутуу гэж backend 409 өгвөл дүнг нь уншаад
   * `force`-оор давах сонголтыг санал болгоно.
   */
  const changeStatus = async (status: OrderStatus, force?: boolean) => {
    setBusyKey(`status:${status}`);
    setError(null);
    setShortfall(null);
    try {
      await adminApi.setOrderStatus(orderId, status, undefined, force);
      toast.success(`Төлөв «${ORDER_STATUS_LABEL[status]}» боллоо.`);
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        toast.error(e.message);
        const missing = (e.details as { missing?: number } | undefined)?.missing;
        if (e.status === 409 && typeof missing === "number" && missing > 0) {
          setShortfall({ status, missing });
        }
      } else {
        const message = "Гүйцэтгэж чадсангүй.";
        setError(message);
        toast.error(message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const revertStatus = async () => {
    setBusyKey("status:revert");
    setError(null);
    setShortfall(null);
    try {
      await adminApi.revertOrderStatus(orderId);
      toast.success("Төлөв нэг алхам буцаагдлаа.");
      await load();
      onChanged();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
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
        hint={
          <span>
            <Link
              href={`/admin/customers?id=${order.customer.id}`}
              className="text-ink no-underline hover:underline"
              onClick={(e) => {
                // Customers page opens detail via local state — deep-link via sessionStorage.
                e.preventDefault();
                try {
                  sessionStorage.setItem("itgel.admin.openCustomer", order.customer.id);
                } catch {
                  /* ignore */
                }
                window.location.href = "/admin/customers";
              }}
            >
              {order.customer.name ?? "Нэргүй"}
            </Link>
            {" · "}
            <a href={`tel:${order.customer.phone}`} className="tnum text-ink no-underline">
              {phoneLabel(order.customer.phone)}
            </a>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  printOrders([order]);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
                }
              }}
            >
              Хэвлэх
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                downloadOrdersExcel([order], `${order.code}.csv`);
                toast.success("Excel татагдлаа.");
              }}
            >
              Excel
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Буцах
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrderBadge status={order.status} />
        <Badge tone={PAYMENT_TONE[order.paymentState]}>{order.paymentStateLabel}</Badge>
        {order.batch && (
          <Link
            href="/admin/batches"
            className="no-underline"
            onClick={(e) => {
              e.preventDefault();
              try {
                sessionStorage.setItem("itgel.admin.openBatch", order.batch!.id);
              } catch {
                /* ignore */
              }
              window.location.href = "/admin/batches";
            }}
          >
            <Badge tone="info">{order.batch.name}</Badge>
          </Link>
        )}
      </div>

      {order.paymentClaimedAt && order.dueAmount > 0 && (
        <Card className="mb-4 border-info bg-info-bg p-4">
          <div className="text-[14px] leading-[1.5] text-info">
            Хэрэглэгч <span className="tnum">{dayTimeLabel(order.paymentClaimedAt)}</span>-нд
            мөнгө шилжүүлсэн гэж мэдэгдсэн. Дансаа шалгаад доор төлбөрийг бүртгэнэ үү —
            мэдэгдэл нь төлбөр орсны баталгаа биш.
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {shortfall && (
        <Card className="mb-4 border-warn bg-warn-bg p-4">
          <div className="text-[14px] leading-[1.5] text-warn">
            <span className="tnum font-medium">{money(shortfall.missing)}</span> ороогүй
            байна. Мөнгийг өөр сувгаар авсан бол доорх төлбөрийн хэсэгт бүртгэнэ үү.
            Бүртгэхгүйгээр үргэлжлүүлбэл захиалга дутуу төлбөртэй хэвээр үлдэнэ.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              loading={busyKey === `status:${shortfall.status}`}
              onClick={() => changeStatus(shortfall.status, true)}
            >
              Дутуу ч гэсэн {ORDER_STATUS_LABEL[shortfall.status]} болгох
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShortfall(null)}>
              Болих
            </Button>
          </div>
        </Card>
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
                    {formatSelections(item.selections, item.size, item.color)}
                    {formatSelections(item.selections, item.size, item.color) ? " · " : ""}
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
                      loading={busyKey === `item:${item.id}`}
                      onCancel={(reason, refund) =>
                        run(
                          `item:${item.id}`,
                          () =>
                            adminApi.cancelOrderItem(order.id, item.id, { reason, refund }),
                          "Мөр цуцлагдлаа.",
                        )
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
          <StatusActions
            status={order.status}
            disabled={busy}
            busyKey={busyKey}
            onChange={changeStatus}
            onRevert={revertStatus}
          />

          <Card className="flex flex-col gap-2 p-4">
            <SumRow label="Барааны дүн" value={money(totals.subtotal)} />
            {totals.deliveryFee > 0 && (
              <SumRow label="Хүргэлт" value={money(totals.deliveryFee)} />
            )}
            {(totals.storageFee ?? 0) > 0 && (
              <SumRow label="Агуулахын хураамж" value={money(totals.storageFee)} />
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
              loading={busyKey === "payment"}
              onSubmit={(body) =>
                run("payment", () => adminApi.recordPayment(order.id, body), "Төлбөр бүртгэгдлээ.")
              }
            />
          )}

          {ledger.maxRefundable > 0 && (
            <RecordRefund
              max={ledger.maxRefundable}
              disabled={busy}
              loading={busyKey === "refund"}
              onSubmit={(body) =>
                run("refund", () => adminApi.recordRefund(order.id, body), "Буцаалт бүртгэгдлээ.")
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Дараагийн алхам, буцаах, цуцлах — backend-ийн зөвшөөрсөн шилжилтүүд л харагдана. */
function StatusActions({
  status,
  disabled,
  busyKey,
  onChange,
  onRevert,
}: {
  status: OrderStatus;
  disabled: boolean;
  busyKey: string | null;
  onChange: (status: OrderStatus) => void;
  onRevert: () => void;
}) {
  const next = nextStatus(status);
  const prev = previousStatus(status);
  const canRevert = status !== "NEW";
  const canCancel = status !== "CANCELLED" && status !== "HANDED_OVER";
  if (!next && !canCancel && !canRevert) return null;

  const revertLabel =
    status === "CANCELLED"
      ? "Цуцлалтыг буцаах"
      : prev
        ? `«${ORDER_STATUS_LABEL[prev]}» руу буцаах`
        : "Буцаах";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Төлөв</div>
      <div className="text-[13px] text-ink-2">
        Одоо: {ORDER_STATUS_LABEL[status]}
      </div>
      <div className="flex flex-wrap gap-2">
        {next && (
          <Button
            size="sm"
            disabled={disabled}
            loading={busyKey === `status:${next}`}
            onClick={() => onChange(next)}
          >
            {ORDER_STATUS_LABEL[next]} болгох
          </Button>
        )}
        {canRevert && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            loading={busyKey === "status:revert"}
            onClick={onRevert}
          >
            {revertLabel}
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            loading={busyKey === "status:CANCELLED"}
            onClick={() => onChange("CANCELLED")}
          >
            Цуцлах
          </Button>
        )}
      </div>
    </Card>
  );
}

function RecordPayment({
  suggested,
  disabled,
  loading,
  onSubmit,
}: {
  suggested: number;
  disabled: boolean;
  loading: boolean;
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
        loading={loading}
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
  loading,
  onSubmit,
}: {
  max: number;
  disabled: boolean;
  loading: boolean;
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
          loading={loading}
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
  loading,
  onCancel,
}: {
  disabled: boolean;
  loading: boolean;
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
          loading={loading}
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
