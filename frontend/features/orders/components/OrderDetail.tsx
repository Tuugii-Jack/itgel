"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ORDER_STATUS_LABEL, OrderBadge, PageHead, LeasingBadge, LeasingGoodsBadge } from "@/components/admin/shared";
import { OrderQpayCard } from "@/components/admin/OrderQpay";
import { OrderExportPanel } from "@/components/admin/OrderExportPanel";
import { LeasingReadyTransfer } from "@/components/leasing/LeasingReadyTransfer";
import { SmsPreviewDialog } from "@/components/leasing/SmsPreviewDialog";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Spinner,
} from "@/components/ui";
import { adminApi } from "@/lib/api";
import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { PAYMENT_TONE } from "@/lib/payment";
import { leasingGoodsArrived } from "@/lib/leasing";
import { hasCustomizedSms } from "@/lib/smsEditOnce";
import { useOrderDetail, type OrderWorkspaceApi } from "../hooks/useOrderDetail";
import { OrderItems } from "./OrderItems";
import { PaymentLedger } from "./PaymentLedger";
import { PaymentSummary } from "./PaymentSummary";
import { RecordPayment } from "./RecordPayment";
import { RecordRefund } from "./RecordRefund";
import { StatusActions } from "./StatusActions";

/**
 * Захиалгын дэлгэрэнгүй — төлбөрийн дэвтэр энд байна.
 * Захиалгыг баталгаажуулахын өмнө мөнгө орсныг эндээс бүртгэнэ.
 */
export function OrderDetail({
  orderId,
  onClose,
  onChanged,
  api = adminApi,
  canWrite: canWriteProp,
  workspace: workspaceProp,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
  api?: OrderWorkspaceApi;
  canWrite?: boolean;
  workspace?: "shop" | "leasing";
}) {
  const router = useRouter();
  const {
    order,
    ledger,
    qpay,
    loading,
    busyKey,
    busy,
    error,
    leasingPortal,
    lockShopPayments,
    canWritePayments,
    canWriteStatus,
    canCancelItems,
    shortfall,
    setShortfall,
    exportOpen,
    setExportOpen,
    exportBusy,
    smsOpen,
    setSmsOpen,
    smsDefault,
    smsTick,
    load,
    run,
    openPaySms,
    sendPaySms,
    changeStatus,
    revertStatus,
    runLocalExport,
  } = useOrderDetail({
    orderId,
    onChanged,
    api,
    canWrite: canWriteProp,
    workspace: workspaceProp,
  });

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
                router.push("/admin/customers");
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
              variant={exportOpen === "print" ? "primary" : "outline"}
              onClick={() => setExportOpen((v) => (v === "print" ? null : "print"))}
            >
              Хэвлэх
            </Button>
            <Button
              size="sm"
              variant={exportOpen === "excel" ? "primary" : "outline"}
              onClick={() => setExportOpen((v) => (v === "excel" ? null : "excel"))}
            >
              Excel
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Буцах
            </Button>
          </div>
        }
      />

      {exportOpen && (
        <OrderExportPanel
          busy={exportBusy}
          confirmLabel={exportOpen === "excel" ? "Excel татах" : "Хэвлэх"}
          onConfirm={(columns) => runLocalExport(exportOpen, columns)}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {leasingPortal ? (
          <LeasingGoodsBadge status={order.status} dueAmount={order.dueAmount} />
        ) : (
          <OrderBadge status={order.status} />
        )}
        {order.isLeasing && <LeasingBadge />}
        {order.isResale && <Badge tone="info">Бэлэн борлуулалт</Badge>}
        {order.debtClosedAt && <Badge tone="neutral">Өр хаасан</Badge>}
        {!leasingPortal && (
          <Badge tone={PAYMENT_TONE[order.paymentState]}>{order.paymentStateLabel}</Badge>
        )}
        {order.batch &&
          (canWriteStatus ? (
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
              router.push("/admin/batches");
            }}
          >
            <Badge tone="info">{order.batch.name}</Badge>
          </Link>
          ) : (
            <Badge tone="info">{order.batch.name}</Badge>
          ))}
      </div>

      {lockShopPayments && (
        <Card className="mb-4 border-line p-4">
          <div className="text-[14px] leading-[1.5] text-ink-2">
            Энэ захиалга <span className="font-medium">лизингээр</span> авсан тул төлбөр
            бүртгэх, буцаалт, QPay шалгах/цуцлах энд байхгүй. Үүнийг лизингийн админ
            хийнэ. QPay-ээр авсан захиалга дээр эдгээр үйлдэл хэвээр харагдана.
          </div>
        </Card>
      )}

      {order.paymentClaimedAt && order.dueAmount > 0 && (
        <Card className="mb-4 border-info bg-info-bg p-4">
          <div className="text-[14px] leading-[1.5] text-info">
            Хэрэглэгч <span className="tnum">{dayTimeLabel(order.paymentClaimedAt)}</span>-нд
            мөнгө шилжүүлсэн гэж мэдэгдсэн.
            {lockShopPayments
              ? " Лизингээр авсан тул төлбөрийг лизингийн админ бүртгэнэ."
              : canWritePayments
              ? " Дансаа шалгаад доор төлбөрийг бүртгэнэ үү — мэдэгдэл нь төлбөр орсны баталгаа биш."
              : " Мэдэгдэл нь төлбөр орсны баталгаа биш."}
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {canWriteStatus && shortfall && (
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
          <OrderItems
            order={order}
            canCancelItems={canCancelItems}
            busy={busy}
            busyKey={busyKey}
            onCancel={(itemId, reason, refund) =>
              run(
                `item:${itemId}`,
                () => api.cancelOrderItem(order.id, itemId, { reason, refund }),
                "Мөр цуцлагдлаа.",
              )
            }
          />

          <PaymentLedger payments={ledger.payments} />

          <OrderQpayCard
            orderId={order.id}
            qpay={qpay}
            disabled={busy || Boolean(order.debtClosedAt)}
            busyKey={busyKey}
            onAction={run}
            readOnly={!canWritePayments || Boolean(order.debtClosedAt)}
            api={api}
          />
        </div>

        <div className="flex flex-col gap-4">
          {canWriteStatus ? (
          <StatusActions
            status={order.status}
            hasHandedOverItems={order.items.some((item) => !item.cancelled && !!item.handedOverAt)}
            disabled={busy}
            busyKey={busyKey}
            onChange={changeStatus}
            onRevert={revertStatus}
          />
          ) : leasingPortal ? (
            <>
            <Card className="flex flex-col gap-3 p-4">
              <div className="text-[15px] font-medium">Бараа</div>
              <div className="flex flex-wrap items-center gap-2">
                <LeasingGoodsBadge status={order.status} dueAmount={order.dueAmount} />
              </div>
              <div className="text-[13px] text-ink-2">
                {leasingGoodsArrived(order.status)
                  ? order.dueAmount > 0
                    ? "Бараа ирсэн. Үлдэгдэл төлбөрийг доор бүртгэнэ үү."
                    : "Бараа ирсэн. Төлбөр гүйцэд орсон."
                  : "Бараа хараахан ирээгүй байна."}
              </div>
            </Card>
            <LeasingReadyTransfer order={order} onDone={() => { void load(); onChanged(); }} />
            </>
          ) : (
            <Card className="flex flex-col gap-3 p-4">
              <div className="text-[15px] font-medium">Төлөв</div>
              <div className="text-[13px] text-ink-2">
                Одоо: {ORDER_STATUS_LABEL[order.status]}
              </div>
              {order.status === "ARRIVED" && (
                <Link
                  href="/admin/handover"
                  className="inline-flex h-9 items-center justify-center rounded-[8px] bg-ink px-3 text-[13px] text-white no-underline"
                >
                  Хүлээлгэн өгөх
                </Link>
              )}
            </Card>
          )}

          <PaymentSummary
            order={order}
            totals={totals}
            leasingPortal={leasingPortal}
            busy={busy}
            busyKey={busyKey}
            smsOpen={smsOpen}
            onOpenPaySms={openPaySms}
          />

          {canWritePayments && totals.dueAmount > 0 && (
            <RecordPayment
              suggested={
                order.isLeasing && (order.nextPayAmount ?? 0) > 0
                  ? (order.nextPayAmount ?? totals.dueAmount)
                  : totals.dueAmount
              }
              disabled={busy}
              loading={busyKey === "payment"}
              onSubmit={(body) =>
                run("payment", () => api.recordPayment(order.id, body), "Төлбөр бүртгэгдлээ.")
              }
            />
          )}

          {canWritePayments && ledger.maxRefundable > 0 && (
            <RecordRefund
              max={ledger.maxRefundable}
              disabled={busy}
              loading={busyKey === "refund"}
              onSubmit={(body) =>
                run("refund", () => api.recordRefund(order.id, body), "Буцаалт бүртгэгдлээ.")
              }
            />
          )}
        </div>
      </div>

      {smsOpen && (
        <SmsPreviewDialog
          key={smsTick}
          title="Төлбөр сануулах SMS"
          name={order.customer.name}
          phone={order.customer.phone}
          defaultText={smsDefault}
          canEdit={!hasCustomizedSms(order.customer.id)}
          busy={busyKey === "leasing-sms"}
          confirmLabel="Илгээх"
          onClose={() => {
            if (busyKey !== "leasing-sms") setSmsOpen(false);
          }}
          onConfirm={(text) => void sendPaySms(text)}
        />
      )}
    </div>
  );
}
