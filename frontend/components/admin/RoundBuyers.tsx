"use client";

import { useCallback, useEffect, useState } from "react";
import { Metric, OrderBadge, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminApi.roundOrders(roundId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHead
          title="Худалдан авагчид"
          actions={
            <Button variant="ghost" onClick={onClose}>
              Буцах
            </Button>
          }
        />
        <ErrorNote>{error ?? "Мэдээлэл алга."}</ErrorNote>
      </div>
    );
  }

  const { round, summary, orders } = data;
  const live = orders.filter((o) => !o.cancelled);
  const cancelled = orders.filter((o) => o.cancelled);

  return (
    <div className="max-w-[1000px]">
      <PageHead
        title={round.name}
        hint={`#${round.roundNo} гаргалт · ${money(round.sellPrice)}${
          round.closeAt ? ` · ${dayLabel(round.closeAt)}-нд хаагдана` : " · бэлэн бараа"
        }`}
        actions={
          <Button variant="ghost" onClick={onClose}>
            Буцах
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Хэдэн хүн авсан" value={summary.customerCount} />
        <Metric label="Нийт ширхэг" value={summary.qty} tone="info" />
        <Metric label="Орлого" value={money(summary.revenue)} />
        <Metric
          label="Төлбөр дутуу"
          value={summary.unpaidCount}
          tone={summary.unpaidCount > 0 ? "warn" : "ok"}
          sub={summary.unpaidCount > 0 ? "Мөнгө ороогүй" : "Бүгд төлсөн"}
        />
      </div>

      {/* Нийлүүлэгч рүү явуулах жагсаалт — хамгийн их хэрэглэгддэг хэсэг. */}
      {summary.qty > 0 && (
        <Card className="mb-5 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium">Захиалах тоо</div>
              <div className="text-[13px] text-muted">
                Нийлүүлэгч рүү явуулах задаргаа
              </div>
            </div>
            <span className="tnum text-[20px] font-medium">{summary.qty} ш</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.byVariant.map((v, i) => (
              <div
                key={i}
                className="flex items-baseline gap-2 rounded-[8px] border border-line bg-surface px-3 py-2"
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
              Өртөг <span className="tnum">{money(round.costPrice * summary.qty)}</span>
            </span>
            <span>
              Ашиг <span className="tnum text-ok">{money(summary.profit)}</span>
            </span>
            {summary.cancelledCount > 0 && (
              <span className="text-danger">{summary.cancelledCount} цуцлагдсан</span>
            )}
          </div>
        </Card>
      )}

      {orders.length === 0 ? (
        <Empty>Энэ гаргалтыг хэн ч аваагүй байна.</Empty>
      ) : (
        <>
          <div className="mb-2 text-[15px] font-medium">
            Худалдан авагчид
            <span className="ml-2 text-[13px] text-muted">{live.length} захиалга</span>
          </div>

          {/* Desktop — хүснэгт */}
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Хэрэглэгч</Th>
                  <Th>Код</Th>
                  <Th>Сонголт</Th>
                  <Th>Тоо</Th>
                  <Th>Дүн</Th>
                  <Th>Төлбөр</Th>
                  <Th>Статус</Th>
                  <Th>Огноо</Th>
                </tr>
              </thead>
              <tbody>
                {[...live, ...cancelled].map((o) => (
                  <tr key={o.orderId + o.code} className={o.cancelled ? "opacity-50" : ""}>
                    <Td>
                      <div className={o.cancelled ? "line-through" : ""}>
                        {o.customer.name ?? "Нэргүй"}
                      </div>
                      <div className="tnum text-[13px] text-muted">
                        {phoneLabel(o.customer.phone)}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {onOpenOrder ? (
                        <button
                          type="button"
                          onClick={() => onOpenOrder(o.orderId)}
                          className="tnum cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                        >
                          {o.code}
                        </button>
                      ) : (
                        <span className="tnum">{o.code}</span>
                      )}
                    </Td>
                    <Td className="text-[13px]">
                      {formatSelections(o.selections, o.size, o.color) || "—"}
                    </Td>
                    <Td className="tnum">{o.qty} ш</Td>
                    <Td className="tnum whitespace-nowrap">{money(o.total)}</Td>
                    <Td>
                      <Badge tone={PAYMENT_TONE[o.paymentState]}>
                        {PAYMENT_LABEL_SHORT[o.paymentState]}
                      </Badge>
                      {o.paymentClaimedAt && o.dueAmount > 0 && (
                        <div className="mt-1 text-[12px] text-info">Шилжүүлсэн гэсэн</div>
                      )}
                    </Td>
                    <Td>
                      {o.cancelled ? (
                        <Badge tone="danger">Цуцлагдсан</Badge>
                      ) : (
                        <OrderBadge status={o.status} />
                      )}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-[13px] text-ink-2">
                      {dayLabel(o.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* Утас — карт */}
          <div className="flex flex-col gap-3 md:hidden">
            {[...live, ...cancelled].map((o) => (
              <Card key={o.orderId + o.code} className={`p-4 ${o.cancelled ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px]">{o.customer.name ?? "Нэргүй"}</div>
                    <div className="tnum text-[13px] text-muted">
                      {phoneLabel(o.customer.phone)}
                    </div>
                  </div>
                  {o.cancelled ? (
                    <Badge tone="danger">Цуцлагдсан</Badge>
                  ) : (
                    <OrderBadge status={o.status} />
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-muted">
                    {formatSelections(o.selections, o.size, o.color) || "Сонголтгүй"} · {o.qty} ш
                  </span>
                  <span className="tnum">{money(o.total)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {onOpenOrder ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(o.orderId)}
                      className="tnum cursor-pointer border-0 bg-transparent p-0 text-[14px] text-ink underline"
                    >
                      {o.code}
                    </button>
                  ) : (
                    <span className="tnum text-[14px]">{o.code}</span>
                  )}
                  <Badge tone={PAYMENT_TONE[o.paymentState]}>
                    {PAYMENT_LABEL_SHORT[o.paymentState]}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
