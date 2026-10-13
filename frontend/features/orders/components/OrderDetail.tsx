"use client";

import Link from "next/link";
import { useState } from "react";
import { TaskTabs } from "@/components/admin/TaskTabs";
import { Metric } from "@/components/admin/shared";
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
import { useAdminSession } from "@/lib/admin-session";
import { useToast } from "@/lib/toast";
import { customerNameLabel, dayTimeLabel, money, phoneLabel } from "@/lib/format";
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
  const [section, setSection] = useState("auto");
  const { user } = useAdminSession();
  const userRoleAllowsBank = user?.role === "LEASING";
  const toast = useToast();
  const {
    order,
    ledger,
    qpay,
    qpayLoading,
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

  if (!loading && error && (!order || !ledger || order.id !== orderId)) {
    return <Card className="max-w-[860px] p-5"><ErrorNote>{error}</ErrorNote><div className="mt-4 flex gap-2"><Button variant="outline" onClick={() => void load()}>Дахин оролдох</Button><Button variant="ghost" onClick={onClose}>Буцах</Button></div></Card>;
  }
  if (loading || !order || !ledger || order.id !== orderId) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const { totals } = ledger;
  const view = section === "auto" ? (totals.dueAmount > 0 && !lockShopPayments ? "payment" : "goods") : section;

  return (
    <div className="max-w-[1100px]">
      <PageHead
        title={order.code}
        hint={
          <span>
            <Link
              href={`/workspace/${leasingPortal ? "leasing" : "shop"}/customers?id=${encodeURIComponent(order.customer.id)}`}
              className="text-ink no-underline hover:underline"
            >
              {customerNameLabel(order.customer.name)}
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
          (canWriteStatus && !leasingPortal ? (
          <Link
            href={`/workspace/shop/batches?batch=${encodeURIComponent(order.batch.id)}`}
            className="no-underline"
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
              ? " QPay төлбөрийг шалгана уу — энэ мэдэгдэл нь төлбөр орсны баталгаа биш."
              : " Мэдэгдэл нь төлбөр орсны баталгаа биш."}
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {order.mixedOwnership && !canWritePayments && (
        <div className="mb-4">
          <ErrorNote>
            Холимог эзэмшлийн хуучин захиалга. Төлөв, цуцлалт, төлбөр, нөөцийг эзэмшигч удирдана. Хуваарилсан
            дүн нь баталгаажсан эзний орлого биш — хуваарилаагүй үлдэгдлийг тусад харуулна.
          </ErrorNote>
        </div>
      )}

      {canWriteStatus && shortfall && (
        <Card className="mb-4 border-warn bg-warn-bg p-4">
          <div className="text-[14px] leading-[1.5] text-warn">
            <span className="tnum font-medium">{money(shortfall.missing)}</span> ороогүй
            байна. QPay төлбөрийг шалгана уу.
            Төлөгдөөгүй үед үргэлжлүүлбэл захиалга дутуу төлбөртэй хэвээр үлдэнэ.
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

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric label="Нийт дүн" value={money(totals.total)} />
        <Metric label="Орсон төлбөр" value={money(totals.paidAmount)} />
        <Metric label="Үлдэгдэл" value={money(totals.dueAmount)} tone={totals.dueAmount > 0 ? "warn" : "ok"} />
      </div>
      <TaskTabs value={view} onChange={setSection} items={[
        { id: "payment", label: "Төлбөр ба тооцоо" },
        { id: "goods", label: "Бараа ба олголт", count: order.items.filter((item) => !item.cancelled).length },
        { id: "history", label: "Төлбөрийн түүх", count: ledger.payments.length },
      ]} />
      {leasingPortal && <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSection("payment")}>Төлбөр, буцаалт</Button>
        {order.isLeasing && !order.isResale && <Button size="sm" variant="outline" onClick={() => setSection("goods")}>Бэлэн бараанд шилжүүлэх</Button>}
        {canWritePayments && order.dueAmount > 0 && <Button size="sm" variant="outline" loading={busyKey === "leasing-sms"} disabled={busy} onClick={() => void openPaySms()}>SMS сануулах</Button>}
        <Link href="/workspace/leasing/itgel" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-[13px] text-ink no-underline">Итгэлд төлөх</Link>
      </div>}
      {view === "payment" && totals.dueAmount > 0 && <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4"><p className="m-0 text-[13px] text-ink-2">Хэрэглэгч барааны төлбөрөө {order.isLeasing || order.payeeKind === "LEASING" ? "лизингийн" : "Итгэлийн"} QPay-ээр төлнө. Карго Итгэлийн QPay-д орно.</p><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/t/${encodeURIComponent(order.code)}`).then(() => toast.success("Төлбөрийн холбоос хууллаа.")).catch(() => toast.error("Холбоос хуулж чадсангүй.")); }}>Төлбөрийн холбоос хуулах</Button></Card>}
      <div className={view === "history" ? "" : "grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start"}>
        <div className="flex flex-col gap-4">
          <div hidden={view !== "goods"}>
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
          </div>
          <div hidden={view !== "history"}>
          <PaymentLedger payments={ledger.payments} />
          </div>
          <div hidden={view !== "payment"}>
          {qpayLoading && <Card className="p-4 text-[13px] text-muted">QPay мэдээллийг ачаалж байна…</Card>}
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
          {view === "payment" && <PaymentSummary order={order} totals={totals} leasingPortal={leasingPortal} busy={busy} busyKey={busyKey} smsOpen={smsOpen} onOpenPaySms={openPaySms} />}

        </div>

        <div className="flex flex-col gap-4" hidden={view === "history"}>
          <div hidden={view !== "goods"}>
          {canWriteStatus ? (
          <StatusActions
            status={order.status}
            hasHandedOverItems={order.items.some((item) => !item.cancelled && !!item.handedOverAt)}
            disabled={busy}
            busyKey={busyKey}
            onChange={changeStatus}
            onRevert={revertStatus}
            handoverHref={leasingPortal ? undefined : "/workspace/shop/handover?code=" + encodeURIComponent(order.code)}
            allowHandover={!leasingPortal}
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
                  href={`/workspace/shop/handover?code=${encodeURIComponent(order.code)}`}
                  className="inline-flex h-9 items-center justify-center rounded-[8px] bg-ink px-3 text-[13px] text-white no-underline"
                >
                  Хүлээлгэн өгөх
                </Link>
              )}
            </Card>
          )}
          </div>

          {view === "payment" && canWritePayments && leasingPortal && userRoleAllowsBank && totals.dueAmount > 0 && (
            <RecordPayment
              key={`payment-${order.id}`}
              suggested={
                order.isLeasing && (order.nextPayAmount ?? 0) > 0
                  ? (order.nextPayAmount ?? totals.dueAmount)
                  : totals.dueAmount
              }
              bankOnly
              disabled={busy}
              loading={busyKey === "payment"}
              onSubmit={(body) =>
                run("payment", () => api.recordPayment(order.id, body), "Төлбөр бүртгэгдлээ.")
              }
            />
          )}

          {view === "payment" && canWritePayments && ledger.maxRefundable > 0 && (
            <RecordRefund
              key={`refund-${order.id}`}
              max={ledger.maxRefundable}
              disabled={busy}
              loading={busyKey === "refund"}
              onSubmit={(body) =>
                run("refund", () => api.recordRefund(order.id, body), "Буцаалт бүртгэгдлээ.")
              }
            />
          )}
          {view === "payment" && totals.dueAmount <= 0 && <Card className="border-ok bg-ok-bg p-4 text-[14px] text-ok">{order.debtClosedAt ? "Үлдэгдэл өр хаагдсан. Хаасан дүн нь төлсөн мөнгө биш." : "Төлбөр бүрэн орсон."}<Button full variant="outline" className="mt-3" onClick={() => setSection("goods")}>Бараа ба олголт харах</Button></Card>}
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
