"use client";

import {
  Metric,
  OrderBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Badge, Button, Card, Empty } from "@/components/ui";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import { money } from "@/lib/format";
import type { AdminBatchDetail, BatchOrderRow } from "@/lib/types";
import { ArrivalSmsPanel } from "./ArrivalSmsPanel";

function fulfilmentLabel(order: BatchOrderRow) {
  if (order.handedOver) return { text: "Олгосон", tone: "ok" as const };
  if (order.handedOverPartial) return { text: "Хэсэгчлэн олгосон", tone: "warn" as const };
  if (order.warehouseArrived) return { text: "Агуулахад ирсэн", tone: "info" as const };
  return { text: "Хүлээгдэж буй", tone: "neutral" as const };
}

export function BatchOrdersPanel({
  batch,
  busyKey,
  onOpenOrder,
  onOmit,
  onReinstate,
  onSmsSent,
}: {
  batch: AdminBatchDetail;
  busyKey: string | null;
  onOpenOrder: (orderId: string) => void;
  onOmit: (order: BatchOrderRow) => void;
  onReinstate: (order: BatchOrderRow) => void;
  onSmsSent: () => void;
}) {
  const canOmit = batch.stage === "IN_TRANSIT";
  const unpaidCount = batch.orders.filter((o) => (o.paidAmount ?? 0) < o.subtotal).length;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Захиалга" value={batch.orders.length} />
        <Metric label="Барааны дүн" value={money(batch.totalValue)} />
        <Metric label="Карго" value={money(batch.totalCargo ?? 0)} />
      </div>
      <p className="mt-0 mb-4 text-[13px] text-muted">
        Карго төлбөр бараа болон лизингийн үндсэн төлбөрөөс тусдаа харагдана. Энд дахин тооцохгүй.
      </p>

      {(batch.stage === "AT_WAREHOUSE" || batch.stage === "DONE") && (
        <ArrivalSmsPanel batch={batch} onSent={onSmsSent} />
      )}

      <h2 className="mt-6 mb-2 text-[16px] font-medium">Захиалгууд</h2>
      {unpaidCount > 0 && (
        <Card className="mb-3 border-warn bg-warn-bg p-3">
          <div className="text-[13px] text-warn">
            <span className="tnum font-medium">{unpaidCount}</span> захиалгын төлбөр дутуу
            {canOmit && " — урагшлуулахгүй бол «Хасах»."}
          </div>
        </Card>
      )}
      {batch.orders.length === 0 ? (
        <Empty>Захиалга алга. Хаагдсан гаргалт нэмэхэд захиалгууд энд орно.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Код</Th>
              <Th>Харилцагч</Th>
              <Th className="text-right">Бараа</Th>
              <Th className="text-right">Карго</Th>
              <Th>Төлбөр</Th>
              <Th>Агуулах</Th>
              <Th>Мэдэгдэл</Th>
              <Th>Олголт</Th>
              {canOmit && <Th className="text-right" />}
            </tr>
          </thead>
          <tbody>
            {batch.orders.map((order) => {
              const fulfilment = fulfilmentLabel(order);
              return (
                <tr
                  key={order.id}
                  onClick={() => onOpenOrder(order.id)}
                  className="cursor-pointer transition-colors hover:bg-surface"
                >
                  <Td>
                    <span className="tnum text-[13px] underline underline-offset-2">
                      {order.code}
                    </span>
                  </Td>
                  <Td>
                    <div className="text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                    <div className="tnum text-[12px] text-muted">{order.customer.phone}</div>
                  </Td>
                  <Td className="text-right">
                    <span className="tnum">{money(order.subtotal)}</span>
                    <div className="text-[12px] text-muted">
                      {order.arrivedPieces ?? 0}/{order.itemCount} ш
                    </div>
                  </Td>
                  <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <span className="tnum">{money(order.cargoFee ?? 0)}</span>
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Badge tone={PAYMENT_TONE[order.paymentState]}>
                      {PAYMENT_LABEL_SHORT[order.paymentState]}
                    </Badge>
                    {order.dueAmount > 0 && (
                      <div className="tnum mt-0.5 text-[12px] text-warn">
                        үлдэгдэл {money(order.dueAmount)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={order.warehouseArrived ? "ok" : "neutral"}>
                      {order.warehouseArrived ? "Ирсэн" : "Үгүй"}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={order.notified ? "ok" : "neutral"}>
                      {order.notified ? "Мэдэгдсэн" : "Үгүй"}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={fulfilment.tone}>{fulfilment.text}</Badge>
                    <div className="mt-0.5">
                      <OrderBadge status={order.status} />
                    </div>
                  </Td>
                  {canOmit && (
                    <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyKey === `omit:${order.id}`}
                        disabled={busyKey !== null}
                        onClick={() => onOmit(order)}
                      >
                        Хасах
                      </Button>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {(batch.omittedOrders?.length ?? 0) > 0 && (
        <>
          <h2 className="mt-6 mb-1 text-[16px] font-medium">Хассан захиалгууд</h2>
          <p className="mt-0 mb-2 text-[13px] text-ink-2">
            Төлбөр ороогүй тул багцаас хассан. Мөнгө орвол (хоцорсон ч) дахин оруулж бэлдэнэ.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Код</Th>
                <Th>Харилцагч</Th>
                <Th className="text-right">Дүн</Th>
                <Th>Төлбөр</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {batch.omittedOrders.map((order) => {
                const canReinstate = order.dueAmount <= 0 && batch.stage !== "DONE";
                return (
                  <tr
                    key={order.id}
                    onClick={() => onOpenOrder(order.id)}
                    className="cursor-pointer transition-colors hover:bg-surface"
                  >
                    <Td>
                      <span className="tnum text-[13px] underline underline-offset-2">
                        {order.code}
                      </span>
                    </Td>
                    <Td>
                      <div className="text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                      <div className="tnum text-[12px] text-muted">{order.customer.phone}</div>
                    </Td>
                    <Td className="text-right">
                      <span className="tnum">{money(order.subtotal)}</span>
                    </Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL_SHORT[order.paymentState]}
                      </Badge>
                      {order.dueAmount > 0 ? (
                        <div className="tnum mt-0.5 text-[12px] text-warn">
                          үлдэгдэл {money(order.dueAmount)}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[12px] text-ok">Төлбөр орсон — оруулж болно</div>
                      )}
                    </Td>
                    <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        disabled={!canReinstate || busyKey !== null}
                        loading={busyKey === `reinstate:${order.id}`}
                        onClick={() => onReinstate(order)}
                      >
                        Дахин оруулах
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
