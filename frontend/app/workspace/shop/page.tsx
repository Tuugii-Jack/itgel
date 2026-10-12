"use client";

import { deferEffect } from "@/lib/deferEffect";
import Link from "next/link";
import { SearchField } from "@/components/admin/SearchField";
import { WorkspaceDialog } from "@/components/admin/WorkspaceDialog";
import { updateWorkspaceQuery, useWorkspaceQuery } from "@/lib/useWorkspaceQuery";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BATCH_STAGE_LABEL,
  Metric,
  OrderBadge,
  LeasingBadge,
  ORDER_STATUS_LABEL,
  PageHead,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { OrderExportPanel } from "@/components/admin/OrderExportPanel";
import { adminApi, ApiError } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { useDeferredReload } from "@/lib/useDeferredReload";
import { useToast } from "@/lib/toast";
import { customerNameLabel, dayLabel, money, phoneLabel } from "@/lib/format";
import {
  downloadOrdersExcel,
  printOrders,
  type OrderExportSelection,
} from "@/lib/orderExport";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import type { AdminBatch, AdminOrderRow, AdminSummary, OrderStatus } from "@/lib/types";

const STATUSES: OrderStatus[] = [
  "NEW",
  "CONFIRMED",
  "IN_BATCH",
  "IN_TRANSIT",
  "ARRIVED",
  "HANDED_OVER",
  "CANCELLED",
];

const ORDERS_PAGE_SIZE = 100;

export default function AdminOrdersPage() {
  const toast = useToast();
  const { user } = useAdminSession();
  const canWrite = isFullAdmin(user?.role);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [status, setStatus] = useWorkspaceQuery("status");
  const [batch, setBatch] = useWorkspaceQuery("batch");
  const [claimed] = useWorkspaceQuery("claimed");
  const [deleted, setDeleted] = useWorkspaceQuery("deleted");
  const showDeleted = deleted === "1";
  const setShowDeleted = (value: boolean) => setDeleted(value ? "1" : null);
  const [search, setSearch] = useWorkspaceQuery("q", "", true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelIds, setCancelIds] = useState<string[]>([]);
  const [openId, setOpenId] = useWorkspaceQuery("order");
  const loadGen = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Аль үйлдэл явж байгааг заана — тухайн товч л spinner-тэй харагдана. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"print" | "excel" | null>(null);
  const [exportOpen, setExportOpen] = useState<"print" | "excel" | null>(null);
  const busy = busyAction !== null;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(
    (page: number) =>
      adminApi.orders({
        status: status || undefined,
        batch: batch || undefined,
        q: query || undefined,
        deleted: showDeleted ? true : undefined,
        claimed: claimed === "1" ? true : undefined,
        page,
        pageSize: ORDERS_PAGE_SIZE,
      }),
    [status, batch, query, showDeleted, claimed],
  );

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setSelected(new Set());
    setMoreLoading(false);
    setError(null);
    setRefreshing(true);
    try {
      const [s, list, b] = await Promise.all([
        adminApi.summary(),
        fetchOrders(1),
        adminApi.batches({ pageSize: 100 }),
      ]);
      if (gen !== loadGen.current) return;
      setSummary(s);
      setOrders(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
      setBatches(b.data);
      setSelected(new Set());
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (gen === loadGen.current) { setLoading(false); setRefreshing(false); }
    }
  }, [fetchOrders]);

  const markChanged = useDeferredReload(load, !openId);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const loadMore = async () => {
    if (moreLoading) return;
    const gen = loadGen.current;
    setMoreLoading(true);
    try {
      const list = await fetchOrders(pageMeta.page + 1);
      if (gen !== loadGen.current) return;
      setOrders((prev) => [...prev, ...list.data.filter((row) => !prev.some((existing) => existing.id === row.id))]);
      setPageMeta({
        page: list.meta?.page ?? pageMeta.page + 1,
        pages: list.meta?.pages ?? pageMeta.pages,
        total: list.meta?.total ?? pageMeta.total,
      });
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (gen === loadGen.current) setMoreLoading(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Сонгосон захиалгуудыг нэг хүсэлтээр шилжүүлнэ. */
  const advanceSelected = async (target: OrderStatus, ids = [...selected]) => {
    if (busy || ids.length === 0) return;
    setBusyAction(target);
    setError(null);

    let message: string | null = null;
    try {
      const result = await adminApi.bulkOrderStatus(ids, target);
      if (result.failed.length > 0) {
        message =
          `${result.succeeded} амжилттай, ${result.failed.length} алдаатай — ` +
          result.failed.map((f) => `${f.code ?? f.id}: ${f.message}`).join(" · ");
        toast.error(message);
      } else {
        toast.success(
          `${result.succeeded} захиалга ${ORDER_STATUS_LABEL[target].toLowerCase()} боллоо.`,
        );
      }
    } catch (e) {
      message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      toast.error(message);
    } finally {
      setBusyAction(null);
    }

    // `load()` нь алдааг цэвэрлэдэг тул мэдэгдлийг түүний дараа тавина.
    await load();
    if (message) setError(message);
  };

  const addToBatch = async (batchId: string) => {
    setBusyAction("batch");
    const count = selected.size;
    try {
      await adminApi.updateBatchOrders(batchId, { add: [...selected] });
      toast.success(`${count} захиалга багцад нэмэгдлээ.`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Багцад нэмж чадсангүй.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  /** Сонгосон эсвэл одоогийн шүүлтийн захиалгыг дэлгэрэнгүйгээр авч хэвлэх/Excel. */
  const runExport = async (mode: "print" | "excel", columns: OrderExportSelection) => {
    setExportBusy(mode);
    setError(null);
    try {
      const res = await adminApi.exportOrders(
        selected.size > 0
          ? { ids: [...selected].join(",") }
          : {
              status: status || undefined,
              batch: batch || undefined,
              q: query || undefined,
              deleted: showDeleted ? true : undefined,
        claimed: claimed === "1" ? true : undefined,
              limit: 500,
            },
      );
      if (res.data.length === 0) {
        toast.error("Хэвлэх/татахад захиалга олдсонгүй.");
        return;
      }
      if (mode === "excel") {
        downloadOrdersExcel(res.data, undefined, columns);
        toast.success(`${res.data.length} захиалга Excel-д татагдлаа.`);
      } else {
        printOrders(res.data, columns);
        toast.success(`${res.data.length} захиалга хэвлэхэд бэлэн.`);
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Экспорт хийж чадсангүй.";
      setError(msg);
      toast.error(msg);
    } finally {
      setExportBusy(null);
    }
  };

  if (openId) {
    return (
      <OrderDetail
        orderId={openId}
        workspace="shop"
        onClose={() => setOpenId(null)}
        onChanged={markChanged}
      />
    );
  }

  const todayHandover = orders.filter(
    (o) => o.status === "ARRIVED" && o.fulfilment !== null,
  ).length;

  return (
    <div>
      <PageHead
        title={showDeleted ? "Устсан захиалга" : "Захиалга"}
        hint={
          showDeleted
            ? "Төлбөргүй устгасан захиалга — 10 хоног хадгалаад бүрмөсөн устана."
            : "Бүх захиалгын урсгал, төлөв"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={exportOpen === "print" ? "primary" : "outline"}
              disabled={exportBusy !== null}
              onClick={() => setExportOpen((v) => (v === "print" ? null : "print"))}
            >
              {selected.size > 0 ? `Хэвлэх (${selected.size})` : "Хэвлэх"}
            </Button>
            <Button
              size="sm"
              variant={exportOpen === "excel" ? "primary" : "outline"}
              disabled={exportBusy !== null}
              onClick={() => setExportOpen((v) => (v === "excel" ? null : "excel"))}
            >
              {selected.size > 0 ? `Excel (${selected.size})` : "Excel"}
            </Button>
            <Link
              href="/workspace/shop/orders/by-product"
              className="inline-flex h-9 items-center rounded-[8px] border border-line bg-bg px-3 text-[13px] text-ink"
            >
              Бараагаар
            </Link>
            <Link
              href="/workspace/shop/returns"
              className="inline-flex h-9 items-center rounded-[8px] border border-line bg-bg px-3 text-[13px] text-ink"
            >
              Буцаалт
            </Link>
            {canWrite && !showDeleted && (
              <Link
                href="/workspace/shop/orders/new"
                className="inline-flex h-9 items-center rounded-[8px] border border-primary bg-primary px-3 text-[13px] text-white"
              >
                Захиалга оруулах
              </Link>
            )}
          </div>
        }
      />

      {exportOpen && (
        <OrderExportPanel
          busy={exportBusy === exportOpen}
          confirmLabel={
            exportOpen === "excel"
              ? selected.size > 0
                ? `Excel татах (${selected.size})`
                : "Excel татах"
              : selected.size > 0
                ? `Хэвлэх (${selected.size})`
                : "Хэвлэх"
          }
          onConfirm={(columns) => void runExport(exportOpen, columns)}
        />
      )}

      {!showDeleted && (
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Шинэ захиалга" value={summary?.newOrders ?? "—"} onClick={() => updateWorkspaceQuery({ status: "NEW", q: null, batch: null, claimed: null, deleted: null })} active={status === "NEW"} />
        <Metric
          label="Төлбөр шалгах"
          value={summary?.paymentClaims ?? "—"}
          tone={summary && summary.paymentClaims > 0 ? "warn" : "neutral"}
          sub="Шилжүүлсэн гэж мэдэгдсэн"
          onClick={() => updateWorkspaceQuery({ claimed: "1", status: null, batch: null, q: null, deleted: null })}
          active={claimed === "1"}
        />
        <Metric label="Ирсэн" value={summary?.arrived ?? "—"} tone="ok" onClick={() => updateWorkspaceQuery({ status: "ARRIVED", q: null, batch: null, claimed: null, deleted: null })} active={status === "ARRIVED"} />
        <Metric
          label="Олгоход бэлэн"
          value={todayHandover}
          sub="Одоогийн жагсаалтаас"
        />
      </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowDeleted(false)}
          className={`h-10 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
            !showDeleted ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
          }`}
        >
          Идэвхтэй
        </button>
        <button
          type="button"
          onClick={() => {
            setShowDeleted(true);
            setSelected(new Set());
            setStatus("");
            setBatch("");
          }}
          className={`h-10 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
            showDeleted ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
          }`}
        >
          Устсан
        </button>
        {!showDeleted && (
          <>
            <Select
              value={status}
              onChange={setStatus}
              placeholder="Бүх статус"
              options={STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] }))}
            />
            <Select
              value={batch}
              onChange={setBatch}
              placeholder="Бүх багц"
              options={batches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </>
        )}
        <div className="min-w-[200px] flex-1">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Код, нэр, утас, и-мэйл"
          />
        </div>
        {(search || status || batch || showDeleted || claimed) && <Button size="sm" variant="ghost" onClick={() => updateWorkspaceQuery({ q: null, status: null, batch: null, deleted: null, claimed: null })}>Шүүлт цэвэрлэх</Button>}
        <span className="text-[12px] text-muted">{pageMeta.total} захиалга</span>
        {refreshing && (
          <span className="text-[13px] text-muted">Шинэчилж байна…</span>
        )}
      </div>

      {canWrite && selected.size > 0 && !showDeleted && (
        <Card className="sticky top-[76px] z-10 mb-4 flex flex-wrap items-center gap-3 border-secondary-muted bg-bg p-3">
          <span className="text-[14px]">{selected.size} захиалга сонгосон</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => advanceSelected("CONFIRMED")}
              disabled={busy}
              loading={busyAction === "CONFIRMED"}
            >
              Баталгаажуулах
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCancelIds([...selected])}
              disabled={busy}
              loading={busyAction === "CANCELLED"}
            >
              Цуцлах
            </Button>
            <Select
              value=""
              onChange={(id) => id && addToBatch(id)}
              placeholder="Багцад нэмэх"
              className="h-9 text-[13px]"
              options={batches
                .filter((b) => b.stage === "IN_TRANSIT")
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Болих
            </Button>
          </div>
        </Card>
      )}

      <WorkspaceDialog open={cancelIds.length > 0} onClose={() => setCancelIds([])} title="Сонгосон захиалгыг цуцлах">
        <div className="p-5">
          <p className="mt-0 text-[14px]">{cancelIds.length} захиалгыг цуцлах гэж байна. Төлсөн мөнгөний буцаалтыг захиалга тус бүрээс шалгана.</p>
          <div className="mb-5 max-h-48 overflow-y-auto rounded-lg border border-line px-3 py-2 text-[13px]">
            {cancelIds.map((id) => <div key={id} className="py-1">{orders.find((order) => order.id === id)?.code ?? id}</div>)}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setCancelIds([])}>Болих</Button>
            <Button variant="danger" disabled={busy} onClick={() => { const ids = cancelIds; setCancelIds([]); void advanceSelected("CANCELLED", ids); }}>{cancelIds.length} захиалга цуцлах</Button>
          </div>
        </div>
      </WorkspaceDialog>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Empty>Захиалга олдсонгүй.</Empty>
      ) : (
        <>
          {/* Desktop — хүснэгт */}
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  {canWrite && (
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Бүгдийг сонгох"
                      checked={selected.size === orders.length && orders.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())
                      }
                    />
                  </Th>
                  )}
                  <Th>Код</Th>
                  <Th>Хэрэглэгч</Th>
                  <Th>Бараа</Th>
                  <Th>Дүн</Th>
                  <Th>Төлбөр</Th>
                  <Th>Статус</Th>
                  {showDeleted ? <Th>Үлдсэн</Th> : <Th>Багц</Th>}
                  <Th>Огноо</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className={selected.has(order.id) ? "bg-surface" : ""}>
                    {canWrite && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`${order.code} сонгох`}
                        checked={selected.has(order.id)}
                        onChange={() => toggle(order.id)}
                      />
                    </Td>
                    )}
                    <Td className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setOpenId(order.id)}
                        className="tnum cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                      >
                        {order.code}
                      </button>
                      {order.isLeasing && (
                        <div className="mt-1">
                          <LeasingBadge />
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div>{customerNameLabel(order.customer.name)}</div>
                      <div className="tnum text-[13px] text-muted">
                        {phoneLabel(order.customer.phone)}
                      </div>
                    </Td>
                    <Td className="tnum">{order.itemCount} ш</Td>
                    <Td className="tnum whitespace-nowrap">
                      <div>{money(order.subtotal)}</div>
                      {order.dueAmount > 0 && (
                        <div className="text-[13px] text-warn">
                          үлдэгдэл {money(order.dueAmount)}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL_SHORT[order.paymentState]}
                      </Badge>
                      {order.paymentClaimedAt && order.dueAmount > 0 && (
                        <div className="mt-1 text-[12px] text-info">Шилжүүлсэн гэсэн</div>
                      )}
                    </Td>
                    <Td>
                      <OrderBadge status={order.status} />
                    </Td>
                    {showDeleted ? (
                      <Td className="tnum text-[13px] text-warn">
                        {order.daysLeft != null ? `${order.daysLeft} хоног` : "—"}
                      </Td>
                    ) : (
                      <Td className="text-[13px] text-ink-2">
                        {order.batch ? (
                          <>
                            <div>{order.batch.name}</div>
                            <div className="text-muted">{BATCH_STAGE_LABEL[order.batch.stage]}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                    )}
                    <Td className="tnum whitespace-nowrap text-[13px] text-ink-2">
                      {dayLabel(showDeleted && order.deletedAt ? order.deletedAt : order.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* Утас — карт */}
          <div className="flex flex-col gap-3 md:hidden">
            {orders.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-center gap-2">
                    {canWrite && !showDeleted && (
                      <input
                        type="checkbox"
                        aria-label={`${order.code} сонгох`}
                        checked={selected.has(order.id)}
                        onChange={() => toggle(order.id)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenId(order.id)}
                      className="tnum cursor-pointer border-0 bg-transparent p-0 text-[15px] font-medium text-ink underline"
                    >
                      {order.code}
                    </button>
                  </label>
                  <OrderBadge status={order.status} />
                </div>
                <div className="mt-2 text-[14px]">{customerNameLabel(order.customer.name)}</div>
                <div className="tnum text-[13px] text-muted">
                  {phoneLabel(order.customer.phone)} · {order.itemCount} бараа
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="tnum text-[15px]">{money(order.subtotal)}</span>
                  <span className="tnum text-[13px] text-muted">
                    {dayLabel(showDeleted && order.deletedAt ? order.deletedAt : order.createdAt)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.isLeasing && <LeasingBadge />}
                  <Badge tone={PAYMENT_TONE[order.paymentState]}>
                    {PAYMENT_LABEL_SHORT[order.paymentState]}
                  </Badge>
                  {showDeleted && order.daysLeft != null && (
                    <Badge tone="warn">Үлдсэн {order.daysLeft} хоног</Badge>
                  )}
                  {order.paymentClaimedAt && order.dueAmount > 0 && (
                    <Badge tone="info">Шилжүүлсэн гэсэн</Badge>
                  )}
                  {!showDeleted && order.batch && <Badge tone="info">{order.batch.name}</Badge>}
                </div>
                </Card>
            ))}
          </div>

          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} loading={moreLoading}>
                Цааш үзэх · {pageMeta.total - orders.length} захиалга
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
