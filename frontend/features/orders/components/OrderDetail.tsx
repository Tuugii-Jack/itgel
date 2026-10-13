"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CalendarDays, ClipboardList, CreditCard, Package, UserRound } from 'lucide-react';
import { TaskTabs } from "@/components/admin/TaskTabs";
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
import { useOnKeyChange } from '@/lib/syncKey';
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
  backLabel = 'Захиалгын жагсаалт руу',
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
  api?: OrderWorkspaceApi;
  canWrite?: boolean;
  workspace?: "shop" | "leasing";
  backLabel?: string;
}) {
  const [section, setSection] = useState("auto");
  useOnKeyChange(orderId, () => setSection('auto'));
  const { user } = useAdminSession();
  const userRoleAllowsBank = user?.role === "ADMIN" && workspaceProp !== 'leasing';
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
  const canRecordBank = userRoleAllowsBank && ledger.manualPayment?.allowed === true && !order.debtClosedAt;
  const view = section === "auto" ? (totals.dueAmount > 0 && (!lockShopPayments || canRecordBank) ? "payment" : "goods") : section;

  return (
    <div className="mx-auto max-w-[1180px]">
      <button type="button" onClick={onClose} className="mb-4 inline-flex min-h-9 items-center gap-2 text-[13px] text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</button>
      <Card className="mb-5 p-5 sm:p-6 [&_.workspace-pagehead]:mb-4">
      <PageHead
        title={order.code}
        hint={order.isLeasing ? 'Лизингийн захиалга' : order.isResale ? 'Лизингийн бэлэн борлуулалт' : 'Дэлгүүрийн захиалга'}
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
          </div>
        }
      />
      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <div className="flex gap-3"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><div><div className="mb-1 text-[11px] text-muted">Хэрэглэгч</div><Link href={`/workspace/${leasingPortal ? 'leasing' : 'shop'}/customers?id=${encodeURIComponent(order.customer.id)}`} className="text-[14px] font-medium text-ink no-underline hover:text-secondary">{customerNameLabel(order.customer.name)}</Link><div className="mt-1"><a href={`tel:${order.customer.phone}`} className="tnum text-[13px] text-ink-2 no-underline">{phoneLabel(order.customer.phone)}</a></div></div></div>
        <div className="flex gap-3"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><div><div className="mb-1 text-[11px] text-muted">Захиалсан огноо</div><div className="text-[13px] text-ink">{dayTimeLabel(order.createdAt)}</div></div></div>
        <div className="flex gap-3"><Package className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><div><div className="mb-1 text-[11px] text-muted">Барааны явц</div><OrderBadge status={order.status} /><div className="mt-1 text-[12px] text-ink-2">{order.items.filter((item) => !item.cancelled).reduce((sum, item) => sum + item.qty, 0)} ш · {order.batch?.name ?? 'Багцад ороогүй'}</div></div></div>
      </div>
      </Card>

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
            Лизингийн QPay болон буцаалт тусдаа хэсэгт байна. Дансаар орсон мөнгийг зөвхөн үндсэн ADMIN энд бүртгэнэ.
          </div>
        </Card>
      )}

      {order.paymentClaimedAt && order.dueAmount > 0 && (
        <Card className="mb-4 border-info bg-info-bg p-4">
          <div className="text-[14px] leading-[1.5] text-info">
            Хэрэглэгч <span className="tnum">{dayTimeLabel(order.paymentClaimedAt)}</span>-нд
            мөнгө шилжүүлсэн гэж мэдэгдсэн.
            {lockShopPayments
              ? " Бодитоор орсон мөнгийг үндсэн админ тулгаж шалгана."
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

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className={`p-5 ${totals.dueAmount > 0 ? 'border-warn bg-warn-bg' : 'border-ok bg-ok-bg'}`}><div className="mb-2 text-[12px] text-ink-2">{totals.dueAmount < 0 ? 'Илүү төлсөн дүн' : 'Төлөх үлдэгдэл'}</div><div className={`tnum text-[26px] font-medium tracking-tight ${totals.dueAmount > 0 ? 'text-warn' : 'text-ok'}`}>{money(Math.abs(totals.dueAmount))}</div><div className="mt-2 text-[12px] text-ink-2">{order.debtClosedAt ? 'Өр хаасан · төлсөн мөнгөнөөс тусдаа' : ledger.paymentStateLabel}</div></Card>
        <Card className="p-5"><div className="mb-2 flex items-center gap-2 text-[12px] text-muted"><CreditCard className="h-4 w-4" aria-hidden="true" />Орсон төлбөр</div><div className="tnum text-[24px] font-medium tracking-tight">{money(totals.paidAmount)}</div><div className="mt-2 text-[12px] text-ink-2">{totals.refundedAmount > 0 ? `Буцаасан ${money(totals.refundedAmount)}` : 'Төлбөрийн дэвтрийн дүн'}</div></Card>
        <Card className="p-5"><div className="mb-2 flex items-center gap-2 text-[12px] text-muted"><ClipboardList className="h-4 w-4" aria-hidden="true" />Захиалгын нийт дүн</div><div className="tnum text-[24px] font-medium tracking-tight">{money(totals.total)}</div><div className="mt-2 text-[12px] text-ink-2">Бараа болон хамаарах хураамжууд</div></Card>
      </div>
      <TaskTabs value={view} onChange={setSection} items={[
        { id: "payment", label: "Төлбөр" },
        { id: "goods", label: "Бараа ба олголт", count: order.items.filter((item) => !item.cancelled).length },
        { id: "history", label: "Түүх", count: ledger.payments.length },
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
          <div hidden={view !== "history"} className={view === 'history' ? 'grid gap-4 lg:grid-cols-[1fr_320px]' : ''}>
          <PaymentLedger payments={ledger.payments} />
          <Card className="h-fit p-5"><div className="mb-4 text-[15px] font-medium">Захиалгын явц</div><ol className="m-0 list-none space-y-4 p-0">{order.timeline.map((step) => <li key={step.key} className="flex gap-3"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${step.status === 'done' ? 'bg-ok' : step.status === 'current' ? 'bg-secondary' : 'bg-line'}`} /><div><div className={`text-[13px] ${step.status === 'pending' ? 'text-muted' : 'font-medium text-ink'}`}>{step.label}</div><div className="mt-1 text-[11px] text-muted">{step.at ? dayTimeLabel(step.at) : step.status === 'current' ? 'Одоогийн алхам' : step.status === 'done' ? 'Огноо бүртгэгдээгүй' : 'Хүлээгдэж байна'}</div></div></li>)}</ol></Card>
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

        <div className={view === 'history' ? 'hidden' : 'flex flex-col gap-4'}>
          <div hidden={view !== "goods"}>
          {order.note && <Card className="mb-4 p-5"><div className="mb-2 text-[14px] font-medium">Захиалгын тэмдэглэл</div><p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{order.note}</p></Card>}
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
                    ? "Бараа ирсэн. Хэрэглэгч үлдэгдлээ төлбөрийн холбоосоор QPay төлнө."
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

          {view === "payment" && canRecordBank && totals.dueAmount > 0 && (
            <RecordPayment
              key={`payment-${order.id}-${totals.paidAmount}-${totals.refundedAmount}-${totals.dueAmount}`}
              orderCode={order.code}
              recipients={ledger.manualPayment?.recipients ?? []}
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
