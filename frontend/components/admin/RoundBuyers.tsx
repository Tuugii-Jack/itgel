"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Metric, PageHead, ProductStatusBadge } from "@/components/admin/shared";
import { Button, Card, ErrorNote, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { RoundBuyerList } from "@/features/orders/components/RoundBuyerList";
import { ProductOrderExport } from "@/features/orders/components/ProductOrderExport";
import { roundBuyerCounts } from "@/features/orders/productOrderView";
import { useOnKeyChange } from "@/lib/syncKey";
import { ArrowLeft, Package } from "lucide-react";
import {
  closeHint,
  DEFAULT_PRODUCT_PRINT,
  downloadProductOrdersExcel,
  printProductOrders,
  productExcelFilename,
  roundOrdersToPrintProduct,
  type ProductPrintOptions,
} from "@/lib/roundPrint";
import type { RoundOrders } from "@/lib/types";

/**
 * «Энэ барааг хэн хэн авсан бэ».
 *
 * Хамгийн дээр нийлүүлэгч рүү захиалах тоо — хэмжээ, өнгөөр задалсан.
 * Доор нь худалдан авагч бүр: хэн, хэдийг, ямар төлбөртэй.
 */
export function RoundBuyers({
  roundId,
  onClose,
  onOpenOrder,
}: {
  roundId: string;
  onClose: () => void;
  /** Захиалгын код дээр дарахад захиалгын дэлгэрэнгүй рүү үсрэх. */
  onOpenOrder?: (orderId: string) => void;
}) {
  const [data, setData] = useState<RoundOrders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState<ProductPrintOptions>(DEFAULT_PRODUCT_PRINT);

  const requests = useRef(0);
  const [printBusy, setPrintBusy] = useState<"print" | "excel" | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  useOnKeyChange(roundId, () => { setData(null); setPrintOpen(false); setPrintError(null); });

  const load = useCallback(async () => {
    const generation = ++requests.current;
    setLoading(true);
    setError(null);
    try {
      const value = await adminApi.roundOrders(roundId);
      if (generation === requests.current) setData(value);
    } catch (e) {
      if (generation === requests.current) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (generation === requests.current) setLoading(false);
    }
  }, [roundId]);

  useEffect(() => {
    const current = requests; const cancel = deferEffect(() => { void load(); });
    return () => { cancel(); current.current++; };
  }, [load]);

  if (loading) {
    return (
      <div><Button variant="ghost" onClick={onClose}>Буцах</Button><Skeleton className="mb-4 h-36 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHead
          title="Худалдан авагчид"
          actions={<Button variant="ghost" onClick={onClose}>Буцах</Button>}
        />
        <ErrorNote>{error ?? "Мэдээлэл алга."}</ErrorNote><Button className="mt-4" variant="outline" onClick={() => void load()}>Дахин ачаалах</Button>
      </div>
    );
  }

  const { round, summary, orders } = data;
  const counts = roundBuyerCounts(orders);
  const closed = round.closed ?? round.status === "CLOSED";

  return (
    <div className="mx-auto max-w-[1180px]">
      <button type="button" onClick={onClose} className="mb-4 inline-flex min-h-9 items-center gap-2 text-[13px] text-ink-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Буцах</button>
      <Card className="mb-5 p-5 sm:p-6">
      <PageHead
        title={round.name}
        hint={`#${round.roundNo} гаргалт · ${closeHint({
          closed,
          closeAt: round.closeAt,
          daysOpen: round.daysOpen ?? null,
          daysSinceClose: round.daysSinceClose ?? null,
        })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" aria-expanded={printOpen} onClick={() => setPrintOpen((v) => !v)}>
              Хэвлэх / Excel
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]"><ProductStatusBadge status={round.status} /><span className="text-muted">Үндсэн үнэ <span className="tnum text-ink">{money(round.sellPrice)}</span></span></div>
      </Card>

      {printOpen && <ProductOrderExport options={printOpts} onChange={setPrintOpts} busy={printBusy}
        scopeLabel="Энэ гаргалтын бүх идэвхтэй барааны задаргаа экспортод орно. Доорх хайлт, шүүлт хэвлэх тоог өөрчлөхгүй."
        onExport={(mode) => {
          if (printBusy) return;
          setPrintBusy(mode);
          setPrintError(null);
          try {
            const products = [roundOrdersToPrintProduct(data)];
            if (mode === 'excel') downloadProductOrdersExcel(products, printOpts, { filename: productExcelFilename(round.name) });
            else printProductOrders(products, printOpts, { title: round.name, countLabel: summary.qty + ' ш', hint: closeHint({ closed, closeAt: round.closeAt, daysOpen: round.daysOpen ?? null, daysSinceClose: round.daysSinceClose ?? null }) });
          } catch { setPrintError(mode === 'excel' ? 'Excel татаж чадсангүй.' : 'Хэвлэж чадсангүй.'); }
          finally { setPrintBusy(null); }
        }} />}
      {printError && <div className="mb-4"><ErrorNote>{printError}</ErrorNote></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Худалдан авагч" value={summary.customerCount} sub={counts.active + " захиалга"} />
        <Metric label="Нийт ширхэг" value={summary.qty} tone="info" />
        <Metric label="Барааны нийт дүн" value={money(summary.revenue)} sub="Орсон төлбөрийн дүн биш" />
        <Metric
          label="Үлдэгдэлтэй захиалга"
          value={counts.unpaid}
          tone={counts.unpaid > 0 ? "warn" : "ok"}
          sub="Нэг кодыг нэг удаа тоолно"
        />
      </div>

      {/* Нийлүүлэгч рүү явуулах жагсаалт — хамгийн их хэрэглэгддэг хэсэг. */}
      {summary.qty > 0 && (
        <Card className="mb-5 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-medium"><Package className="h-4 w-4 text-secondary" aria-hidden="true" />Захиалах тоо</div>
              <div className="text-[13px] text-muted">
                Нийлүүлэгч рүү явуулах задаргаа
              </div>
            </div>
            <span className="tnum text-[20px] font-medium">{summary.qty} ш</span>
          </div>
          {(summary.byKind ?? []).length > 0 && (
            <details className="mb-4 rounded-lg border border-line p-3"><summary className="cursor-pointer text-[13px] text-ink-2">Өнгө, хэмжээ тус бүрийн нийлбэр</summary><div className="mt-3 flex flex-col gap-3">
              {summary.byKind!.map((kind) => (
                <div key={kind.kind}>
                  <div className="mb-1.5 text-[13px] text-ink-2">{kind.kind}</div>
                  <div className="flex flex-wrap gap-2">
                    {kind.rows.map((row) => (
                      <div
                        key={row.value}
                        className="flex items-baseline gap-2 rounded-[8px] border border-line bg-surface px-3 py-2"
                      >
                        <span className="text-[14px]">{row.value}</span>
                        <span className="tnum text-[15px] font-medium">{row.qty} ш</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div></details>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.byVariant.map((v, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-3"
              >
                <span className="text-[14px]">
                  {formatSelections(v.selections, v.size, v.color) || "Сонголтгүй"}
                </span>
                <span className="tnum text-[15px] font-medium">{v.qty} ш</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
            <span>
              Барааны дүн <span className="tnum">{money(summary.revenue)}</span>
            </span>
            {summary.cancelledCount > 0 && (
              <span className="text-danger">{summary.cancelledCount} цуцлагдсан мөр</span>
            )}
          </div>
        </Card>
      )}

      <RoundBuyerList key={roundId} orders={orders} onOpenOrder={onOpenOrder} />
    </div>
  );
}
