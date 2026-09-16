"use client";

import { useState } from "react";
import { Button, Card, Empty } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { phoneLabel } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail } from "@/lib/types";

export function ArrivalSmsPanel({
  batch,
  onSent,
}: {
  batch: AdminBatchDetail;
  onSent: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const eligible = batch.orders.filter((o) => o.status !== "CANCELLED");
  const smsReady = eligible.filter((o) => o.arrivalSmsEligible !== false);
  const pending = smsReady.filter((o) => !o.arrivalNotifiedAt && o.customer.phone);
  const missingPhone = smsReady.filter((o) => !o.customer.phone);

  const send = async (orderId?: string) => {
    const key = orderId ?? "all";
    setBusyId(key);
    try {
      const result = await adminApi.sendBatchArrivalSms(
        batch.id,
        orderId ? { orderId } : undefined,
      );
      if (result.failed.length > 0 && result.sent === 0) {
        toast.error(result.failed[0]?.error ?? "Илгээгдсэнгүй.");
      } else if (result.sent > 0) {
        toast.success(
          result.sent === 1
            ? "SMS илгээлээ."
            : `${result.sent} захиалагчид SMS илгээлээ.`,
        );
      } else {
        toast.success("Илгээх захиалга алга.");
      }
      onSent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "SMS илгээж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Бараа ирсэн SMS</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            Автоматаар явахгүй. Зөвхөн бараа нь ирсэн, хүлээлгэж өгөөгүй захиалгад товчоор илгээнэ.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => void send()}
          loading={busyId === "all"}
          disabled={pending.length === 0 || busyId !== null}
        >
          Илгээгээгүй бүгдэд ({pending.length})
        </Button>
      </div>
      {missingPhone.length > 0 && (
        <div className="mb-3 text-[13px] text-warn">
          {missingPhone.length} захиалгад утас алга.
        </div>
      )}
      {eligible.length === 0 ? (
        <Empty>Захиалга алга.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {eligible.map((order) => {
            const sent = Boolean(order.arrivalNotifiedAt);
            const phone = order.customer.phone;
            const canSend = Boolean(phone) && order.arrivalSmsEligible !== false;
            return (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="tnum text-[14px]">{order.code}</div>
                  <div className="truncate text-[13px] text-ink-2">
                    {order.customer.name ?? "Нэргүй"}
                    {phone ? ` · ${phoneLabel(phone)}` : " · утас алга"}
                    {sent ? " · илгээгдсэн" : ""}
                    {order.arrivalSmsEligible === false ? " · SMS илгээхгүй" : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={sent ? "outline" : "primary"}
                  onClick={() => void send(order.id)}
                  loading={busyId === order.id}
                  disabled={!canSend || busyId !== null}
                >
                  {sent ? "Дахин илгээх" : "SMS илгээх"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
