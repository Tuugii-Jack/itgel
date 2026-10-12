"use client";
import Link from "next/link";

import { ORDER_STATUS_LABEL } from "@/components/admin/shared";
import { Button, Card } from "@/components/ui";
import type { OrderStatus } from "@/lib/types";

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

/** Дараагийн алхам, буцаах, цуцлах — backend-ийн зөвшөөрсөн шилжилтүүд л харагдана. */
export function StatusActions({
  status,
  hasHandedOverItems,
  disabled,
  busyKey,
  onChange,
  onRevert,
  handoverHref,
  allowHandover = true,
}: {
  status: OrderStatus;
  hasHandedOverItems: boolean;
  disabled: boolean;
  busyKey: string | null;
  onChange: (status: OrderStatus) => void;
  onRevert: () => void;
  handoverHref?: string;
  allowHandover?: boolean;
}) {
  const proposed = nextStatus(status);
  const next = proposed === "HANDED_OVER" && !allowHandover ? null : proposed;
  const prev = previousStatus(status);
  const canRevert = status !== "NEW";
  const canCancel = status !== "CANCELLED" && status !== "HANDED_OVER" && !hasHandedOverItems;
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
        {next === "HANDED_OVER" && handoverHref ? <Link href={handoverHref} className="inline-flex min-h-11 items-center rounded-lg bg-secondary px-4 text-[14px] text-white no-underline">Олголт нээх</Link> : next && (
          <Button
            size="sm"
            disabled={disabled}
            loading={busyKey === `status:${next}`}
            onClick={() => onChange(next)}
          >
            {ORDER_STATUS_LABEL[next]} болгох
          </Button>
        )}
        <details className="w-full"><summary className="cursor-pointer py-2 text-[12px] text-ink-2">Бусад үйлдэл</summary><div className="mt-2 flex flex-wrap gap-2">
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
        </div></details>
      </div>
    </Card>
  );
}
