"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayTimeLabel, money } from "@/lib/format";
import type { AdminOrderQpay, QpayPaymentRow } from "@/lib/types";

export function OrderQpayCard({
  orderId,
  qpay,
  disabled,
  busyKey,
  onAction,
}: {
  orderId: string;
  qpay: AdminOrderQpay | null;
  disabled: boolean;
  busyKey: string | null;
  onAction: (
    key: string,
    action: () => Promise<unknown>,
    okMessage: string,
  ) => Promise<void>;
}) {
  const [rows, setRows] = useState<QpayPaymentRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const loadPayments = useCallback(async () => {
    if (!qpay?.invoiceId || !qpay.ready) {
      setRows([]);
      setListError(null);
      return;
    }
    try {
      const list = await adminApi.orderQpayPayments(orderId);
      setRows(list.rows);
      setListError(null);
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "Жагсаалт авахад алдаа.");
    }
  }, [orderId, qpay?.invoiceId, qpay?.ready]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  if (!qpay) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 text-[15px] font-medium">QPay</div>
      {!qpay.ready ? (
        <p className="m-0 text-[13px] text-muted">
          {qpay.enabled
            ? "QPay тохиргоо дутуу — нэхэмжлэл шалгаж чадахгүй."
            : "QPay идэвхгүй."}
        </p>
      ) : !qpay.invoiceId ? (
        <p className="m-0 text-[13px] text-muted">
          Энэ захиалгад QPay нэхэмжлэл алга. Хэрэглэгч QR авсны дараа энд харагдана.
        </p>
      ) : (
        <>
          <div className="text-[13px] text-ink-2">
            Нэхэмжлэл{" "}
            <span className="tnum break-all text-ink">{qpay.invoiceId}</span>
            {qpay.invoiceAt ? (
              <span className="text-muted"> · {dayTimeLabel(qpay.invoiceAt)}</span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled}
              loading={busyKey === "qpay-check"}
              onClick={() =>
                onAction(
                  "qpay-check",
                  async () => {
                    const result = await adminApi.checkOrderQpay(orderId);
                    await loadPayments();
                    return result;
                  },
                  "QPay шалгалаа.",
                )
              }
            >
              Төлбөр шалгах
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              loading={busyKey === "qpay-cancel-invoice"}
              onClick={() => {
                if (
                  !window.confirm(
                    "QPay нэхэмжлэлийг цуцлах уу? Хэрэглэгч дахин QR авах боломжтой.",
                  )
                ) {
                  return;
                }
                void onAction(
                  "qpay-cancel-invoice",
                  () => adminApi.cancelOrderQpayInvoice(orderId),
                  "Нэхэмжлэл цуцлагдлаа.",
                );
              }}
            >
              Нэхэмжлэл цуцлах
            </Button>
          </div>

          {listError && (
            <p className="mt-3 mb-0 text-[13px] text-danger">{listError}</p>
          )}

          {rows.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {rows.map((row) => (
                <div
                  key={row.paymentId}
                  className="flex items-start justify-between gap-3 border-t border-line pt-2 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="tnum break-all">{row.paymentId}</div>
                    <div className="text-muted">
                      {row.status ?? "төлөв үгүй"}
                      {row.wallet ? ` · ${row.wallet}` : ""}
                      {row.date ? ` · ${row.date}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tnum">{money(row.amount)}</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        loading={busyKey === `qpay-cancel:${row.paymentId}`}
                        onClick={() => {
                          if (!window.confirm("QPay төлбөрийг цуцлах уу?")) return;
                          void onAction(
                            `qpay-cancel:${row.paymentId}`,
                            async () => {
                              const result = await adminApi.cancelQpayPayment(row.paymentId);
                              await loadPayments();
                              return result;
                            },
                            "QPay төлбөр цуцлагдлаа.",
                          );
                        }}
                      >
                        Цуцлах
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={disabled}
                        loading={busyKey === `qpay-refund:${row.paymentId}`}
                        onClick={() => {
                          if (!window.confirm("QPay-ээр буцаалт хийх үү?")) return;
                          void onAction(
                            `qpay-refund:${row.paymentId}`,
                            async () => {
                              const result = await adminApi.refundQpayPayment(row.paymentId);
                              await loadPayments();
                              return result;
                            },
                            "QPay буцаалт хийгдлээ.",
                          );
                        }}
                      >
                        Буцаах
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
